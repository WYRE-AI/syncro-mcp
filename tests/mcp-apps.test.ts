/**
 * MCP Apps (SEP-1865) contract tests — mirrors the checks an MCP Apps host
 * performs to render the ticket card:
 *   1. renderable tools advertise the UI resource via _meta
 *   2. the ui:// resource lists and reads back as profile=mcp-app HTML
 *   3. buildTicketCard normalizes a Syncro ticket into the card payload
 *      the iframe renders from, with a safe internal-only comment default
 */

import { describe, it, expect, vi } from "vitest";
import {
  getAvailableDomains,
  getDomainHandler,
} from "../src/domains/index.js";
import { listResources, readResource } from "../src/resources.js";
import {
  buildTicketCard,
  applyBrandInjection,
  TICKET_CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
} from "../src/card.builder.js";
import { TICKET_CARD_HTML } from "../src/generated/ticket-card-html.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const RENDERABLE_TOOLS = ["syncro_tickets_get", "syncro_tickets_add_comment"];

async function getAllTools(): Promise<Tool[]> {
  const tools: Tool[] = [];
  for (const domain of getAvailableDomains()) {
    const handler = await getDomainHandler(domain);
    tools.push(...handler.getTools());
  }
  return tools;
}

describe("MCP Apps ticket card", () => {
  describe("tool _meta advertisement", () => {
    it.each(RENDERABLE_TOOLS)("%s links the card via _meta", async (name) => {
      const tool = (await getAllTools()).find((t) => t.name === name);
      expect(tool).toBeDefined();
      // Canonical flat key (ext-apps RESOURCE_URI_META_KEY) …
      expect(tool?._meta?.["ui/resourceUri"]).toBe(TICKET_CARD_RESOURCE_URI);
      // … and the nested form registerAppTool also emits.
      expect((tool?._meta?.ui as { resourceUri?: string })?.resourceUri).toBe(
        TICKET_CARD_RESOURCE_URI
      );
    });

    it("no other tools carry UI metadata", async () => {
      const others = (await getAllTools()).filter(
        (t) => t._meta && !RENDERABLE_TOOLS.includes(t.name)
      );
      expect(others).toEqual([]);
    });
  });

  describe("ui:// resource", () => {
    it("is listed with the MCP Apps MIME type", () => {
      const card = listResources().find(
        (r) => r.uri === TICKET_CARD_RESOURCE_URI
      );
      expect(card?.mimeType).toBe(MCP_APP_RESOURCE_MIME);
    });

    it("reads back as profile=mcp-app HTML containing the card app", () => {
      const content = readResource(TICKET_CARD_RESOURCE_URI);
      expect(content.mimeType).toBe(MCP_APP_RESOURCE_MIME);
      // No MCP_BRAND_* env set → the embedded HTML is served byte-identical.
      expect(content.text).toBe(TICKET_CARD_HTML);
      expect(content.text).toContain("card__bar");
      expect(content.text).toContain("BRAND_INJECT");
      // The vite build must have inlined the bridge script — a bare <script src>
      // would be unloadable from a resources/read HTML string.
      expect(content.text).not.toContain('src="./ticket-card.ts"');
    });

    it("serves neutral defaults with no vendor identity", () => {
      const { text } = readResource(TICKET_CARD_RESOURCE_URI);
      expect(text).not.toMatch(/WYRE/i);
      expect(text).not.toContain("00c9db"); // WYRE cyan
      expect(text).not.toContain("ede947"); // WYRE yellow
      expect(text).not.toContain("fonts.googleapis.com"); // no external fetches
    });

    it("injects MCP_BRAND_* env vars into the served HTML", () => {
      vi.stubEnv("MCP_BRAND_NAME", "Acme MSP");
      vi.stubEnv("MCP_BRAND_PRIMARY_COLOR", "#ff0000");
      try {
        const { text } = readResource(TICKET_CARD_RESOURCE_URI);
        expect(text).toContain(
          '<script>window.__BRAND__={"name":"Acme MSP","primaryColor":"#ff0000"}</script>'
        );
        expect(text).not.toContain("BRAND_INJECT");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("rejects unknown resource URIs", () => {
      expect(() => readResource("ui://syncro/nope.html")).toThrow(
        /Unknown resource/
      );
    });
  });

  describe("applyBrandInjection", () => {
    const html = TICKET_CARD_HTML;

    it("replaces the marker with an inline window.__BRAND__ script", () => {
      const out = applyBrandInjection(html, {
        name: "Acme",
        primaryColor: "#123456",
      });
      expect(out).toContain(
        'window.__BRAND__={"name":"Acme","primaryColor":"#123456"}'
      );
      expect(out).not.toContain("BRAND_INJECT");
    });

    it("escapes < so brand values cannot break out of the script tag", () => {
      const out = applyBrandInjection(html, {
        name: "</script><script>alert(1)",
      });
      expect(out).not.toContain("</script><script>alert(1)");
      expect(out).toContain("\\u003c/script>\\u003cscript>alert(1)");
    });

    it("returns the HTML unchanged for an empty brand", () => {
      expect(applyBrandInjection(html, {})).toBe(html);
      expect(applyBrandInjection(html, { name: "" })).toBe(html);
    });
  });

  describe("buildTicketCard", () => {
    const ticket = {
      id: 4821,
      number: "5310",
      subject: "VPN outage — main office",
      status: "New",
      problem_type: "Network",
      customer_id: 12,
      contact_id: 34,
      created_at: "2026-07-17T09:00:00Z",
      due_date: "2026-07-18T17:00:00Z",
      comments: [
        {
          id: 1,
          subject: "Update",
          body: "Assigned to network team",
          tech: "Dana Ruiz",
          hidden: true,
          created_at: "2026-07-17T09:30:00Z",
        },
      ],
    };

    const client = {
      customers: {
        get: vi.fn(async () => ({
          id: 12,
          business_name: "Acme Corp",
          business_and_full_name: "Acme Corp",
        })),
      },
      contacts: {
        get: vi.fn(async () => ({ id: 34, name: "Pat Lee" })),
      },
    };

    it("normalizes labels, names, and comments into the card payload", async () => {
      const card = await buildTicketCard(ticket, client as never);
      expect(card).toMatchObject({
        id: 4821,
        number: "5310",
        subject: "VPN outage — main office",
        status: "New",
        problemType: "Network",
        customer: "Acme Corp",
        contact: "Pat Lee",
        createdAt: "2026-07-17T09:00:00Z",
        dueDate: "2026-07-18T17:00:00Z",
        comments: [
          {
            who: "Dana Ruiz",
            subject: "Update",
            body: "Assigned to network team",
            hidden: true,
          },
        ],
      });
    });

    it("defaults the add-comment round-trip to internal-only visibility", async () => {
      const card = await buildTicketCard(ticket, client as never);
      expect(card?.commentDefaults).toEqual({ hidden: true });
    });

    it("falls back to #id labels when lookups fail (card is best-effort)", async () => {
      const failing = {
        customers: {
          get: vi.fn(async () => {
            throw new Error("Syncro 500");
          }),
        },
        contacts: {
          get: vi.fn(async () => {
            throw new Error("Syncro 500");
          }),
        },
      };
      const card = await buildTicketCard(ticket, failing as never);
      expect(card?.customer).toBe("#12");
      expect(card?.contact).toBe("#34");
      expect(card?.status).toBe("New");
    });

    it("keeps only the most recent comments and truncates long bodies", async () => {
      const many = {
        ...ticket,
        comments: Array.from({ length: 7 }, (_, i) => ({
          id: i + 1,
          body: i === 6 ? "x".repeat(600) : `Comment ${i + 1}`,
          created_at: `2026-07-1${i}T09:00:00Z`,
        })),
      };
      const card = await buildTicketCard(many, client as never);
      expect(card?.comments).toHaveLength(5);
      // Chronological order — the newest comment comes last, truncated.
      expect(card?.comments[0].body).toBe("Comment 3");
      expect(card?.comments[4].body).toHaveLength(500);
    });

    it("returns null for payloads that are not a ticket", async () => {
      expect(await buildTicketCard({ id: 1 }, client as never)).toBeNull();
      expect(
        await buildTicketCard({ subject: "no id" }, client as never)
      ).toBeNull();
    });

    it("omits optional fields the API did not send", async () => {
      const bare = { id: 1, subject: "Printer down" };
      const card = await buildTicketCard(bare, client as never);
      expect(card).toMatchObject({ id: 1, subject: "Printer down", comments: [] });
      expect(card?.customer).toBeUndefined();
      expect(card?.contact).toBeUndefined();
      expect(card?.status).toBeUndefined();
    });
  });

  describe("content/structuredContent split (SEP-1865)", () => {
    it("syncro_tickets_get returns a plain-text summary in content and the JSON payload in structuredContent", async () => {
      const { ticketsHandler } = await import("../src/domains/tickets.js");
      const clientModule = await import("../src/utils/client.js");
      vi.spyOn(clientModule, "getClient").mockResolvedValue({
        tickets: {
          get: vi.fn(async () => ({
            id: 456,
            number: "789",
            subject: "Help needed",
            status: "New",
          })),
        },
      } as never);

      const result = await ticketsHandler.handleCall("syncro_tickets_get", {
        ticket_id: 456,
      });

      const text = (result.content[0] as { text: string }).text;
      // content is a human-readable summary, not a JSON dump.
      expect(() => JSON.parse(text)).toThrow();
      expect(text).toContain("789");
      expect(text).toContain("Help needed");

      const structured = result.structuredContent as {
        id: number;
        subject: string;
      };
      expect(structured.id).toBe(456);
      expect(structured.subject).toBe("Help needed");
    });
  });

  describe("server capability declaration (SEP-1865)", () => {
    it("declares io.modelcontextprotocol/ui in the server capabilities", async () => {
      const { createMcpServer } = await import("../src/mcp-server.js");
      const server = createMcpServer();
      const caps = (
        server as unknown as {
          _capabilities: {
            extensions?: Record<string, { mimeTypes?: string[] }>;
          };
        }
      )._capabilities;
      expect(caps.extensions?.["io.modelcontextprotocol/ui"]).toBeDefined();
      expect(
        caps.extensions?.["io.modelcontextprotocol/ui"]?.mimeTypes
      ).toContain(MCP_APP_RESOURCE_MIME);
    });
  });
});
