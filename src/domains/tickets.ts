/**
 * Tickets domain handler
 *
 * Provides tools for ticket operations in Syncro MSP.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { elicitSelection } from "../utils/elicitation.js";
import { buildTicketCard, TICKET_CARD_META } from "../card.builder.js";
import {
  booleanArg,
  finiteNumber,
  pathId,
  positiveInteger,
  positiveNumber,
  syncroRest,
} from "../utils/rest.js";
import { guardWrite } from "../utils/write-guard.js";
import { sdkWrite } from "../utils/write-outcome.js";
import { MAX_LONG_TEXT_PROMPT, quoteInFull } from "../utils/prompt-text.js";
import {
  READ_ONLY,
  ADDITIVE_WRITE,
  IDEMPOTENT_WRITE,
} from "../utils/annotations.js";

/**
 * Get ticket domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "syncro_tickets_list",
      description:
        "List tickets in Syncro. Can filter by customer, contact, status, user, problem type, or resolved state.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: {
            type: "number",
            description: "Filter tickets by customer ID",
          },
          contact_id: {
            type: "number",
            description: "Filter tickets by contact ID",
          },
          status: {
            type: "string",
            description: "Filter tickets by status",
          },
          user_id: {
            type: "number",
            description: "Filter tickets by assigned user ID",
          },
          problem_type: {
            type: "string",
            description: "Filter tickets by problem type",
          },
          resolved: {
            type: "boolean",
            description: "Filter by resolved status",
          },
          query: {
            type: "string",
            description: "Search query string",
          },
          since: {
            type: "string",
            description:
              "Filter tickets created/updated since date (ISO 8601 format)",
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
      name: "syncro_tickets_get",
      description:
        "Get details for a specific ticket by its ID, including comments",
      _meta: TICKET_CARD_META,
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: {
            type: "number",
            description: "The ticket ID",
          },
        },
        required: ["ticket_id"],
      },
    },
    {
      name: "syncro_tickets_create",
      description:
        "Create a new ticket in Syncro. comment_body creates an initial comment that may be visible to the customer, and Syncro may email it to them. This tool cannot mark that comment hidden. If the user did not ask to contact the customer, leave comment_body out and add an internal note afterwards with syncro_tickets_add_comment and hidden: true.",
      annotations: ADDITIVE_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: {
            type: "number",
            description: "Customer ID (required)",
          },
          subject: {
            type: "string",
            description: "Ticket subject/title (required)",
          },
          problem_type: {
            type: "string",
            description: "Problem type category",
          },
          status: {
            type: "string",
            description: "Ticket status",
          },
          contact_id: {
            type: "number",
            description: "Contact ID",
          },
          user_id: {
            type: "number",
            description: "Assigned user/technician ID",
          },
          due_date: {
            type: "string",
            description: "Due date (ISO 8601 format)",
          },
          comment_body: {
            type: "string",
            description:
              "Initial comment/description body. May be visible to the customer and emailed to them; this tool cannot make it hidden",
          },
          comment_subject: {
            type: "string",
            description: "Initial comment subject",
          },
        },
        required: ["customer_id", "subject"],
      },
    },
    {
      name: "syncro_tickets_update",
      description: "Update an existing ticket in Syncro",
      annotations: IDEMPOTENT_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: {
            type: "number",
            description: "The ticket ID to update (required)",
          },
          subject: {
            type: "string",
            description: "New ticket subject",
          },
          problem_type: {
            type: "string",
            description: "New problem type",
          },
          status: {
            type: "string",
            description: "New status",
          },
          user_id: {
            type: "number",
            description: "New assigned user ID",
          },
          due_date: {
            type: "string",
            description: "New due date (ISO 8601 format)",
          },
        },
        required: ["ticket_id"],
      },
    },
    {
      name: "syncro_tickets_add_comment",
      description:
        "Add a comment to an existing ticket. Unless hidden is true, the comment is public: the customer can see it and Syncro emails it to them. Set hidden: true for an internal note the customer does not see. Set do_not_email: true to stop the notification email; a public comment with do_not_email: true is still visible to the customer. This tool does not set either flag for you. If the user did not ask to contact the customer, use hidden: true.",
      _meta: TICKET_CARD_META,
      annotations: ADDITIVE_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: {
            type: "number",
            description: "The ticket ID to add the comment to (required)",
          },
          body: {
            type: "string",
            description: "The comment body text (required)",
          },
          subject: {
            type: "string",
            description: "Comment subject line",
          },
          hidden: {
            type: "boolean",
            description:
              "Make this an internal comment that the customer does not see. If not true, the comment is public and is emailed to the customer",
          },
          do_not_email: {
            type: "boolean",
            description:
              "Do not send the notification email for this comment. A public comment is still visible to the customer",
          },
        },
        required: ["ticket_id", "body"],
      },
    },
    {
      name: "syncro_tickets_add_line_item",
      description:
        "⚠ HIGH-IMPACT. Add a billable line item (labor, part, or fee) to a ticket so it is carried onto the ticket's invoice. Use product_id for a catalog item, or name + price_retail for a manual charge. Not idempotent: a retry adds the charge twice. Confirm with the user before invoking.",
      annotations: ADDITIVE_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: { type: "number", description: "The ticket ID (required)" },
          name: {
            type: "string",
            description:
              "Line item name (required), shown in the confirmation prompt exactly as sent. Up to 200 characters. Refused, with no prompt and no request, if it contains a control or invisible character (newline, carriage return and tab are allowed) or a space other than the plain space (such as a non-breaking space)",
          },
          description: {
            type: "string",
            description:
              "Line item description (required by Syncro), shown in the confirmation prompt exactly as sent. Up to 1000 characters. Refused, with no prompt and no request, if it contains a control or invisible character (newline, carriage return and tab are allowed) or a space other than the plain space (such as a non-breaking space)",
          },
          quantity: { type: "number", description: "Quantity, greater than 0 (default: 1)" },
          price_retail: { type: "number", description: "Unit price charged to the customer" },
          price_cost: { type: "number", description: "Unit cost" },
          product_id: { type: "integer", description: "Catalog product ID" },
          taxable: { type: "boolean", description: "Whether the line is taxable" },
        },
        required: ["ticket_id", "name", "description"],
      },
    },
  ];
}

/**
 * Handle a ticket domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "syncro_tickets_list": {
      let since = args.since as string | undefined;

      // If no filters provided, elicit a date range from the user
      const hasFilters =
        args.customer_id || args.contact_id || args.status || args.user_id ||
        args.problem_type || args.resolved !== undefined || args.query || args.since;

      if (!hasFilters) {
        const selection = await elicitSelection(
          "No filters provided. Would you like to narrow the ticket list by date range?",
          "date_range",
          [
            { value: "today", label: "Today" },
            { value: "past_week", label: "Past week" },
            { value: "past_month", label: "Past month" },
            { value: "all", label: "All tickets (no date filter)" },
          ]
        );

        if (selection && selection !== "all") {
          const now = new Date();
          if (selection === "today") {
            now.setHours(0, 0, 0, 0);
          } else if (selection === "past_week") {
            now.setDate(now.getDate() - 7);
          } else if (selection === "past_month") {
            now.setMonth(now.getMonth() - 1);
          }
          since = now.toISOString();
        }
      }

      const response = await client.tickets.list({
        customer_id: args.customer_id as number | undefined,
        contact_id: args.contact_id as number | undefined,
        status: args.status as string | undefined,
        user_id: args.user_id as number | undefined,
        problem_type: args.problem_type as string | undefined,
        resolved: args.resolved as boolean | undefined,
        query: args.query as string | undefined,
        since,
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
                tickets: response.tickets,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "syncro_tickets_get": {
      const ticketId = pathId(args.ticket_id, "ticket_id");
      const ticket = await client.tickets.get(ticketId);

      // MCP Apps: attach the normalized card payload the ui:// ticket card
      // renders from. Best-effort — any failure just means no UI surface,
      // never a failed tool result.
      const payload: Record<string, unknown> = { ...ticket };
      try {
        const card = await buildTicketCard(payload, client);
        if (card) payload._card = card;
      } catch {
        /* card is progressive enhancement — serve the plain JSON */
      }

      const summary = `Ticket #${ticket.number ?? ticket.id} (${
        ticket.status ?? "unknown status"
      }): ${ticket.subject ?? "no subject"}`;

      return {
        content: [{ type: "text", text: summary }],
        structuredContent: payload,
      };
    }

    case "syncro_tickets_create": {
      const ticket = await sdkWrite((sdk) =>
        sdk.tickets.create({
          customer_id: args.customer_id as number,
          subject: args.subject as string,
          problem_type: args.problem_type as string | undefined,
          status: args.status as string | undefined,
          contact_id: args.contact_id as number | undefined,
          user_id: args.user_id as number | undefined,
          due_date: args.due_date as string | undefined,
          comment_body: args.comment_body as string | undefined,
          comment_subject: args.comment_subject as string | undefined,
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
      };
    }

    case "syncro_tickets_update": {
      const ticketId = pathId(args.ticket_id, "ticket_id");
      const ticket = await sdkWrite((sdk) =>
        sdk.tickets.update(ticketId, {
          subject: args.subject as string | undefined,
          problem_type: args.problem_type as string | undefined,
          status: args.status as string | undefined,
          user_id: args.user_id as number | undefined,
          due_date: args.due_date as string | undefined,
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
      };
    }

    case "syncro_tickets_add_comment": {
      const ticketId = pathId(args.ticket_id, "ticket_id");
      const ticket = await sdkWrite((sdk) =>
        sdk.tickets.addComment(ticketId, {
          body: args.body as string,
          subject: args.subject as string | undefined,
          hidden: args.hidden as boolean | undefined,
          do_not_email: args.do_not_email as boolean | undefined,
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
      };
    }

    case "syncro_tickets_add_line_item": {
      const ticketId = pathId(args.ticket_id, "ticket_id");
      const quantity =
        args.quantity === undefined ? 1 : positiveNumber(args.quantity, "quantity");
      const priceRetail =
        args.price_retail === undefined
          ? undefined
          : finiteNumber(args.price_retail, "price_retail");
      const priceCost =
        args.price_cost === undefined
          ? undefined
          : finiteNumber(args.price_cost, "price_cost");
      const productId =
        args.product_id === undefined
          ? undefined
          : positiveInteger(args.product_id, "product_id");
      const taxable =
        args.taxable === undefined ? undefined : booleanArg(args.taxable, "taxable");
      // Every field that is sent below is shown here, and name and
      // description in full (or the call is refused).
      const name =
        args.name === undefined
          ? "an item with no name"
          : quoteInFull(args.name, "name");
      const description =
        args.description === undefined
          ? "not set"
          : quoteInFull(args.description, "description", MAX_LONG_TEXT_PROMPT);
      const details = [
        `unit price ${priceRetail ?? "not set"}`,
        `unit cost ${priceCost ?? "not set"}`,
        `catalog product ${productId ?? "none"}`,
        `taxable ${taxable ?? "not set"}`,
        `description ${description}`,
      ].join(", ");
      const blocked = await guardWrite(
        `Add ${quantity} x ${name} (${details}) to Syncro ticket ${ticketId}?`
      );
      if (blocked) return blocked;

      const lineItem = await syncroRest<Record<string, unknown>>(
        `/tickets/${ticketId}/add_line_item`,
        {
          method: "POST",
          body: {
            name: args.name,
            description: args.description,
            quantity,
            price_retail: priceRetail,
            price_cost: priceCost,
            product_id: productId,
            taxable,
          },
        }
      );

      return {
        content: [{ type: "text", text: JSON.stringify(lineItem, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown ticket tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const ticketsHandler: DomainHandler = {
  getTools,
  handleCall,
};
