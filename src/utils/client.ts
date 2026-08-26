/**
 * Lazy-loaded Syncro client
 *
 * This module provides lazy initialization of the Syncro client
 * to avoid loading the entire library upfront.
 *
 * CONSISTENCY (not a live vulnerability): this used to hold the cached
 * client/credentials in module-level `let _client` / `let _credentials`
 * singletons, with manual "did credentials change → invalidate → recreate"
 * logic in `getClient()`. A prior security review traced that sequence
 * end-to-end and confirmed it is NOT exploitable as coded — the
 * validate/invalidate/recreate/return path runs synchronously with no
 * `await` between checking credentials and using the resulting client, so
 * there is no interleaving that hands one tenant another tenant's client.
 *
 * It was still structurally fragile: a future edit that introduced an
 * `await` in the wrong spot could reintroduce that bug class, and it was
 * the one piece of per-tenant state in this file still living in a shared
 * mutable module variable instead of the AsyncLocalStorage-scoped pattern
 * already used for credentials (`utils/credential-store.ts`) and the
 * per-request server reference (`utils/server-ref.ts`, which fixed the
 * literal same class of bug for a different piece of state — see that
 * file's header for the concrete cross-tenant scenario it eliminates).
 *
 * This file now stores the cached client/credentials in an
 * AsyncLocalStorage-scoped box instead, so there is no shared mutable
 * module state left to reason about at all. Credential resolution, error
 * handling, and the mismatch-detect-and-recreate behavior are unchanged —
 * only where the mutable state lives has changed.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { SyncroClient } from "@wyre-ai/node-syncro";
import { getRequestCredentials } from "./credential-store.js";
import { cleanCredential } from "./clean-credential.js";

export interface SyncroCredentials {
  apiKey: string;
  subdomain?: string;
}

/**
 * Mutable client cache slot, scoped to a single AsyncLocalStorage context
 * instead of the module. Each per-request scope (see `runWithClientScope`)
 * gets its own independent box, so concurrent requests can never observe
 * or invalidate each other's cached client.
 */
interface ClientScope {
  client: SyncroClient | null;
  credentials: SyncroCredentials | null;
}

function createScope(): ClientScope {
  return { client: null, credentials: null };
}

const clientScopeStore = new AsyncLocalStorage<ClientScope>();

/**
 * Run a callback with a fresh client cache bound to the async context for
 * the duration of that callback — including anything it `await`s or
 * schedules. Use this for transports that handle one call per request
 * (HTTP, Workers), so concurrent requests never share or invalidate each
 * other's cached client.
 */
export function runWithClientScope<T>(fn: () => T): T {
  return clientScopeStore.run(createScope(), fn);
}

/**
 * Bind a fresh client cache for the remainder of the current synchronous
 * execution and all following async work, without requiring a wrapping
 * callback.
 *
 * Only safe for single-session transports (stdio) where exactly one caller
 * exists for the whole process and there are no concurrent tenants to
 * isolate from each other. Do NOT use this for per-request transports —
 * use `runWithClientScope` there, since `enterWith` has no natural "scope
 * end" and would leak across requests just like the old module-level
 * singleton this replaces.
 */
export function bindClientScope(): void {
  clientScopeStore.enterWith(createScope());
}

/**
 * Get the client cache bound to the current async context, lazily binding
 * a process-lifetime fallback scope if none has been established yet (e.g.
 * direct calls from unit tests, or a stdio session that hasn't called
 * `bindClientScope()`). Mirrors the previous module-level cache's behavior
 * for every caller that never opted into per-request scoping.
 */
function getScope(): ClientScope {
  const scope = clientScopeStore.getStore();
  if (scope) {
    return scope;
  }
  const fallback = createScope();
  clientScopeStore.enterWith(fallback);
  return fallback;
}

/**
 * Get credentials from the per-request store (gateway mode) or
 * environment variables (stdio / env mode).
 *
 * This is the single chokepoint feeding the Syncro SDK, so every value is run
 * through {@link cleanCredential} here. That strips unresolved MCPB/DXT
 * `"${user_config.X}"` placeholders (issue #73) regardless of whether they
 * arrived via env vars, HTTP headers, or Worker secrets.
 */
export function getCredentials(): SyncroCredentials | null {
  // Per-request credentials take priority (gateway HTTP mode); otherwise fall
  // back to environment variables (stdio / env mode).
  const reqCreds = getRequestCredentials();
  const apiKey = cleanCredential(
    reqCreds ? reqCreds.apiKey : process.env.SYNCRO_API_KEY
  );
  const subdomain = cleanCredential(
    reqCreds ? reqCreds.subdomain : process.env.SYNCRO_SUBDOMAIN
  );

  if (!apiKey) {
    return null;
  }

  return { apiKey, subdomain };
}

/**
 * Get or create the Syncro client (lazy initialization)
 */
export async function getClient(): Promise<SyncroClient> {
  const creds = getCredentials();

  if (!creds) {
    throw new Error(
      "No API credentials provided. Please configure SYNCRO_API_KEY environment variable."
    );
  }

  // Syncro cannot build a request host without a subdomain. Fail with a clear
  // message here rather than letting an absent (or unresolved "${user_config.X}"
  // placeholder) subdomain reach the SDK, which would otherwise produce a
  // malformed host like "https://${user_config.syncro_subdomain}.syncromsp.com"
  // that DNS-fails on every request. See issue #73.
  if (!creds.subdomain) {
    throw new Error(
      "SYNCRO_SUBDOMAIN is required. Please configure the SYNCRO_SUBDOMAIN " +
        "environment variable with your Syncro subdomain " +
        '(e.g. "acme" for acme.syncromsp.com).'
    );
  }

  const scope = getScope();

  // If credentials changed, invalidate the cached client
  if (
    scope.client &&
    scope.credentials &&
    (creds.apiKey !== scope.credentials.apiKey ||
      creds.subdomain !== scope.credentials.subdomain)
  ) {
    scope.client = null;
  }

  if (!scope.client) {
    // Lazy import the library
    const { SyncroClient } = await import("@wyre-ai/node-syncro");
    scope.client = new SyncroClient({
      apiKey: creds.apiKey,
      subdomain: creds.subdomain,
    });
    scope.credentials = creds;
  }

  return scope.client;
}

/**
 * Clear the cached client (useful for testing)
 */
export function clearClient(): void {
  const scope = getScope();
  scope.client = null;
  scope.credentials = null;
}
