/**
 * Assets domain handler
 *
 * Provides tools for asset/configuration item operations in Syncro MSP.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { pathId, syncroRest } from "../utils/rest.js";
import { guardWrite } from "../utils/write-guard.js";
import { clip } from "../utils/prompt-text.js";
import {
  READ_ONLY,
  IDEMPOTENT_WRITE,
  DESTRUCTIVE,
} from "../utils/annotations.js";

/**
 * Get asset domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "syncro_assets_list",
      description:
        "List assets/configuration items in Syncro. Can filter by customer, asset type, or serial number.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: {
            type: "number",
            description: "Filter assets by customer ID",
          },
          asset_type: {
            type: "string",
            description:
              "Filter by asset type (e.g., Desktop, Laptop, Server, Network Device)",
          },
          asset_serial: {
            type: "string",
            description: "Filter by serial number",
          },
          query: {
            type: "string",
            description: "Search query string",
          },
          page: {
            type: "number",
            description: "Page number for pagination (default: 1)",
          },
          per_page: {
            type: "number",
            description: "Results per page (default: 25)",
          },
        },
      },
    },
    {
      name: "syncro_assets_get",
      description: "Get details for a specific asset by its ID",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          asset_id: {
            type: "number",
            description: "The asset ID",
          },
        },
        required: ["asset_id"],
      },
    },
    {
      name: "syncro_assets_search",
      description:
        "Search for assets using a query string or serial number. Useful for finding devices by name, serial, or other attributes.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query string",
          },
          asset_serial: {
            type: "string",
            description: "Search by exact serial number",
          },
          customer_id: {
            type: "number",
            description: "Limit search to a specific customer",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 25)",
          },
        },
      },
    },
    {
      name: "syncro_assets_get_patches",
      description:
        "Get Windows patch status for an RMM-managed asset: installed patches and missing, failed, or rejected patches with KB numbers. Use this to decide whether a device needs patching.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          asset_id: { type: "number", description: "The asset ID" },
        },
        required: ["asset_id"],
      },
    },
    {
      name: "syncro_assets_list_installed_applications",
      description:
        "List software installed on an RMM-managed asset (name, vendor, version, install date). Use it to confirm that an agent such as a backup or AV client is present on the device.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          asset_id: { type: "number", description: "The asset ID" },
          page: { type: "number", description: "Page number (default: 1)" },
          per_page: {
            type: "number",
            description: "Results per page (default: 100, max: 100)",
          },
        },
        required: ["asset_id"],
      },
    },
    {
      name: "syncro_assets_list_policy_folders",
      description:
        "List a customer's RMM policy folders. An asset's policy folder determines the RMM policy (including patch management settings) applied to it.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: { type: "number", description: "Customer ID (required)" },
          page: { type: "number", description: "Page number" },
          per_page: { type: "number", description: "Results per page, up to 100" },
        },
        required: ["customer_id"],
      },
    },
    {
      name: "syncro_assets_set_policy_folder",
      description:
        "⚠ HIGH-IMPACT. Move an RMM-managed asset into a policy folder, which changes the RMM policy (patch schedule, monitoring, automation) applied to the device. Requires the 'Assets - Edit Policy' permission. Confirm with the user before invoking.",
      annotations: IDEMPOTENT_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          asset_id: { type: "number", description: "The asset ID" },
          policy_folder_id: {
            type: "number",
            description: "Target policy folder ID (from syncro_assets_list_policy_folders)",
          },
        },
        required: ["asset_id", "policy_folder_id"],
      },
    },
    {
      name: "syncro_assets_run_script",
      description:
        "⚠ DESTRUCTIVE — RUNS CODE ON A MANAGED DEVICE. Schedule an existing Syncro RMM script to run once on an asset, now or at a set time (e.g. a patch-install or remediation script). The script ID comes from the Syncro script library; the API has no endpoint to list scripts. Requires the 'Scripts - Execute' permission. Confirm with the user before invoking: the user is prompted only over stdio with a client that supports elicitation. Over HTTP (the gateway) there is no prompt, so you must ask the user yourself and pass confirm: true only after they approve this exact run.",
      annotations: DESTRUCTIVE,
      inputSchema: {
        type: "object" as const,
        properties: {
          asset_id: { type: "number", description: "The asset ID to run the script on" },
          script_id: { type: "number", description: "The Syncro script ID" },
          run_at: {
            type: "string",
            description: "ISO 8601 time to run the script once. Omit to run now",
          },
          run_as: {
            type: "string",
            description: "Account to run the script as (the script's default if omitted)",
          },
          variables: {
            type: "object",
            description: "Runtime variables passed to the script, as name/value pairs",
          },
          confirm: {
            type: "boolean",
            description:
              "Set true only after the user approved this run. Required when the client cannot show a confirmation prompt (always the case over HTTP). This server cannot verify that the user approved",
          },
        },
        required: ["asset_id", "script_id"],
      },
    },
  ];
}

/**
 * Handle an asset domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "syncro_assets_list": {
      const response = await client.assets.list({
        customer_id: args.customer_id as number | undefined,
        asset_type: args.asset_type as string | undefined,
        asset_serial: args.asset_serial as string | undefined,
        query: args.query as string | undefined,
        page: args.page as number | undefined,
        perPage: args.per_page as number | undefined,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total_entries: response.meta.total_entries,
                total_pages: response.meta.total_pages,
                current_page: response.meta.page,
                assets: response.assets,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "syncro_assets_get": {
      const assetId = args.asset_id as number;
      const asset = await client.assets.get(assetId);

      return {
        content: [{ type: "text", text: JSON.stringify(asset, null, 2) }],
      };
    }

    case "syncro_assets_search": {
      const limit = (args.limit as number) || 25;

      const response = await client.assets.list({
        query: args.query as string | undefined,
        asset_serial: args.asset_serial as string | undefined,
        customer_id: args.customer_id as number | undefined,
        perPage: limit,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: response.assets.length,
                assets: response.assets,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "syncro_assets_get_patches": {
      const assetId = pathId(args.asset_id, "asset_id");
      const patches = await syncroRest<Record<string, unknown>>(
        `/customer_assets/${assetId}/patches`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(patches, null, 2) }],
      };
    }

    case "syncro_assets_list_installed_applications": {
      const assetId = pathId(args.asset_id, "asset_id");
      const response = await syncroRest<{
        installed_applications?: unknown[];
        meta?: unknown;
      }>(`/customer_assets/${assetId}/installed_applications`, {
        params: {
          page: args.page as number | undefined,
          per_page: args.per_page as number | undefined,
        },
      });

      if (!response.installed_applications?.length) {
        return {
          content: [
            {
              type: "text",
              text: `No installed applications found for asset ${assetId}. The asset may not be running the Syncro agent.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "syncro_assets_list_policy_folders": {
      const response = await syncroRest<{
        policy_folders?: unknown[];
        meta?: unknown;
      }>("/policy_folders", {
        params: {
          customer_id: args.customer_id as number,
          page: args.page as number | undefined,
          per_page: args.per_page as number | undefined,
        },
      });

      if (!response.policy_folders?.length) {
        return {
          content: [
            {
              type: "text",
              text: `No policy folders found for customer ${args.customer_id}.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    case "syncro_assets_set_policy_folder": {
      const assetId = pathId(args.asset_id, "asset_id");
      const folderId = pathId(args.policy_folder_id, "policy_folder_id");
      const blocked = await guardWrite(
        `Move Syncro asset ${assetId} into policy folder ${folderId}? This changes the RMM policy applied to the device.`
      );
      if (blocked) return blocked;

      // Send only policy_folder_id: per the API docs, that needs just the
      // "Assets - Edit Policy" permission, while adding other fields also
      // requires "Assets - Edit".
      const response = await syncroRest<{ asset: unknown }>(
        `/customer_assets/${assetId}`,
        { method: "PUT", body: { policy_folder_id: folderId } }
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(response.asset ?? response, null, 2) },
        ],
      };
    }

    case "syncro_assets_run_script": {
      const assetId = pathId(args.asset_id, "asset_id");
      const scriptId = args.script_id as number;
      const runAt = args.run_at as string | undefined;
      const runAs =
        args.run_as === undefined
          ? "the script's default account"
          : clip(args.run_as);
      const variables =
        args.variables === undefined ? "none" : clip(args.variables);
      const blocked = await guardWrite(
        `Run Syncro script ${scriptId} on asset ${assetId} ${runAt ? `at ${runAt}` : "now"}, as ${runAs}, with variables: ${variables}? This executes code on the device.`,
        { destructive: true, args }
      );
      if (blocked) return blocked;

      const scriptOptions: Record<string, unknown> = {};
      if (args.run_as !== undefined) scriptOptions.run_as = args.run_as;
      if (args.variables !== undefined) {
        scriptOptions.runtime_variables = args.variables;
      }

      const response = await syncroRest<Record<string, unknown>>(
        `/rmm/public_scripts/${assetId}/schedule`,
        {
          method: "POST",
          body: {
            script_id: scriptId,
            run_type: runAt ? "later" : "now",
            next_time: runAt,
            freq: "once",
            ...(Object.keys(scriptOptions).length
              ? { script_options: scriptOptions }
              : {}),
          },
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown asset tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const assetsHandler: DomainHandler = {
  getTools,
  handleCall,
};
