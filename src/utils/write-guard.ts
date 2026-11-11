/**
 * Shared confirm step for write tools.
 *
 * Writes ask the user through MCP elicitation. A decline or cancel always
 * stops the call. When the client cannot elicit, ordinary writes proceed
 * (the Conduit gateway applies its own confirm guard to write-classified
 * tools), but destructive tools additionally require the caller to pass
 * `confirm: true`, so a client without elicitation cannot run them blind.
 */

import type { CallToolResult } from "./types.js";
import { confirmWrite } from "./elicitation.js";

export interface WriteGuardOptions {
  /** Require `args.confirm === true` when the client cannot elicit. */
  destructive?: boolean;
  /** The tool call arguments, read for the `confirm` flag. */
  args?: Record<string, unknown>;
}

/**
 * Ask the user to confirm a write before it reaches Syncro.
 *
 * Callers must check the return value: `null` means proceed with the write;
 * any other value is a result to return to the client as-is, without writing.
 * `options.args.confirm` is consulted only when `options.destructive` is set.
 *
 * @throws When the client supports elicitation but the prompt fails, so the
 *   write is never run unconfirmed.
 */
export async function guardWrite(
  message: string,
  options: WriteGuardOptions = {}
): Promise<CallToolResult | null> {
  const outcome = await confirmWrite(message);

  if (outcome === "confirmed") return null;

  if (outcome === "declined") {
    return {
      content: [
        { type: "text", text: "Cancelled: the user did not confirm this action." },
      ],
    };
  }

  if (options.destructive && options.args?.confirm !== true) {
    return {
      content: [
        {
          type: "text",
          text: `Confirmation required: ${message} Ask the user, then call again with confirm: true.`,
        },
      ],
      isError: true,
    };
  }

  return null;
}
