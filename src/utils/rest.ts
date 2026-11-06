/**
 * Direct Syncro REST calls for endpoints the SDK does not wrap correctly.
 *
 * `@wyre-ai/node-syncro` (<= 1.1.2) has no wrapper for ticket line items,
 * asset patches / installed applications, policy folders or RMM script
 * scheduling, and its ticket-timer methods target paths that are not in the
 * official API (`GET|PUT|DELETE /ticket_timers/{id}`, `/tickets/{id}/timer`).
 * Every path used through this helper is listed in
 * https://api-docs.syncromsp.com/swagger.json.
 *
 * Credentials come from the per-request SDK client (`getClient()`), so tenant
 * isolation is identical to the SDK-backed tools. The API key travels only in
 * the Authorization header, never in the URL.
 */

import { getClient } from "./client.js";

export type RestMethod = "GET" | "POST" | "PUT" | "PATCH";

export interface RestOptions {
  method?: RestMethod;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class SyncroRestError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "SyncroRestError";
    this.status = status;
    this.body = body;
  }
}

function describeErrorBody(body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const detail = record.errors ?? record.error ?? record.message;
    if (detail !== undefined) {
      return Array.isArray(detail) ? detail.join(", ") : String(detail);
    }
  }
  if (typeof body === "string" && body.trim() !== "") {
    return body.slice(0, 200);
  }
  return "no error detail returned";
}

export async function syncroRest<T>(
  path: string,
  options: RestOptions = {}
): Promise<T> {
  const { method = "GET", params, body } = options;
  const client = await getClient();
  const { baseUrl, apiKey } = client.getConfig();

  const url = new URL(`${baseUrl}/api/v1${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.append(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Read once as text: a fetch body is single-use, and Syncro error pages are
  // not always JSON.
  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    if (response.ok) {
      throw new SyncroRestError(
        `Expected JSON from ${method} ${path} but got: ${raw.slice(0, 200)}`,
        response.status,
        raw
      );
    }
  }

  if (!response.ok) {
    throw new SyncroRestError(
      `Syncro API ${method} ${path} failed (${response.status}): ${describeErrorBody(parsed)}`,
      response.status,
      parsed
    );
  }

  return parsed as T;
}
