/**
 * Every tool the server lists must be classified read / write / destructive
 * via MCP annotations. The Conduit gateway locks out unclassified tools, so
 * this guards against a new tool shipping without annotations.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../src/mcp-server.js";
import { classifyTool } from "../src/utils/annotations.js";

async function listServerTools(): Promise<Tool[]> {
  const server = createMcpServer();
  const client = new Client({ name: "classification-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

const EXPECTED_CLASSES: Record<string, "read" | "write" | "destructive"> = {
  syncro_navigate: "read",
  syncro_status: "read",
  syncro_customers_list: "read",
  syncro_customers_get: "read",
  syncro_customers_create: "write",
  syncro_customers_search: "read",
  syncro_tickets_list: "read",
  syncro_tickets_get: "read",
  syncro_tickets_create: "write",
  syncro_tickets_update: "write",
  syncro_tickets_add_comment: "write",
  syncro_tickets_add_line_item: "write",
  syncro_assets_list: "read",
  syncro_assets_get: "read",
  syncro_assets_search: "read",
  syncro_assets_get_patches: "read",
  syncro_assets_list_installed_applications: "read",
  syncro_assets_list_policy_folders: "read",
  syncro_assets_set_policy_folder: "write",
  syncro_assets_run_script: "destructive",
  syncro_contacts_list: "read",
  syncro_contacts_get: "read",
  syncro_contacts_create: "write",
  syncro_invoices_list: "read",
  syncro_invoices_get: "read",
  syncro_invoices_create: "write",
  syncro_invoices_email: "destructive",
  syncro_time_list_entries: "read",
  syncro_time_log_entry: "write",
  syncro_time_set_billable: "write",
};

describe("tool classification", () => {
  it("lists exactly the expected tools", async () => {
    const names = (await listServerTools()).map((t) => t.name).sort();
    expect(names).toEqual(Object.keys(EXPECTED_CLASSES).sort());
  });

  it("classifies every listed tool", async () => {
    const unclassified = (await listServerTools())
      .filter((t) => classifyTool(t.annotations) === null)
      .map((t) => t.name);
    expect(unclassified).toEqual([]);
  });

  it.each(Object.entries(EXPECTED_CLASSES))(
    "%s is classified as %s",
    async (name, expected) => {
      const tool = (await listServerTools()).find((t) => t.name === name);
      expect(classifyTool(tool?.annotations)).toBe(expected);
    }
  );

  it("destructive tools warn and ask for confirmation in their description", async () => {
    const destructive = (await listServerTools()).filter(
      (t) => classifyTool(t.annotations) === "destructive"
    );
    expect(destructive.length).toBeGreaterThan(0);
    for (const tool of destructive) {
      expect(tool.description).toMatch(/^⚠ /);
      expect(tool.description).toContain("Confirm with the user before invoking");
    }
  });
});

describe("classifyTool", () => {
  it("returns null when hints are missing", () => {
    expect(classifyTool(undefined)).toBeNull();
    expect(classifyTool({})).toBeNull();
    expect(classifyTool({ readOnlyHint: false })).toBeNull();
  });

  it("maps hints to classes", () => {
    expect(classifyTool({ readOnlyHint: true })).toBe("read");
    expect(classifyTool({ readOnlyHint: false, destructiveHint: false })).toBe(
      "write"
    );
    expect(classifyTool({ readOnlyHint: false, destructiveHint: true })).toBe(
      "destructive"
    );
  });
});
