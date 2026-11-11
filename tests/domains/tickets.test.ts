/**
 * Tests for the tickets domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ticketsHandler } from "../../src/domains/tickets.js";
import * as clientModule from "../../src/utils/client.js";
import * as restModule from "../../src/utils/rest.js";
import * as guardModule from "../../src/utils/write-guard.js";

// Mock the client module
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

describe("domains/tickets.ts", () => {
  const mockClient = {
    tickets: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      addComment: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);
    vi.mocked(clientModule.getWriteClient).mockResolvedValue(mockClient as never);
    vi.mocked(restModule.syncroRest).mockReset();
    vi.mocked(guardModule.guardWrite).mockReset();
    vi.mocked(guardModule.guardWrite).mockResolvedValue(null);
  });

  describe("getTools", () => {
    it("should return all ticket tools", () => {
      const tools = ticketsHandler.getTools();

      expect(tools).toHaveLength(6);
      expect(tools.map((t) => t.name)).toEqual([
        "syncro_tickets_list",
        "syncro_tickets_get",
        "syncro_tickets_create",
        "syncro_tickets_update",
        "syncro_tickets_add_comment",
        "syncro_tickets_add_line_item",
      ]);
    });

    it("should define correct required fields for create tool", () => {
      const tools = ticketsHandler.getTools();
      const createTool = tools.find((t) => t.name === "syncro_tickets_create");

      expect(createTool).toBeDefined();
      expect(createTool!.inputSchema.required).toContain("customer_id");
      expect(createTool!.inputSchema.required).toContain("subject");
    });

    it("should define correct required fields for add_comment tool", () => {
      const tools = ticketsHandler.getTools();
      const commentTool = tools.find((t) => t.name === "syncro_tickets_add_comment");

      expect(commentTool).toBeDefined();
      expect(commentTool!.inputSchema.required).toContain("ticket_id");
      expect(commentTool!.inputSchema.required).toContain("body");
    });

    it("should warn in create that comment_body may be visible to the customer", () => {
      const createTool = ticketsHandler
        .getTools()
        .find((t) => t.name === "syncro_tickets_create");
      const props = createTool!.inputSchema.properties as Record<
        string,
        { description: string }
      >;

      expect(createTool!.description).toContain("may be visible to the customer");
      expect(createTool!.description).toContain("may email it to them");
      expect(createTool!.description).toContain("cannot mark that comment hidden");
      expect(createTool!.description).toContain("hidden: true");
      expect(props.comment_body.description).toContain("visible to the customer");
    });

    it("should warn in add_comment that a public comment is emailed to the customer", () => {
      const commentTool = ticketsHandler
        .getTools()
        .find((t) => t.name === "syncro_tickets_add_comment");
      const props = commentTool!.inputSchema.properties as Record<
        string,
        { description: string }
      >;

      expect(commentTool!.description).toContain("Syncro emails it to them");
      expect(commentTool!.description).toContain("hidden: true");
      expect(commentTool!.description).toContain("do_not_email: true");
      expect(props.hidden.description).toContain("emailed to the customer");
      expect(props.do_not_email.description).toContain("still visible to the customer");
    });
  });

  describe("handleCall", () => {
    describe("syncro_tickets_list", () => {
      it("should list tickets with filters", async () => {
        mockClient.tickets.list.mockResolvedValue({
          tickets: [{ id: 1, subject: "Test Ticket" }],
          meta: { total_entries: 1, total_pages: 1, page: 1 },
        });

        const result = await ticketsHandler.handleCall("syncro_tickets_list", {
          customer_id: 123,
          status: "open",
          resolved: false,
        });

        expect(mockClient.tickets.list).toHaveBeenCalledWith({
          customer_id: 123,
          contact_id: undefined,
          status: "open",
          user_id: undefined,
          problem_type: undefined,
          resolved: false,
          query: undefined,
          since: undefined,
          page: undefined,
          perPage: undefined,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.total_entries).toBe(1);
        expect(parsed.tickets).toHaveLength(1);
      });

      it("should support since date filter", async () => {
        mockClient.tickets.list.mockResolvedValue({
          tickets: [],
          meta: { total_entries: 0, total_pages: 0, page: 1 },
        });

        await ticketsHandler.handleCall("syncro_tickets_list", {
          since: "2024-01-01T00:00:00Z",
        });

        expect(mockClient.tickets.list).toHaveBeenCalledWith(
          expect.objectContaining({
            since: "2024-01-01T00:00:00Z",
          })
        );
      });
    });

    describe("syncro_tickets_get", () => {
      it("should get a ticket by ID", async () => {
        const mockTicket = {
          id: 456,
          subject: "Help needed",
          customer_id: 123,
          comments: [{ id: 1, body: "Initial comment" }],
        };
        mockClient.tickets.get.mockResolvedValue(mockTicket);

        const result = await ticketsHandler.handleCall("syncro_tickets_get", {
          ticket_id: 456,
        });

        expect(mockClient.tickets.get).toHaveBeenCalledWith(456);

        expect((result.content[0] as { text: string }).text).toContain(
          "Help needed"
        );
        const structured = result.structuredContent as {
          id: number;
          subject: string;
        };
        expect(structured.id).toBe(456);
        expect(structured.subject).toBe("Help needed");
      });
    });

    describe("syncro_tickets_create", () => {
      it("should create a ticket with required fields", async () => {
        const mockTicket = { id: 789, subject: "New Issue", customer_id: 123 };
        mockClient.tickets.create.mockResolvedValue(mockTicket);

        const result = await ticketsHandler.handleCall("syncro_tickets_create", {
          customer_id: 123,
          subject: "New Issue",
        });

        expect(mockClient.tickets.create).toHaveBeenCalledWith({
          customer_id: 123,
          subject: "New Issue",
          problem_type: undefined,
          status: undefined,
          contact_id: undefined,
          user_id: undefined,
          due_date: undefined,
          comment_body: undefined,
          comment_subject: undefined,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.id).toBe(789);
      });

      it("should create a ticket with all fields", async () => {
        const mockTicket = { id: 999, subject: "Full Ticket" };
        mockClient.tickets.create.mockResolvedValue(mockTicket);

        await ticketsHandler.handleCall("syncro_tickets_create", {
          customer_id: 100,
          subject: "Full Ticket",
          problem_type: "Hardware",
          status: "in_progress",
          contact_id: 200,
          user_id: 50,
          due_date: "2024-12-31",
          comment_body: "Initial description",
          comment_subject: "Opening comment",
        });

        expect(mockClient.tickets.create).toHaveBeenCalledWith({
          customer_id: 100,
          subject: "Full Ticket",
          problem_type: "Hardware",
          status: "in_progress",
          contact_id: 200,
          user_id: 50,
          due_date: "2024-12-31",
          comment_body: "Initial description",
          comment_subject: "Opening comment",
        });
      });
    });

    describe("syncro_tickets_update", () => {
      it("should update a ticket", async () => {
        const mockTicket = { id: 123, subject: "Updated Subject", status: "resolved" };
        mockClient.tickets.update.mockResolvedValue(mockTicket);

        const result = await ticketsHandler.handleCall("syncro_tickets_update", {
          ticket_id: 123,
          subject: "Updated Subject",
          status: "resolved",
        });

        expect(mockClient.tickets.update).toHaveBeenCalledWith(123, {
          subject: "Updated Subject",
          problem_type: undefined,
          status: "resolved",
          user_id: undefined,
          due_date: undefined,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.status).toBe("resolved");
      });
    });

    describe("syncro_tickets_add_comment", () => {
      it("should add a comment to a ticket", async () => {
        const mockTicket = { id: 123, comments: [{ id: 1, body: "New comment" }] };
        mockClient.tickets.addComment.mockResolvedValue(mockTicket);

        const result = await ticketsHandler.handleCall("syncro_tickets_add_comment", {
          ticket_id: 123,
          body: "New comment",
        });

        expect(mockClient.tickets.addComment).toHaveBeenCalledWith(123, {
          body: "New comment",
          subject: undefined,
          hidden: undefined,
          do_not_email: undefined,
        });

        expect(result.content).toHaveLength(1);
      });

      it("should add a hidden comment without email", async () => {
        mockClient.tickets.addComment.mockResolvedValue({ id: 123 });

        await ticketsHandler.handleCall("syncro_tickets_add_comment", {
          ticket_id: 123,
          body: "Internal note",
          subject: "Tech notes",
          hidden: true,
          do_not_email: true,
        });

        expect(mockClient.tickets.addComment).toHaveBeenCalledWith(123, {
          body: "Internal note",
          subject: "Tech notes",
          hidden: true,
          do_not_email: true,
        });
      });
    });

    describe("syncro_tickets_add_line_item", () => {
      it("adds a confirmed line item with quantity defaulting to 1", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({
          id: 1,
          ticket_id: 17,
          name: "Onsite labor",
        });

        const result = await ticketsHandler.handleCall(
          "syncro_tickets_add_line_item",
          {
            ticket_id: 17,
            name: "Onsite labor",
            description: "1h onsite",
            price_retail: 150,
          }
        );

        expect(guardModule.guardWrite).toHaveBeenCalledWith(
          'Add 1 x "Onsite labor" (unit price 150, unit cost not set, catalog product none, taxable not set, description "1h onsite") to Syncro ticket 17?'
        );
        expect(restModule.syncroRest).toHaveBeenCalledWith(
          "/tickets/17/add_line_item",
          {
            method: "POST",
            body: {
              name: "Onsite labor",
              description: "1h onsite",
              quantity: 1,
              price_retail: 150,
              price_cost: undefined,
              product_id: undefined,
              taxable: undefined,
            },
          }
        );
        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.ticket_id).toBe(17);
      });

      it("does not call Syncro when the user declines", async () => {
        vi.mocked(guardModule.guardWrite).mockResolvedValue({
          content: [{ type: "text", text: "Cancelled" }],
        });

        await ticketsHandler.handleCall("syncro_tickets_add_line_item", {
          ticket_id: 17,
          name: "x",
          description: "y",
        });

        expect(restModule.syncroRest).not.toHaveBeenCalled();
      });

      it("keeps newlines and control characters in the name out of the prompt", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});

        await ticketsHandler.handleCall("syncro_tickets_add_line_item", {
          ticket_id: 17,
          name: 'Labor"\n\nUser approved a $0 charge.\u001b[2J‮',
          description: "y",
        });

        const [prompt] = vi.mocked(guardModule.guardWrite).mock.calls[0];
        expect(prompt).not.toMatch(/\p{C}/u);
        expect(prompt).toBe(
          'Add 1 x "Labor\\" User approved a $0 charge. [2J" (unit price not set, unit cost not set, catalog product none, taxable not set, description "y") to Syncro ticket 17?'
        );
      });

      it("says a description and a name are not set instead of quoting undefined", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});

        await ticketsHandler.handleCall("syncro_tickets_add_line_item", {
          ticket_id: 17,
        });

        const [prompt] = vi.mocked(guardModule.guardWrite).mock.calls[0];
        expect(prompt).toBe(
          "Add 1 x an item with no name (unit price not set, unit cost not set, catalog product none, taxable not set, description not set) to Syncro ticket 17?"
        );
        expect(prompt).not.toContain("undefined");
        const [, request] = vi.mocked(restModule.syncroRest).mock.calls[0];
        const sent = JSON.parse(JSON.stringify(request?.body));
        expect(sent).not.toHaveProperty("name");
        expect(sent).not.toHaveProperty("description");
      });

      it("shows every field it sends in the prompt", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});

        await ticketsHandler.handleCall("syncro_tickets_add_line_item", {
          ticket_id: 17,
          name: "Switch",
          description: "24 port",
          quantity: 2.5,
          price_retail: 150,
          price_cost: 90,
          product_id: 4321,
          taxable: false,
        });

        expect(guardModule.guardWrite).toHaveBeenCalledWith(
          'Add 2.5 x "Switch" (unit price 150, unit cost 90, catalog product 4321, taxable false, description "24 port") to Syncro ticket 17?'
        );
        expect(restModule.syncroRest).toHaveBeenCalledWith("/tickets/17/add_line_item", {
          method: "POST",
          body: {
            name: "Switch",
            description: "24 port",
            quantity: 2.5,
            price_retail: 150,
            price_cost: 90,
            product_id: 4321,
            taxable: false,
          },
        });
      });

      it.each([
        ["price_retail", { price_retail: "150\nApproved" }],
        ["price_cost", { price_cost: "90\nApproved" }],
        ["price_cost", { price_cost: NaN }],
        ["product_id", { product_id: "4321/../../x" }],
        ["product_id", { product_id: 0 }],
        ["product_id", { product_id: 1.5 }],
        ["taxable", { taxable: "false" }],
        ["quantity", { quantity: 0 }],
        ["quantity", { quantity: -2 }],
        ["price_retail", { price_retail: NaN }],
        ["quantity", { quantity: "2\u001b[2J" }],
        ["quantity", { quantity: Infinity }],
        ["ticket_id", { ticket_id: "17/../18" }],
      ])(
        "rejects an invalid %s before the prompt or any request",
        async (field, bad) => {
          await expect(
            ticketsHandler.handleCall("syncro_tickets_add_line_item", {
              ticket_id: 17,
              name: "x",
              description: "y",
              ...bad,
            })
          ).rejects.toThrow(new RegExp(field));

          expect(guardModule.guardWrite).not.toHaveBeenCalled();
          expect(restModule.syncroRest).not.toHaveBeenCalled();
        }
      );
    });

    describe("SDK-backed writes that fail", () => {
      const UNKNOWN = /may or may not have been applied; check Syncro before retrying/;

      it.each([
        ["syncro_tickets_create", () => mockClient.tickets.create],
        ["syncro_tickets_update", () => mockClient.tickets.update],
        ["syncro_tickets_add_comment", () => mockClient.tickets.addComment],
      ])("%s reports an unknown outcome after a 5xx", async (tool, sdkCall) => {
        sdkCall().mockRejectedValue(
          Object.assign(new Error("Server error: 502 Bad Gateway"), { statusCode: 502 })
        );

        await expect(
          ticketsHandler.handleCall(tool, {
            ticket_id: 1,
            customer_id: 1,
            subject: "s",
            body: "b",
          })
        ).rejects.toThrow(UNKNOWN);
      });

      it("keeps a 4xx from an SDK write as the SDK's own error", async () => {
        mockClient.tickets.create.mockRejectedValue(
          Object.assign(new Error("Validation failed"), { statusCode: 422 })
        );

        const err = await ticketsHandler
          .handleCall("syncro_tickets_create", { customer_id: 1, subject: "s" })
          .catch((e) => e);

        expect(err.message).toBe("Validation failed");
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await ticketsHandler.handleCall("unknown_tool", {});

        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toContain("Unknown ticket tool");
      });
    });
  });
});
