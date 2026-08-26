/**
 * Tests for the lazy-loaded Syncro client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCredentials,
  getClient,
  clearClient,
  runWithClientScope,
} from "../../src/utils/client.js";
import { credentialStore } from "../../src/utils/credential-store.js";

// Mock the Syncro client module
vi.mock("@wyre-ai/node-syncro", () => ({
  SyncroClient: vi.fn().mockImplementation(function (config) { return ({
    config,
    customers: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
    tickets: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), addComment: vi.fn() },
    assets: { list: vi.fn(), get: vi.fn() },
    contacts: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
    invoices: { list: vi.fn(), get: vi.fn(), create: vi.fn(), email: vi.fn() },
  }) }),
}));

describe("client.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    // Clear the cached client between tests
    clearClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getCredentials", () => {
    it("should return null when SYNCRO_API_KEY is not set", () => {
      delete process.env.SYNCRO_API_KEY;
      delete process.env.SYNCRO_SUBDOMAIN;

      const creds = getCredentials();
      expect(creds).toBeNull();
    });

    it("should return credentials with only apiKey when SYNCRO_SUBDOMAIN is not set", () => {
      process.env.SYNCRO_API_KEY = "test-api-key";
      delete process.env.SYNCRO_SUBDOMAIN;

      const creds = getCredentials();
      expect(creds).toEqual({
        apiKey: "test-api-key",
        subdomain: undefined,
      });
    });

    it("should return credentials with both apiKey and subdomain", () => {
      process.env.SYNCRO_API_KEY = "test-api-key";
      process.env.SYNCRO_SUBDOMAIN = "mycompany";

      const creds = getCredentials();
      expect(creds).toEqual({
        apiKey: "test-api-key",
        subdomain: "mycompany",
      });
    });

    // Regression: issue #73 — a blank OPTIONAL user_config field in an MCPB/DXT
    // bundle injects the literal "${user_config.syncro_subdomain}" string.
    it("should treat an unresolved subdomain placeholder as absent", () => {
      process.env.SYNCRO_API_KEY = "test-api-key";
      process.env.SYNCRO_SUBDOMAIN = "${user_config.syncro_subdomain}";

      const creds = getCredentials();
      expect(creds).toEqual({
        apiKey: "test-api-key",
        subdomain: undefined,
      });
    });

    it("should treat an unresolved api key placeholder as absent (null)", () => {
      process.env.SYNCRO_API_KEY = "${user_config.syncro_api_key}";
      process.env.SYNCRO_SUBDOMAIN = "mycompany";

      expect(getCredentials()).toBeNull();
    });
  });

  describe("getClient", () => {
    it("should throw error when no credentials are configured", async () => {
      delete process.env.SYNCRO_API_KEY;

      await expect(getClient()).rejects.toThrow(
        "No API credentials provided. Please configure SYNCRO_API_KEY environment variable."
      );
    });

    it("should create client with correct configuration", async () => {
      process.env.SYNCRO_API_KEY = "test-api-key";
      process.env.SYNCRO_SUBDOMAIN = "mycompany";

      const client = await getClient();

      expect(client).toBeDefined();
      expect(client.config).toEqual({
        apiKey: "test-api-key",
        subdomain: "mycompany",
      });
    });

    it("should return cached client on subsequent calls", async () => {
      process.env.SYNCRO_API_KEY = "test-api-key";
      process.env.SYNCRO_SUBDOMAIN = "acme";

      const client1 = await getClient();
      const client2 = await getClient();

      expect(client1).toBe(client2);
    });

    it("should create new client when credentials change", async () => {
      const { SyncroClient } = await import("@wyre-ai/node-syncro");
      const mockSyncroClient = vi.mocked(SyncroClient);

      process.env.SYNCRO_API_KEY = "first-api-key";
      process.env.SYNCRO_SUBDOMAIN = "acme";
      await getClient();

      // Verify first call with first credentials
      expect(mockSyncroClient).toHaveBeenCalledWith({
        apiKey: "first-api-key",
        subdomain: "acme",
      });

      // Clear and change credentials
      clearClient();
      mockSyncroClient.mockClear();

      process.env.SYNCRO_API_KEY = "second-api-key";
      await getClient();

      // Verify second call with new credentials
      expect(mockSyncroClient).toHaveBeenCalledWith({
        apiKey: "second-api-key",
        subdomain: "acme",
      });
    });

    it("should create new client when subdomain changes", async () => {
      const { SyncroClient } = await import("@wyre-ai/node-syncro");
      const mockSyncroClient = vi.mocked(SyncroClient);

      process.env.SYNCRO_API_KEY = "test-api-key";
      process.env.SYNCRO_SUBDOMAIN = "company1";
      await getClient();

      // Verify first call
      expect(mockSyncroClient).toHaveBeenCalledWith({
        apiKey: "test-api-key",
        subdomain: "company1",
      });

      // Clear and change subdomain
      clearClient();
      mockSyncroClient.mockClear();

      process.env.SYNCRO_SUBDOMAIN = "company2";
      await getClient();

      // Verify second call with new subdomain
      expect(mockSyncroClient).toHaveBeenCalledWith({
        apiKey: "test-api-key",
        subdomain: "company2",
      });
    });

    it("should throw a clear error when SYNCRO_SUBDOMAIN is missing", async () => {
      process.env.SYNCRO_API_KEY = "test-api-key";
      delete process.env.SYNCRO_SUBDOMAIN;

      await expect(getClient()).rejects.toThrow("SYNCRO_SUBDOMAIN is required");
    });

    // Regression: issue #73 — the blank-field placeholder must NEVER be passed
    // to the SDK (which would build "https://${user_config.syncro_subdomain}
    // .syncromsp.com" and DNS-fail on every request). Instead we fail fast with
    // a clear "required" error and never construct the client.
    it("should reject an unresolved subdomain placeholder instead of building a bogus host", async () => {
      const { SyncroClient } = await import("@wyre-ai/node-syncro");
      const mockSyncroClient = vi.mocked(SyncroClient);

      process.env.SYNCRO_API_KEY = "test-api-key";
      process.env.SYNCRO_SUBDOMAIN = "${user_config.syncro_subdomain}";

      await expect(getClient()).rejects.toThrow("SYNCRO_SUBDOMAIN is required");
      // The placeholder never reached the SDK constructor.
      expect(mockSyncroClient).not.toHaveBeenCalled();
    });
  });

  describe("runWithClientScope (tenant isolation)", () => {
    // Regression for the AsyncLocalStorage refactor: prove that two
    // concurrent "tenants" (distinct credential sets), each scoped via
    // `runWithClientScope`, never observe or invalidate each other's cached
    // client — even when an `await` gap separates validating credentials
    // from using the resulting client, which is exactly the kind of edit
    // a prior security review warned could reintroduce the old
    // module-level-singleton bug class.
    it("keeps each tenant's client isolated under concurrent, interleaved calls", async () => {
      // Vitest's dynamic-import mock interception is not safe to race: two
      // truly concurrent first-time `import()` calls for the same mocked
      // specifier can non-deterministically resolve to the *real* package
      // for one of them (a test-harness quirk, unrelated to the
      // AsyncLocalStorage scoping under test here). So each tenant's own
      // cold client creation happens sequentially — tenant B waits for
      // tenant A's `getClient()` to resolve before making its own first
      // call — via `gateA`. Everything after that first call (the await
      // gap and the second `getClient()` re-use) still runs concurrently
      // for both tenants, which is the property the prior security review
      // scenario actually cared about: no interleaving between validating
      // credentials and using the resulting client should let one tenant
      // observe another's client.
      let resolveGateA!: () => void;
      const gateA = new Promise<void>((resolve) => {
        resolveGateA = resolve;
      });

      async function runTenant(
        apiKey: string,
        subdomain: string,
        waitFor?: Promise<void>
      ) {
        return credentialStore.run({ apiKey, subdomain }, () =>
          runWithClientScope(async () => {
            if (waitFor) {
              await waitFor;
            }
            const client = await getClient();
            resolveGateA();
            // Simulate real work between validating credentials and the
            // next use of the client, so the two tenants' async work
            // interleaves on the event loop.
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
            const clientAgain = await getClient();
            return { client, clientAgain };
          })
        );
      }

      const [tenantA, tenantB] = await Promise.all([
        runTenant("tenant-a-key", "tenant-a"),
        runTenant("tenant-b-key", "tenant-b", gateA),
      ]);

      // Each tenant's own two calls returned the same cached instance...
      expect(tenantA.client).toBe(tenantA.clientAgain);
      expect(tenantB.client).toBe(tenantB.clientAgain);
      // ...but the two tenants never share a client instance...
      expect(tenantA.client).not.toBe(tenantB.client);
      // ...and each client was built with its own tenant's credentials.
      expect((tenantA.client as unknown as { config: unknown }).config).toEqual({
        apiKey: "tenant-a-key",
        subdomain: "tenant-a",
      });
      expect((tenantB.client as unknown as { config: unknown }).config).toEqual({
        apiKey: "tenant-b-key",
        subdomain: "tenant-b",
      });
    });
  });

  describe("clearClient", () => {
    it("should clear the cached client", async () => {
      process.env.SYNCRO_API_KEY = "test-api-key";
      process.env.SYNCRO_SUBDOMAIN = "acme";

      const client1 = await getClient();
      clearClient();
      const client2 = await getClient();

      // After clearing, a new client instance should be created
      expect(client1).not.toBe(client2);
    });
  });
});
