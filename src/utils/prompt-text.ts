/**
 * Render caller-supplied text for a confirmation prompt.
 *
 * Every free-text value in a prompt goes through here, so a caller cannot
 * forge prompt text. {@link quote} shows a value that cannot change what the
 * action does: it is reduced to one line, stripped of control and format
 * characters (ESC, NUL, right-to-left override and the like), cut when long,
 * and shown as a JSON string. {@link quoteInFull} shows a value the user must
 * see exactly as it is sent, so it never cleans or cuts: it refuses instead.
 */

/** Longest value {@link quote} and {@link quoteInFull} show by default. */
const MAX_PROMPT_VALUE = 200;

/** One line of text: any run of whitespace, control or format characters becomes one space. */
function oneLine(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text).replace(/[\s\p{C}]+/gu, " ").trim();
}

/**
 * Show a value for a prompt, cut to `max` characters with the full length
 * stated when it is longer. Use it where a long value cannot change what the
 * action does; use {@link quoteInFull} where the user has to see all of it.
 */
export function quote(value: unknown, max = MAX_PROMPT_VALUE): string {
  const characters = [...oneLine(value)];
  if (characters.length <= max) return JSON.stringify(characters.join(""));
  const shown = JSON.stringify(characters.slice(0, max).join(""));
  return `${shown} (first ${max} of ${characters.length} characters)`;
}

/**
 * Characters that cannot be shown faithfully in a prompt: control characters
 * other than newline and tab, format characters (zero-width and
 * direction-changing), private-use, unassigned and surrogate code points, line
 * and paragraph separators, and the characters below that are letters or
 * marks in the Unicode tables but draw nothing (Braille blank, Hangul fillers,
 * Khmer inherent vowels, the combining grapheme joiner).
 */
const NOT_SHOWABLE =
  /[^\P{C}\n\t]|[\p{Zl}\p{Zp}\u115F\u1160\u2800\u3164\uFFA0]|\u034F|\u17B4|\u17B5/u;

/**
 * Show a value for a prompt exactly as it will be sent, or refuse it.
 *
 * The user approves what the prompt shows, so nothing may differ between the
 * two: the value is shown as a JSON string of the raw text (a newline appears
 * as `\n`, a quote is escaped), its length is measured on the raw text, and a
 * value that is not a string, is longer than `max` characters, or contains a
 * character that would not show up in the prompt throws instead of being
 * cleaned or cut. `label` names the value in the error.
 */
export function quoteInFull(
  value: unknown,
  label: string,
  max = MAX_PROMPT_VALUE
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const hidden = NOT_SHOWABLE.exec(value);
  if (hidden) {
    const codePoint = hidden[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    throw new Error(
      `${label} contains the character U+${codePoint}, which cannot be shown in the confirmation prompt. Remove it; only newline and tab are allowed as control characters.`
    );
  }
  const length = [...value].length;
  if (length > max) {
    throw new Error(
      `${label} is ${length} characters, over the ${max} that can be shown in full in the confirmation prompt. Shorten it.`
    );
  }
  return JSON.stringify(value);
}
