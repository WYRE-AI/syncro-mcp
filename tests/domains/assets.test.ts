/**
 * Tests for the assets domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { assetsHandler } from "../../src/domains/assets.js";
import * as clientModule from "../../src/utils/client.js";
import * as restModule from "../../src/utils/rest.js";
import * as guardModule from "../../src/utils/write-guard.js";

// Mock the client module
vi.mock("../../src/utils/client.js", () => ({
  getClient: vi.fn(),
  getWriteClient: vi.fn(),
  getCredentials: vi.fn(),
  clearClient: vi.fn(),
}));

vi.mock("../../src/utils/rest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/rest.js")>()),
  syncroRest: vi.fn(),
}));

vi.mock("../../src/utils/write-guard.js", () => ({
  guardWrite: vi.fn(),
}));

describe("domains/assets.ts", () => {
  const mockClient = {
    assets: {
      list: vi.fn(),
      get: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientModule.getClient).mockResolvedValue(mockClient as never);
    vi.mocked(clientModule.getWriteClient).mockResolvedValue(mockClient as never);
    vi.mocked(restModule.syncroRest).mockReset();
    vi.mocked(guardModule.guardWrite).mockReset();
    vi.mocked(guardModule.guardWrite).mockResolvedValue(null);
  });

  describe("getTools", () => {
    it("should return all asset tools", () => {
      const tools = assetsHandler.getTools();

      expect(tools).toHaveLength(8);
      expect(tools.map((t) => t.name)).toEqual([
        "syncro_assets_list",
        "syncro_assets_get",
        "syncro_assets_search",
        "syncro_assets_get_patches",
        "syncro_assets_list_installed_applications",
        "syncro_assets_list_policy_folders",
        "syncro_assets_set_policy_folder",
        "syncro_assets_run_script",
      ]);
    });

    it("should define correct input schema for list tool", () => {
      const tools = assetsHandler.getTools();
      const listTool = tools.find((t) => t.name === "syncro_assets_list");

      expect(listTool).toBeDefined();
      expect(listTool!.inputSchema.properties).toHaveProperty("customer_id");
      expect(listTool!.inputSchema.properties).toHaveProperty("asset_type");
      expect(listTool!.inputSchema.properties).toHaveProperty("asset_serial");
      expect(listTool!.inputSchema.properties).toHaveProperty("query");
    });

    it("should mark asset_id as required for get tool", () => {
      const tools = assetsHandler.getTools();
      const getTool = tools.find((t) => t.name === "syncro_assets_get");

      expect(getTool).toBeDefined();
      expect(getTool!.inputSchema.required).toContain("asset_id");
    });

    it("should have search tool with optional filters", () => {
      const tools = assetsHandler.getTools();
      const searchTool = tools.find((t) => t.name === "syncro_assets_search");

      expect(searchTool).toBeDefined();
      expect(searchTool!.inputSchema.properties).toHaveProperty("query");
      expect(searchTool!.inputSchema.properties).toHaveProperty("asset_serial");
      expect(searchTool!.inputSchema.properties).toHaveProperty("customer_id");
      expect(searchTool!.inputSchema.properties).toHaveProperty("limit");
      // Search does not have required fields - all are optional
      expect(searchTool!.inputSchema.required).toBeUndefined();
    });
  });

  describe("handleCall", () => {
    describe("syncro_assets_list", () => {
      it("should list assets with default parameters", async () => {
        mockClient.assets.list.mockResolvedValue({
          assets: [{ id: 1, name: "Laptop-001" }],
          meta: { total_entries: 1, total_pages: 1, page: 1 },
        });

        const result = await assetsHandler.handleCall("syncro_assets_list", {});

        expect(mockClient.assets.list).toHaveBeenCalledWith({
          customer_id: undefined,
          asset_type: undefined,
          asset_serial: undefined,
          query: undefined,
          page: undefined,
          perPage: undefined,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.total_entries).toBe(1);
        expect(parsed.assets).toHaveLength(1);
      });

      it("should list assets filtered by customer and type", async () => {
        mockClient.assets.list.mockResolvedValue({
          assets: [
            { id: 1, name: "Server-001", asset_type: "Server" },
            { id: 2, name: "Server-002", asset_type: "Server" },
          ],
          meta: { total_entries: 2, total_pages: 1, page: 1 },
        });

        await assetsHandler.handleCall("syncro_assets_list", {
          customer_id: 123,
          asset_type: "Server",
        });

        expect(mockClient.assets.list).toHaveBeenCalledWith({
          customer_id: 123,
          asset_type: "Server",
          asset_serial: undefined,
          query: undefined,
          page: undefined,
          perPage: undefined,
        });
      });

      it("should list assets filtered by serial number", async () => {
        mockClient.assets.list.mockResolvedValue({
          assets: [{ id: 1, asset_serial: "ABC123" }],
          meta: { total_entries: 1, total_pages: 1, page: 1 },
        });

        await assetsHandler.handleCall("syncro_assets_list", {
          asset_serial: "ABC123",
        });

        expect(mockClient.assets.list).toHaveBeenCalledWith(
          expect.objectContaining({
            asset_serial: "ABC123",
          })
        );
      });

      it("should support pagination", async () => {
        mockClient.assets.list.mockResolvedValue({
          assets: [],
          meta: { total_entries: 100, total_pages: 4, page: 3 },
        });

        await assetsHandler.handleCall("syncro_assets_list", {
          page: 3,
          per_page: 25,
        });

        expect(mockClient.assets.list).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 3,
            perPage: 25,
          })
        );
      });
    });

    describe("syncro_assets_get", () => {
      it("should get an asset by ID", async () => {
        const mockAsset = {
          id: 456,
          name: "Workstation-001",
          asset_type: "Desktop",
          asset_serial: "WS001",
          customer_id: 123,
        };
        mockClient.assets.get.mockResolvedValue(mockAsset);

        const result = await assetsHandler.handleCall("syncro_assets_get", {
          asset_id: 456,
        });

        expect(mockClient.assets.get).toHaveBeenCalledWith(456);

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.id).toBe(456);
        expect(parsed.name).toBe("Workstation-001");
        expect(parsed.asset_type).toBe("Desktop");
      });
    });

    describe("syncro_assets_search", () => {
      it("should search assets by query", async () => {
        mockClient.assets.list.mockResolvedValue({
          assets: [{ id: 1, name: "Laptop-A" }, { id: 2, name: "Laptop-B" }],
          meta: { total_entries: 2, total_pages: 1, page: 1 },
        });

        const result = await assetsHandler.handleCall("syncro_assets_search", {
          query: "laptop",
        });

        expect(mockClient.assets.list).toHaveBeenCalledWith({
          query: "laptop",
          asset_serial: undefined,
          customer_id: undefined,
          perPage: 25,
        });

        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.count).toBe(2);
        expect(parsed.assets).toHaveLength(2);
      });

      it("should search by serial number", async () => {
        mockClient.assets.list.mockResolvedValue({
          assets: [{ id: 1, asset_serial: "EXACT123" }],
          meta: { total_entries: 1, total_pages: 1, page: 1 },
        });

        await assetsHandler.handleCall("syncro_assets_search", {
          asset_serial: "EXACT123",
        });

        expect(mockClient.assets.list).toHaveBeenCalledWith({
          query: undefined,
          asset_serial: "EXACT123",
          customer_id: undefined,
          perPage: 25,
        });
      });

      it("should search within a specific customer", async () => {
        mockClient.assets.list.mockResolvedValue({
          assets: [],
          meta: { total_entries: 0, total_pages: 0, page: 1 },
        });

        await assetsHandler.handleCall("syncro_assets_search", {
          query: "server",
          customer_id: 999,
          limit: 50,
        });

        expect(mockClient.assets.list).toHaveBeenCalledWith({
          query: "server",
          asset_serial: undefined,
          customer_id: 999,
          perPage: 50,
        });
      });

      it("should use default limit of 25", async () => {
        mockClient.assets.list.mockResolvedValue({
          assets: [],
          meta: { total_entries: 0, total_pages: 0, page: 1 },
        });

        await assetsHandler.handleCall("syncro_assets_search", {
          query: "test",
        });

        expect(mockClient.assets.list).toHaveBeenCalledWith(
          expect.objectContaining({
            perPage: 25,
          })
        );
      });
    });

    describe("syncro_assets_get_patches", () => {
      it("reads the asset's patch status", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({
          installed_patches: [],
          available_patches: [{ kb: "KB5027215", status: "Failed Patches" }],
        });

        const result = await assetsHandler.handleCall("syncro_assets_get_patches", {
          asset_id: 42,
        });

        expect(restModule.syncroRest).toHaveBeenCalledWith(
          "/customer_assets/42/patches"
        );
        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.available_patches[0].kb).toBe("KB5027215");
      });
    });

    describe("syncro_assets_list_installed_applications", () => {
      it("lists installed applications with pagination", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({
          installed_applications: [{ name: "Syncro Backup" }],
          meta: { page: 1 },
        });

        await assetsHandler.handleCall("syncro_assets_list_installed_applications", {
          asset_id: 42,
          page: 2,
        });

        expect(restModule.syncroRest).toHaveBeenCalledWith(
          "/customer_assets/42/installed_applications",
          { params: { page: 2, per_page: undefined } }
        );
      });

      it("returns an explicit error when nothing is installed", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({
          installed_applications: [],
        });

        const result = await assetsHandler.handleCall(
          "syncro_assets_list_installed_applications",
          { asset_id: 42 }
        );
        expect(result.isError).toBe(true);
      });
    });

    describe("syncro_assets_list_policy_folders", () => {
      it("lists a customer's policy folders", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({
          policy_folders: [{ id: 2, name: "Workstations" }],
        });

        await assetsHandler.handleCall("syncro_assets_list_policy_folders", {
          customer_id: 9,
        });

        expect(restModule.syncroRest).toHaveBeenCalledWith("/policy_folders", {
          params: { customer_id: 9, page: undefined, per_page: undefined },
        });
      });
    });

    describe("syncro_assets_set_policy_folder", () => {
      it("sends only policy_folder_id after confirmation", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({
          asset: { id: 42, policy_folder_id: 2 },
        });

        const result = await assetsHandler.handleCall(
          "syncro_assets_set_policy_folder",
          { asset_id: 42, policy_folder_id: 2 }
        );

        expect(guardModule.guardWrite).toHaveBeenCalledOnce();
        expect(restModule.syncroRest).toHaveBeenCalledWith("/customer_assets/42", {
          method: "PUT",
          body: { policy_folder_id: 2 },
        });
        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        expect(parsed.policy_folder_id).toBe(2);
      });

      it("does not call Syncro when the user declines", async () => {
        vi.mocked(guardModule.guardWrite).mockResolvedValue({
          content: [{ type: "text", text: "Cancelled" }],
        });

        await assetsHandler.handleCall("syncro_assets_set_policy_folder", {
          asset_id: 42,
          policy_folder_id: 2,
        });

        expect(restModule.syncroRest).not.toHaveBeenCalled();
      });
    });

    describe("syncro_assets_run_script", () => {
      it("runs a script now as a destructive, confirmed action", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({
          message: "Ok, script scheduled.",
        });
        const args = { asset_id: 42, script_id: 7, confirm: true };

        await assetsHandler.handleCall("syncro_assets_run_script", args);

        expect(guardModule.guardWrite).toHaveBeenCalledWith(
          "Run Syncro script 7 on asset 42 now, as the script's default account, with variables: none? This executes code on the device.",
          { destructive: true, args }
        );
        expect(restModule.syncroRest).toHaveBeenCalledWith(
          "/rmm/public_scripts/42/schedule",
          {
            method: "POST",
            body: {
              script_id: 7,
              run_type: "now",
              next_time: undefined,
              freq: "once",
            },
          }
        );
      });

      it("schedules a one-off later run with options", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});

        await assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          run_at: "2026-11-07T02:00:00Z",
          run_as: "system",
          variables: { reboot: "false" },
        });

        expect(restModule.syncroRest).toHaveBeenCalledWith(
          "/rmm/public_scripts/42/schedule",
          {
            method: "POST",
            body: {
              script_id: 7,
              run_type: "later",
              next_time: "2026-11-07T02:00:00Z",
              freq: "once",
              script_options: {
                run_as: "system",
                runtime_variables: { reboot: "false" },
              },
            },
          }
        );
      });

      it("shows run_as and the variables in the confirmation prompt", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});

        await assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          run_at: "2026-11-07T02:00:00Z",
          run_as: "system",
          variables: { reboot: "false", target: "C:\\Temp" },
        });

        const [prompt] = vi.mocked(guardModule.guardWrite).mock.calls[0];
        expect(prompt).toBe(
          'Run Syncro script 7 on asset 42 at 2026-11-07T02:00:00Z, as "system", with variables: "reboot" = "false", "target" = "C:\\\\Temp"? This executes code on the device.'
        );
      });

      it("lists every variable name even when there are many", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});
        const variables = Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [`var_${i}`, "v"])
        );

        await assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          variables,
        });

        const [prompt] = vi.mocked(guardModule.guardWrite).mock.calls[0];
        for (const name of Object.keys(variables)) {
          expect(prompt).toContain(`"${name}" = "v"`);
        }
      });

      it("refuses a variable value too long to show in full", async () => {
        const result = assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          variables: { payload: `${"x".repeat(200)}; rm -rf /` },
        });

        await expect(result).rejects.toThrow(
          /The value of variable "payload" is 210 characters, over the 200/
        );
        expect(guardModule.guardWrite).not.toHaveBeenCalled();
        expect(restModule.syncroRest).not.toHaveBeenCalled();
      });

      it("accepts a variable value of exactly 200 characters", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});

        await assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          variables: { payload: "x".repeat(200) },
        });

        expect(restModule.syncroRest).toHaveBeenCalledTimes(1);
      });

      it("refuses a variable name too long to show in full", async () => {
        const result = assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          variables: { [`n${"x".repeat(200)}`]: "1" },
        });

        await expect(result).rejects.toThrow(/A variable name is 201 characters/);
        expect(restModule.syncroRest).not.toHaveBeenCalled();
      });

      it("refuses variables that are too long to show in full together", async () => {
        const variables = Object.fromEntries(
          Array.from({ length: 6 }, (_, i) => [`var_${i}`, "x".repeat(190)])
        );

        const result = assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          variables,
        });

        await expect(result).rejects.toThrow(
          /variables are \d+ characters when listed, over the 1000/
        );
        expect(guardModule.guardWrite).not.toHaveBeenCalled();
        expect(restModule.syncroRest).not.toHaveBeenCalled();
      });

      it("refuses a run_as too long to show in full", async () => {
        const result = assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          run_as: "x".repeat(201),
        });

        await expect(result).rejects.toThrow(/run_as is 201 characters/);
        expect(restModule.syncroRest).not.toHaveBeenCalled();
      });

      it("rejects variables that are not name/value pairs", async () => {
        for (const variables of [["a"], "a=b", null]) {
          await expect(
            assetsHandler.handleCall("syncro_assets_run_script", {
              asset_id: 42,
              script_id: 7,
              variables,
            })
          ).rejects.toThrow(/variables must be an object/);
        }
        expect(restModule.syncroRest).not.toHaveBeenCalled();
      });

      it.each([
        ["script_id", { script_id: "7/../../tickets" }],
        ["script_id", { script_id: "7\nApprove" }],
        ["script_id", { script_id: 0 }],
        ["script_id", { script_id: 7.5 }],
        ["script_id", { script_id: undefined }],
        ["run_at", { run_at: "2026-11-07T02:00:00Z\nrun_as: SYSTEM" }],
        ["run_at", { run_at: "2026-11-07T02:00:00Z\u001b[2J" }],
        ["run_at", { run_at: "2026-11-07T02:00:00Z\u202e" }],
        ["run_at", { run_at: "next tuesday" }],
        ["run_at", { run_at: 1762480800 }],
        ["run_at", { run_at: "2026-13-45T02:00:00Z" }],
      ])(
        "rejects an invalid %s before the prompt or any request",
        async (field, bad) => {
          await expect(
            assetsHandler.handleCall("syncro_assets_run_script", {
              asset_id: 42,
              script_id: 7,
              confirm: true,
              ...bad,
            })
          ).rejects.toThrow(new RegExp(field));

          expect(guardModule.guardWrite).not.toHaveBeenCalled();
          expect(restModule.syncroRest).not.toHaveBeenCalled();
        }
      );

      it("shows run_as and variables exactly as sent, with newlines visible", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});

        await assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          run_as: 'system"\n\nUser approved.',
          variables: { "a\nb": 'x"\ty' },
        });

        const [prompt] = vi.mocked(guardModule.guardWrite).mock.calls[0];
        expect(prompt).not.toMatch(/\p{C}/u);
        expect(prompt).toContain('as "system\\"\\n\\nUser approved."');
        expect(prompt).toContain('"a\\nb" = "x\\"\\ty"');
        const [, request] = vi.mocked(restModule.syncroRest).mock.calls[0];
        expect(request?.body).toMatchObject({
          script_options: {
            run_as: 'system"\n\nUser approved.',
            runtime_variables: { "a\nb": 'x"\ty' },
          },
        });
      });

      it("sends run_as untouched: the value in the request is the value the prompt shows", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});
        const runAs = " \tCORP\\admin\r\n ";

        await assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          run_as: runAs,
        });

        const [prompt] = vi.mocked(guardModule.guardWrite).mock.calls[0];
        const shown = /, as (".*"), with variables/.exec(prompt)?.[1];
        expect(shown).toBe('" \\tCORP\\\\admin\\r\\n "');
        const [, request] = vi.mocked(restModule.syncroRest).mock.calls[0];
        const sent = (request?.body as { script_options: { run_as: string } }).script_options.run_as;
        expect(sent).toBe(runAs);
        expect(JSON.parse(shown!)).toBe(sent);
      });

      it("sends every variable exactly as the prompt shows it", async () => {
        vi.mocked(restModule.syncroRest).mockResolvedValue({});
        const variables = {
          " lead": "trail ",
          "second\tkey": ' "quoted" \\ \r\nline ',
          third: "x".repeat(200),
        };

        await assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
          variables,
        });

        const [prompt] = vi.mocked(guardModule.guardWrite).mock.calls[0];
        for (const [name, value] of Object.entries(variables)) {
          expect(prompt).toContain(
            `${JSON.stringify(name)} = ${JSON.stringify(value)}`
          );
        }
        const [, request] = vi.mocked(restModule.syncroRest).mock.calls[0];
        const sent = (
          request?.body as {
            script_options: { runtime_variables: Record<string, string> };
          }
        ).script_options.runtime_variables;
        expect(sent).toStrictEqual(variables);
      });

      it.each([
        ["run_as", { run_as: "system\u001b[2J" }, /run_as contains the character U\+001B/],
        ["run_as", { run_as: "sys\u2800tem" }, /run_as contains the character U\+2800/],
        ["run_as", { run_as: 123 }, /run_as must be a string/],
        ["a variable value", { variables: { a: "x\u202ey" } }, /value of variable "a" contains the character U\+202E/],
        ["a variable name", { variables: { "a\u3164": "x" } }, /variable name contains the character U\+3164/],
        ["a non-string variable value", { variables: { a: 1 } }, /value of variable "a" must be a string/],
        ["a long run of newlines", { run_as: `${"x".repeat(150)}${"\n".repeat(100)}` }, /run_as is 250 characters/],
      ])(
        "refuses %s that cannot be shown as sent, with no prompt and no request",
        async (_name, bad, message) => {
          await expect(
            assetsHandler.handleCall("syncro_assets_run_script", {
              asset_id: 42,
              script_id: 7,
              confirm: true,
              ...bad,
            })
          ).rejects.toThrow(message);

          expect(guardModule.guardWrite).not.toHaveBeenCalled();
          expect(restModule.syncroRest).not.toHaveBeenCalled();
        }
      );

      it("does not run when the guard blocks it", async () => {
        vi.mocked(guardModule.guardWrite).mockResolvedValue({
          content: [{ type: "text", text: "Confirmation required" }],
          isError: true,
        });

        const result = await assetsHandler.handleCall("syncro_assets_run_script", {
          asset_id: 42,
          script_id: 7,
        });

        expect(result.isError).toBe(true);
        expect(restModule.syncroRest).not.toHaveBeenCalled();
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await assetsHandler.handleCall("unknown_tool", {});

        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toContain("Unknown asset tool");
      });
    });
  });
});
