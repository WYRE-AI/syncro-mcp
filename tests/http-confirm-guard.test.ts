/**
 * Write confirmation over the gateway transport.
 *
 * Over HTTP the server is created per request, so it never sees the client's
 * capabilities and cannot elicit. These tests pin what the docs say happens
 * there: ordinary writes proceed with no prompt, destructive tools need
 * `confirm: true` (and only the boolean `true`), and a blocked call makes no
 * outbound request. They use the real HTTP transport in gateway mode with a
 * valid service-to-service header; only the outbound call to Syncro is stubbed.
 */

import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHttpTransport } from "../src/index.js";

const S2S_SECRET = "s2s-confirm-guard-test-4b1d";
const API_KEY = "gateway-api-key-6e0f";

const ENV_KEYS = [
  "CONDUIT_S2S_SECRET",
  "AUTH_MODE",
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "MCP_ALLOW_INSECURE_DEV",
  "SYNCRO_API_KEY",
  "SYNCRO_SUBDOMAIN",
] as const;

const savedEnv = new Map<string, string | undefined>();
const realFetch = globalThis.fetch;
const servers: Server[] = [];

/** Requests that would have gone to Syncro. Loopback calls to the server under test are not recorded. */
let outbound: Array<{ url: string; init?: RequestInit }>;

function mintS2sHeader(): string {
  const message = `t=${Math.floor(Date.now() / 1000)}`;
  const hex = createHmac("sha256", S2S_SECRET).update(message).digest("hex");
  return `${message},v1=${hex}`;
}

async function listen(): Promise<number> {
  const server = await startHttpTransport();
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ text: string }>;
}

async function callTool(
  port: number,
  name: string,
  args: Record<string, unknown>,
  subdomain = "acme"
): Promise<ToolResult> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-gateway-s2s": mintS2sHeader(),
      "x-syncro-api-key": API_KEY,
      "x-syncro-subdomain": subdomain,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { result: ToolResult };
  return payload.result;
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
  process.env.AUTH_MODE = "gateway";
  process.env.MCP_HTTP_PORT = "0";
  process.env.MCP_HTTP_HOST = "127.0.0.1";
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.SYNCRO_API_KEY;
  delete process.env.SYNCRO_SUBDOMAIN;

  outbound = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    outbound.push({ url, init });
    return Promise.resolve(
      new Response('{"message":"Ok"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server?.listening) continue;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("syncro_assets_run_script over the gateway transport", () => {
  const args = { asset_id: 42, script_id: 7 };

  it("is blocked without confirm and makes no outbound call", async () => {
    const port = await listen();

    const result = await callTool(port, "syncro_assets_run_script", args);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Confirmation required");
    expect(outbound).toHaveLength(0);
  });

  it("makes exactly one outbound call with confirm: true", async () => {
    const port = await listen();

    const result = await callTool(port, "syncro_assets_run_script", {
      ...args,
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(outbound).toHaveLength(1);
    const [{ url, init }] = outbound;
    expect(url).toBe("https://acme.syncromsp.com/api/v1/rmm/public_scripts/42/schedule");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toMatchObject({ script_id: 7, run_type: "now" });
  });

  it.each(["true", "yes", 1, false, null])(
    "is blocked when confirm is %j rather than the boolean true",
    async (confirm) => {
      const port = await listen();

      const result = await callTool(port, "syncro_assets_run_script", { ...args, confirm });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Confirmation required");
      expect(outbound).toHaveLength(0);
    }
  );

  it("shows what it would run in the blocked message", async () => {
    const port = await listen();

    const result = await callTool(port, "syncro_assets_run_script", {
      ...args,
      run_as: "system",
      variables: { reboot: "false" },
    });

    expect(result.content[0].text).toContain(
      'as system, with variables: {"reboot":"false"}'
    );
  });
});

describe("other writes over the gateway transport", () => {
  it("blocks syncro_invoices_email without confirm: true and sends nothing", async () => {
    const port = await listen();

    const result = await callTool(port, "syncro_invoices_email", { invoice_id: 5 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Confirmation required");
    expect(outbound).toHaveLength(0);
  });

  it("sends syncro_invoices_email once with confirm: true", async () => {
    const port = await listen();

    const result = await callTool(port, "syncro_invoices_email", {
      invoice_id: 5,
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toBe("https://acme.syncromsp.com/api/v1/invoices/5/email");
  });

  it("lets an ordinary write proceed with no prompt and no confirm", async () => {
    const port = await listen();

    const result = await callTool(port, "syncro_time_log_entry", {
      ticket_id: 9,
      start_at: "2026-11-05T14:00:00Z",
      duration_minutes: 15,
    });

    expect(result.isError).toBeUndefined();
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toBe("https://acme.syncromsp.com/api/v1/tickets/9/timer_entry");
  });
});

describe("subdomain header over the gateway transport", () => {
  it.each(["evil.example/x#", "evil.example#", "evil.example"])(
    "rejects %j before any outbound call",
    async (subdomain) => {
      const port = await listen();

      const rest = await callTool(
        port,
        "syncro_assets_run_script",
        { asset_id: 42, script_id: 7, confirm: true },
        subdomain
      );
      const sdk = await callTool(port, "syncro_customers_get", { customer_id: 1 }, subdomain);

      for (const result of [rest, sdk]) {
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("single subdomain label");
      }
      expect(outbound).toHaveLength(0);
    }
  );
});
