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
    ["ESC", "\u001b"],
    ["NUL", "\u0000"],
    ["BEL", "\u0007"],
    ["DEL", "\u007f"],
    ["right-to-left override", "\u202e"],
    ["zero-width space", "\u200b"],
    ["byte order mark", "\ufeff"],
    ["bidi isolate", "\u2066"],
    ["lone surrogate", "\ud800"],
  ])("strips %s", (_name, character) => {
    // Not even as a JSON escape such as \u001b: the character is gone.
    expect(quote(`before${character}after`)).toBe('"before after"');
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
  it("shows the raw value as a JSON string, so a quote is escaped", () => {
    expect(quoteInFull('say "hi"', "run_as")).toBe('"say \\"hi\\""');
  });

  it("shows a newline and a tab as visible escapes instead of collapsing them", () => {
    expect(quoteInFull("a\nb\tc", "message")).toBe('"a\\nb\\tc"');
  });

  it("keeps ordinary non-ASCII text, including emoji and accents", () => {
    expect(quoteInFull("café 😀 日本語", "message")).toBe('"café 😀 日本語"');
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

  it("measures the limit on the raw value, so a run of newlines counts", () => {
    // 150 characters plus 100 newlines is 250 characters sent, not a short line.
    expect(() =>
      quoteInFull(`${"x".repeat(150)}${"\n".repeat(100)}`, "message", 200)
    ).toThrow(/message is 250 characters, over the 200/);
  });

  it("counts an emoji as one character, not two", () => {
    expect(quoteInFull("😀".repeat(200), "run_as")).toContain("😀");
    expect(() => quoteInFull("😀".repeat(201), "run_as")).toThrow(/201 characters/);
  });

  it.each([
    ["escape", "a\u001b[2Jb", "001B"],
    ["NUL", "a\u0000b", "0000"],
    ["vertical tab", "a\u000bb", "000B"],
    ["delete", "a\u007fb", "007F"],
    ["C1 control (NEL)", "a\u0085b", "0085"],
    ["zero-width space", "a\u200bb", "200B"],
    ["zero-width joiner", "a\u200db", "200D"],
    ["right-to-left override", "a\u202eb", "202E"],
    ["right-to-left isolate", "a\u2067b", "2067"],
    ["Arabic letter mark", "a\u061cb", "061C"],
    ["byte order mark", "a\ufeffb", "FEFF"],
    ["soft hyphen", "a\u00adb", "00AD"],
    ["tag character", "a\u{E0041}b", "E0041"],
    ["private use", "a\ue000b", "E000"],
    ["supplementary private use", "a\u{F0000}b", "F0000"],
    ["unassigned code point", "a\u0378b", "0378"],
    ["lone high surrogate", "a\ud800b", "D800"],
    ["lone low surrogate", "a\udc00b", "DC00"],
    ["line separator", "a\u2028b", "2028"],
    ["paragraph separator", "a\u2029b", "2029"],
    ["Braille blank", "a\u2800b", "2800"],
    ["Hangul filler", "a\u3164b", "3164"],
    ["halfwidth Hangul filler", "a\uffa0b", "FFA0"],
    ["Hangul choseong filler", "a\u115fb", "115F"],
    ["Hangul jungseong filler", "a\u1160b", "1160"],
    ["Khmer inherent vowel", "a\u17b4b", "17B4"],
    ["Khmer inherent vowel (aa)", "a\u17b5b", "17B5"],
    ["combining grapheme joiner", "a\u034fb", "034F"],
    ["variation selector-16", "Administrator\ufe0f", "FE0F"],
    ["variation selector-1", "a\ufe00b", "FE00"],
    ["supplementary variation selector", "a\u{E0100}b", "E0100"],
    ["last supplementary variation selector", "a\u{E01EF}b", "E01EF"],
    ["Mongolian free variation selector one", "a\u180bb", "180B"],
    ["Mongolian free variation selector two", "a\u180cb", "180C"],
    ["Mongolian free variation selector three", "a\u180db", "180D"],
    ["Mongolian free variation selector four", "a\u180fb", "180F"],
    ["Mongolian vowel separator", "a\u180eb", "180E"],
    ["no-break space", "a\u00a0b", "00A0"],
    ["Ogham space mark", "a\u1680b", "1680"],
    ["en quad", "a\u2000b", "2000"],
    ["hair space", "a\u200ab", "200A"],
    ["narrow no-break space", "a\u202fb", "202F"],
    ["medium mathematical space", "a\u205fb", "205F"],
    ["ideographic space", "a\u3000b", "3000"],
  ])("refuses a value containing a %s, and names it", (_name, value, codePoint) => {
    expect(() => quoteInFull(value, "message")).toThrow(
      new RegExp(`^message contains the character U\\+${codePoint}, `)
    );
  });

  it("shows a carriage return as the visible escape \\r, so CRLF text is accepted as sent", () => {
    expect(quoteInFull("line one\r\nline two", "message")).toBe('"line one\\r\\nline two"');
  });

  it("accepts the plain space, which is the only separator that can be shown", () => {
    expect(quoteInFull("a b", "message")).toBe('"a b"');
  });

  it("accepts nothing in general category C or Z, and nothing default-ignorable, over every code point", () => {
    const hidden = /[\p{C}\p{Z}]|\p{Default_Ignorable_Code_Point}|\p{Variation_Selector}/u;
    const shownAsEscapeOrSpace = new Set([0x09, 0x0a, 0x0d, 0x20]);
    const leaks: string[] = [];

    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
      const character = String.fromCodePoint(codePoint);
      if (shownAsEscapeOrSpace.has(codePoint) || !hidden.test(character)) continue;
      try {
        quoteInFull(character, "value");
        leaks.push(`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
      } catch {
        // refused, as it should be
      }
    }

    expect(leaks).toEqual([]);
    // About 1 s locally; a shared CI runner can take several times that, so
    // the default 5 s limit is too tight for a sweep of 1,114,112 code points.
  }, 60_000);

  it.each([42, null, undefined, true, { a: 1 }, ["x"]])(
    "refuses the non-string value %j",
    (value) => {
      expect(() => quoteInFull(value, "subject")).toThrow("subject must be a string");
    }
  );

  it("shows what it returns without any character that could hide or reorder text", () => {
    const shown = quoteInFull("line one\nline two\ttabbed", "message");

    expect(shown).not.toMatch(/[\u0000-\u001f]/);
  });
});
