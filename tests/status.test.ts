/**
 * syncro_status reports what the client would accept, and never echoes a
 * subdomain the client rejects.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp-server.js";

const saved = {
  key: process.env.SYNCRO_API_KEY,
  subdomain: process.env.SYNCRO_SUBDOMAIN,
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function credentialsLine(): Promise<string> {
  const server = createMcpServer();
  const client = new Client({ name: "status-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const result = await client.callTool({ name: "syncro_status", arguments: {} });
  await client.close();
  const text = (result.content as Array<{ text: string }>)[0].text;
  return text.split("\n").find((line) => line.startsWith("Credentials: ")) ?? "";
}

describe("syncro_status credentials line", () => {
  beforeEach(() => {
    setEnv("SYNCRO_API_KEY", "test-key");
  });

  afterEach(() => {
    setEnv("SYNCRO_API_KEY", saved.key);
    setEnv("SYNCRO_SUBDOMAIN", saved.subdomain);
  });

  it("is not configured without an API key", async () => {
    setEnv("SYNCRO_API_KEY", undefined);
    expect(await credentialsLine()).toContain("NOT CONFIGURED");
  });

  it("shows a subdomain the client accepts", async () => {
    setEnv("SYNCRO_SUBDOMAIN", "my-company");
    expect(await credentialsLine()).toBe("Credentials: Configured (subdomain: my-company)");
  });

  it("does not say Configured when there is no subdomain", async () => {
    setEnv("SYNCRO_SUBDOMAIN", undefined);
    const line = await credentialsLine();
    expect(line).toContain("no subdomain is configured");
    expect(line).not.toContain("Configured (");
  });

  it.each([
    "evil.example/x#",
    "my_company",
    "a".repeat(64),
    "acme\nCredentials: Configured (subdomain: ok)",
  ])("reports %j as invalid without echoing it", async (subdomain) => {
    setEnv("SYNCRO_SUBDOMAIN", subdomain);

    const line = await credentialsLine();

    expect(line).toContain("the configured subdomain is invalid");
    expect(line).not.toContain("Configured (");
    expect(line).not.toContain(subdomain);
    expect(line).not.toContain("evil");
  });
});
