# WYREAI-464 — Syncro capability diff (scored by MSP jobs)

Parent: [WYREAI-308](https://linear.app/wyre-ai/issue/WYREAI-308/epic-stackjack-conduit-connector-parity) · Issue: [WYREAI-464](https://linear.app/wyre-ai/issue/WYREAI-464/syncro-tool-parity-vs-stackjack-46-official-vs-169)

Conduit's Syncro coverage comes from two servers:

- **Official** — Syncro's remote MCP (`mcp.services.syncromsp.com`, wired in by conduit#2044).
- **Sidecar** — this repo (`syncro-mcp`).

This doc scores that coverage against the six MSP jobs in WYREAI-464: `create_ticket`, `log_time`, `invoice`, `onboard_user`, `patch_device`, `backup_check`. StackJack's ~169 Syncro tools count only as depth pressure; raw tool count is not the target.

## Sources and how they were checked (2026-11-06)

| Source | What was used | Caveat |
|---|---|---|
| Syncro REST API | `https://api-docs.syncromsp.com/swagger.json` (OpenAPI 3.0, 128 paths / 195 operations) | Authoritative for "does an endpoint exist". |
| Official Syncro MCP | [Syncro MCP Tools Reference](https://docs.syncrosecure.com/model-context-protocol/mcp-tools-reference), updated 2026-11-04: **60 tools** | The server needs OAuth (`/.well-known/oauth-protected-resource`), so `tools/list` could not be pulled live. Conduit's pin was reported as ~46 tools; older listings (mcp.so) also show 46. Before relying on any official tool that is newer than the pin, check Conduit's live `tools/list`. |
| Sidecar | `src/domains/*.ts` in this repo. Before this PR: 19 domain tools plus `syncro_navigate` and `syncro_status`. After: 30. | — |
| StackJack | `https://stackjack.io/connectors-syncro/` returned HTTP 403 to automated fetches | The SJ tool list could not be enumerated, so Syncro REST domains stand in for SJ domains. |
| SDK | `@wyre-ai/node-syncro` v1.0.7 (lockfile pin; no `src/` changes through v1.1.2) | Its ticket-timer methods call endpoints that are not in the swagger (see Findings). |

## Capability diff by domain

**Status legend**

- **Official** — covered by the official MCP.
- **Sidecar** — covered by this sidecar.
- **Gap → closed** — a high-value gap closed in this PR.
- **Gap → deferred** — a gap that is real but not blocking any of the six jobs; tracked as a follow-up.
- **Out of scope** — no MSP job needs it.

| Domain | Official MCP tools | Sidecar tools (after this PR) | REST surface not covered by either | Status |
|---|---|---|---|---|
| **Tickets** (create, update, status, comments) | `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `add_ticket_comment`, `get_ticket_comments`*, `list_ticket_comments`*, `attach_file_to_ticket`, `print_ticket` | `syncro_tickets_list`, `_get` (with ticket card), `_create`, `_update`, `_add_comment` | `DELETE /tickets/{id}`, worksheets, ticket blueprints, new-ticket forms, `delete_attachment` | **Official** (sidecar is a fallback). Deletes are out of scope. |
| **Time / timers** | `add_timer_entry` (no billable field), `update_timer_entry`, `charge_timer_entry`, `list_timeclock_entries` (attendance, not ticket time) | **new** `syncro_time_list_entries`, `syncro_time_log_entry` (with billable flag), `syncro_time_set_billable` | live timer `start` / `pause` / `stop` (`/ticket_timers/{id}/*`), `PUT /timelogs` | **Gap → closed.** Official cannot set billable or list ticket time by `billing_status`. Live start/stop timers are deferred: agents log completed work. |
| **Invoices / billing** | `list_invoices`, `get_invoice`, `create_invoice`, `update_invoice`, `add_invoice_line_item`, `print_invoice`, `email_invoice`, `list_overdue_invoices`, `list_invoices_by_amount` | `syncro_invoices_list`, `_get`, `_create`, `_email`; **new** `syncro_tickets_add_line_item` | `POST /tickets/{id}/add_line_item` (now closed), invoice `publish` / `convert_to_draft` / delete, `POST /payments`, payment profiles | **Official**, plus **Gap → closed** for ticket line items and unbilled time (`syncro_time_list_entries billing_status=unbilled`). Payments and payment profiles are out of scope (money movement, card data). |
| **Estimates** | 8 tools: list, get, create, update, add/update line item, convert, email | — | estimate delete, print, line-item delete | **Official.** No job depends on it. |
| **Assets / RMM alerts** | `list_assets`, `get_asset`, `create_asset`, `update_asset`, `list_alerts`, `get_alert`, `create_alert` | `syncro_assets_list`, `_get`, `_search`; **new** `syncro_assets_get_patches`, `syncro_assets_list_installed_applications` | `POST /rmm_alerts/{id}/mute`, `DELETE /rmm_alerts/{id}`, BitLocker keys, local administrators, chat info | **Official**, plus **Gap → closed** for patch status and installed software. Alert mute/resolve is **Gap → deferred** (alert-triage depth, not one of the six jobs). BitLocker keys and local admins are out of scope (secret exposure). |
| **Scripts / policies** | none | **new** `syncro_assets_list_policy_folders`, `syncro_assets_set_policy_folder`, `syncro_assets_run_script` | policy-folder create/update/delete; no script-list endpoint; no recurring script schedules via API | **Gap → closed** for `patch_device`. Policy-folder CRUD is out of scope (fleet-wide RMM configuration). |
| **Appointments** | `list_appointments`, `get_appointment`, `create_appointment`, `update_appointment` | — | appointment delete, appointment types | **Official.** |
| **Customers / contacts** | `list_customers`, `get_customer`, `create_customer`, `update_customer`, `list_contacts`, `get_contact`, `create_contact`, `update_contact` | `syncro_customers_list`, `_get`, `_create`, `_search`; `syncro_contacts_list`, `_get`, `_create` | customer/contact delete, customer phones, payment profiles, portal users | **Official** (sidecar is a fallback). Portal users are **Gap → deferred**: Global Admin only and the API takes passwords. |
| **Products / inventory** | `list_products`, `get_product`, `create_product`, `update_product`, `update_po_line_item`, `delete_po_line_item` | — | serials, SKUs, images, location quantities, purchase-order create/receive, vendors | **Official** for catalog. The rest is out of scope (inventory operations, no MSP job). |
| **Contracts** | none | — | `/contracts` CRUD | **Gap → deferred.** This is useful QBR context (`non_billable_product_ids` decides whether covered time is billable) but blocks no job. |
| **Recurring invoices** (`/schedules`) | none | — | `/schedules` CRUD + line items | **Gap → deferred** (monthly recurring revenue view for QBRs). |
| **Users / search / docs** | `list_users`, `get_current_user`, `search`, `search_docs`, `get_docs_article` | `syncro_status`, `syncro_navigate` | — | **Official.** |
| **Leads, wiki, canned responses, worksheets, OTP, caller ID, user devices** | none | — | as listed | **Out of scope** (no MSP job). |

\* The official docs mark these as needing an OAuth sign-in (not available on API-key connections).

## Job matrix

| Job | Status | How an agent can do it through Conduit after follow-up 3 |
|---|---|---|
| **create_ticket** | **Covered** | Find the customer (official `list_customers` / `search`, or `syncro_customers_search`). Create it with official `create_ticket` or `syncro_tickets_create`, change status or assignee with `update_ticket` / `syncro_tickets_update`, and add notes with `add_ticket_comment` / `syncro_tickets_add_comment`. The sidecar tools are annotated as writes. Conduit classifies the official tools on its side (see follow-up 3). Over HTTP the sidecar's own writes are not confirmed by any prompt (see "Classification of the new tools"). |
| **log_time** | **Covered** | `syncro_time_log_entry` (`POST /tickets/{id}/timer_entry`, then `PATCH /ticket_timers/{id}` with `billable`). Fix the flag with `syncro_time_set_billable`. Review with `syncro_time_list_entries`. Official `update_timer_entry` / `charge_timer_entry` correct an entry or charge it. Both new writes ask for elicitation confirmation over stdio with a capable client and are not confirmed at all over HTTP. |
| **invoice** | **Covered** | Unbilled work: `syncro_time_list_entries billing_status=unbilled` (by customer or date). Ticket charges: `syncro_tickets_add_line_item`. Invoices: official `list_invoices`, `list_overdue_invoices`, `create_invoice`, `add_invoice_line_item`, `charge_timer_entry` (sidecar `syncro_invoices_*` as fallback). |
| **onboard_user** | **Covered**, with asset-to-contact link and portal invite deferred | Customer: official `create_customer` / `update_customer` (or `syncro_customers_create`). Contact: official `create_contact` / `update_contact` (or `syncro_contacts_create`). Device under the customer: official `create_asset` / `update_asset`. **Deferred:** the asset `PUT` body (`/customer_assets/{id}`) has no `contact_id`; only the read `GET /customer_assets/assets_by_contact/{contact_id}` exists. Portal invitation (`/portal_users`) needs Global Admin and a password. |
| **patch_device** | **Covered within API limits** | Check with `syncro_assets_get_patches` (missing, failed, or rejected KBs). Put the device on the right patch policy with `syncro_assets_list_policy_folders` and `syncro_assets_set_policy_folder`. Remediate with `syncro_assets_run_script` (`POST /rmm/public_scripts/{asset_id}/schedule`, run once now or later; destructive, needs `confirm: true` where there is no prompt, and should be admin tier on the gateway). **Not possible through the API:** approving or installing a specific KB (no endpoint), recurring script schedules (the API returns 422 "recurring schedules are not supported through the api"), and listing scripts (no endpoint, so the caller supplies `script_id`). |
| **backup_check** | **Deferred: no backup API** | The Syncro REST API has no backup-job or backup-status endpoint. Searching swagger.json for "backup" finds only Syncro Backup billing fields on `/schedules` (`syncro_backup_billing_type`, …). Partial evidence through existing tools: official `list_alerts` (RMM alerts raised by backup monitors) and `syncro_assets_list_installed_applications` (is a backup agent installed). Revisit when Syncro adds a backup endpoint, or route the check to the backup vendor's connector. |

Score: **5 of 6 jobs can be covered through Conduit after follow-up 3** (create_ticket, log_time, invoice, onboard_user, patch_device). **backup_check is deferred** with API evidence.

## Classification of the new tools

Every tool the sidecar lists carries MCP annotations. `tests/classification.test.ts` fails if any tool is unclassified or changes class.

**What confirmation does, by transport.** Over stdio with a client that supports form elicitation, the tools below ask the user, and a decline cancels the call. If a supported prompt fails (for example, it times out), the write does not run. Over HTTP, which is the gateway transport, there is no prompt: the sidecar creates a new server for every request, so it never learns the client's capabilities and cannot elicit. There, ordinary writes proceed without confirmation, and the destructive tools require `confirm: true`. The calling model supplies that flag itself, so it is a convention the model is asked to honour, not an enforcement boundary. The enforcement boundary on the gateway is Conduit's per-tool tier policy. The sidecar does not rely on any confirm step in the gateway.

| Tool | Class | Confirmation (stdio, capable client) | Without a prompt (HTTP, or a client that cannot elicit) |
|---|---|---|---|
| `syncro_time_list_entries` | read | — | — |
| `syncro_time_log_entry` | write (additive, not idempotent) | elicitation; a decline cancels | proceeds |
| `syncro_time_set_billable` | write (idempotent) | elicitation; a decline cancels | proceeds |
| `syncro_tickets_add_line_item` | write (additive, not idempotent) | elicitation; a decline cancels | proceeds |
| `syncro_assets_get_patches` | read | — | — |
| `syncro_assets_list_installed_applications` | read | — | — |
| `syncro_assets_list_policy_folders` | read | — | — |
| `syncro_assets_set_policy_folder` | write (idempotent) | elicitation; a decline cancels | proceeds |
| `syncro_assets_run_script` | destructive | elicitation; a decline cancels | needs `confirm: true`; tier it admin on the gateway |
| `syncro_invoices_email` (existing tool) | destructive | elicitation; a decline cancels | needs `confirm: true` |

Existing tools are now classified too: every list/get/search tool and `syncro_navigate` / `syncro_status` is read; every create/update/comment tool is write; `syncro_invoices_email` is destructive because sending cannot be undone. Apart from `syncro_invoices_email`, which now goes through the write guard, their runtime behaviour did not change: they have no confirmation step. `syncro_tickets_add_comment` emails the customer unless `hidden` or `do_not_email` is set, and nothing in the sidecar prompts for it.

## Findings worth filing

1. **SDK timer endpoints do not exist.** `@wyre-ai/node-syncro` `ticketTimers.get/update/delete` call `GET|PUT|DELETE /ticket_timers/{id}`, and `tickets.getTimer/startTimer/updateTimer/deleteTimer` call `/tickets/{id}/timer`. Neither path is in the official swagger. The real endpoints are `POST /tickets/{id}/timer_entry`, `PUT /tickets/{id}/update_timer_entry`, `POST /tickets/{id}/charge_timer_entry`, `GET|POST /ticket_timers`, `PATCH /ticket_timers/{id}`, and `POST /ticket_timers/{id}/start|pause|stop`. The sidecar's new tools therefore call REST directly (`src/utils/rest.ts`) and do not use those SDK methods.
2. **The official `add_timer_entry` has no billable flag.** The REST create endpoint has none either; billable is set afterwards with `PATCH /ticket_timers/{id}`. That is the main reason the sidecar owns `log_time`.

## Follow-up children (proposed, not filed)

1. **node-syncro:** fix the timer methods (finding 1). Add line items, patches, installed applications, policy folders, and script scheduling. Then move `src/utils/rest.ts` callers onto the SDK so they share its 180 req/min limiter; today the REST helper runs outside that limiter.
2. **Sandbox end-to-end:** run the five covered jobs against a real Syncro sandbox. This needs a `SYNCRO_API_KEY` / `SYNCRO_SUBDOMAIN` secret; this PR is verified against swagger contracts with mocked HTTP only.
3. **Conduit:** diff the `syncro-official` pin's live `tools/list` (~46) against the 60 published tools. Add gateway classification entries for the 9 new sidecar tools, with `syncro_assets_run_script` in the admin tier (it runs code on a managed device, and over HTTP the sidecar's `confirm: true` is not an enforcement boundary), and bump the sidecar pin after release. Neither is done in this PR.
4. **backup_check:** on the sandbox, confirm how Syncro Backup and third-party backup failures show up as RMM alerts. Write down the filter an agent should use, or route the job to backup-vendor connectors.
5. **QBR depth:** read-only `/contracts` and `/schedules` (recurring invoices).
6. **Alert triage depth:** RMM alert mute and resolve.

---

## Short version for Linear (WYREAI-464)

> **Syncro depth: 5 of 6 MSP jobs covered, backup_check deferred (no API).**
> The official Syncro MCP (60 published tools; Conduit pin ~46) covers tickets, customers/contacts, invoices, estimates, appointments, products, assets and alerts. The sidecar now fills the gaps the official server leaves for these jobs:
> - **log_time:** `syncro_time_log_entry` (with billable flag), `syncro_time_set_billable`, `syncro_time_list_entries` (`billing_status=unbilled`).
> - **invoice:** `syncro_tickets_add_line_item`, plus unbilled-time listing.
> - **patch_device:** `syncro_assets_get_patches`, `syncro_assets_list_policy_folders`, `syncro_assets_set_policy_folder`, `syncro_assets_run_script` (destructive; needs `confirm: true` over HTTP, so tier it admin on the gateway).
> - **backup_check evidence:** `syncro_assets_list_installed_applications`.
>
> All 30 sidecar tools are classified read/write/destructive. Over stdio with an elicitation-capable client, new writes ask the user. Over HTTP (the gateway) there is no prompt: non-destructive writes proceed, and the destructive tools need `confirm: true`, which the calling model sets itself and which is not an enforcement boundary. The boundary is the gateway's tier policy.
> **Deferred, with API evidence:** backup status (no endpoint in swagger), KB-level patch approval (no endpoint), recurring script schedules (API returns 422), asset-to-contact assignment (no `contact_id` on asset PUT), portal invites (Global Admin + password).
> **Finding:** node-syncro's timer methods call endpoints that are not in Syncro's swagger.
> Full table: `docs/WYREAI-464-capability-diff.md`.
