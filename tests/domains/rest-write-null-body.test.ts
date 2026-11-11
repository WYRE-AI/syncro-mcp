/**
 * A REST-helper write that Syncro answers with a 2xx and the JSON body `null`
 * may already have been applied. These tests run the real handlers and the
 * real REST helper against a stubbed `fetch` and check that each tool reports
 * the unknown outcome, instead of throwing a bare TypeError, after exactly one
 * request (a retry of `syncro_time_log_entry` would log the time twice).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetsHandler } from "../../src/domains/assets.js";
import { timeHandler } from "../../src/domains/time.js";
import { clearClient } from "../../src/utils/client.js";
import type { DomainHandler } from "../../src/utils/types.js";

const UNKNOWN = "The change may or may not have been applied; check Syncro before retrying.";

const writes: Array<[string, DomainHandler, Record<string, unknown>, string]> = [
  [
    "syncro_assets_set_policy_folder",
    assetsHandler,
    { asset_id: 42, policy_folder_id: 2 },
    "PUT /customer_assets/42",
  ],
  [
    "syncro_time_log_entry",
    timeHandler,
    { ticket_id: 5, start_at: "2026-11-05T14:00:00Z", duration_minutes: 30, billable: true },
    "POST /tickets/5/timer_entry",
  ],
  [
    "syncro_time_set_billable",
    timeHandler,
    { timer_id: 11, billable: true },
    "PATCH /ticket_timers/11",
  ],
];

describe("REST-helper writes against a Syncro that answers 200 with null", () => {
  const fetchMock = vi.fn();
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.SYNCRO_API_KEY = "test-key";
    process.env.SYNCRO_SUBDOMAIN = "acme";
    clearClient();
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () => new Response("null", { status: 200, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = savedEnv;
    clearClient();
  });

  it.each(writes)(
    "%s reports an unknown outcome after exactly one request",
    async (tool, handler, args, request) => {
      const err = await handler.handleCall(tool, args).catch((e: Error) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).constructor.name).toBe("SyncroRestError");
      expect((err as Error).message).toContain(UNKNOWN);
      expect(fetchMock.mock.calls.map(([url, init]) => `${init.method} ${new URL(String(url)).pathname.replace("/api/v1", "")}`)).toEqual([request]);
    }
  );
});
