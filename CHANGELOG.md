## [Unreleased]

### Security

- **Every id that reaches a request path is validated, including in the
  SDK-backed tools.** Only the REST-helper tools checked path ids. The SDK
  builds paths such as `/tickets/<id>/comment` with no encoding and `fetch`
  resolves `..` segments, so a crafted string id in `syncro_tickets_get`,
  `_update` or `_add_comment`, `syncro_customers_get`, `syncro_contacts_get`,
  `syncro_assets_get` or `syncro_invoices_get` could send a call to a
  different endpoint than the tool names, including one this server guards
  with `confirm`. Each of those ids now goes through `pathId` first, as does
  the id of a time entry that Syncro returns and is then used in a path.
  `tests/domains/path-ids.test.ts` has one row per (tool, id argument), so
  removing any single check fails a test; it includes the seven existing
  checks that had no test (`time_log_entry` `ticket_id`, `set_billable`
  `timer_id`, `get_patches` and `list_installed_applications` `asset_id`,
  `set_policy_folder` `asset_id` and `policy_folder_id`, `run_script`
  `asset_id`).

- **A destructive prompt now shows exactly what is sent, or the call is
  refused.** `syncro_assets_run_script` (`run_as`, variable names and values)
  and `syncro_invoices_email` (`cc_emails`, `subject`, `message`) used to
  collapse whitespace and drop control characters for display while sending the
  raw value, and measured length limits on the collapsed text. They now refuse
  a value that is not a string or that contains a control character other than
  newline and tab, a format, private-use, unassigned or surrogate character, a
  line or paragraph separator, or a character that draws nothing (for example
  U+2800, U+3164, U+FFA0, U+115F, U+1160). Length limits are measured on the
  raw value, and the prompt shows the raw value as a JSON string, so a newline
  appears as `\n`. One helper, `quoteInFull` in `src/utils/prompt-text.ts`.

- **A malformed `Host` header or request target no longer stops the HTTP
  server.** The listener parsed the request target against the client's `Host`
  header before authentication, and a value `URL` could not parse threw out of
  the request handler, which exits the process. The target is now parsed
  against a fixed base inside a guard, so the `Host` header is not consulted;
  an unparseable target is answered with a 400 JSON body and the server keeps
  serving. Routes, the S2S check, the credential check and the responses to
  valid requests are unchanged. (The MCP transport itself still answers 400 to
  an unparseable `Host` on `/mcp`, after the S2S check.)

- **The Syncro subdomain is validated before it becomes a host name.** It was
  used as-is in `https://<subdomain>.syncromsp.com`, so a value containing `/`
  or `#` (for example from the `X-Syncro-Subdomain` header or
  `SYNCRO_SUBDOMAIN`) could send the API key to another host. `getClient()` in
  `src/utils/client.ts` now accepts only one DNS label (letters, digits and
  inner hyphens, at most 63 characters) and otherwise fails with a clear error
  and no outbound request. Both the SDK-backed tools and the new REST helper
  build their host from that client, so both are covered. A value such as
  `acme.syncromsp.com` is now rejected; use `acme`.

