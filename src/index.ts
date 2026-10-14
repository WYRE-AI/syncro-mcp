#!/usr/bin/env node
/**
 * Syncro MSP MCP Server
 *
 * This MCP server provides tools for interacting with the Syncro API.
 * All tools are listed upfront so they work with every MCP client, including
 * remote connectors (claude.ai, mcp-remote) that do not support dynamic
 * tool-list changes. A helper `syncro_navigate` tool provides domain
 * discovery and guidance.
 *
 * Supports both stdio and HTTP (StreamableHTTPServerTransport) transports.
 *
 * Credentials are provided via environment variables:
 * - SYNCRO_API_KEY (required)
 * - SYNCRO_SUBDOMAIN (optional)
 *
 * Or via gateway headers (when AUTH_MODE=gateway):
 * - X-Syncro-API-Key
 * - X-Syncro-Subdomain
 *
 * HTTP transport refuses to start unless CONDUIT_S2S_SECRET is a real secret.
 * Known placeholders are rejected even when MCP_ALLOW_INSECURE_DEV=1.
 * That flag is local-only: it skips X-Gateway-S2S and listens on 127.0.0.1 only.
 * A configured secret honors MCP_HTTP_HOST. When the host is unset the bind
 * address is 127.0.0.1. Gateway mode never falls back to SYNCRO_* env credentials.
 * /health stays unauthenticated and does not read credentials.
 * stdio does not use S2S auth.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createMcpServer } from "./mcp-server.js";
import { credentialStore } from "./utils/credential-store.js";
import { runWithServerRef, bindServerRef } from "./utils/server-ref.js";
import { runWithClientScope, bindClientScope } from "./utils/client.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

const LOOPBACK_HOST = "127.0.0.1";

/**
 * Public example values. A copied placeholder must not verify X-Gateway-S2S
 * and must not count as "the secret is set".
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
]);

/** Unresolved MCPB/DXT injection, e.g. `${user_config.conduit_s2s_secret}`. */
const CONFIG_PLACEHOLDER = /^\$\{.*\}$/;

function isKnownPlaceholderSecret(secret: string): boolean {
  return KNOWN_PLACEHOLDER_SECRETS.has(secret.toLowerCase()) || CONFIG_PLACEHOLDER.test(secret);
}

/** Hosts the insecure-dev bypass may be asked to bind. The listener is still 127.0.0.1. */
function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") {
    return true;
  }
  const bare = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  const parts = bare.split(".");
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return parts[0] === "127";
}

