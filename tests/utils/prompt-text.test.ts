/**
 * Tests for the confirmation prompt sanitiser
 */

import { describe, it, expect } from "vitest";
import { quote, quoteInFull } from "../../src/utils/prompt-text.js";

const LINE_BREAKS = /[\n\r\u0085\u2028\u2029]/;

describe("quote", () => {
  it("shows a value as a JSON string", () => {
    expect(quote("Reset MFA")).toBe('"Reset MFA"');
  });

  it("escapes a quote so a value cannot close its own delimiters", () => {
    expect(quote('a" and then "b')).toBe('"a\\" and then \\"b"');
    expect(quote("C:\\Temp")).toBe('"C:\\\\Temp"');
  });

  it("always renders on a single line", () => {
    const text = "a\nb\r\nc\u2028d\u2029e\u0085f\tg\u000bh\u000ci";

    const shown = quote(text);

    expect(shown).not.toMatch(LINE_BREAKS);
    expect(shown).toBe('"a b c d e f g h i"');
  });

  it("collapses runs of whitespace and trims the ends", () => {
    expect(quote("  a \n\n\n  b  ")).toBe('"a b"');
  });

  it.each([
    ["ESC", "\u001b[2J"],
    ["NUL", "\u0000"],
    ["BEL", "\u0007"],
    ["DEL", "\u007f"],
    ["right-to-left override", "\u202e"],
    ["zero-width space", "\u200b"],
    ["byte order mark", "\ufeff"],
    ["bidi isolate", "\u2066"],
    ["lone surrogate", "\ud800"],
  ])("strips %s", (_name, character) => {
    const shown = quote(`before${character}after`);

    expect(shown).not.toMatch(/\p{C}/u);
    expect(shown.startsWith('"before')).toBe(true);
    expect(shown.endsWith('after"')).toBe(true);
  });

  it("renders non-strings as JSON text", () => {
    expect(quote(42)).toBe('"42"');
    expect(quote({ a: "b\nc" })).toBe('"{\\"a\\":\\"b\\\\nc\\"}"');
    expect(quote(undefined)).toBe('"undefined"');
  });

  it("states the full length when it cuts a long value", () => {
    expect(quote("x".repeat(5000))).toBe(
      `"${"x".repeat(200)}" (first 200 of 5000 characters)`
    );
  });

  it("does not cut a value of exactly the limit", () => {
    expect(quote("x".repeat(200))).toBe(`"${"x".repeat(200)}"`);
  });

  it("cuts by character so a pair of surrogates is never split", () => {
    const shown = quote("😀".repeat(300));

    expect(shown).not.toMatch(/\p{Cs}/u);
    expect(shown).toContain("(first 200 of 300 characters)");
  });
});

describe("quoteInFull", () => {
  it("sanitises and quotes the same way", () => {
    expect(quoteInFull('a"\n\u001bb', "run_as")).toBe('"a\\" b"');
  });

  it("accepts a value of exactly the limit", () => {
    expect(quoteInFull("x".repeat(200), "run_as")).toBe(`"${"x".repeat(200)}"`);
  });

  it("refuses a longer value instead of cutting it", () => {
    expect(() => quoteInFull("x".repeat(201), "run_as")).toThrow(
      "run_as is 201 characters, over the 200 that can be shown in full in the confirmation prompt. Shorten it."
    );
  });

  it("applies a caller-chosen limit", () => {
    expect(() => quoteInFull("x".repeat(11), "message", 10)).toThrow(/over the 10/);
    expect(quoteInFull("x".repeat(10), "message", 10)).toBe(`"${"x".repeat(10)}"`);
  });

  it("measures the value as it will be shown, not as it was sent", () => {
    // 150 characters plus 100 newlines collapse to a short line.
    expect(() => quoteInFull(`${"x".repeat(150)}${"\n".repeat(100)}`, "m")).not.toThrow();
  });
});
