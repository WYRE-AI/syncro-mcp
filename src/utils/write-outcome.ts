/**
 * What to tell the caller when a write may have been applied although it
 * reported a failure (timeout, network error, 5xx). Used by the REST helper
 * and, through {@link sdkWrite}, by the writes that go through the SDK.
 */

/** Append the unknown-outcome note to an error message. */
export function withUnknownOutcome(message: string): string {
  return `${message.replace(/[.\s]+$/, "")}. The change may or may not have been applied; check Syncro before retrying.`;
}

/**
 * Run an SDK write and give an error whose outcome is unknown the same note
 * the REST helper adds. Only a 4xx means Syncro rejected the request; a 5xx,
 * a network failure or an unexpected success body can follow a change that
 * was applied. The SDK may itself resend a POST after a 5xx or 429, so a
 * failure here can follow more than one attempt.
 */
export async function sdkWrite<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const status = (err as { statusCode?: unknown } | null)?.statusCode;
    const rejected = typeof status === "number" && status >= 400 && status < 500;
    if (rejected || !(err instanceof Error)) throw err;
    throw new Error(withUnknownOutcome(err.message), { cause: err });
  }
}
