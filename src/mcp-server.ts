/**
 * Shared MCP server factory for Syncro.
 *
 * This module is **side-effect free** (importing it never starts a transport),
 * so it can be reused by every entrypoint:
 * - `index.ts`  — stdio + Node HTTP transport
 * - `worker.ts` — Cloudflare Workers (Web Standard) transport
 *
 * All Syncro tools are exposed upfront (flat architecture) for universal MCP
 * client compatibility.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getDomainHandler, getAvailableDomains } from "./domains/index.js";
import { isDomainName, type DomainName } from "./utils/types.js";
import { getCredentials } from "./utils/client.js";
import { registerResourceHandlers } from "./resources.js";
import type { RequestCredentials } from "./utils/credential-store.js";

export type { RequestCredentials as SyncroCredentials };

/**
 * Domain metadata for navigation
 */
const domainDescriptions: Record<DomainName, string> = {
  customers:
    "Customer management - list, get, create, and update customer accounts and information",
  tickets:
    "Ticket management - list, get, create, and update support tickets and workflow",
  assets:
    "Asset management - list and get hardware/software assets and configuration items",
  contacts:
    "Contact management - list, get, create, and update customer contacts and relationships",
  invoices: "Invoice management - list and get billing and invoice information",
};

/**
 * Navigation / discovery tool - helps the LLM find the right tools.
 *
 * This is a stateless helper that describes available tools for a domain.
 * All domain tools are always listed in tools/list regardless of navigation
 * state, because many MCP clients (claude.ai connectors, mcp-remote) only
 * fetch the tool list once and do not support notifications/tools/list_changed.
 */
const navigateTool: Tool = {
  name: "syncro_navigate",
  description:
    "Discover available Syncro tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time — this is a help/discovery aid, not a prerequisite.",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: getAvailableDomains(),
        description: `The domain to explore:
- customers: ${domainDescriptions.customers}
- tickets: ${domainDescriptions.tickets}
- assets: ${domainDescriptions.assets}
- contacts: ${domainDescriptions.contacts}
- invoices: ${domainDescriptions.invoices}`,
      },
    },
    required: ["domain"],
  },
};

/**
 * Status tool - shows credentials status and available domains
 */
const statusTool: Tool = {
  name: "syncro_status",
  description: "Show credentials status and available domains",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

/**
 * Map from domain name to its tool definitions (loaded lazily)
 */
const domainToolMap = new Map<DomainName, Tool[]>();

/**
 * All domain tools, collected once at startup.
 *
 * The tool set is static and credential-independent, but a fresh server is
 * created per request (for credential isolation), so the assembled list is
 * memoized at module scope to avoid rebuilding it on every request.
 */
let allDomainTools: Tool[] | null = null;

/**
 * Load all domain tools (lazy-loaded on first access)
 */
async function getAllDomainTools(): Promise<Tool[]> {
  if (allDomainTools !== null) {
    return allDomainTools;
  }

  const domains = getAvailableDomains();
  const tools: Tool[] = [];

  for (const domain of domains) {
    if (!domainToolMap.has(domain)) {
      const handler = await getDomainHandler(domain);
      const domainTools = handler.getTools();
      domainToolMap.set(domain, domainTools);
    }
    tools.push(...domainToolMap.get(domain)!);
  }

  allDomainTools = tools;
  return tools;
}

/**
 * Build a validated Syncro credentials object from raw values.
 * Returns `{ creds }` on success or `{ error }` when the API key is missing.
 * Shared by every transport (Node HTTP headers, Workers headers, Workers env).
 */
export function buildCredentials(
  apiKey: string | undefined,
  subdomain: string | undefined
): { creds?: RequestCredentials; error?: string } {
  if (!apiKey) {
    return {
      error:
        "Missing credentials: X-Syncro-API-Key (or SYNCRO_API_KEY)",
    };
  }
  return { creds: { apiKey, ...(subdomain ? { subdomain } : {}) } };
}

/**
 * Resolve per-request gateway credentials from a header accessor.
 *
 * Works with any transport: pass a getter that returns a (lowercased) header
 * value. Returns `{ creds }` on success, or `{ error }` when the required
 * header is missing.
 */
export function resolveGatewayCredentials(
  getHeader: (lowerName: string) => string | undefined
): { creds?: RequestCredentials; error?: string } {
  return buildCredentials(
    getHeader("x-syncro-api-key"),
    getHeader("x-syncro-subdomain")
  );
}

/**
 * Create a fresh MCP server instance with all handlers registered.
 * Called once for stdio, or per-request for HTTP / Workers transports.
 *
 * Credentials are resolved at tool-call time via {@link getCredentials},
 * which reads from the per-request AsyncLocalStorage store (gateway mode)
 * or process.env (env / stdio mode). The Workers entrypoint runs each
 * request inside `credentialStore.run()` so isolation holds there too.
 *
 * The returned server is likewise NOT registered as "the" server anywhere
 * here — callers are responsible for binding it into the per-request
 * `server-ref` AsyncLocalStorage context (via `runWithServerRef` /
 * `bindServerRef`) so elicitation helpers resolve the right server even
 * after await gaps. See `utils/server-ref.ts` for why this matters.
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "syncro-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );
  registerResourceHandlers(server);

  /**
   * Handle ListTools requests - always returns ALL tools
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const domainTools = await getAllDomainTools();
    return { tools: [navigateTool, statusTool, ...domainTools] };
  });

  /**
   * Handle CallTool requests
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Handle navigation / discovery helper
      if (name === "syncro_navigate") {
        const { domain } = args as { domain: DomainName };

        if (!isDomainName(domain)) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid domain: ${domain}. Available domains: ${getAvailableDomains().join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        const handler = await getDomainHandler(domain);
        const tools = handler.getTools();

        const toolSummary = tools
          .map((t) => `- ${t.name}: ${t.description}`)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `${domainDescriptions[domain]}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`,
            },
          ],
        };
      }

      if (name === "syncro_status") {
        const creds = getCredentials();
        const credStatus = creds
          ? `Configured${creds.subdomain ? ` (subdomain: ${creds.subdomain})` : ""}`
          : "NOT CONFIGURED - Please set SYNCRO_API_KEY environment variable";

        return {
          content: [
            {
              type: "text",
              text: `Syncro MCP Server Status\n\nCredentials: ${credStatus}\nAvailable domains: ${getAvailableDomains().join(", ")}\nRate limit: 180 requests/minute\n\nAll tools are available at all times. Use syncro_navigate to discover tools by domain.`,
            },
          ],
        };
      }

      // Route to appropriate domain handler
      const toolArgs = (args ?? {}) as Record<string, unknown>;

      if (name.startsWith("syncro_customers_")) {
        const handler = await getDomainHandler("customers");
        return await handler.handleCall(name, toolArgs);
      }
      if (name.startsWith("syncro_tickets_")) {
        const handler = await getDomainHandler("tickets");
        return await handler.handleCall(name, toolArgs);
      }
      if (name.startsWith("syncro_assets_")) {
        const handler = await getDomainHandler("assets");
        return await handler.handleCall(name, toolArgs);
      }
      if (name.startsWith("syncro_contacts_")) {
        const handler = await getDomainHandler("contacts");
        return await handler.handleCall(name, toolArgs);
      }
      if (name.startsWith("syncro_invoices_")) {
        const handler = await getDomainHandler("invoices");
        return await handler.handleCall(name, toolArgs);
      }

      // Unknown tool
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}. Use syncro_navigate to discover available tools by domain.`,
          },
        ],
        isError: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
