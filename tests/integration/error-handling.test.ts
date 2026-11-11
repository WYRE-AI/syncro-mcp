/**
 * Tests for error handling across all domain handlers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { customersHandler } from "../../src/domains/customers.js";
import { ticketsHandler } from "../../src/domains/tickets.js";
import { assetsHandler } from "../../src/domains/assets.js";
import { contactsHandler } from "../../src/domains/contacts.js";
import { invoicesHandler } from "../../src/domains/invoices.js";
import * as clientModule from "../../src/utils/client.js";

// Mock the client module
vi.mock("../../src/utils/client.js", () => ({
  getClient: vi.fn(),
  getCredentials: vi.fn(),
  clearClient: vi.fn(),
}));

describe("Error Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("API Errors", () => {
    it("should propagate API errors from customers handler", async () => {
      const mockClient = {
        customers: {
          list: vi.fn().mockRejectedValue(new Error("API rate limit exceeded")),
        },
      };
      vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);

      await expect(
        customersHandler.handleCall("syncro_customers_list", {})
      ).rejects.toThrow("API rate limit exceeded");
    });

    it("should propagate API errors from tickets handler", async () => {
      const mockClient = {
        tickets: {
          get: vi.fn().mockRejectedValue(new Error("Ticket not found")),
        },
      };
      vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);

      await expect(
        ticketsHandler.handleCall("syncro_tickets_get", { ticket_id: 999999 })
      ).rejects.toThrow("Ticket not found");
    });

    it("should propagate API errors from assets handler", async () => {
      const mockClient = {
        assets: {
          get: vi.fn().mockRejectedValue(new Error("Asset not found")),
        },
      };
      vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);

      await expect(
        assetsHandler.handleCall("syncro_assets_get", { asset_id: 999999 })
      ).rejects.toThrow("Asset not found");
    });

    it("should propagate API errors from contacts handler", async () => {
      const mockClient = {
        contacts: {
          create: vi.fn().mockRejectedValue(new Error("Validation error: name is required")),
        },
      };
      vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);

      await expect(
        contactsHandler.handleCall("syncro_contacts_create", { customer_id: 1, name: "" })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate API errors from invoices handler", async () => {
      const mockClient = {
        invoices: {
          email: vi.fn().mockRejectedValue(new Error("Invalid email address")),
        },
      };
      vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);

      await expect(
        invoicesHandler.handleCall("syncro_invoices_email", {
          invoice_id: 123,
          confirm: true,
        })
      ).rejects.toThrow("Invalid email address");
    });
  });

  describe("Client Initialization Errors", () => {
    it("should throw when client cannot be initialized", async () => {
      vi.mocked(clientModule.getClient).mockRejectedValue(
        new Error("No API credentials provided")
      );

      await expect(
        customersHandler.handleCall("syncro_customers_list", {})
      ).rejects.toThrow("No API credentials provided");
    });
  });

  describe("Network Errors", () => {
    it("should propagate network timeout errors", async () => {
      const mockClient = {
        tickets: {
          list: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")),
        },
      };
      vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);

      await expect(
        ticketsHandler.handleCall("syncro_tickets_list", {})
      ).rejects.toThrow("ETIMEDOUT");
    });

    it("should propagate connection refused errors", async () => {
      const mockClient = {
        assets: {
          list: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
        },
      };
      vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);

      await expect(
        assetsHandler.handleCall("syncro_assets_list", {})
      ).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("Rate Limiting Awareness", () => {
    it("should handle 429 rate limit responses", async () => {
      const rateLimitError = new Error("Rate limit exceeded. Please retry after 60 seconds.");
      (rateLimitError as Error & { status: number }).status = 429;

      const mockClient = {
        customers: {
          list: vi.fn().mockRejectedValue(rateLimitError),
        },
      };
      vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);

      await expect(
        customersHandler.handleCall("syncro_customers_list", {})
      ).rejects.toThrow("Rate limit exceeded");
    });
  });
});
