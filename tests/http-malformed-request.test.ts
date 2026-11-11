/**
 * The HTTP listener answers a request whose Host header or request target is
 * malformed, instead of throwing before authentication. The process exits on
 * an uncaught exception, so one such request used to take the server down.
 *
 * Raw sockets are used because `fetch` will not send a malformed Host header
 * or request target.
 */

import { connect } from "node:net";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startHttpTransport } from "../src/index.js";

const ENV_KEYS = [
  "CONDUIT_S2S_SECRET",
  "MCP_ALLOW_INSECURE_DEV",
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "AUTH_MODE",
] as const;

const savedEnv = new Map<string, string | undefined>();
let server: Server;
let port: number;

/** Send raw bytes and return the response once the server closes the socket (HTTP/1.0). */
function rawRequest(
  request: string,
  targetPort = port
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(targetPort, "127.0.0.1");
    let received = "";
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error(`no response to: ${JSON.stringify(request)}`));
    });
    socket.on("data", (chunk) => (received += chunk.toString("utf8")));
    socket.on("error", reject);
    socket.on("close", () => {
      const [head = "", ...rest] = received.split("\r\n\r\n");
      resolve({ status: Number(head.split(" ")[1]), body: rest.join("\r\n\r\n") });
    });
    socket.write(request);
  });
}

// HTTP/1.0 so the response is not chunked and the body can be read as-is.
const get = (target: string, host = "localhost") =>
  rawRequest(`GET ${target} HTTP/1.0\r\nHost: ${host}\r\n\r\n`);

/** Start the real HTTP transport on an OS-allocated port with the given S2S secret. */
async function listen(secret?: string): Promise<{ server: Server; port: number }> {
  if (secret) process.env.CONDUIT_S2S_SECRET = secret;
  else delete process.env.CONDUIT_S2S_SECRET;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const started = await startHttpTransport();
  log.mockRestore();
  return { server: started, port: (started.address() as AddressInfo).port };
}

const close = (target: Server) =>
  new Promise<void>((resolve) => target.close(() => resolve()));

const mcpPost = (host: string) => {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "syncro_status", arguments: {} },
  });
  return (
    `POST /mcp HTTP/1.0\r\nHost: ${host}\r\n` +
    "Content-Type: application/json\r\n" +
    "Accept: application/json, text/event-stream\r\n" +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
};

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  delete process.env.AUTH_MODE;
  delete process.env.MCP_HTTP_HOST;
  process.env.MCP_ALLOW_INSECURE_DEV = "1";
  process.env.MCP_HTTP_PORT = "0";
  ({ server, port } = await listen());
});

afterAll(async () => {
  await close(server);
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("HTTP transport with a malformed request", () => {
  it.each(["[", "a b", "exa mple.com:99999", "[::1"])(
    "serves /health when the Host header is %j",
    async (host) => {
      const res = await get("/health", host);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).status).toBe("ok");
    }
  );

  it("answers 404 for an unknown path when the Host header is malformed", async () => {
    const res = await get("/nope", "[");

    expect(res.status).toBe(404);
  });

  it.each(["//", "http://[", "//[", "http://"])(
    "answers 400 with a JSON body for the request target %j",
    async (target) => {
      const res = await get(target);

      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: "Malformed request target" });
    }
  );

  it("keeps serving after malformed requests", async () => {
    await get("//");
    await get("/health", "[");

    const res = await get("/health");

    expect(res.status).toBe(200);
  });

  it("serves /mcp with a well-formed Host header", async () => {
    const res = await rawRequest(mcpPost("localhost"));

    expect(res.status).toBe(200);
    expect(res.body).toContain("Syncro");
  });

  it("answers /mcp when the Host header is malformed, and keeps serving", async () => {
    const res = await rawRequest(mcpPost("["));

    // The MCP transport itself refuses a Host it cannot parse.
    expect(res.status).toBe(400);
    expect((await get("/health")).status).toBe(200);
  });

  it("still checks the S2S header first when the Host header is malformed", async () => {
    const secured = await listen("s2s-secret-for-malformed-host-test");
    try {
      const res = await rawRequest(mcpPost("["), secured.port);

      expect(res.status).toBe(401);
      expect(JSON.parse(res.body).error).toContain("X-Gateway-S2S");
    } finally {
      await close(secured.server);
    }
  });
});
