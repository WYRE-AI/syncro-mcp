# Syncro MCP Server

A Model Context Protocol (MCP) server for Syncro MSP, implementing a decision tree architecture for efficient tool navigation.


## One-Click Deployment

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/WYRE-AI/syncro-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/WYRE-AI/syncro-mcp)

> **Operator note — GitHub Packages authentication (required for one-click deploys).**
> This server depends on the private `@wyre-technology/node-syncro` SDK, which is
> hosted on **GitHub Packages**. GitHub Packages requires an authentication token
> on every install (no anonymous reads, even for public packages), so the cloud
> builders fail during `npm install` with `401 Unauthorized` unless you supply a
> token. Create a GitHub **Personal Access Token** with the `read:packages` scope
> and provide it to the builder:
>
> - **Cloudflare Workers** — set a build/environment variable named `NODE_AUTH_TOKEN` to your PAT.
> - **DigitalOcean App Platform** — set a **build-time** secret named `GITHUB_TOKEN` to your PAT.
>
> For local `npm install`, run `export NODE_AUTH_TOKEN=$(gh auth token)` first.

## Features

- **Decision Tree Architecture**: Tools are organized by domain and loaded lazily
- **Domain Navigation**: Navigate between customers, tickets, assets, contacts, and invoices
- **Lazy Loading**: Domain handlers and the Syncro client are loaded on-demand
- **Full Syncro API Coverage**: Access to key Syncro MSP functionality
- **Interactive Ticket Card (MCP Apps)**: `syncro_tickets_get` renders as an interactive card in MCP Apps hosts (Claude Desktop/web) with an in-card "Add comment" round-trip via `syncro_tickets_add_comment` (internal-only by default); plain-JSON behavior is unchanged in other hosts. The card is neutral by default, brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env vars (`MCP_BRAND_NAME`, `MCP_BRAND_LOGO_URL`, `MCP_BRAND_PRIMARY_COLOR`, `MCP_BRAND_ACCENT_COLOR`, `MCP_BRAND_BG`, `MCP_BRAND_TEXT`) — no rebuild needed.

## Installation

> WYRE MCP servers are distributed via OCI/GHCR images and (where available) MCPB bundles. The npm package `@wyre-ai/syncro-mcp` is also published to **GitHub Packages** (`npm.pkg.github.com`); installing it requires an authenticated `.npmrc` with `read:packages` scope (run `export NODE_AUTH_TOKEN=$(gh auth token)` locally).

### Option 1: WYRE MCP Gateway (Recommended)

