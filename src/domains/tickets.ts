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

/**
 * Get ticket domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "syncro_tickets_list",
      description:
        "List tickets in Syncro. Can filter by customer, contact, status, user, problem type, or resolved state.",
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
      description: "Create a new ticket in Syncro",
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
            description: "Initial comment/description body",
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
      description: "Add a comment to an existing ticket",
      _meta: TICKET_CARD_META,
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
            description: "Make this a hidden/internal comment",
          },
          do_not_email: {
            type: "boolean",
            description: "Do not send email notification for this comment",
          },
        },
        required: ["ticket_id", "body"],
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
      const ticketId = args.ticket_id as number;
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
      const ticket = await client.tickets.create({
        customer_id: args.customer_id as number,
        subject: args.subject as string,
        problem_type: args.problem_type as string | undefined,
        status: args.status as string | undefined,
        contact_id: args.contact_id as number | undefined,
        user_id: args.user_id as number | undefined,
        due_date: args.due_date as string | undefined,
        comment_body: args.comment_body as string | undefined,
        comment_subject: args.comment_subject as string | undefined,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
      };
    }

    case "syncro_tickets_update": {
      const ticketId = args.ticket_id as number;
      const ticket = await client.tickets.update(ticketId, {
        subject: args.subject as string | undefined,
        problem_type: args.problem_type as string | undefined,
        status: args.status as string | undefined,
        user_id: args.user_id as number | undefined,
        due_date: args.due_date as string | undefined,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
      };
    }

    case "syncro_tickets_add_comment": {
      const ticketId = args.ticket_id as number;
      const ticket = await client.tickets.addComment(ticketId, {
        body: args.body as string,
        subject: args.subject as string | undefined,
        hidden: args.hidden as boolean | undefined,
        do_not_email: args.do_not_email as boolean | undefined,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
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
