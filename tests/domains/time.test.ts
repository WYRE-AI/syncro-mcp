/**
 * Tests for the time (ticket timer) domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { timeHandler } from "../../src/domains/time.js";
import * as restModule from "../../src/utils/rest.js";
import * as guardModule from "../../src/utils/write-guard.js";

vi.mock("../../src/utils/rest.js", () => ({
  syncroRest: vi.fn(),
}));

vi.mock("../../src/utils/write-guard.js", () => ({
  guardWrite: vi.fn(),
}));

const rest = vi.mocked(restModule.syncroRest);
const guard = vi.mocked(guardModule.guardWrite);

function text(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe("domains/time.ts", () => {
  beforeEach(() => {
    rest.mockReset();
    guard.mockReset();
    guard.mockResolvedValue(null);
  });

  describe("getTools", () => {
    it("returns the time tools", () => {
      expect(timeHandler.getTools().map((t) => t.name)).toEqual([
        "syncro_time_list_entries",
        "syncro_time_log_entry",
        "syncro_time_set_billable",
      ]);
    });

    it("requires ticket_id and start_at to log time", () => {
      const tool = timeHandler
        .getTools()
        .find((t) => t.name === "syncro_time_log_entry");
      expect(tool?.inputSchema.required).toEqual(["ticket_id", "start_at"]);
      expect(tool?.inputSchema.properties).toHaveProperty("billable");
    });
  });

  describe("syncro_time_list_entries", () => {
    it("maps filters onto /ticket_timers query params", async () => {
      rest.mockResolvedValue({
        ticket_timers: [{ id: 1, ticket_id: 2, billable: true }],
        meta: { total_entries: 1, total_pages: 1, page: 1 },
      });

      const result = await timeHandler.handleCall("syncro_time_list_entries", {
        customer_id: 7,
        billing_status: "unbilled",
        created_after: "2026-10-01",
        created_before: "2026-11-01",
      });

      expect(rest).toHaveBeenCalledWith("/ticket_timers", {
        params: {
          ticket_id: undefined,
          customer_id: 7,
          user_id: undefined,
          status: undefined,
          billing_status: "unbilled",
          created_at_gt: "2026-10-01",
          created_at_lt: "2026-11-01",
          page: undefined,
        },
      });
      const parsed = JSON.parse(text(result));
      expect(parsed.total_entries).toBe(1);
      expect(parsed.time_entries).toHaveLength(1);
    });

    it("returns an explicit error when nothing matches", async () => {
      rest.mockResolvedValue({ ticket_timers: [], meta: {} });
      const result = await timeHandler.handleCall("syncro_time_list_entries", {});
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("No ticket time entries found");
    });
  });

  describe("syncro_time_log_entry", () => {
    it("requires end_at or duration_minutes", async () => {
      const result = await timeHandler.handleCall("syncro_time_log_entry", {
        ticket_id: 5,
        start_at: "2026-11-05T14:00:00Z",
      });
      expect(result.isError).toBe(true);
      expect(rest).not.toHaveBeenCalled();
    });

    it("creates the entry and then applies the billable flag", async () => {
      rest
        .mockResolvedValueOnce({ id: 11, ticket_id: 5, billable: false })
        .mockResolvedValueOnce({
          ticket_timer: { id: 11, ticket_id: 5, billable: true },
        });

      const result = await timeHandler.handleCall("syncro_time_log_entry", {
        ticket_id: 5,
        start_at: "2026-11-05T14:00:00Z",
        duration_minutes: 30,
        billable: true,
        notes: "Reset MFA",
      });

      expect(guard).toHaveBeenCalledWith(
        "Log 30 minutes (billable) on Syncro ticket 5?"
      );
      expect(rest).toHaveBeenNthCalledWith(1, "/tickets/5/timer_entry", {
        method: "POST",
        body: {
          start_at: "2026-11-05T14:00:00Z",
          end_at: undefined,
          duration_minutes: 30,
          notes: "Reset MFA",
          product_id: undefined,
          user_id: undefined,
        },
      });
      expect(rest).toHaveBeenNthCalledWith(2, "/ticket_timers/11", {
        method: "PATCH",
        body: { billable: true },
      });
      expect(JSON.parse(text(result)).time_entry.billable).toBe(true);
    });

    it("skips the billable update when the account default already matches", async () => {
      rest.mockResolvedValueOnce({ id: 12, ticket_id: 5, billable: false });

      await timeHandler.handleCall("syncro_time_log_entry", {
        ticket_id: 5,
        start_at: "2026-11-05T14:00:00Z",
        end_at: "2026-11-05T14:15:00Z",
        billable: false,
      });

      expect(rest).toHaveBeenCalledTimes(1);
    });

    it("reports the created entry when setting billable fails", async () => {
      rest
        .mockResolvedValueOnce({ id: 13, ticket_id: 5, billable: false })
        .mockRejectedValueOnce(new Error("Syncro API PATCH failed (422)"));

      const result = await timeHandler.handleCall("syncro_time_log_entry", {
        ticket_id: 5,
        start_at: "2026-11-05T14:00:00Z",
        duration_minutes: 15,
        billable: true,
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(text(result));
      expect(parsed.time_entry.id).toBe(13);
      expect(parsed.warning).toContain("syncro_time_set_billable");
    });

    it("does not call Syncro when the user declines", async () => {
      guard.mockResolvedValue({
        content: [{ type: "text", text: "Cancelled: the user did not confirm this action." }],
      });

      const result = await timeHandler.handleCall("syncro_time_log_entry", {
        ticket_id: 5,
        start_at: "2026-11-05T14:00:00Z",
        duration_minutes: 15,
      });

      expect(rest).not.toHaveBeenCalled();
      expect(text(result)).toContain("Cancelled");
    });
  });

  describe("syncro_time_set_billable", () => {
    it("patches the timer", async () => {
      rest.mockResolvedValue({ ticket_timer: { id: 3, billable: false } });

      const result = await timeHandler.handleCall("syncro_time_set_billable", {
        timer_id: 3,
        billable: false,
      });

      expect(guard).toHaveBeenCalledWith(
        "Mark Syncro time entry 3 as non-billable?"
      );
      expect(rest).toHaveBeenCalledWith("/ticket_timers/3", {
        method: "PATCH",
        body: { billable: false },
      });
      expect(JSON.parse(text(result)).time_entry.id).toBe(3);
    });
  });

  it("rejects unknown tools", async () => {
    const result = await timeHandler.handleCall("syncro_time_nope", {});
    expect(result.isError).toBe(true);
  });
});
