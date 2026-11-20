/**
 * Cloudflare Workers entry point for the Syncro MCP Server.
 *
 * Serves the full MCP server over the Streamable HTTP transport using the SDK's
 * Web Standard transport (Request/Response), which runs natively on Workers.
 * It reuses the exact same `createMcpServer()` factory as the stdio / Node HTTP
 * entrypoints (see `mcp-server.ts`), so there is no second tool implementation
 * to maintain.
 *
 * Caller authentication: every `/mcp` request must carry a valid
 * `X-Gateway-S2S` header, the same check the Node HTTP entry makes, keyed with
 * the `CONDUIT_S2S_SECRET` Worker secret. It fails closed: with no secret (or a
 * known placeholder) configured, every `/mcp` request gets a 401. `/health`
 * stays unauthenticated. There are no CORS headers: this is a server-to-server
 * endpoint, and a browser page must not be able to call it.
 *
 * Credentials are resolved per request, in order:
 * 1. Gateway headers (when AUTH_MODE=gateway):
 *    - X-Syncro-API-Key
 *    - X-Syncro-Subdomain (optional)
 * 2. Worker secrets / vars (env mode):
 *    - SYNCRO_API_KEY
 *    - SYNCRO_SUBDOMAIN (optional)
 *
 * Per-request credentials are propagated through AsyncLocalStorage
 * (`credentialStore`), exactly as in the Node HTTP transport, so concurrent
 * requests stay isolated without mutating any shared global state. `nodejs_compat`
 * provides `async_hooks` on workerd.
 *
 * `tools/list` and `initialize` work without credentials; only `tools/call`
 * requires them.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, resolveGatewayCredentials } from "./mcp-server.js";
import {
  S2S_HEADER,
  isKnownPlaceholderSecret,
  verifyS2sHeader,
} from "./s2s-verify.js";
import {
  credentialStore,
  type RequestCredentials,
} from "./utils/credential-store.js";
import { runWithServerRef } from "./utils/server-ref.js";
import { runWithClientScope } from "./utils/client.js";

export interface Env {
  SYNCRO_API_KEY?: string;
  SYNCRO_SUBDOMAIN?: string;
  AUTH_MODE?: string;
  CONDUIT_S2S_SECRET?: string;
  LOG_LEVEL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** True when the request carries a valid X-Gateway-S2S header; false when no real secret is configured. */
function hasValidS2s(request: Request, env: Env): boolean {
  const secret = (env.CONDUIT_S2S_SECRET ?? "").trim();
  if (!secret || isKnownPlaceholderSecret(secret)) return false;
  return verifyS2sHeader(request.headers.get(S2S_HEADER) ?? undefined, secret);
}

/**
 * Run the MCP request through a fresh server + Web Standard transport.
 * Stateless: a new server/transport pair is created per request. The server
 * is likewise bound to the per-request async context (not a module-level
 * global) so elicitation helpers resolve *this* request's server even
 * after await gaps, and never a concurrent request's — see
 * utils/server-ref.ts. The Syncro client cache is scoped the same way
 * (see utils/client.ts) so concurrent requests never share or invalidate
 * each other's client.
 */
async function handleMcp(request: Request): Promise<Response> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  return runWithServerRef(server, () =>
    runWithClientScope(async () => {
      await server.connect(transport);

      try {
        const response = await transport.handleRequest(request);
        return response;
      } finally {
        await transport.close();
        await server.close();
      }
    })
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Shallow, unauthenticated liveness probe.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json({
        status: "ok",
        transport: "http",
        authMode: env.AUTH_MODE === "gateway" ? "gateway" : "env",
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === "/mcp") {
      // Checked first, before any credential is read, in both auth modes.
      if (!hasValidS2s(request, env)) {
        return json(
          {
            error:
              "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
          },
          401
        );
      }

      const isGatewayMode = (env.AUTH_MODE ?? "env") === "gateway";

      let creds: RequestCredentials | undefined;
      if (isGatewayMode) {
        const resolved = resolveGatewayCredentials(
          (name) => request.headers.get(name) ?? undefined
        );
        if (resolved.error) {
          return json(
            {
              error: "Missing credentials",
              message: "Gateway mode requires X-Syncro-API-Key header",
              required: ["X-Syncro-API-Key"],
              optional: ["X-Syncro-Subdomain"],
            },
            401
          );
        }
        creds = resolved.creds;
      } else if (env.SYNCRO_API_KEY) {
        // env mode: build credentials from Worker secrets if present.
        // (Absent creds are fine — tools/list still works, tools/call errors.)
        creds = {
          apiKey: env.SYNCRO_API_KEY,
          ...(env.SYNCRO_SUBDOMAIN ? { subdomain: env.SYNCRO_SUBDOMAIN } : {}),
        };
      }

      // Run inside the AsyncLocalStorage scope so the Syncro client picks up
      // per-request credentials (same mechanism as the Node HTTP transport).
      if (creds) {
        return credentialStore.run(creds, () => handleMcp(request));
      }
      return handleMcp(request);
    }

    return json({ error: "Not found", endpoints: ["/mcp", "/health"] }, 404);
  },
};
