/**
 * Tests for confirmWrite (elicitation) and guardWrite
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { confirmWrite } from "../../src/utils/elicitation.js";
import { guardWrite } from "../../src/utils/write-guard.js";
import * as serverRef from "../../src/utils/server-ref.js";

vi.mock("../../src/utils/server-ref.js", () => ({
  getServerRef: vi.fn(),
}));

function serverReturning(result: unknown) {
  return { elicitInput: vi.fn().mockResolvedValue(result) } as never;
}

describe("confirmWrite", () => {
  beforeEach(() => {
    vi.mocked(serverRef.getServerRef).mockReset();
  });

  it("is unavailable without a server", async () => {
    vi.mocked(serverRef.getServerRef).mockReturnValue(null as never);
    await expect(confirmWrite("ok?")).resolves.toBe("unavailable");
  });

  it("is unavailable when the client cannot elicit", async () => {
    vi.mocked(serverRef.getServerRef).mockReturnValue({
      elicitInput: vi.fn().mockRejectedValue(new Error("Client does not support elicitation")),
    } as never);
    await expect(confirmWrite("ok?")).resolves.toBe("unavailable");
  });

  it("is confirmed only on accept with confirm=true", async () => {
    vi.mocked(serverRef.getServerRef).mockReturnValue(
      serverReturning({ action: "accept", content: { confirm: true } })
    );
    await expect(confirmWrite("ok?")).resolves.toBe("confirmed");
  });

  it.each([
    { action: "accept", content: { confirm: false } },
    { action: "decline" },
    { action: "cancel" },
  ])("is declined for %j", async (result) => {
    vi.mocked(serverRef.getServerRef).mockReturnValue(serverReturning(result));
    await expect(confirmWrite("ok?")).resolves.toBe("declined");
  });
});

describe("guardWrite", () => {
  beforeEach(() => {
    vi.mocked(serverRef.getServerRef).mockReset();
  });

  it("lets a confirmed write through", async () => {
    vi.mocked(serverRef.getServerRef).mockReturnValue(
      serverReturning({ action: "accept", content: { confirm: true } })
    );
    await expect(guardWrite("ok?")).resolves.toBeNull();
  });

  it("cancels a declined write", async () => {
    vi.mocked(serverRef.getServerRef).mockReturnValue(
      serverReturning({ action: "decline" })
    );
    const result = await guardWrite("ok?", { destructive: true, args: { confirm: true } });
    expect(result?.isError).toBeUndefined();
    expect((result?.content[0] as { text: string }).text).toMatch(/Cancelled/);
  });

  it("lets a write through when elicitation is unavailable", async () => {
    vi.mocked(serverRef.getServerRef).mockReturnValue(null as never);
    await expect(guardWrite("ok?")).resolves.toBeNull();
  });

  it("blocks a destructive write without confirm when elicitation is unavailable", async () => {
    vi.mocked(serverRef.getServerRef).mockReturnValue(null as never);
    const result = await guardWrite("Run it?", { destructive: true, args: {} });
    expect(result?.isError).toBe(true);
    expect((result?.content[0] as { text: string }).text).toContain("confirm: true");
  });

  it("allows a destructive write with confirm when elicitation is unavailable", async () => {
    vi.mocked(serverRef.getServerRef).mockReturnValue(null as never);
    await expect(
      guardWrite("Run it?", { destructive: true, args: { confirm: true } })
    ).resolves.toBeNull();
  });
});