Use the hosted gateway at [mcp.wyre.ai](https://mcp.wyre.ai) — paste your Syncro API key into the gateway UI and you're done.

```json
{
  "mcpServers": {
    "syncro": {
      "type": "http",
      "url": "https://mcp.wyre.ai/v1/syncro/mcp",
      "headers": {
        "X-Syncro-Api-Key": "${SYNCRO_API_KEY}"
      }
    }
  }
}
```

### Option 2: Claude Code CLI (run from GitHub)

```bash
claude mcp add syncro \
  -e SYNCRO_API_KEY=your-api-key \
  -e SYNCRO_SUBDOMAIN=your-subdomain \
  -- npx -y github:WYRE-AI/syncro-mcp
```

### Option 3: Docker (GHCR)

The image listens on `0.0.0.0` inside the container and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass the service-to-service secret. In gateway mode, Syncro credentials arrive on each request as headers; they are not read from the environment.

```bash
docker run --rm \
  -e CONDUIT_S2S_SECRET=your-s2s-secret \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/wyre-ai/syncro-mcp:latest
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset, runs `AUTH_MODE=gateway` with no static `SYNCRO_*` credentials, and publishes `127.0.0.1:8080:8080`:

```bash
CONDUIT_S2S_SECRET=your-s2s-secret docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `SYNCRO_API_KEY`:

```bash
docker run --rm \
  -e CONDUIT_S2S_SECRET=your-s2s-secret \
  -e AUTH_MODE=env \
  -e SYNCRO_API_KEY=your-api-key \
  -e SYNCRO_SUBDOMAIN=your-subdomain \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/wyre-ai/syncro-mcp:latest
```

### Option 4: From Source

```bash
git clone https://github.com/WYRE-AI/syncro-mcp.git
cd syncro-mcp
npm ci
npm run build
node dist/index.js
```

## Configuration

Copy [`.env.example`](.env.example) and set the variables below.

| Variable | Required | Description |
|----------|----------|-------------|
| `SYNCRO_API_KEY` | For stdio and `AUTH_MODE=env` | Your Syncro API key |
| `SYNCRO_SUBDOMAIN` | No | Your Syncro subdomain (if applicable) |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `AUTH_MODE` | No | `gateway` (Docker image and Compose default) or `env`. Gateway mode requires `X-Syncro-API-Key` on each `/mcp` request and never falls back to `SYNCRO_*`. `env` uses those variables only after S2S auth succeeds. |
| `CONDUIT_S2S_SECRET` | Yes for HTTP | Service-to-service secret. The HTTP server logs an error and exits non-zero when this is empty or a known placeholder (`changeme`, `your-s2s-secret`, `replace-with-a-real-secret`, `secret`, an unresolved `${...}` value, and the other example strings). Compose will not start without it. Never commit a real value. Generate one with `openssl rand -hex 32`. |
| `MCP_ALLOW_INSECURE_DEV` | No | Set to exactly `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning, does not enforce `X-Gateway-S2S`, and binds `127.0.0.1` only. A wider `MCP_HTTP_HOST` (including `0.0.0.0`) is ignored and the override is logged. A known placeholder secret still refuses to start. |
| `MCP_HTTP_HOST` | No | Bind address when `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` is set. Defaults to `127.0.0.1` when unset. The container image sets `0.0.0.0`. |
| `MCP_HTTP_PORT` | No | HTTP port. Defaults to `8080`. |

`/health` stays unauthenticated and does not read credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

### HTTP authentication

With `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` set, every `/mcp` request must include `X-Gateway-S2S`. The value is `t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of the literal string `t=<unix seconds>` keyed with `CONDUIT_S2S_SECRET` (64 lowercase hex characters). The timestamp must be within 300 seconds of the server clock. A missing or invalid header returns 401 before vendor credentials are read. The secret is never logged.

```bash
TS=$(date +%s)
SIG=$(printf 't=%s' "$TS" | openssl dgst -sha256 -hmac "$CONDUIT_S2S_SECRET" -hex | awk '{print $NF}')
curl -sS http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-Gateway-S2S: t=${TS},v1=${SIG}" \
  -H "X-Syncro-API-Key: $SYNCRO_API_KEY" \
  -H "X-Syncro-Subdomain: $SYNCRO_SUBDOMAIN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

In `AUTH_MODE=gateway`, `/mcp` also requires `X-Syncro-API-Key` (`X-Syncro-Subdomain` is optional). Those headers are the only credential source for that request. A request missing the API key returns 401 and does not fall back to `SYNCRO_API_KEY` in the process environment.

In `AUTH_MODE=env`, `/mcp` still requires a valid `X-Gateway-S2S` header. Vendor credentials come from `SYNCRO_API_KEY` and `SYNCRO_SUBDOMAIN` when the request does not carry `X-Syncro-API-Key`.

Local HTTP without a secret is development-only. It binds `127.0.0.1` and logs a warning:

```bash
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 npm start
```

### Getting Your API Key

1. Log in to your Syncro MSP account
2. Navigate to Settings > API Tokens
3. Generate a new API token with appropriate permissions

## Architecture

### Decision Tree Navigation

The server uses a hierarchical approach to tool discovery:

1. **Initial State**: Only navigation and status tools are exposed
2. **After Navigation**: Domain-specific tools become available
3. **Back Navigation**: Return to the main menu to switch domains

This reduces cognitive load and improves LLM tool selection accuracy.

### Available Domains

| Domain | Description | Tools |
|--------|-------------|-------|
| `customers` | Manage customer accounts | list, get, create, search |
| `tickets` | Manage support tickets | list, get, create, update, add_comment |
| `assets` | Manage configuration items | list, get, search |
| `contacts` | Manage customer contacts | list, get, create |
| `invoices` | View and manage billing | list, get, create, email |

## Tools Reference

### Navigation Tools

#### syncro_navigate
Navigate to a domain to access its tools.

```json
{
  "domain": "customers" | "tickets" | "assets" | "contacts" | "invoices"
}
```

#### syncro_back
Return to the main menu from any domain.

#### syncro_status
Show current navigation state and credential status.

### Customers Domain

#### syncro_customers_list
List customers with optional filters.

```json
{
  "query": "search term",
  "business_name": "Company Inc",
  "email": "contact@example.com",
  "include_disabled": false,
  "page": 1,
  "per_page": 25
}
```

#### syncro_customers_get
Get a specific customer by ID.

```json
{
  "customer_id": 123
}
```

#### syncro_customers_create
Create a new customer.

```json
{
  "business_name": "Acme Corp",
  "firstname": "John",
  "lastname": "Doe",
  "email": "john@acme.com"
}
```

#### syncro_customers_search
Search customers by query string.

```json
{
  "query": "acme",
  "limit": 25
}
```

### Tickets Domain

#### syncro_tickets_list
List tickets with optional filters.

```json
{
  "customer_id": 123,
  "status": "Open",
  "user_id": 456,
  "resolved": false
}
```

#### syncro_tickets_get
Get a specific ticket by ID.

```json
{
  "ticket_id": 789
}
```

#### syncro_tickets_create
Create a new ticket.

```json
{
  "customer_id": 123,
  "subject": "Network Issue",
  "problem_type": "Network",
  "comment_body": "Initial description"
}
```

#### syncro_tickets_update
Update an existing ticket.

```json
{
  "ticket_id": 789,
  "status": "Resolved",
  "user_id": 456
}
```

#### syncro_tickets_add_comment
Add a comment to a ticket.

```json
{
  "ticket_id": 789,
  "body": "Comment text",
  "hidden": false
}
```

### Assets Domain

#### syncro_assets_list
List assets with optional filters.

```json
{
  "customer_id": 123,
  "asset_type": "Desktop"
}
```

#### syncro_assets_get
Get a specific asset by ID.

```json
{
  "asset_id": 456
}
```

#### syncro_assets_search
Search assets by query or serial number.

```json
{
  "query": "workstation",
  "asset_serial": "SN12345"
}
```

### Contacts Domain

#### syncro_contacts_list
List contacts with optional filters.

```json
{
  "customer_id": 123,
  "query": "john"
}
```

#### syncro_contacts_get
Get a specific contact by ID.

```json
{
  "contact_id": 789
}
```

#### syncro_contacts_create
Create a new contact.

```json
{
  "customer_id": 123,
  "name": "Jane Smith",
  "email": "jane@example.com"
}
```

### Invoices Domain

#### syncro_invoices_list
List invoices with optional filters.

```json
{
  "customer_id": 123,
  "status": "sent",
  "since_date": "2024-01-01"
}
```

#### syncro_invoices_get
Get a specific invoice by ID.

```json
{
  "invoice_id": 456
}
```

#### syncro_invoices_create
Create a new invoice.

```json
{
  "customer_id": 123,
  "due_date": "2024-02-01"
}
```

#### syncro_invoices_email
Email an invoice to the customer.

```json
{
  "invoice_id": 456,
  "subject": "Your Invoice"
}
```

## Rate Limiting

Syncro API has a rate limit of 180 requests per minute. The underlying `@wyre-technology/node-syncro` library handles rate limiting automatically.

## Development

```bash
# Install dependencies. The @wyre-technology/node-syncro SDK lives on GitHub
# Packages, so authenticate first:
export NODE_AUTH_TOKEN=$(gh auth token)
npm install

# Build
npm run build

# Run in development (stdio)
npm run dev

# HTTP refuses to start until CONDUIT_S2S_SECRET is a real secret
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" MCP_TRANSPORT=http npm start

# Local HTTP only, without a service-to-service secret (always binds 127.0.0.1)
MCP_ALLOW_INSECURE_DEV=1 MCP_TRANSPORT=http npm start

# Type check
npm run typecheck

# Lint
npm run lint
```

## License

Apache-2.0
