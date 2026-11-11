/**
 * What to tell the caller when a write may have been applied although it
 * reported a failure. Used by the REST helper and, through {@link sdkWrite},
 * by the writes that go through the SDK.
 *
 * The rule, for both paths: only a 4xx response means Syncro rejected the
 * request. A write that ends any other way (timeout, network error or 5xx)
 * may have been applied, and its error carries this note. The REST helper
 * also applies it to a 2xx whose body is not a JSON object; an SDK write
 * that gets such a 2xx is returned as a success, because the shape of an SDK
 * response is not checked. Each write is sent once; neither path retries.
 */

import type { SyncroClient } from "@wyre-ai/node-syncro";
import { getWriteClient } from "./client.js";

/** Append the unknown-outcome note to an error message. */
export function withUnknownOutcome(message: string): string {
  return `${message.replace(/[.\s]+$/, "")}. The change may or may not have been applied; check Syncro before retrying.`;
}

/**
 * Run an SDK write on the single-attempt client (see `getWriteClient`) and
 * give an error whose outcome is unknown the same note the REST helper adds.
 * The SDK has no request timeout, so a write that never gets a response does
 * not end on its own.
 */
export async function sdkWrite<T>(
  call: (client: SyncroClient) => Promise<T>
): Promise<T> {
  // Outside the try: a missing credential is not a write with an unknown outcome.
  const client = await getWriteClient();
  try {
    return await call(client);
  } catch (err) {
    const status = (err as { statusCode?: unknown } | null)?.statusCode;
    const rejected = typeof status === "number" && status >= 400 && status < 500;
    if (rejected || !(err instanceof Error)) throw err;
    throw new Error(withUnknownOutcome(err.message), { cause: err });
  }
}
