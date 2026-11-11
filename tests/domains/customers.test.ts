/**
 * Tests for the customers domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { customersHandler } from "../../src/domains/customers.js";
import * as clientModule from "../../src/utils/client.js";

// Mock the client module
vi.mock("../../src/utils/client.js", () => ({
  getClient: vi.fn(),
  getWriteClient: vi.fn(),
  getCredentials: vi.fn(),
  clearClient: vi.fn(),
}));

describe("domains/customers.ts", () => {
  const mockClient = {
    customers: {
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
    it("should return all customer tools", () => {
      const tools = customersHandler.getTools();

      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name)).toEqual([
        "syncro_customers_list",
        "syncro_customers_get",
        "syncro_customers_create",
        "syncro_customers_search",
      ]);
    });

    it("should define correct input schema for list tool", () => {
      const tools = customersHandler.getTools();
      const listTool = tools.find((t) => t.name === "syncro_customers_list");

      expect(listTool).toBeDefined();
      expect(listTool!.inputSchema.type).toBe("object");
      expect(listTool!.inputSchema.properties).toHaveProperty("query");
      expect(listTool!.inputSchema.properties).toHaveProperty("business_name");
      expect(listTool!.inputSchema.properties).toHaveProperty("email");
      expect(listTool!.inputSchema.properties).toHaveProperty("page");
      expect(listTool!.inputSchema.properties).toHaveProperty("per_page");
    });

    it("should mark customer_id as required for get tool", () => {
      const tools = customersHandler.getTools();
      const getTool = tools.find((t) => t.name === "syncro_customers_get");

      expect(getTool).toBeDefined();
      expect(getTool!.inputSchema.required).toContain("customer_id");
    });

    it("should mark query as required for search tool", () => {
      const tools = customersHandler.getTools();
      const searchTool = tools.find((t) => t.name === "syncro_customers_search");

      expect(searchTool).toBeDefined();
      expect(searchTool!.inputSchema.required).toContain("query");
    });
  });

  describe("handleCall", () => {
    describe("syncro_customers_list", () => {
      it("should list customers with default parameters", async () => {
        mockClient.customers.list.mockResolvedValue({
          customers: [{ id: 1, business_name: "Test Co" }],
          meta: { total_entries: 1, total_pages: 1, page: 1 },
        });

        const result = await customersHandler.handleCall("syncro_customers_list", {});

        expect(mockClient.customers.list).toHaveBeenCalledWith({
          query: undefined,
          business_name: undefined,
          email: undefined,
          phone: undefined,
          include_disabled: undefined,
          page: undefined,
          perPage: undefined,
        });
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.total_entries).toBe(1);
        expect(parsed.customers).toHaveLength(1);
      });

      it("should list customers with filters", async () => {
        mockClient.customers.list.mockResolvedValue({
          customers: [],
          meta: { total_entries: 0, total_pages: 0, page: 1 },
        });

        await customersHandler.handleCall("syncro_customers_list", {
          query: "acme",
          email: "test@acme.com",
          page: 2,
          per_page: 50,
        });

        expect(mockClient.customers.list).toHaveBeenCalledWith({
          query: "acme",
          business_name: undefined,
          email: "test@acme.com",
          phone: undefined,
          include_disabled: undefined,
          page: 2,
          perPage: 50,
        });
      });
    });

    describe("syncro_customers_get", () => {
      it("should get a customer by ID", async () => {
        const mockCustomer = { id: 123, business_name: "Test Co", email: "test@test.com" };
        mockClient.customers.get.mockResolvedValue(mockCustomer);

        const result = await customersHandler.handleCall("syncro_customers_get", {
          customer_id: 123,
        });

        expect(mockClient.customers.get).toHaveBeenCalledWith(123);
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.id).toBe(123);
        expect(parsed.business_name).toBe("Test Co");
      });
    });

    describe("syncro_customers_create", () => {
      it("should create a customer with all fields", async () => {
        const mockCustomer = { id: 456, business_name: "New Co" };
        mockClient.customers.create.mockResolvedValue(mockCustomer);

        const result = await customersHandler.handleCall("syncro_customers_create", {
          business_name: "New Co",
          firstname: "John",
          lastname: "Doe",
          email: "john@newco.com",
          phone: "555-1234",
        });

        expect(mockClient.customers.create).toHaveBeenCalledWith({
          business_name: "New Co",
          firstname: "John",
          lastname: "Doe",
          email: "john@newco.com",
          phone: "555-1234",
          mobile: undefined,
          address: undefined,
          address_2: undefined,
          city: undefined,
          state: undefined,
          zip: undefined,
          notes: undefined,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.id).toBe(456);
      });

      it("should create a customer with minimal fields", async () => {
        const mockCustomer = { id: 789, business_name: "Minimal" };
        mockClient.customers.create.mockResolvedValue(mockCustomer);

        await customersHandler.handleCall("syncro_customers_create", {
          business_name: "Minimal",
        });

        expect(mockClient.customers.create).toHaveBeenCalledWith({
          business_name: "Minimal",
          firstname: undefined,
          lastname: undefined,
          email: undefined,
          phone: undefined,
          mobile: undefined,
          address: undefined,
          address_2: undefined,
          city: undefined,
          state: undefined,
          zip: undefined,
          notes: undefined,
        });
      });

      it("should report an unknown outcome after a 5xx", async () => {
        mockClient.customers.create.mockRejectedValue(
          Object.assign(new Error("Server error: 500 Internal Server Error"), {
            statusCode: 500,
          })
        );

        await expect(
          customersHandler.handleCall("syncro_customers_create", { business_name: "x" })
        ).rejects.toThrow(/may or may not have been applied/);
      });
    });

    describe("syncro_customers_search", () => {
      it("should search customers with query", async () => {
        mockClient.customers.list.mockResolvedValue({
          customers: [{ id: 1 }, { id: 2 }],
          meta: { total_entries: 2, total_pages: 1, page: 1 },
        });

        const result = await customersHandler.handleCall("syncro_customers_search", {
          query: "acme",
        });

        expect(mockClient.customers.list).toHaveBeenCalledWith({
          query: "acme",
          perPage: 25,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.count).toBe(2);
        expect(parsed.customers).toHaveLength(2);
      });

      it("should search with custom limit", async () => {
        mockClient.customers.list.mockResolvedValue({
          customers: [],
          meta: { total_entries: 0, total_pages: 0, page: 1 },
        });

        await customersHandler.handleCall("syncro_customers_search", {
          query: "test",
          limit: 100,
        });

        expect(mockClient.customers.list).toHaveBeenCalledWith({
          query: "test",
          perPage: 100,
        });
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await customersHandler.handleCall("unknown_tool", {});

        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toContain("Unknown customer tool");
      });
    });
  });
});
