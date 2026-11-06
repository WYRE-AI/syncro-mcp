/**
 * Tests for the direct Syncro REST helper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncroRest, SyncroRestError } from "../../src/utils/rest.js";
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
});
