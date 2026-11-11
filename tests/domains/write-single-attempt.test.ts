/**
 * Every SDK-backed write is sent once. The SDK resends a request after a 5xx
 * or 429, which for a POST can create a record or send an email more than
 * once, so these tests run the real client and handlers against a stubbed
 * `fetch` and count the outbound requests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contactsHandler } from "../../src/domains/contacts.js";
import { customersHandler } from "../../src/domains/customers.js";
import { invoicesHandler } from "../../src/domains/invoices.js";
import { ticketsHandler } from "../../src/domains/tickets.js";
import { clearClient } from "../../src/utils/client.js";
import type { DomainHandler } from "../../src/utils/types.js";

const UNKNOWN = "The change may or may not have been applied; check Syncro before retrying.";

const writes: Array<[string, DomainHandler, Record<string, unknown>, string]> = [
  ["syncro_customers_create", customersHandler, { business_name: "x" }, "POST /customers"],
  ["syncro_contacts_create", contactsHandler, { customer_id: 1, name: "x" }, "POST /contacts"],
  ["syncro_tickets_create", ticketsHandler, { customer_id: 1, subject: "x" }, "POST /tickets"],
  ["syncro_tickets_update", ticketsHandler, { ticket_id: 1, subject: "x" }, "PUT /tickets/1"],
  [
    "syncro_tickets_add_comment",
    ticketsHandler,
    { ticket_id: 1, body: "x", hidden: true },
    "POST /tickets/1/comment",
  ],
  ["syncro_invoices_create", invoicesHandler, { customer_id: 1 }, "POST /invoices"],
  [
    "syncro_invoices_email",
    invoicesHandler,
    { invoice_id: 1, confirm: true },
    "POST /invoices/1/email",
  ],
];

describe("SDK-backed writes against a failing Syncro", () => {
  const fetchMock = vi.fn();
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.SYNCRO_API_KEY = "test-key";
    process.env.SYNCRO_SUBDOMAIN = "acme";
    clearClient();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = savedEnv;
    clearClient();
  });

  const respond = (status: number) =>
    fetchMock.mockImplementation(
      async () => new Response("{}", { status, headers: { "content-type": "application/json" } })
    );

  const requestsSent = () =>
    fetchMock.mock.calls.map(([url, init]) => {
      const path = new URL(String(url)).pathname.replace("/api/v1", "");
      return `${init.method} ${path}`;
    });

  it.each(writes)("%s sends exactly one request after a 500", async (tool, handler, args, request) => {
    respond(500);

    const err = await handler.handleCall(tool, args).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(UNKNOWN);
    expect(requestsSent()).toEqual([request]);
  });

  it.each(writes)("%s sends exactly one request after a 429, and reports a rejection", async (tool, handler, args, request) => {
    respond(429);

    const err = await handler.handleCall(tool, args).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(UNKNOWN);
    expect(requestsSent()).toEqual([request]);
  });

  it("still retries a read after a 500, so reads keep the SDK's retry", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(new Response("{}", { status: 500 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ customer: { id: 1 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );

      const call = customersHandler.handleCall("syncro_customers_get", { customer_id: 1 });
      await vi.runAllTimersAsync();
      await call;

      expect(requestsSent()).toEqual(["GET /customers/1", "GET /customers/1"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
