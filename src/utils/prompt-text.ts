/**
 * Render caller-supplied text for a confirmation prompt.
 *
 * Every free-text value in a prompt goes through here, so a caller cannot
 * forge prompt text: the value is reduced to one line, stripped of control
 * and format characters (ESC, NUL, right-to-left override and the like), and
 * shown as a JSON string, so a quote inside it is escaped and the value is
 * visibly delimited from the sentence around it.
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
 * Show a value for a prompt in full, or refuse it: a value longer than `max`
 * throws instead of being cut, so the user never approves text they were not
 * shown. `label` names the value in the error.
 */
export function quoteInFull(
  value: unknown,
  label: string,
  max = MAX_PROMPT_VALUE
): string {
  const text = oneLine(value);
  const length = [...text].length;
  if (length > max) {
    throw new Error(
      `${label} is ${length} characters, over the ${max} that can be shown in full in the confirmation prompt. Shorten it.`
    );
  }
  return JSON.stringify(text);
}
