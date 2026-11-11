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
import { withUnknownOutcome } from "./write-outcome.js";

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
 * Validates a tool-supplied whole number that must be positive, such as an ID
 * or a count of minutes. Tool arguments are not schema-checked at runtime, so
 * an ID such as "../tickets" would otherwise change which endpoint is called.
 */
export function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

/**
 * Validates an ID before it is interpolated into a request path. Run every ID
 * that reaches a path through this, whether the request goes through the SDK
 * or {@link syncroRest}: the SDK does not encode IDs, and `fetch` resolves
 * `..` segments.
 */
export const pathId = positiveInteger;

/** `YYYY-MM-DDTHH:MM[:SS[.fff]]` followed by `Z` or a `+HH:MM` / `-HH:MM` offset. */
const ISO_TIMESTAMP =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/;

/** Whether a matched {@link ISO_TIMESTAMP} names a real date and a time of day in range. */
function isRealDateTime(groups: Record<string, string | undefined>): boolean {
  const n = (name: string) => Number(groups[name] ?? 0);
  // A month or day out of range makes Date roll over into another month
  // (the 31st of February becomes March, day 0 the month before), so the
  // month coming back unchanged proves both the month and the day are real.
  const rolled = new Date(Date.UTC(n("year"), n("month") - 1, n("day")));
  return (
    rolled.getUTCMonth() === n("month") - 1 &&
    n("hour") <= 23 &&
    n("minute") <= 59 &&
    n("second") <= 59 &&
    n("offsetHour") <= 23 &&
    n("offsetMinute") <= 59
  );
}

/**
 * Validates a tool-supplied ISO 8601 date-time before it is sent or shown in
 * a prompt. It must name a real date and carry `Z` or an offset: without one
 * the time is ambiguous, and Syncro and this server could read it in
 * different time zones.
 */
export function isoTimestamp(value: unknown, label: string): string {
  const groups =
    typeof value === "string" ? ISO_TIMESTAMP.exec(value)?.groups : undefined;
  if (!groups || !isRealDateTime(groups)) {
    throw new Error(
      `${label} must be a real ISO 8601 date-time with Z or an offset, such as 2026-11-07T02:00:00Z`
    );
  }
  return value as string;
}

/** Validates a tool-supplied number before it is sent or shown in a prompt. */
export function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

/** Validates a tool-supplied flag: a string such as "false" is truthy, so only a real boolean passes. */
export function booleanArg(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false`);
  }
  return value;
}

/** Validates a tool-supplied amount that must be above zero, such as a quantity. */
export function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a number greater than 0`);
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

/** Short reason for a fetch failure, with the system error code when present. */
function describeNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? `${err.message} (${code})` : err.message;
}

/**
 * Call the Syncro REST API with the current request's credentials.
 *
 * @param path Endpoint path starting with `/`, relative to `/api/v1`
 *   (for example `/ticket_timers`). Build IDs into it with {@link pathId}.
 * @param options HTTP method (default `GET`), query params and JSON body.
 * @returns The parsed JSON response, or `{}` when the body is empty.
 * @throws {SyncroRestError} On a non-2xx status, a non-JSON success body, or a
 *   timeout or network error (status `0`). For a write (any method but `GET`),
 *   only a 4xx response is a plain rejection; a timeout, network error, any
 *   other status, or a 2xx body that is not JSON may follow a change that was
 *   applied, and the message says so. A `GET` never carries the note. The call
 *   is made once and never retried.
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
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? `timed out after ${REST_TIMEOUT_MS / 1000}s`
        : `failed: ${describeNetworkError(err)}`;
    const message = `Syncro API ${method} ${path} ${reason}`;
    throw new SyncroRestError(
      method === "GET" ? message : withUnknownOutcome(message),
      0,
      undefined
    );
  }
  // Only a 4xx means Syncro rejected the request. A write that got any other
  // answer may already have been applied, so its error carries the note.
  const rejected = response.status >= 400 && response.status < 500;
  const outcomeKnown = method === "GET" || rejected;
  let parsed: unknown = raw;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    if (response.ok) {
      const message = `Expected JSON from ${method} ${path} but got: ${raw.slice(0, 200)}`;
      throw new SyncroRestError(
        outcomeKnown ? message : withUnknownOutcome(message),
        response.status,
        raw
      );
    }
  }

  if (!response.ok) {
    const message = `Syncro API ${method} ${path} failed (${response.status}): ${describeErrorBody(parsed)}`;
    throw new SyncroRestError(
      outcomeKnown ? message : withUnknownOutcome(message),
      response.status,
      parsed
    );
  }

  return parsed as T;
}
