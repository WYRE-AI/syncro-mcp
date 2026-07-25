/**
 * Cloudflare Workers entry point for the Syncro MCP Server.
 *
 * Serves the full MCP server over the Streamable HTTP transport using the SDK's
 * Web Standard transport (Request/Response), which runs natively on Workers.
 * It reuses the exact same `createMcpServer()` factory as the stdio / Node HTTP
 * entrypoints (see `mcp-server.ts`), so there is no second tool implementation
 * to maintain.
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
  credentialStore,
  type RequestCredentials,
} from "./utils/credential-store.js";
import { runWithServerRef } from "./utils/server-ref.js";

export interface Env {
  SYNCRO_API_KEY?: string;
  SYNCRO_SUBDOMAIN?: string;
  AUTH_MODE?: string;
  LOG_LEVEL?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, X-Syncro-API-Key, X-Syncro-Subdomain",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Run the MCP request through a fresh server + Web Standard transport.
 * Stateless: a new server/transport pair is created per request. The server
 * is likewise bound to the per-request async context (not a module-level
 * global) so elicitation helpers resolve *this* request's server even
 * after await gaps, and never a concurrent request's — see
 * utils/server-ref.ts.
 */
async function handleMcp(request: Request): Promise<Response> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  return runWithServerRef(server, async () => {
    await server.connect(transport);

    try {
      const response = await transport.handleRequest(request);
      return withCors(response);
    } finally {
      await transport.close();
      await server.close();
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

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
