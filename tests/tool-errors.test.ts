/**
 * A failed tool call keeps the Syncro HTTP status in its error text, so a
 * caller can tell a 401 from a 404 from a 422.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp-server.js";
import { getDomainHandler } from "../src/domains/index.js";

vi.mock("../src/domains/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/domains/index.js")>()),
  getDomainHandler: vi.fn(),
}));

/** An error with a `statusCode`, shaped like the SDK's. */
function statusError(message: string, statusCode: unknown): Error {
  return Object.assign(new Error(message), { statusCode });
}

async function callTicketsList(thrown: unknown): Promise<string> {
  vi.mocked(getDomainHandler).mockResolvedValue({
    handleCall: vi.fn().mockRejectedValue(thrown),
  } as never);
  const server = createMcpServer();
  const client = new Client({ name: "tool-errors-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name: "syncro_tickets_list", arguments: {} });
  await client.close();
  expect(result.isError).toBe(true);
  return (result.content as Array<{ text: string }>)[0].text;
}

describe("tool error text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([401, 404, 422, 500])("includes HTTP %i when the error carries it", async (status) => {
    const text = await callTicketsList(statusError("Syncro said no", status));
    expect(text).toBe(`Error (HTTP ${status}): Syncro said no`);
  });

  it("includes the status of the original error when sdkWrite wrapped it", async () => {
    const wrapped = new Error("Boom. The change may or may not have been applied", {
      cause: statusError("Boom", 502),
    });
    expect(await callTicketsList(wrapped)).toBe(
      "Error (HTTP 502): Boom. The change may or may not have been applied"
    );
  });

  it.each([
    ["an error with no status", new Error("plain")],
    ["a non-numeric status", statusError("plain", "422")],
    ["a thrown string", "plain"],
    ["a thrown null", null],
  ])("keeps the plain form for %s", async (_name, thrown) => {
    const text = await callTicketsList(thrown);
    expect(text).toMatch(/^Error: /);
    expect(text).not.toContain("HTTP");
  });
});
