/**
 * Shared types for the Syncro MCP server
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Domain handler interface
 */
export interface DomainHandler {
  /** Get the tools for this domain */
  getTools(): Tool[];
  /** Handle a tool call */
  handleCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult>;
}

/**
 * Re-export for convenience
 */
export type { CallToolResult };

/**
 * Domain names
 */
export type DomainName =
  | "customers"
  | "tickets"
  | "assets"
  | "contacts"
  | "invoices"
  | "time";

/**
 * Check if a string is a valid domain name
 */
export function isDomainName(value: string): value is DomainName {
  return [
    "customers",
    "tickets",
    "assets",
    "contacts",
    "invoices",
    "time",
  ].includes(value);
}
