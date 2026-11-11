/**
 * Tests for the direct Syncro REST helper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  finiteNumber,
  isoTimestamp,
  pathId,
  syncroRest,
  SyncroRestError,
} from "../../src/utils/rest.js";
import * as clientModule from "../../src/utils/client.js";

vi.mock("../../src/utils/client.js", () => ({
  getClient: vi.fn(),
  getCredentials: vi.fn(),
  clearClient: vi.fn(),
}));

function mockResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("utils/rest.ts", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.mocked(clientModule.getClient).mockResolvedValue({
      getConfig: () => ({
        apiKey: "secret-key",
        baseUrl: "https://acme.syncromsp.com",
      }),
    } as never);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the API key as a bearer header and never in the URL", async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '{"ok":true}'));

    await syncroRest("/ticket_timers", { params: { ticket_id: 5 } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.syncromsp.com/api/v1/ticket_timers?ticket_id=5");
    expect(url).not.toContain("secret-key");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer secret-key");
    expect(init.body).toBeUndefined();
  });

  it("drops undefined params and serializes the JSON body", async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '{"id":1}'));

    const result = await syncroRest<{ id: number }>("/tickets/9/timer_entry", {
      method: "POST",
      params: { a: undefined, b: "x" },
      body: { notes: "hi" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://acme.syncromsp.com/api/v1/tickets/9/timer_entry?b=x");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ notes: "hi" });
    expect(result).toEqual({ id: 1 });
  });

  it("returns an empty object for an empty success body", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    await expect(syncroRest("/x")).resolves.toEqual({});
  });

  it("surfaces Syncro validation errors", async () => {
    fetchMock.mockResolvedValue(
      mockResponse(422, '{"errors":["Billable must be true or false"]}')
    );

    const err = await syncroRest("/ticket_timers/1", { method: "PATCH" }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(SyncroRestError);
    expect(err.status).toBe(422);
    expect(err.message).toContain("Billable must be true or false");
  });

  it("surfaces non-JSON error bodies", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    await expect(syncroRest("/x")).rejects.toThrow(/502.*Bad Gateway/);
  });

  it("rejects a non-JSON success body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>login</html>", { status: 200 }));
    await expect(syncroRest("/x")).rejects.toThrow(/Expected JSON/);
  });

  it("passes an abort signal so a stalled call times out", async () => {
    fetchMock.mockResolvedValue(mockResponse(200, "{}"));
    await syncroRest("/x");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an unknown outcome when a write times out", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TimeoutError" })
    );
    await expect(syncroRest("/x", { method: "POST" })).rejects.toThrow(
      /timed out.*may or may not have been applied/
    );
  });

  describe("write failures with an unknown outcome", () => {
    const UNKNOWN = /may or may not have been applied; check Syncro before retrying/;

    it.each(["POST", "PUT", "PATCH"] as const)(
      "says so when a %s hits a network error",
      async (method) => {
        const cause = Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" });
        fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause }));

        const err = await syncroRest("/x", { method }).catch((e) => e);

        expect(err).toBeInstanceOf(SyncroRestError);
        expect(err.status).toBe(0);
        expect(err.message).toContain("fetch failed (ENOTFOUND)");
        expect(err.message).toMatch(UNKNOWN);
        expect(err.message).not.toContain("secret-key");
      }
    );

    it.each([500, 502, 503])("says so when a write gets a %i", async (status) => {
      fetchMock.mockResolvedValue(new Response("upstream error", { status }));

      const err = await syncroRest("/x", { method: "POST" }).catch((e) => e);

      expect(err).toBeInstanceOf(SyncroRestError);
      expect(err.status).toBe(status);
      expect(err.message).toContain(`failed (${status}): upstream error`);
      expect(err.message).toMatch(UNKNOWN);
    });

    it.each([400, 404, 422, 429])(
      "keeps a %i on a write as a plain rejection",
      async (status) => {
        fetchMock.mockResolvedValue(mockResponse(status, '{"error":"nope"}'));

        const err = await syncroRest("/x", { method: "POST" }).catch((e) => e);

        expect(err.status).toBe(status);
        expect(err.message).toContain("nope");
        expect(err.message).not.toMatch(UNKNOWN);
      }
    );

    it("does not double the full stop when the error body already ends with one", async () => {
      fetchMock.mockResolvedValue(new Response("Upstream is down.", { status: 502 }));

      const err = await syncroRest("/x", { method: "POST" }).catch((e) => e);

      expect(err.message).toContain("failed (502): Upstream is down. The change may or may not");
      expect(err.message).not.toContain("..");
    });

    it("adds no note to a read that fails the same ways", async () => {
      fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
      await expect(syncroRest("/x")).rejects.not.toThrow(UNKNOWN);

      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      await expect(syncroRest("/x")).rejects.not.toThrow(UNKNOWN);
    });
  });
});

describe("pathId", () => {
  it("accepts a positive integer", () => {
    expect(pathId(42, "asset_id")).toBe(42);
  });

  it.each(["5", "../tickets", 1.5, 0, -1, NaN, undefined])(
    "rejects %j",
    (value) => {
      expect(() => pathId(value, "asset_id")).toThrow(/asset_id/);
    }
  );
});

describe("isoTimestamp", () => {
  it.each([
    "2026-11-07T02:00:00Z",
    "2026-11-07T02:00:00.123Z",
    "2026-11-07T02:00:00+01:00",
    "2026-11-07T02:00:00-05:00",
    "2026-11-07T02:00",
    "2026-11-07T02:00:00",
  ])("accepts %s and returns it unchanged", (value) => {
    expect(isoTimestamp(value, "run_at")).toBe(value);
  });

  it.each([
    "tomorrow",
    "2026-11-07",
    "2026-13-45T02:00:00Z",
    "2026-11-07T25:00:00Z",
    "2026-11-07T02:00:00Z\n",
    "2026-11-07T02:00:00Z\nrun_as: SYSTEM",
    "2026-11-07T02:00:00Z\u001b[2J",
    "2026-11-07T02:00:00Z‮",
    " 2026-11-07T02:00:00Z",
    "",
    1762480800,
    null,
    undefined,
  ])("rejects %j", (value) => {
    expect(() => isoTimestamp(value, "run_at")).toThrow(/run_at must be an ISO 8601/);
  });
});

describe("finiteNumber", () => {
  it.each([0, 1.5, -3, 150])("accepts %s", (value) => {
    expect(finiteNumber(value, "price_retail")).toBe(value);
  });

  it.each(["150", "1\n2", NaN, Infinity, -Infinity, null, undefined, {}])(
    "rejects %j",
    (value) => {
      expect(() => finiteNumber(value, "price_retail")).toThrow(
        /price_retail must be a finite number/
      );
    }
  );
});
