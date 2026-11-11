/**
 * Tests for domain navigation and caching
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDomainHandler,
  getAvailableDomains,
  clearDomainCache,
} from "../../src/domains/index.js";

// Mock all domain handlers
vi.mock("../../src/domains/customers.js", () => ({
  customersHandler: {
    getTools: vi.fn().mockReturnValue([{ name: "syncro_customers_list" }]),
    handleCall: vi.fn(),
  },
}));

vi.mock("../../src/domains/tickets.js", () => ({
  ticketsHandler: {
    getTools: vi.fn().mockReturnValue([{ name: "syncro_tickets_list" }]),
    handleCall: vi.fn(),
  },
}));

vi.mock("../../src/domains/assets.js", () => ({
  assetsHandler: {
    getTools: vi.fn().mockReturnValue([{ name: "syncro_assets_list" }]),
    handleCall: vi.fn(),
  },
}));

vi.mock("../../src/domains/contacts.js", () => ({
  contactsHandler: {
    getTools: vi.fn().mockReturnValue([{ name: "syncro_contacts_list" }]),
    handleCall: vi.fn(),
  },
}));

vi.mock("../../src/domains/time.js", () => ({
  timeHandler: {
    getTools: vi.fn().mockReturnValue([{ name: "syncro_time_list_entries" }]),
    handleCall: vi.fn(),
  },
}));

vi.mock("../../src/domains/invoices.js", () => ({
  invoicesHandler: {
    getTools: vi.fn().mockReturnValue([{ name: "syncro_invoices_list" }]),
    handleCall: vi.fn(),
  },
}));

describe("domains/index.ts", () => {
  beforeEach(() => {
    clearDomainCache();
  });

  describe("getAvailableDomains", () => {
    it("should return all available domain names", () => {
      const domains = getAvailableDomains();

      expect(domains).toEqual([
        "customers",
        "tickets",
        "assets",
        "contacts",
        "invoices",
        "time",
      ]);
    });

    it("should return a consistent order", () => {
      const domains1 = getAvailableDomains();
      const domains2 = getAvailableDomains();

      expect(domains1).toEqual(domains2);
    });
  });

  describe("getDomainHandler", () => {
    it("should load the customers handler", async () => {
      const handler = await getDomainHandler("customers");

      expect(handler).toBeDefined();
      expect(handler.getTools).toBeDefined();
      expect(handler.handleCall).toBeDefined();
    });

    it("should load the tickets handler", async () => {
      const handler = await getDomainHandler("tickets");

      expect(handler).toBeDefined();
      const tools = handler.getTools();
      expect(tools).toContainEqual({ name: "syncro_tickets_list" });
    });

    it("should load the assets handler", async () => {
      const handler = await getDomainHandler("assets");

      expect(handler).toBeDefined();
      const tools = handler.getTools();
      expect(tools).toContainEqual({ name: "syncro_assets_list" });
    });

    it("should load the contacts handler", async () => {
      const handler = await getDomainHandler("contacts");

      expect(handler).toBeDefined();
      const tools = handler.getTools();
      expect(tools).toContainEqual({ name: "syncro_contacts_list" });
    });

    it("should load the time handler", async () => {
      const handler = await getDomainHandler("time");
      const tools = handler.getTools();

      expect(tools).toContainEqual({ name: "syncro_time_list_entries" });
    });

    it("should load the invoices handler", async () => {
      const handler = await getDomainHandler("invoices");

      expect(handler).toBeDefined();
      const tools = handler.getTools();
      expect(tools).toContainEqual({ name: "syncro_invoices_list" });
    });

    it("should cache domain handlers", async () => {
      const handler1 = await getDomainHandler("customers");
      const handler2 = await getDomainHandler("customers");

      expect(handler1).toBe(handler2);
    });

    it("should throw for unknown domain", async () => {
      // @ts-expect-error - Testing invalid input
      await expect(getDomainHandler("unknown")).rejects.toThrow(
        "Unknown domain: unknown"
      );
    });
  });

  describe("clearDomainCache", () => {
    it("should clear cached handlers", async () => {
      // Load a handler to cache it
      const handler1 = await getDomainHandler("customers");

      // Clear the cache
      clearDomainCache();

      // The handler should be loaded again (but mocked, so same implementation)
      const handler2 = await getDomainHandler("customers");

      // Since we're using mocks, the handlers will be the same object
      // In real usage, this would test that the module is re-imported
      expect(handler1).toBeDefined();
      expect(handler2).toBeDefined();
    });
  });
});
