## [Unreleased]

### Security

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

### Changed

- **Client cache moved off module-level state (defense-in-depth, not a live vulnerability).** `src/utils/client.ts` held the cached Syncro client/credentials in module-level `let _client` / `let _credentials` singletons, with manual "did credentials change → invalidate → recreate" logic in `getClient()`. A security review traced that sequence end-to-end and confirmed it is **not** exploitable as coded — the validate/invalidate/recreate/return path runs synchronously with no `await` between checking credentials and using the resulting client, so there is no interleaving that hands one tenant another tenant's client. It was still structurally fragile (a future edit that introduced an `await` in the wrong spot could reintroduce that bug class) and inconsistent with the rest of this file's per-tenant state, which already lives in `AsyncLocalStorage` (`credentialStore` in `src/utils/credential-store.ts`, and the `server-ref.ts` fix above for the identical bug class in a different subsystem).
  - **Fix:** the client cache now lives in an `AsyncLocalStorage`-scoped box instead of module variables (`runWithClientScope` for per-request transports — Node HTTP, Workers — and `bindClientScope` for the single-session stdio transport), mirroring `server-ref.ts`. Credential resolution, error messages, and the mismatch-detect-and-recreate behavior are unchanged — only where the mutable state lives has changed. Call sites updated: `src/index.ts` (Node HTTP `handleMcp` wraps the connect/handleRequest chain in `runWithClientScope`; stdio calls `bindClientScope` once at startup), `src/worker.ts` (Cloudflare Workers `handleMcp` wraps the connect/handleRequest chain in `runWithClientScope`). `getClient()` / `getCredentials()` / `clearClient()` keep their existing signatures and behavior, so no domain handler call sites changed.
  - **Regression test:** `tests/utils/client.test.ts` runs two concurrent "tenants" (distinct credential sets) through `runWithClientScope`, each with an `await` gap between validating credentials and re-using the client, and asserts each tenant's client is cached correctly within its own scope, is built from its own credentials, and is never the same instance as the other tenant's.

- **Published to GitHub Packages.** Enabled npm publishing for the already-scoped `@wyre-technology/syncro-mcp` package: `@semantic-release/npm` `npmPublish` is now `true` and `publishConfig.registry` points at `npm.pkg.github.com`. The release workflow already configured an authenticated `.npmrc` and `packages: write`. Updated the README, which previously stated there was no npm package. The GHCR image name and `io.github.wyre-technology/syncro-mcp` MCP Registry identifier are unchanged.

### Fixed

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
