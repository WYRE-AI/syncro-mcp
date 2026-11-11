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

/** Deadline for one Syncro REST call, so a stalled request cannot hang a tool. */
export const REST_TIMEOUT_MS = 30_000;

export type RestMethod = "GET" | "POST" | "PUT" | "PATCH";

export interface RestOptions {
  method?: RestMethod;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/** A failed Syncro REST call. `status` is `0` when no response was received. */
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

/**
 * Validates a tool-supplied ID before it is interpolated into a REST path.
 * Tool arguments are not schema-checked at runtime, so a string such as
 * "../tickets" would otherwise change which endpoint is called.
 */
export function pathId(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

/** Pull a short, human-readable message out of a Syncro error body. */
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

/**
 * Call the Syncro REST API with the current request's credentials.
 *
 * @param path Endpoint path starting with `/`, relative to `/api/v1`
 *   (for example `/ticket_timers`). Build IDs into it with {@link pathId}.
 * @param options HTTP method (default `GET`), query params and JSON body.
 * @returns The parsed JSON response, or `{}` when the body is empty.
 * @throws {SyncroRestError} On a non-2xx status, a non-JSON success body, or a
 *   timeout (status `0`). A timed-out write may still have been applied.
 */
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

  let response: Response;
  let raw: string;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    // Read once as text: a fetch body is single-use, and Syncro error pages
    // are not always JSON.
    raw = await response.text();
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      const outcome =
        method === "GET"
          ? ""
          : " The change may or may not have been applied; check Syncro before retrying.";
      throw new SyncroRestError(
        `Syncro API ${method} ${path} timed out after ${REST_TIMEOUT_MS / 1000}s.${outcome}`,
        0,
        undefined
      );
    }
    throw err;
  }
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