function refuseHttpStart(message: string): never {
  console.error(message);
  process.exit(1);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Secret for X-Gateway-S2S on /mcp, read when HTTP starts rather than at import.
 * Empty fails closed unless MCP_ALLOW_INSECURE_DEV is exactly "1", and that
 * bypass always listens on 127.0.0.1. A known placeholder always refuses to
 * start. The secret value is never written to logs.
 * A real secret honors MCP_HTTP_HOST; an unset host binds 127.0.0.1.
 */
function resolveHttpS2s(configuredHost: string): { secret: string; host: string } {
  const raw = (process.env.CONDUIT_S2S_SECRET ?? "").trim();

  if (raw && isKnownPlaceholderSecret(raw)) {
    refuseHttpStart(
      "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. " +
        "Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value. " +
        "Known placeholders are rejected even when MCP_ALLOW_INSECURE_DEV=1."
    );
  }

  if (!raw) {
    if (process.env.MCP_ALLOW_INSECURE_DEV !== "1") {
      refuseHttpStart(
        "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. " +
          "Set CONDUIT_S2S_SECRET to the gateway-provisioned secret (openssl rand -hex 32), " +
          "or set MCP_ALLOW_INSECURE_DEV=1 for local development only."
      );
    }

    console.error(
      "SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. " +
        "HTTP /mcp is starting WITHOUT service-to-service authentication and is bound to 127.0.0.1 only. " +
        "Do not use this outside local development."
    );

    if (configuredHost && !isLoopbackBindHost(configuredHost)) {
      console.error(
        `WARNING: MCP_HTTP_HOST=${configuredHost} is not a loopback address. ` +
          "MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. " +
          "Binding 127.0.0.1 only."
      );
    }

    return { secret: "", host: LOOPBACK_HOST };
  }

  return { secret: raw, host: configuredHost || LOOPBACK_HOST };
}

/**
 * Extract gateway credentials from HTTP request headers.
 * Returns the credentials object if present, or null if the required API key is missing.
 * Blank and whitespace-only values count as missing so they cannot fall through.
 */
function extractGatewayCredentials(req: IncomingMessage): { apiKey: string; subdomain?: string } | null {
  const apiKey = headerValue(req.headers["x-syncro-api-key"]);
  if (!apiKey) return null;

  const subdomain = headerValue(req.headers["x-syncro-subdomain"]);
  return { apiKey, ...(subdomain ? { subdomain } : {}) };
}

/**
 * Start the HTTP transport with StreamableHTTPServerTransport.
 * Each request gets a fresh Server + Transport (stateless).
 * Returns the listener so tests can close it. Signal handlers live in main().
 */
export async function startHttpTransport(): Promise<HttpServer> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const configuredHost = (process.env.MCP_HTTP_HOST ?? "").trim();
  const { secret: s2sSecret, host } = resolveHttpS2s(configuredHost);
  const isGatewayMode = process.env.AUTH_MODE === "gateway";

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`
    );

    // Health endpoint - no auth required
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          transport: "http",
          authMode: isGatewayMode ? "gateway" : "env",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // Empty s2sSecret is only reachable when MCP_ALLOW_INSECURE_DEV=1.
      // A configured secret is always enforced, before credential extraction.
      const s2sHeader = req.headers[S2S_HEADER];
      const s2sValue = typeof s2sHeader === "string" ? s2sHeader : undefined;
      if (s2sSecret && !verifyS2sHeader(s2sValue, s2sSecret)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
          })
        );
        return;
      }

      // Extract per-request credentials from headers (gateway mode).
      // Credentials are stored in AsyncLocalStorage so concurrent
      // requests are isolated — no process.env mutation.
      let gatewayCreds: { apiKey: string; subdomain?: string } | null = null;
      if (isGatewayMode) {
        gatewayCreds = extractGatewayCredentials(req);
        if (!gatewayCreds) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Missing credentials",
              message:
                "Gateway mode requires X-Syncro-API-Key header",
              required: ["X-Syncro-API-Key"],
              optional: ["X-Syncro-Subdomain"],
            })
          );
          return;
        }
      }

      const handleMcp = () => {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        res.on("close", () => {
          transport.close();
          server.close();
        });

        // Bind this request's server into the per-request async context
        // (not a module-level global) so elicitation helpers resolve
        // *this* server/transport even after await gaps, and never a
        // concurrent request's — see utils/server-ref.ts. The client cache
        // is scoped the same way (see utils/client.ts) so concurrent
        // requests never share or invalidate each other's Syncro client.
        runWithServerRef(server, () => {
          runWithClientScope(() => {
            server.connect(transport).then(() => {
              transport.handleRequest(req, res);
            });
          });
        });
      };

      if (gatewayCreds) {
        credentialStore.run(gatewayCreds, handleMcp);
      } else {
        handleMcp();
      }
      return;
    }

    // 404 for everything else
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] })
    );
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      const bound = httpServer.address();
      const boundPort = bound && typeof bound !== "string" ? bound.port : port;
      console.error(`Syncro MCP server listening on http://${host}:${boundPort}/mcp`);
      console.error(
        `Health check available at http://${host}:${boundPort}/health`
      );
      console.error(
        `Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`
      );
      resolve();
    });
  });

  return httpServer;
}

// Start the server
async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";

  if (transportType === "http") {
    const httpServer = await startHttpTransport();
    const shutdown = async (signal: string) => {
      console.error(`Received ${signal}, shutting down gracefully...`);
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } else {
    const server = createMcpServer();
    // stdio is single-session (one process = one caller), so there is no
    // concurrent tenant to isolate from — bind once for the process
    // lifetime rather than per-request. See utils/server-ref.ts and
    // utils/client.ts.
    bindServerRef(server);
    bindClientScope();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Syncro MCP server running on stdio");
  }
}

// Vitest imports this module to call startHttpTransport. Skip the CLI
// entrypoint and process-level crash handlers there. `node dist/index.js`
// still starts stdio or HTTP.
if (process.env.VITEST !== "true") {
  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
  });

  process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
    process.exit(1);
  });

  main().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
