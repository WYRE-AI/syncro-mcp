/**
 * Tests for the unknown-outcome note and the SDK write wrapper
 */

import { describe, it, expect } from "vitest";
import { sdkWrite, withUnknownOutcome } from "../../src/utils/write-outcome.js";

const NOTE = "The change may or may not have been applied; check Syncro before retrying.";

describe("withUnknownOutcome", () => {
  it("appends the note after a full stop", () => {
    expect(withUnknownOutcome("Server error: 502")).toBe(`Server error: 502. ${NOTE}`);
  });

  it("does not double a full stop that already ends the message", () => {
    expect(withUnknownOutcome("upstream said: try later.")).toBe(
      `upstream said: try later. ${NOTE}`
    );
    expect(withUnknownOutcome("a... ")).toBe(`a. ${NOTE}`);
  });
});

describe("sdkWrite", () => {
  const sdkError = (message: string, statusCode: number) =>
    Object.assign(new Error(message), { statusCode });

  it("returns the result of a successful call", async () => {
    await expect(sdkWrite(async () => ({ id: 1 }))).resolves.toEqual({ id: 1 });
  });

  it.each([500, 502, 503, 504])("adds the note to a %i", async (status) => {
    const err = await sdkWrite(() =>
      Promise.reject(sdkError(`Server error: ${status}`, status))
    ).catch((e) => e);

    expect(err.message).toBe(`Server error: ${status}. ${NOTE}`);
  });

  it("adds the note to a network failure, which carries no status", async () => {
    const cause = new TypeError("fetch failed");

    const err = await sdkWrite(() => Promise.reject(cause)).catch((e) => e);

    expect(err.message).toBe(`fetch failed. ${NOTE}`);
    expect(err.cause).toBe(cause);
  });

  it("adds the note to an SDK error with status 0", async () => {
    const err = await sdkWrite(() =>
      Promise.reject(sdkError("Request failed", 0))
    ).catch((e) => e);

    expect(err.message).toContain(NOTE);
  });

  it("adds the note when a success status carried an unreadable body", async () => {
    const err = await sdkWrite(() =>
      Promise.reject(sdkError("Expected JSON from POST but got text/html", 200))
    ).catch((e) => e);

    expect(err.message).toContain(NOTE);
  });

  it.each([400, 401, 403, 404, 422, 429, 499])(
    "leaves a %i as a plain rejection",
    async (status) => {
      const original = sdkError("Rejected", status);

      const err = await sdkWrite(() => Promise.reject(original)).catch((e) => e);

      expect(err).toBe(original);
      expect(err.message).toBe("Rejected");
    }
  );

  it("rethrows something that is not an Error unchanged", async () => {
    await expect(sdkWrite(() => Promise.reject("boom"))).rejects.toBe("boom");
  });
});
