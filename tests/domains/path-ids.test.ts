/**
 * Every ID that a tool places in a request path is validated first.
 *
 * The SDK builds paths such as `/tickets/${id}/comment` without encoding, and
 * `fetch` resolves `..` segments, so an unvalidated string id could point a
 * write at a different endpoint, including one the server guards with
 * `confirm`. One row per (tool, id argument): the row fails if that single
 * validation is removed, because the stubbed client and REST helper would then
 * accept the bad value.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetsHandler } from "../../src/domains/assets.js";
import { contactsHandler } from "../../src/domains/contacts.js";
import { customersHandler } from "../../src/domains/customers.js";
import { invoicesHandler } from "../../src/domains/invoices.js";
import { ticketsHandler } from "../../src/domains/tickets.js";
import { timeHandler } from "../../src/domains/time.js";
import * as clientModule from "../../src/utils/client.js";
import * as restModule from "../../src/utils/rest.js";
import * as guardModule from "../../src/utils/write-guard.js";
import type { DomainHandler } from "../../src/utils/types.js";

vi.mock("../../src/utils/client.js", () => ({
  getClient: vi.fn(),
  getWriteClient: vi.fn(),
  getCredentials: vi.fn(),
  clearClient: vi.fn(),
}));

vi.mock("../../src/utils/rest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/rest.js")>()),
  syncroRest: vi.fn(),
}));

vi.mock("../../src/utils/write-guard.js", () => ({
  guardWrite: vi.fn(),
}));

/** Every SDK method call a handler makes lands here, whatever the resource. */
const sdkCalls: string[] = [];
const sdk = new Proxy(
  {},
  {
    get: (_target, resource) =>
      new Proxy(
        {},
        {
          get: (_resource, method) => async () => {
            sdkCalls.push(`${String(resource)}.${String(method)}`);
            return {};
          },
        }
      ),
  }
);

/** An id that would turn a ticket write into an invoice email. */
const TRAVERSAL = "1/../../invoices/5/email?";
const BAD_IDS = [TRAVERSAL, "..", "7", 0, -3, 1.5, null];

interface Row {
  handler: DomainHandler;
  tool: string;
  /** Valid arguments for the tool. */
  args: Record<string, unknown>;
  /** The id argument under test. */
  idArg: string;
}

const rows: Row[] = [
  // tickets (SDK-backed, except the line item)
  ...["syncro_tickets_get", "syncro_tickets_update", "syncro_tickets_add_comment"].map(
    (tool) => ({
      handler: ticketsHandler,
      tool,
      args: { ticket_id: 1, subject: "s", body: "b" },
      idArg: "ticket_id",
    })
  ),
  {
    handler: ticketsHandler,
    tool: "syncro_tickets_add_line_item",
    args: { ticket_id: 1, name: "n", description: "d" },
    idArg: "ticket_id",
  },
  { handler: customersHandler, tool: "syncro_customers_get", args: { customer_id: 1 }, idArg: "customer_id" },
  { handler: contactsHandler, tool: "syncro_contacts_get", args: { contact_id: 1 }, idArg: "contact_id" },
  { handler: assetsHandler, tool: "syncro_assets_get", args: { asset_id: 1 }, idArg: "asset_id" },
  { handler: assetsHandler, tool: "syncro_assets_get_patches", args: { asset_id: 1 }, idArg: "asset_id" },
  {
    handler: assetsHandler,
    tool: "syncro_assets_list_installed_applications",
    args: { asset_id: 1 },
    idArg: "asset_id",
  },
  {
    handler: assetsHandler,
    tool: "syncro_assets_set_policy_folder",
    args: { asset_id: 1, policy_folder_id: 2 },
    idArg: "asset_id",
  },
  {
    handler: assetsHandler,
    tool: "syncro_assets_set_policy_folder",
    args: { asset_id: 1, policy_folder_id: 2 },
    idArg: "policy_folder_id",
  },
  {
    handler: assetsHandler,
    tool: "syncro_assets_run_script",
    args: { asset_id: 1, script_id: 2, confirm: true },
    idArg: "asset_id",
  },
  {
    handler: assetsHandler,
    tool: "syncro_assets_run_script",
    args: { asset_id: 1, script_id: 2, confirm: true },
    idArg: "script_id",
  },
  { handler: invoicesHandler, tool: "syncro_invoices_get", args: { invoice_id: 1 }, idArg: "invoice_id" },
  {
    handler: invoicesHandler,
    tool: "syncro_invoices_email",
    args: { invoice_id: 1, confirm: true },
    idArg: "invoice_id",
  },
  {
    handler: timeHandler,
    tool: "syncro_time_log_entry",
    args: { ticket_id: 1, start_at: "2026-11-07T02:00:00Z", duration_minutes: 5 },
    idArg: "ticket_id",
  },
  {
    handler: timeHandler,
    tool: "syncro_time_set_billable",
    args: { timer_id: 1, billable: true },
    idArg: "timer_id",
  },
];

describe("ids placed in a request path", () => {
  beforeEach(() => {
    sdkCalls.length = 0;
    vi.mocked(clientModule.getClient).mockResolvedValue(sdk as never);
    vi.mocked(clientModule.getWriteClient).mockResolvedValue(sdk as never);
    vi.mocked(restModule.syncroRest).mockReset();
    vi.mocked(restModule.syncroRest).mockResolvedValue({});
    vi.mocked(guardModule.guardWrite).mockReset();
    vi.mocked(guardModule.guardWrite).mockResolvedValue(null);
  });

  const requestsMade = () => sdkCalls.length + vi.mocked(restModule.syncroRest).mock.calls.length;

  describe.each(rows)("$tool $idArg", ({ handler, tool, args, idArg }) => {
    it("is sent when valid", async () => {
      await handler.handleCall(tool, args);

      expect(requestsMade()).toBeGreaterThan(0);
    });

    it.each(BAD_IDS)("rejects %j before any request or prompt", async (bad) => {
      await expect(handler.handleCall(tool, { ...args, [idArg]: bad })).rejects.toThrow(
        `${idArg} must be a positive integer`
      );

      expect(requestsMade()).toBe(0);
      expect(guardModule.guardWrite).not.toHaveBeenCalled();
    });
  });

  it("covers every tool with a required id", () => {
    // These take an id only in the body or the query string, never in the path.
    const notInPath = ["syncro_tickets_create", "syncro_contacts_create", "syncro_invoices_create", "syncro_assets_list_policy_folders"];
    const covered = new Set(rows.map((row) => row.tool));
    const idKeys = ["ticket_id", "customer_id", "contact_id", "asset_id", "invoice_id", "timer_id"];

    const missing = [ticketsHandler, customersHandler, contactsHandler, assetsHandler, invoicesHandler, timeHandler]
      .flatMap((handler) => handler.getTools())
      .filter((tool) => idKeys.some((key) => tool.inputSchema.required?.includes(key)))
      .map((tool) => tool.name)
      .filter((name) => !covered.has(name) && !notInPath.includes(name));

    expect(missing).toEqual([]);
  });
});
