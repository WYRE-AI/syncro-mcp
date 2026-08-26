/**
 * Ticket-card payload builder for the MCP Apps (SEP-1865) UI surface.
 *
 * syncro_tickets_get results get a normalized `_card` object attached
 * (see domains/tickets.ts) that the ui:// ticket card renders from. The card
 * is progressive enhancement: every step here is best-effort, and a null
 * return simply means the host renders no card while the JSON payload is
 * unchanged.
 */

import type { SyncroClient } from "@wyre-ai/node-syncro";

export const TICKET_CARD_RESOURCE_URI = "ui://syncro/ticket-card.html";

/** MCP Apps resource MIME (RESOURCE_MIME_TYPE in @modelcontextprotocol/ext-apps). */
export const MCP_APP_RESOURCE_MIME = "text/html;profile=mcp-app";

/**
 * Tool `_meta` advertising the card. Carries both the canonical flat key
 * (RESOURCE_URI_META_KEY in ext-apps) and the nested form ext-apps'
 * registerAppTool emits, so any MCP Apps host revision finds it.
 */
export const TICKET_CARD_META = {
  "ui/resourceUri": TICKET_CARD_RESOURCE_URI,
  ui: { resourceUri: TICKET_CARD_RESOURCE_URI },
} as const;

/** Mirror of Brand in ui/ticket-card.ts — keep in sync. */
export interface CardBrand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}

/** The BRAND_INJECT comment marker baked into the card HTML (see ui/index.html). */
const BRAND_INJECT_RE = /<!--\s*BRAND_INJECT:[\s\S]*?-->/;

/**
 * Serve-time brand injection: replace the BRAND_INJECT marker with an inline
 * `window.__BRAND__` script so self-hosters can theme the card without
 * rebuilding the bundle. An empty brand returns the HTML unchanged (the card
 * renders its neutral defaults). `<` is escaped so brand values can never
 * break out of the script tag.
 */
export function applyBrandInjection(html: string, brand: CardBrand): string {
  if (!brand || Object.values(brand).every((v) => !v)) return html;
  const json = JSON.stringify(brand).replace(/</g, "\\u003c");
  return html.replace(BRAND_INJECT_RE, `<script>window.__BRAND__=${json}</script>`);
}

/**
 * Resolve brand overrides from MCP_BRAND_* environment variables. Guarded for
 * runtimes without `process` (Cloudflare Workers), where this returns an empty
 * brand and the card serves its neutral defaults.
 */
export function resolveBrandFromEnv(): CardBrand {
  if (typeof process === "undefined" || !process.env) return {};
  const env = process.env;
  const brand: CardBrand = {};
  if (env.MCP_BRAND_NAME) brand.name = env.MCP_BRAND_NAME;
  if (env.MCP_BRAND_LOGO_URL) brand.logoUrl = env.MCP_BRAND_LOGO_URL;
  if (env.MCP_BRAND_PRIMARY_COLOR) brand.primaryColor = env.MCP_BRAND_PRIMARY_COLOR;
  if (env.MCP_BRAND_ACCENT_COLOR) brand.accentColor = env.MCP_BRAND_ACCENT_COLOR;
  if (env.MCP_BRAND_BG) brand.bg = env.MCP_BRAND_BG;
  if (env.MCP_BRAND_TEXT) brand.text = env.MCP_BRAND_TEXT;
  return brand;
}

/** Mirror of TicketCard in ui/ticket-card.ts — keep in sync. */
export interface TicketCard {
  id: number;
  number?: string;
  subject: string;
  status?: string;
  problemType?: string;
  customer?: string;
  contact?: string;
  createdAt?: string;
  dueDate?: string;
  comments: Array<{ who?: string; subject?: string; body: string; hidden?: boolean }>;
  commentDefaults?: { hidden: boolean };
}

const CARD_COMMENT_LIMIT = 5;
const CARD_COMMENT_MAX_LENGTH = 500;

/**
 * Build the renderable card from a syncro_tickets_get payload. Syncro tickets
 * carry resolved status/problem_type strings and embedded comments; only the
 * customer/contact names need lookups (via the same client.customers.get /
 * client.contacts.get the customers/contacts domains already use), each
 * best-effort with a `#id` fallback.
 */
export async function buildTicketCard(
  ticket: Record<string, unknown>,
  client: Pick<SyncroClient, "customers" | "contacts">
): Promise<TicketCard | null> {
  if (typeof ticket?.id !== "number" || typeof ticket.subject !== "string" || !ticket.subject) {
    return null;
  }

  const card: TicketCard = {
    id: ticket.id,
    subject: ticket.subject,
    comments: [],
    // Syncro's client-portal visibility control on a comment is the universal
    // `hidden` boolean (not a tenant-specific enum), so an internal-only
    // default is always safe. The card never guesses visibility itself.
    commentDefaults: { hidden: true },
  };

  if (ticket.number != null) card.number = String(ticket.number);
  if (typeof ticket.status === "string" && ticket.status) card.status = ticket.status;
  if (typeof ticket.problem_type === "string" && ticket.problem_type) {
    card.problemType = ticket.problem_type;
  }
  if (ticket.created_at) card.createdAt = String(ticket.created_at);
  if (ticket.due_date) card.dueDate = String(ticket.due_date);

  // Resolve customer/contact names best-effort; fall back to `#id` labels.
  if (typeof ticket.customer_id === "number") {
    try {
      const customer = await client.customers.get(ticket.customer_id);
      card.customer =
        customer.business_and_full_name ||
        customer.business_name ||
        `#${ticket.customer_id}`;
    } catch {
      card.customer = `#${ticket.customer_id}`;
    }
  }
  if (typeof ticket.contact_id === "number") {
    try {
      const contact = await client.contacts.get(ticket.contact_id);
      card.contact = contact.name || `#${ticket.contact_id}`;
    } catch {
      card.contact = `#${ticket.contact_id}`;
    }
  }

  // Recent comments give the card (and its add-comment round-trip) visible
  // context. Sorted chronologically so the newest comments come last,
  // whichever order the API returned them in.
  if (Array.isArray(ticket.comments)) {
    card.comments = (ticket.comments as Array<Record<string, unknown>>)
      .filter((c) => c && typeof c.body === "string" && c.body)
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
      .slice(-CARD_COMMENT_LIMIT)
      .map((c) => {
        const comment: TicketCard["comments"][number] = {
          body: String(c.body).slice(0, CARD_COMMENT_MAX_LENGTH),
        };
        if (typeof c.tech === "string" && c.tech) comment.who = c.tech;
        if (typeof c.subject === "string" && c.subject) comment.subject = c.subject;
        if (c.hidden === true) comment.hidden = true;
        return comment;
      });
  }

  return card;
}