- **Cross-tenant elicitation/confirmation misroute (gateway mode).** The
  "server reference" used by elicitation helpers (`src/utils/elicitation.ts`
  — `elicitSelection` / `elicitText` / `elicitConfirmation`) was stored in a
  module-level `let _server: Server | null` singleton in
  `src/utils/server-ref.ts`, set synchronously per request via
  `setServerRef(server)` (called from `createMcpServer()` in
  `src/mcp-server.ts`) and read back later via `getServerRef()` — including
  after `await` gaps inside async tool handlers (e.g. after awaiting a
  Syncro API call, before sending an elicitation or confirmation prompt back
  through "the" server).
  - **Impact:** in gateway (multi-tenant HTTP) mode — `AUTH_MODE=gateway` —
    a fresh `Server` instance is created per inbound request, so two
    concurrent tenant requests could race through the shared global: tenant
    A's request sets the ref and starts awaiting async work; before A
    resumes, tenant B's request runs and overwrites the module-level ref
    with B's server/transport; when A's awaited work resolves and it reads
    the ref back to call `elicitInput`, it gets B's server — so A's
    elicitation/confirmation prompt is sent down B's connection instead of
    A's (or vice versa, depending on timing). Same shared-mutable-state
    -across-await-gaps bug class as the credential-leak fixes in
    liongard-mcp#58, ninjaone-mcp#71, and the identical server-ref fix in
    halopsa-mcp#65, but in the server/transport routing subsystem for
    elicitation, not credential/token caching.
  - **Fix:** replaced the module-level singleton with an `AsyncLocalStorage<Server>`
    context (`runWithServerRef` for per-request transports — Node HTTP,
    Workers — and `bindServerRef` for the single-session stdio transport),
    mirroring the existing per-request credential isolation pattern already
    used for Syncro credentials (`credentialStore` in
    `src/utils/credential-store.ts`). `getServerRef()` now reads from the
    ALS context instead of a shared variable, so it is correctly scoped to
    the request that created it and survives arbitrary `await` gaps without
    observing a concurrent request's server. There is no module-level
    mutable server/transport state left in `src/utils/server-ref.ts`. Call
    sites updated: `src/mcp-server.ts` (`createMcpServer` no longer calls
    `setServerRef`), `src/index.ts` (Node HTTP `handleMcp` wraps the
    connect/handleRequest chain in `runWithServerRef`; stdio calls
    `bindServerRef` once at startup), `src/worker.ts` (Cloudflare Workers
    `handleMcp` wraps the connect/handleRequest chain in `runWithServerRef`).
  - **Regression test:** `tests/utils/server-ref.test.ts` forces a
    deterministic interleave (a manually-resolved "gate" promise, not a
    timing stagger) where tenant A binds its server and suspends on an
    await gap, tenant B's entire request runs to completion in the
    meantime, and only then does tenant A resume and elicit. The test
    asserts by value which tenant's mock `elicitInput` actually received
    each message. Verified to fail with the exact predicted symptom
    (`expected 'tenant-B' to be 'tenant-A'`) against a reinstated
    module-singleton implementation, and to pass against the ALS-based fix.

### Added

- **Interactive ticket card via MCP Apps (SEP-1865).** `syncro_tickets_get` results now render as an interactive card in MCP Apps hosts (Claude Desktop/web, and other hosts advertising the `io.modelcontextprotocol/ui` extension), instead of a wall of JSON. The card shows the ticket subject, status, problem type, resolved customer/contact names, key dates, and recent comments — and includes a working "Add comment" round-trip that calls `syncro_tickets_add_comment` with a safe internal-only (`hidden: true`) default resolved server-side. Non-App hosts are unaffected: the tool's JSON payload is unchanged apart from a new `_card` field.
  - The two renderable tools advertise the UI via `_meta` (`ui/resourceUri`, plus the nested `ui.resourceUri` form) pointing at a new `ui://syncro/ticket-card.html` resource served as `text/html;profile=mcp-app`. The card HTML is a self-contained vite single-file bundle embedded at build time (`src/generated/ticket-card-html.ts`, committed), so it serves identically from stdio, Node HTTP, and the fs-less Cloudflare Workers runtime. The server now declares the `resources` capability and answers `resources/list` / `resources/read` (`src/resources.ts`).
  - The card is neutral by default (system fonts, no vendor identity, no external fetches) and brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env vars (`MCP_BRAND_NAME`, `MCP_BRAND_LOGO_URL`, `MCP_BRAND_PRIMARY_COLOR`, `MCP_BRAND_ACCENT_COLOR`, `MCP_BRAND_BG`, `MCP_BRAND_TEXT`): at serve time the server replaces the card's BRAND_INJECT marker with an inline, `<`-escaped `window.__BRAND__` script, so self-hosters can theme the card without rebuilding. No brand configured = HTML served unchanged.

