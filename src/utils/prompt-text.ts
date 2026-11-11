/** Longest caller-supplied value shown whole in a confirmation prompt. */
const MAX_PROMPT_VALUE = 200;

/**
 * Render a caller-supplied value for a confirmation prompt on one line, cut
 * to {@link MAX_PROMPT_VALUE} characters so a long value cannot bury the rest
 * of the prompt. Objects are shown as JSON.
 */
export function clip(value: unknown): string {
  const text = (typeof value === "string" ? value : JSON.stringify(value))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_PROMPT_VALUE
    ? `${text.slice(0, MAX_PROMPT_VALUE)}... (${text.length} characters in total)`
    : text;
}
