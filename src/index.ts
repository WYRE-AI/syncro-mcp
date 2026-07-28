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
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createMcpServer } from "./mcp-server.js";
import { credentialStore } from "./utils/credential-store.js";
import { runWithServerRef, bindServerRef } from "./utils/server-ref.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || "";

/**
 * Extract gateway credentials from HTTP request headers.
 * Returns the credentials object if present, or null if the required API key is missing.
 */
function extractGatewayCredentials(req: IncomingMessage): { apiKey: string; subdomain?: string } | null {
  const headers = req.headers as Record<string, string | string[] | undefined>;

  const getHeader = (name: string): string | undefined => {
    const value = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  const apiKey = getHeader("x-syncro-api-key");
  if (!apiKey) return null;

  const subdomain = getHeader("x-syncro-subdomain");
  return { apiKey, ...(subdomain ? { subdomain } : {}) };
}

/**
 * Start the HTTP transport with StreamableHTTPServerTransport.
 * Each request gets a fresh Server + Transport (stateless).
 */
async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
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
      if (S2S_SECRET && !verifyS2sHeader(req.headers[S2S_HEADER] as string | undefined, S2S_SECRET)) {
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
        // concurrent request's — see utils/server-ref.ts.
        runWithServerRef(server, () => {
          server.connect(transport).then(() => {
            transport.handleRequest(req, res);
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

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.error(`Syncro MCP server listening on http://${host}:${port}/mcp`);
      console.error(
        `Health check available at http://${host}:${port}/health`
      );
      console.error(
        `Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`
      );
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.error(`Received ${signal}, shutting down gracefully...`);
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Start the server
async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    const server = createMcpServer();
    // stdio is single-session (one process = one caller), so there is no
    // concurrent tenant to isolate from — bind once for the process
    // lifetime rather than per-request. See utils/server-ref.ts.
    bindServerRef(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Syncro MCP server running on stdio");
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