- **Syncro MSP job depth (WYREAI-464).** New tools cover time, ticket line
  items and RMM and patch work that the official Syncro MCP leaves open. They call
  Syncro's REST API directly through `src/utils/rest.ts` (30s timeout per
  call; path IDs must be positive integers) because `@wyre-ai/node-syncro`
  does not wrap these endpoints.
  - **Time (new `time` domain):** `syncro_time_list_entries` (filter by
    `billing_status`, for example `unbilled`), `syncro_time_log_entry` and
    `syncro_time_set_billable`.
  - **Tickets:** `syncro_tickets_add_line_item` adds a labor, part or fee line
    item that carries onto the ticket's invoice.
  - **Assets / RMM:** `syncro_assets_get_patches`,
    `syncro_assets_list_installed_applications`,
    `syncro_assets_list_policy_folders`, `syncro_assets_set_policy_folder`
    and `syncro_assets_run_script`.
  - **Write confirmation:** over stdio with an elicitation-capable client,
    every new write asks the user through MCP elicitation first. A decline or
    cancel always stops the call, and a prompt that fails stops it too. Over
    HTTP, including behind the gateway, there is no prompt: the server is
    created per request and never learns the client's capabilities. Ordinary
    writes proceed with no confirmation, and the destructive
    `syncro_assets_run_script` requires `confirm: true`. That flag is supplied
    by the calling model, so it is a convention the model is asked to honour,
    not an enforcement boundary. On the gateway the boundary is the gateway's
    per-tool tier policy; restrict `syncro_assets_run_script` to the admin
    tier.
  - **Prompt contents:** a prompt shows what the call will send. Free text
    that cannot change what the call does (time entry notes, a line item name
    and description) is reduced to one line, stripped of control and format
    characters (`\p{C}`, for example ESC, NUL and right-to-left override),
    shown in double quotes with embedded quotes escaped, and cut at 200
    characters with the full length stated. The destructive tools show the raw
    value or refuse; see the Security entry above. A line item prompt shows
    every field it sends: quantity, name, description, unit price, unit cost,
    catalog product and taxable. All through `src/utils/prompt-text.ts`.
  - **Write failures:** only a 4xx response (including a 429) means Syncro
    rejected a write, and it is reported as a plain rejection. A write that
    ends any other way (network error, timeout, a 5xx or other non-4xx status,
    or a 2xx whose body is not JSON) reports that it may or may not have been
    applied and that Syncro should be checked before retrying. This covers the
    REST-helper writes and the SDK-backed writes (`syncro_tickets_create`,
    `syncro_tickets_update`, `syncro_tickets_add_comment`,
    `syncro_customers_create`, `syncro_contacts_create`,
    `syncro_invoices_create` and `syncro_invoices_email`), through
    `syncroRest` and one wrapper, `sdkWrite` in `src/utils/write-outcome.ts`.
    Every write is sent once; see "Writes are sent once" under Fixed. The REST
    helper sets a 30s timeout; the SDK sets none and this server does not add
    one. An error body that ends in a full stop no longer produces `..` before
    that sentence.
  - **Stricter argument validation:** these checks run before a prompt is
    built or a request is sent, and a failure is returned as an error with no
    outbound call. `asset_id`, `script_id`, `policy_folder_id`, `ticket_id`,
    `timer_id` and `invoice_id` (and `user_id` and `product_id` on
    `syncro_time_log_entry` and `syncro_tickets_add_line_item`) must be
    positive integers; `script_id` and `invoice_id` were previously passed
    through unchecked. `duration_minutes` must be a positive whole number
    (Syncro's schema says integer) and `quantity` a number above 0;
    `price_retail` and `price_cost` must be finite numbers. `billable` and
    `taxable` must be real booleans. `run_at`, `start_at` and `end_at` must be
    real ISO 8601 date-times with `Z` or an offset (`2026-11-07T02:00:00Z`);
    a date-only value, a value with no offset and an impossible date such as
    the 31st of February are rejected. `syncro_assets_run_script` refuses the
    call if `run_as` or a variable name or value is over 200 characters, or the
    variables together are over 1000 characters when listed, and
    `syncro_invoices_email` refuses it if cc or subject is over 200 characters
    or the message is over 1000; see the Security entry above for what else is
    refused.
  - See `docs/WYREAI-464-capability-diff.md` for the capability diff and the
    jobs deferred for lack of a Syncro API (backup status, KB-level patch
    approval, recurring script schedules).

### Changed

- **Client cache moved off module-level state (defense-in-depth, not a live vulnerability).** `src/utils/client.ts` held the cached Syncro client/credentials in module-level `let _client` / `let _credentials` singletons, with manual "did credentials change → invalidate → recreate" logic in `getClient()`. A security review traced that sequence end-to-end and confirmed it is **not** exploitable as coded — the validate/invalidate/recreate/return path runs synchronously with no `await` between checking credentials and using the resulting client, so there is no interleaving that hands one tenant another tenant's client. It was still structurally fragile (a future edit that introduced an `await` in the wrong spot could reintroduce that bug class) and inconsistent with the rest of this file's per-tenant state, which already lives in `AsyncLocalStorage` (`credentialStore` in `src/utils/credential-store.ts`, and the `server-ref.ts` fix above for the identical bug class in a different subsystem).
  - **Fix:** the client cache now lives in an `AsyncLocalStorage`-scoped box instead of module variables (`runWithClientScope` for per-request transports — Node HTTP, Workers — and `bindClientScope` for the single-session stdio transport), mirroring `server-ref.ts`. Credential resolution, error messages, and the mismatch-detect-and-recreate behavior are unchanged — only where the mutable state lives has changed. Call sites updated: `src/index.ts` (Node HTTP `handleMcp` wraps the connect/handleRequest chain in `runWithClientScope`; stdio calls `bindClientScope` once at startup), `src/worker.ts` (Cloudflare Workers `handleMcp` wraps the connect/handleRequest chain in `runWithClientScope`). `getClient()` / `getCredentials()` / `clearClient()` keep their existing signatures and behavior, so no domain handler call sites changed.
  - **Regression test:** `tests/utils/client.test.ts` runs two concurrent "tenants" (distinct credential sets) through `runWithClientScope`, each with an `await` gap between validating credentials and re-using the client, and asserts each tenant's client is cached correctly within its own scope, is built from its own credentials, and is never the same instance as the other tenant's.

- **GitHub Packages publishing was set up, then turned off.** `publishConfig.registry` points at `npm.pkg.github.com`, but `.releaserc.json` sets `npmPublish: false` (commit 7416b03), so releases do not publish an npm package; the GHCR image and the `io.github.wyre-technology/syncro-mcp` MCP Registry identifier are what ships.

- **Every tool now carries MCP classification annotations.** All sidecar tools,
  including the existing customer, contact, ticket, asset and invoice tools,
  declare `readOnlyHint` / `destructiveHint` / `idempotentHint` presets
  (`src/utils/annotations.ts`) so clients can classify each as read, write or
  destructive. The annotations are hints, not enforcement.
  `tests/classification.test.ts` fails if a tool is unclassified or changes
  class. `syncro_invoices_email` is classified
  destructive, and its description now warns that sending cannot be undone.

- **`syncro_tickets_add_comment` now says that a public comment is emailed to
  the customer.** The tool and argument descriptions explain `hidden` (internal
  note) and `do_not_email`. Behaviour and defaults are unchanged.

- **`syncro_tickets_create` now says that `comment_body` may be visible to the
  customer.** The tool and argument descriptions warn that the initial comment
  may be emailed to the customer and cannot be marked hidden here, and point
  to `syncro_tickets_add_comment` with `hidden: true` for an internal note.
  Behaviour is unchanged.

- **`syncro_assets_set_policy_folder` now says that a policy folder can apply
  policies and scripts.** The description adds that moving a device into a
  policy folder can apply that folder's policies and scripts to it. Its
  classification and guard are unchanged.

- **`syncro_invoices_email` now goes through the destructive write guard.**
  It previously called Syncro directly even though it is annotated
  destructive. It now asks the user through MCP elicitation when the client
  supports it. When the client cannot elicit (always the case over HTTP), it
  returns "Confirmation required" unless the call passes `confirm: true`; a
  new optional `confirm` argument was added for that. Callers that used to
  email an invoice without `confirm` over HTTP or stdio without elicitation
  must now pass it. The prompt (and the "Confirmation required" message)
  shows cc, subject and the message body. `invoice_id` must be a positive
  integer. See "Write confirmation" above for what `confirm` does and does not
  enforce.

### Fixed

- **Writes are sent once.** The SDK resends a POST after a 5xx or 429, so one
  call to `syncro_tickets_create`, `_add_comment`, `syncro_invoices_email` or
  another SDK-backed write could create a record or send an email several
  times, and a 429 on a resend after a 5xx was reported as a plain rejection
  although the first attempt may have been applied. SDK-backed writes now run
  on a second client (`getWriteClient` in `src/utils/client.ts`) with the
  SDK's retries turned off, through `sdkWrite`. Reads keep the SDK's retries.
  The SDK counts rate limit use per client, so reads and writes each count
  against their own budget. The SDK has no request timeout, and none was added
  to SDK-backed writes.
- **A 2xx whose body is not JSON, on a REST-helper write, now carries the
  unknown-outcome note.** It reported a plain "Expected JSON" error although
  the write may have been applied. A write that gets a status other than a 2xx
  or 4xx gets the note as well; a read never does.
- **Time and line item arguments are validated more strictly.** `billable`
  (both time tools) must be a real boolean: the string `"false"` was shown in
  the prompt as billable and sent as text. `duration_minutes` and `quantity`
  must be positive. `isoTimestamp` rejects impossible dates and requires `Z`
  or an offset, to match the tool descriptions. A line item prompt shows
  `product_id`, `description`, `price_cost` and `taxable`, and `product_id`,
  `price_cost` and `taxable` are validated.
- **Documentation.** The README's rate limit section said the SDK handles rate
  limiting for every tool, which is not true for the REST-helper tools, and
  named the package `@wyre-technology/node-syncro` instead of
  `@wyre-ai/node-syncro`; both are corrected. The README now says plainly that
  `syncro_tickets_add_comment` and `syncro_tickets_create` with `comment_body`
  can email the customer and are not confirm-gated, and that
  `syncro_assets_set_policy_folder` changes which policies apply to a managed
  device. The `syncro_navigate` descriptions of the invoices and tickets
  domains now list create, email, comment and line item operations, and no
  longer claim update tools for customers and contacts that do not exist.
- **`syncro_status` no longer echoes a subdomain the client rejects.** It
  printed the raw configured subdomain and said "Configured" for a value that
  every other tool refuses. It now prints the subdomain only when it passes the
  same check as `getClient()` (`isValidSubdomain` in `src/utils/client.ts`);
  otherwise it reports the subdomain as invalid without repeating it, and a
  missing subdomain is reported as missing instead of "Configured".
- **`syncro_status` and the unknown-tool error advised calling
  `syncro_navigate` to discover tools without qualification.** Conduit
  suppresses `*_navigate` / `*_back` at the gateway (tier filtering lives in
  the grant resolver, which the container cannot see) and replaces them with
  `conduit__my_access`, so that advice pointed callers behind the gateway at
  a tool that returns method-not-found. Both strings now point to
  `conduit__my_access` for gateway callers and keep `syncro_navigate` as the
  standalone-mode discovery path. The tool itself is unchanged.
  (WYRE-AI/conduit#1236)
- **deps:** bump `@wyre-technology/node-syncro` to
  [v1.0.5](https://github.com/wyre-technology/node-syncro/releases/tag/v1.0.5),
  which reads each HTTP response body exactly once. Previously the SDK's error
  path could re-read an already-consumed response body, swallowing the real API
  error and surfacing an empty `{}` instead; API failures now propagate as
  descriptive errors. Same class of bug as
  [connectwise-automate-mcp#54](https://github.com/wyre-technology/connectwise-automate-mcp/issues/54),
  where the pattern was first identified.
- **credentials:** ignore unresolved MCPB/DXT `"${user_config.X}"` placeholders
  in credentials. When an optional user_config field (e.g. the Syncro subdomain)
  is left blank, Claude Desktop injects the literal string
  `${user_config.syncro_subdomain}` instead of an empty value. Previously that
  truthy placeholder was passed straight to the SDK, which built the host
  `https://${user_config.syncro_subdomain}.syncromsp.com` and DNS-failed
  (`ENOTFOUND`) on every request. Credentials are now sanitised at ingress via
  `cleanCredential`, and a missing/placeholder subdomain fails fast with a clear
  `SYNCRO_SUBDOMAIN is required` error. Mirrors wyre-technology/itglue-mcp#73.
- **deploy:** authenticate GitHub Packages in one-click cloud builds so the
  private `@wyre-technology/node-syncro` SDK can be installed. Added the
  `_authToken` line to `.npmrc`, a `GITHUB_TOKEN` build ARG fallback to the
  Dockerfile (DigitalOcean App Platform does not support BuildKit secret
  mounts), and a build-time `GITHUB_TOKEN` secret to `.do/app.yaml`. Previously
  `npm install` failed with `401 Unauthorized` during Cloudflare/DigitalOcean
  deploys.
- **deploy:** point the Wrangler entry at the real Worker source
  (`wrangler.json` `main` -> `src/worker.ts`) instead of the never-built
  `dist/worker.js`.

## [1.1.6](https://github.com/wyre-technology/syncro-mcp/compare/v1.1.5...v1.1.6) (2026-04-07)


### Bug Fixes

* **ci:** deploy :latest tag, force revision via env var bump ([130fe78](https://github.com/wyre-technology/syncro-mcp/commit/130fe785824f58ad666ff662372e306a9f746ddc))

## [1.1.5](https://github.com/wyre-technology/syncro-mcp/compare/v1.1.4...v1.1.5) (2026-04-06)


### Bug Fixes

* per-request MCP Server+Transport for gateway compatibility ([3f8f15e](https://github.com/wyre-technology/syncro-mcp/commit/3f8f15ecbfb3f6e8942c55ec3ea28a64635d8ec4))

## [1.1.4](https://github.com/wyre-technology/syncro-mcp/compare/v1.1.3...v1.1.4) (2026-04-03)


### Bug Fixes

* **deploy:** replace node_compat with nodejs_compat for Wrangler v4 ([13b5e11](https://github.com/wyre-technology/syncro-mcp/commit/13b5e11d0cbd4f60ab67608aee7ce9fe36fe2554))

## [1.1.3](https://github.com/wyre-technology/syncro-mcp/compare/v1.1.2...v1.1.3) (2026-03-10)


### Bug Fixes

* **ci:** add contents:write permission for MCPB upload ([ed14585](https://github.com/wyre-technology/syncro-mcp/commit/ed1458521c699f722b6d2dec71816cd78e64555e))

## [1.1.2](https://github.com/wyre-technology/syncro-mcp/compare/v1.1.1...v1.1.2) (2026-03-10)


### Bug Fixes

* **ci:** install deps before MCPB pack step in docker job ([9292693](https://github.com/wyre-technology/syncro-mcp/commit/929269352dba926610959ee468566b0e4258e213))

## [1.1.1](https://github.com/wyre-technology/syncro-mcp/compare/v1.1.0...v1.1.1) (2026-03-10)


### Bug Fixes

* **docker:** pass GitHub Packages auth token to Docker build via BuildKit secret ([c0c3a9e](https://github.com/wyre-technology/syncro-mcp/commit/c0c3a9ec720aa8e513d9c713f3304c20344da00b))

# [1.1.0](https://github.com/wyre-technology/syncro-mcp/compare/v1.0.0...v1.1.0) (2026-03-10)


### Features

* **elicitation:** add MCP elicitation support with graceful fallback ([14ca9ef](https://github.com/wyre-technology/syncro-mcp/commit/14ca9ef060ddfcf4546e7be330b8e2db21ed7c79))

# 1.0.0 (2026-03-02)


### Bug Fixes

* **ci:** add GitHub Packages auth for npm ci ([03ef2ce](https://github.com/wyre-technology/syncro-mcp/commit/03ef2ced57820dee74dade67660fd5eb08ff0316))
* **ci:** convert pack-mcpb.js to ESM imports ([d018565](https://github.com/wyre-technology/syncro-mcp/commit/d0185652c6c29941b85aa4e3fecb323c907f7be1))
* **ci:** fix broken YAML in Discord notification step ([0daf7ec](https://github.com/wyre-technology/syncro-mcp/commit/0daf7ec26c909cd9b803f570869c3aeba8c99117))
* **ci:** move Discord notification into release workflow ([8379c80](https://github.com/wyre-technology/syncro-mcp/commit/8379c802a4bd30b2dc09ed59b6e7272ab40ff17a))
* **ci:** update lock file and bump node to 22 ([6a534ec](https://github.com/wyre-technology/syncro-mcp/commit/6a534ec808e1c63190d96389cb5cc143313a67fe))
* correct mock package name from @asachs01/node-syncro to @wyre-technology/node-syncro ([67e2d33](https://github.com/wyre-technology/syncro-mcp/commit/67e2d3329ec42cf32cfb72076f840856955b3910))
* **docker:** drop arm64 platform to fix QEMU build failures ([5d740fd](https://github.com/wyre-technology/syncro-mcp/commit/5d740fd6cabe325474728c6d7f2cad4358b83619))
* escape newlines in .releaserc.json message template ([5551cbe](https://github.com/wyre-technology/syncro-mcp/commit/5551cbe01d172bbb56c6c16cf474c93e20ee2227))
* quote MCPB bundle filename to prevent shell glob expansion failure ([ee2f3c8](https://github.com/wyre-technology/syncro-mcp/commit/ee2f3c8ef811c8618b5ea429949eb08b0af3a2d3))
* rename duplicate step id in docker job ([d99f703](https://github.com/wyre-technology/syncro-mcp/commit/d99f703bd5e5ee6a54980d19c5cc247b27aeab10))


### Features

* add MCPB manifest for desktop installation ([b5e6aca](https://github.com/wyre-technology/syncro-mcp/commit/b5e6aca36a956ce8b5aa98ad371e4aa7fe6f15ab))
* add MCPB pack script ([de637e1](https://github.com/wyre-technology/syncro-mcp/commit/de637e1966ad1bdaa07ba13dab52a41b54feee91))
* add mcpb packaging support ([0a095d5](https://github.com/wyre-technology/syncro-mcp/commit/0a095d5565513b7db5e5a219b3c95733d0234a9f))
* add mcpb packaging support ([d2744fa](https://github.com/wyre-technology/syncro-mcp/commit/d2744fae7df9eb816cdaad7ad184dc500ae804c5))
* add mcpb packaging support ([a73bae3](https://github.com/wyre-technology/syncro-mcp/commit/a73bae3ad14546083d8991943b197e1e4ff4061b))
* add mcpb packaging support ([ccdfe8e](https://github.com/wyre-technology/syncro-mcp/commit/ccdfe8e33c36ff135a6633b6013c8b1c47bb9578))
* add mcpb packaging support ([53a2452](https://github.com/wyre-technology/syncro-mcp/commit/53a245258b7229d915eaf7da94327a9107db8bdc))
* add one-click deploy badges to README ([af443da](https://github.com/wyre-technology/syncro-mcp/commit/af443da1d2bd4a4f43933b0a2be50e358e46dcd8))
* Implement Syncro MCP server with decision tree architecture ([cbc4b37](https://github.com/wyre-technology/syncro-mcp/commit/cbc4b3783e658d0197611535b6751499b1f687b4))
* **transport:** Add HTTP transport, Docker, and deployment configs ([fa30756](https://github.com/wyre-technology/syncro-mcp/commit/fa30756899197aa6ea2ab4b54d33770d6abc97f9))
