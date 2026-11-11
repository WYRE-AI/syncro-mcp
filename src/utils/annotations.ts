/**
 * MCP tool annotations used to classify every Syncro tool as read, write or
 * destructive, so every tool must carry exactly one of these presets. They are
 * hints for MCP clients, not enforcement: on the gateway, who may call which
 * tool is decided by the gateway's own per-tool tier policy.
 */

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type ToolClass = "read" | "write" | "destructive";

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Adds a new record; a retry creates a duplicate. */
export const ADDITIVE_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Overwrites fields on an existing record; repeating it is harmless. */
export const IDEMPOTENT_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Sends external communication or acts on a managed endpoint. */
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/** Read the class a tool's annotations declare, or `null` if unclassified. */
export function classifyTool(
  annotations: ToolAnnotations | undefined
): ToolClass | null {
  if (!annotations || annotations.readOnlyHint === undefined) return null;
  if (annotations.readOnlyHint) return "read";
  if (annotations.destructiveHint === undefined) return null;
  return annotations.destructiveHint ? "destructive" : "write";
}
