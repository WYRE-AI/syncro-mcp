/**
 * Tests for the Cloudflare Workers entrypoint.
 *
 * Drives the exported `fetch` handler directly with Web Standard Request objects
 * (available natively in Node 18+), exercising the same WebStandardStreamableHTTP
 * transport the Worker uses in production.
 */

import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import worker, { type Env } from "../src/worker.js";
import { S2S_HEADER } from "../src/s2s-verify.js";

const S2S_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** A valid X-Gateway-S2S value, signed the way the gateway signs it. */
function signS2s(secret = S2S_SECRET, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`t=${t}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

/** POST to /mcp. Defaults to a configured secret and a validly signed header. */
async function mcp(
  body: unknown,
  env: Env = {},
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return worker.fetch(
    new Request("http://worker.local/mcp", {
      method: "POST",
      headers: { ...MCP_HEADERS, [S2S_HEADER]: signS2s(), ...extraHeaders },
      body: JSON.stringify(body),
    }),
    { CONDUIT_S2S_SECRET: S2S_SECRET, ...env }
  );
}

const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

describe("Cloudflare Worker entrypoint", () => {
  it("serves a shallow health probe", async () => {
    const res = await worker.fetch(
      new Request("http://worker.local/health"),
      {}
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });

  it("sets no CORS headers, on the health probe or on /mcp", async () => {
    const health = await worker.fetch(new Request("http://worker.local/health"), {});
    const ok = await mcp(TOOLS_LIST);
    const denied = await mcp(TOOLS_LIST, {}, { [S2S_HEADER]: "" });
    for (const res of [health, ok, denied]) {
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("does not answer a CORS preflight for /mcp without S2S", async () => {
    const res = await worker.fetch(
      new Request("http://worker.local/mcp", { method: "OPTIONS" }),
      { CONDUIT_S2S_SECRET: S2S_SECRET }
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("404s unknown paths", async () => {
    const res = await worker.fetch(new Request("http://worker.local/nope"), {});
    expect(res.status).toBe(404);
  });

  it("handles MCP initialize", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0" },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(body.result?.serverInfo?.name).toBe("syncro-mcp");
  });

  it("lists all tools without credentials", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (body.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain("syncro_navigate");
    expect(names).toContain("syncro_status");
    expect(names).toContain("syncro_tickets_list");
    expect(names.length).toBeGreaterThan(10);
  });

  it("returns a graceful error for a credential-requiring tool when unconfigured", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "syncro_tickets_list", arguments: {} },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: { text?: string }[] };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toMatch(/credential/i);
  });

  it("rejects /mcp in gateway mode without credential headers", async () => {
    const res = await mcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "syncro_tickets_list", arguments: {} },
      },
      { AUTH_MODE: "gateway" }
    );
    expect(res.status).toBe(401);
  });

  it("accepts /mcp in gateway mode with credential headers", async () => {
    const res = await mcp(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/list",
        params: {},
      },
      { AUTH_MODE: "gateway" },
      { "X-Syncro-API-Key": "test-key", "X-Syncro-Subdomain": "acme" }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { tools?: { name: string }[] };
    };
    expect((body.result?.tools ?? []).length).toBeGreaterThan(10);
  });

  describe("caller authentication (X-Gateway-S2S)", () => {
    const rawMcp = (env: Env, headers: Record<string, string> = {}) =>
      worker.fetch(
        new Request("http://worker.local/mcp", {
          method: "POST",
          headers: { ...MCP_HEADERS, ...headers },
          body: JSON.stringify(TOOLS_LIST),
        }),
        env
      );

    const modes: Array<[string, Env]> = [
      ["env mode", { SYNCRO_API_KEY: "stored-key" }],
      ["gateway mode", { AUTH_MODE: "gateway" }],
    ];

    describe.each(modes)("%s", (_mode, base) => {
      const gatewayHeaders: Record<string, string> =
        base.AUTH_MODE === "gateway" ? { "X-Syncro-API-Key": "k" } : {};
      const env: Env = { ...base, CONDUIT_S2S_SECRET: S2S_SECRET };

      it("401s with no X-Gateway-S2S header", async () => {
        const res = await rawMcp(env, gatewayHeaders);
        expect(res.status).toBe(401);
      });

      it.each([
        ["garbage", "nope"],
        ["signed with another secret", signS2s("another-secret-value-entirely")],
        ["a stale timestamp", signS2s(S2S_SECRET, Math.floor(Date.now() / 1000) - 3600)],
      ])("401s with an X-Gateway-S2S header that is %s", async (_name, value) => {
        const res = await rawMcp(env, { ...gatewayHeaders, [S2S_HEADER]: value });
        expect(res.status).toBe(401);
      });

      it("serves /mcp with a valid X-Gateway-S2S header", async () => {
        const res = await rawMcp(env, { ...gatewayHeaders, [S2S_HEADER]: signS2s() });
        expect(res.status).toBe(200);
      });

      it.each([
        ["not configured", undefined],
        ["empty", "  "],
        ["a known placeholder", "changeme"],
      ])("fails closed when the secret is %s, even with a header signed with it", async (_name, secret) => {
        const res = await rawMcp(
          { ...base, CONDUIT_S2S_SECRET: secret },
          { ...gatewayHeaders, [S2S_HEADER]: signS2s(secret ?? "") }
        );
        expect(res.status).toBe(401);
      });
    });

    it("keeps /health unauthenticated, even with no secret configured", async () => {
      const res = await worker.fetch(new Request("http://worker.local/health"), {});
      expect(res.status).toBe(200);
    });
  });
});
