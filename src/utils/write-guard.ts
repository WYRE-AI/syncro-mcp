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
  destructive?: boolean;
  args?: Record<string, unknown>;
}

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
