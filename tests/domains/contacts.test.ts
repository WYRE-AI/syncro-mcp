/**
 * Tests for the contacts domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { contactsHandler } from "../../src/domains/contacts.js";
import * as clientModule from "../../src/utils/client.js";

// Mock the client module
vi.mock("../../src/utils/client.js", () => ({
  getClient: vi.fn(),
  getWriteClient: vi.fn(),
  getCredentials: vi.fn(),
  clearClient: vi.fn(),
}));

describe("domains/contacts.ts", () => {
  const mockClient = {
    contacts: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);
    vi.mocked(clientModule.getWriteClient).mockResolvedValue(mockClient as never);
  });

  describe("getTools", () => {
    it("should return all contact tools", () => {
      const tools = contactsHandler.getTools();

      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual([
        "syncro_contacts_list",
        "syncro_contacts_get",
        "syncro_contacts_create",
      ]);
    });

    it("should define correct input schema for list tool", () => {
      const tools = contactsHandler.getTools();
      const listTool = tools.find((t) => t.name === "syncro_contacts_list");

      expect(listTool).toBeDefined();
      expect(listTool!.inputSchema.properties).toHaveProperty("customer_id");
      expect(listTool!.inputSchema.properties).toHaveProperty("query");
      expect(listTool!.inputSchema.properties).toHaveProperty("page");
      expect(listTool!.inputSchema.properties).toHaveProperty("per_page");
    });

    it("should mark contact_id as required for get tool", () => {
      const tools = contactsHandler.getTools();
      const getTool = tools.find((t) => t.name === "syncro_contacts_get");

      expect(getTool).toBeDefined();
      expect(getTool!.inputSchema.required).toContain("contact_id");
    });

    it("should mark customer_id and name as required for create tool", () => {
      const tools = contactsHandler.getTools();
      const createTool = tools.find((t) => t.name === "syncro_contacts_create");

      expect(createTool).toBeDefined();
      expect(createTool!.inputSchema.required).toContain("customer_id");
      expect(createTool!.inputSchema.required).toContain("name");
    });
  });

  describe("handleCall", () => {
    describe("syncro_contacts_list", () => {
      it("should list contacts with default parameters", async () => {
        mockClient.contacts.list.mockResolvedValue({
          contacts: [{ id: 1, name: "John Doe" }],
          meta: { total_entries: 1, total_pages: 1, page: 1 },
        });

        const result = await contactsHandler.handleCall("syncro_contacts_list", {});

        expect(mockClient.contacts.list).toHaveBeenCalledWith({
          customer_id: undefined,
          query: undefined,
          page: undefined,
          perPage: undefined,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.total_entries).toBe(1);
        expect(parsed.contacts).toHaveLength(1);
      });

      it("should list contacts filtered by customer", async () => {
        mockClient.contacts.list.mockResolvedValue({
          contacts: [
            { id: 1, name: "Jane Doe", customer_id: 123 },
            { id: 2, name: "Bob Smith", customer_id: 123 },
          ],
          meta: { total_entries: 2, total_pages: 1, page: 1 },
        });

        await contactsHandler.handleCall("syncro_contacts_list", {
          customer_id: 123,
        });

        expect(mockClient.contacts.list).toHaveBeenCalledWith({
          customer_id: 123,
          query: undefined,
          page: undefined,
          perPage: undefined,
        });
      });

      it("should search contacts by query", async () => {
        mockClient.contacts.list.mockResolvedValue({
          contacts: [],
          meta: { total_entries: 0, total_pages: 0, page: 1 },
        });

        await contactsHandler.handleCall("syncro_contacts_list", {
          query: "john",
        });

        expect(mockClient.contacts.list).toHaveBeenCalledWith(
          expect.objectContaining({
            query: "john",
          })
        );
      });

      it("should support pagination", async () => {
        mockClient.contacts.list.mockResolvedValue({
          contacts: [],
          meta: { total_entries: 100, total_pages: 4, page: 2 },
        });

        await contactsHandler.handleCall("syncro_contacts_list", {
          page: 2,
          per_page: 25,
        });

        expect(mockClient.contacts.list).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 2,
            perPage: 25,
          })
        );
      });
    });

    describe("syncro_contacts_get", () => {
      it("should get a contact by ID", async () => {
        const mockContact = {
          id: 456,
          name: "Alice Johnson",
          email: "alice@test.com",
          phone: "555-1234",
          customer_id: 123,
        };
        mockClient.contacts.get.mockResolvedValue(mockContact);

        const result = await contactsHandler.handleCall("syncro_contacts_get", {
          contact_id: 456,
        });

        expect(mockClient.contacts.get).toHaveBeenCalledWith(456);

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.id).toBe(456);
        expect(parsed.name).toBe("Alice Johnson");
        expect(parsed.email).toBe("alice@test.com");
      });
    });

    describe("syncro_contacts_create", () => {
      it("should create a contact with required fields only", async () => {
        const mockContact = { id: 789, name: "New Contact", customer_id: 123 };
        mockClient.contacts.create.mockResolvedValue(mockContact);

        const result = await contactsHandler.handleCall("syncro_contacts_create", {
          customer_id: 123,
          name: "New Contact",
        });

        expect(mockClient.contacts.create).toHaveBeenCalledWith({
          customer_id: 123,
          name: "New Contact",
          email: undefined,
          phone: undefined,
          mobile: undefined,
          address1: undefined,
          address2: undefined,
          city: undefined,
          state: undefined,
          zip: undefined,
          notes: undefined,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.id).toBe(789);
        expect(parsed.name).toBe("New Contact");
      });

      it("should report an unknown outcome after a 5xx", async () => {
        mockClient.contacts.create.mockRejectedValue(
          Object.assign(new Error("Server error: 504 Gateway Timeout"), {
            statusCode: 504,
          })
        );

        await expect(
          contactsHandler.handleCall("syncro_contacts_create", {
            customer_id: 1,
            name: "x",
          })
        ).rejects.toThrow(/may or may not have been applied/);
      });

      it("should create a contact with all fields", async () => {
        const mockContact = { id: 999, name: "Full Contact" };
        mockClient.contacts.create.mockResolvedValue(mockContact);

        await contactsHandler.handleCall("syncro_contacts_create", {
          customer_id: 100,
          name: "Full Contact",
          email: "full@test.com",
          phone: "555-1111",
          mobile: "555-2222",
          address1: "123 Main St",
          address2: "Suite 100",
          city: "Springfield",
          state: "IL",
          zip: "62701",
          notes: "VIP customer contact",
        });

        expect(mockClient.contacts.create).toHaveBeenCalledWith({
          customer_id: 100,
          name: "Full Contact",
          email: "full@test.com",
          phone: "555-1111",
          mobile: "555-2222",
          address1: "123 Main St",
          address2: "Suite 100",
          city: "Springfield",
          state: "IL",
          zip: "62701",
          notes: "VIP customer contact",
        });
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await contactsHandler.handleCall("unknown_tool", {});

        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toContain("Unknown contact tool");
      });
    });
  });
});
