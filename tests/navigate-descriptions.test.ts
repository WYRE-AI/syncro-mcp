/**
 * syncro_navigate describes each domain's operations, including the ones that
 * reach the customer (a public comment, an invoice email) or bill them (a line
 * item), so a caller choosing a domain is not told they are read-only.
 */

import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp-server.js";

async function navigate(domain: string): Promise<string> {
  const server = createMcpServer();
  const client = new Client({ name: "navigate-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name: "syncro_navigate", arguments: { domain } });
  await client.close();
  return (result.content as Array<{ text: string }>)[0].text;
}

describe("syncro_navigate domain descriptions", () => {
  it("lists the create, comment and line item operations for tickets", async () => {
    const text = await navigate("tickets");

    expect(text).toMatch(/create/);
    expect(text).toMatch(/comments? \(a public comment is emailed to the customer/);
    expect(text).toMatch(/line items/);
  });

  it("lists the create and email operations for invoices", async () => {
    const text = await navigate("invoices");

    expect(text).toMatch(/create/);
    expect(text).toMatch(/email invoices \(emailing cannot be undone\)/);
  });

  it("does not claim update tools that customers and contacts do not have", async () => {
    expect((await navigate("customers")).split("\n\n")[0]).not.toMatch(/update/);
    expect((await navigate("contacts")).split("\n\n")[0]).not.toMatch(/update/);
  });
});
