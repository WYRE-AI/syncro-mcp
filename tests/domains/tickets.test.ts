/**
 * Tests for the tickets domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ticketsHandler } from "../../src/domains/tickets.js";
import * as clientModule from "../../src/utils/client.js";

// Mock the client module
vi.mock("../../src/utils/client.js", () => ({
  getClient: vi.fn(),
  getCredentials: vi.fn(),
  clearClient: vi.fn(),
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
  });

  describe("getTools", () => {
    it("should return all ticket tools", () => {
      const tools = ticketsHandler.getTools();

      expect(tools).toHaveLength(5);
      expect(tools.map((t) => t.name)).toEqual([
        "syncro_tickets_list",
        "syncro_tickets_get",
        "syncro_tickets_create",
        "syncro_tickets_update",
        "syncro_tickets_add_comment",
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

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await ticketsHandler.handleCall("unknown_tool", {});

        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toContain("Unknown ticket tool");
      });
    });
  });
});
