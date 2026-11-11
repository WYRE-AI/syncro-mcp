/**
 * Time domain handler
 *
 * Ticket time entries ("ticket timers") for the log_time job and for
 * unbilled-work checks ahead of invoicing. The official Syncro MCP can add,
 * update and charge a timer entry but cannot set whether it is billable or
 * list entries by billing status; these tools fill exactly that gap.
 *
 * Endpoints (https://api-docs.syncromsp.com/swagger.json):
 *   GET   /ticket_timers
 *   POST  /tickets/{id}/timer_entry
 *   PATCH /ticket_timers/{id}
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import {
  booleanArg,
  isoTimestamp,
  pathId,
  positiveInteger,
  syncroRest,
} from "../utils/rest.js";
import { guardWrite } from "../utils/write-guard.js";
import { quote } from "../utils/prompt-text.js";
import {
  READ_ONLY,
  ADDITIVE_WRITE,
  IDEMPOTENT_WRITE,
} from "../utils/annotations.js";

interface TicketTimer {
  id: number;
  ticket_id: number;
  billable?: boolean;
  [key: string]: unknown;
}

interface TicketTimerListResponse {
  ticket_timers: TicketTimer[];
  meta?: {
    total_entries?: number;
    total_pages?: number;
    page?: number;
  };
}

const TIMER_STATUSES = ["running", "paused", "stopped"];
const BILLING_STATUSES = ["non-billable", "unbilled", "billed", "invoiced"];

/**
 * Get time domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "syncro_time_list_entries",
      description:
        "List ticket time entries (ticket timers). Filter by ticket, customer, technician, timer state, or billing status. Use billing_status 'unbilled' to find billable work not yet charged to an invoice (QBR / unbilled-work checks).",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: { type: "number", description: "Only entries on this ticket" },
          customer_id: {
            type: "number",
            description: "Only entries on tickets belonging to this customer",
          },
          user_id: { type: "number", description: "Only entries by this technician" },
          status: {
            type: "string",
            enum: TIMER_STATUSES,
            description: "Timer state",
          },
          billing_status: {
            type: "string",
            enum: BILLING_STATUSES,
            description:
              "Derived billing status: non-billable, unbilled (billable but not charged), billed (charged to a ticket line item), invoiced",
          },
          created_after: {
            type: "string",
            description: "Only entries created after this date (YYYY-MM-DD)",
          },
          created_before: {
            type: "string",
            description: "Only entries created before this date (YYYY-MM-DD)",
          },
          page: { type: "number", description: "Page number (25 results per page)" },
        },
      },
    },
    {
      name: "syncro_time_log_entry",
      description:
        "⚠ HIGH-IMPACT. Log completed work time on a ticket, with an explicit billable flag. Provide start_at plus either end_at or duration_minutes. Not idempotent: a retry logs the time twice. Confirm with the user before invoking.",
      annotations: ADDITIVE_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: { type: "number", description: "Ticket to log time against" },
          start_at: {
            type: "string",
            description:
              "Start of the work window (ISO 8601 date-time with Z or an offset, e.g. 2026-11-07T09:00:00-05:00)",
          },
          end_at: {
            type: "string",
            description:
              "End of the work window (ISO 8601 date-time with Z or an offset). Alternative to duration_minutes",
          },
          duration_minutes: {
            type: "integer",
            description: "Whole minutes worked, greater than 0. Alternative to end_at",
          },
          billable: {
            type: "boolean",
            description:
              "Whether the time is billable. Omit to use the account's default billable setting",
          },
          notes: { type: "string", description: "Work description" },
          product_id: {
            type: "number",
            description: "Labor product ID that sets the rate (optional)",
          },
          user_id: {
            type: "number",
            description: "Technician who did the work (defaults to the API token owner)",
          },
        },
        required: ["ticket_id", "start_at"],
      },
    },
    {
      name: "syncro_time_set_billable",
      description:
        "⚠ HIGH-IMPACT. Mark an existing ticket time entry billable or non-billable. Changes what the customer is charged once the entry is billed. Confirm with the user before invoking.",
      annotations: IDEMPOTENT_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          timer_id: { type: "number", description: "Ticket timer ID" },
          billable: { type: "boolean", description: "New billable value" },
        },
        required: ["timer_id", "billable"],
      },
    },
  ];
}

/** Wrap a value as a successful JSON tool result. */
function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Wrap a message as an error tool result. */
function error(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Handle a time domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case "syncro_time_list_entries": {
      const response = await syncroRest<TicketTimerListResponse>(
        "/ticket_timers",
        {
          params: {
            ticket_id: args.ticket_id as number | undefined,
            customer_id: args.customer_id as number | undefined,
            user_id: args.user_id as number | undefined,
            status: args.status as string | undefined,
            billing_status: args.billing_status as string | undefined,
            created_at_gt: args.created_after as string | undefined,
            created_at_lt: args.created_before as string | undefined,
            page: args.page as number | undefined,
          },
        }
      );

      const entries = response.ticket_timers ?? [];
      if (entries.length === 0) {
        return error("No ticket time entries found for these filters.");
      }

      return json({
        total_entries: response.meta?.total_entries,
        total_pages: response.meta?.total_pages,
        current_page: response.meta?.page,
        time_entries: entries,
      });
    }

    case "syncro_time_log_entry": {
      const ticketId = pathId(args.ticket_id, "ticket_id");
      if (args.end_at === undefined && args.duration_minutes === undefined) {
        return error("Provide either end_at or duration_minutes.");
      }

      // Check every value before the prompt is built or anything is sent.
      const startAt = isoTimestamp(args.start_at, "start_at");
      const endAt =
        args.end_at === undefined ? undefined : isoTimestamp(args.end_at, "end_at");
      const minutes =
        args.duration_minutes === undefined
          ? undefined
          : positiveInteger(args.duration_minutes, "duration_minutes");
      const userId =
        args.user_id === undefined
          ? undefined
          : positiveInteger(args.user_id, "user_id");
      const productId =
        args.product_id === undefined
          ? undefined
          : positiveInteger(args.product_id, "product_id");
      const billable =
        args.billable === undefined
          ? undefined
          : booleanArg(args.billable, "billable");
      const span =
        `starting ${startAt}` +
        (endAt ? `, ending ${endAt}` : "") +
        (minutes !== undefined ? `, ${minutes} minutes` : "");
      const billing =
        billable === undefined
          ? "account default billing"
          : billable
            ? "billable"
            : "non-billable";
      const technician =
        userId === undefined ? "the API token owner" : `user ${userId}`;
      const product = productId === undefined ? "none" : productId;
      const notes = args.notes === undefined ? "none" : quote(args.notes);
      const blocked = await guardWrite(
        `Log time (${span}; ${billing}) on Syncro ticket ${ticketId} for ${technician}, labor product: ${product}, notes: ${notes}?`
      );
      if (blocked) return blocked;

      const entry = await syncroRest<TicketTimer>(
        `/tickets/${ticketId}/timer_entry`,
        {
          method: "POST",
          body: {
            start_at: startAt,
            end_at: endAt,
            duration_minutes: minutes,
            notes: args.notes,
            product_id: productId,
            user_id: userId,
          },
        }
      );

      if (billable === undefined || entry.billable === billable) {
        return json({ time_entry: entry });
      }

      // The create endpoint has no billable field, so the flag is applied
      // with a second call. If that call fails the entry already exists:
      // report it instead of failing, because a retry would log it twice.
      try {
        const updated = await syncroRest<{ ticket_timer: TicketTimer }>(
          `/ticket_timers/${pathId(entry.id, "the new time entry's id")}`,
          { method: "PATCH", body: { billable } }
        );
        return json({ time_entry: updated.ticket_timer ?? entry });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  time_entry: entry,
                  warning: `Time was logged (timer ${entry.id}) but setting billable=${billable} failed: ${reason}. Retry with syncro_time_set_billable, not syncro_time_log_entry.`,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }

    case "syncro_time_set_billable": {
      const timerId = pathId(args.timer_id, "timer_id");
      const billable = booleanArg(args.billable, "billable");
      const blocked = await guardWrite(
        `Mark Syncro time entry ${timerId} as ${billable ? "billable" : "non-billable"}?`
      );
      if (blocked) return blocked;

      const updated = await syncroRest<{ ticket_timer: TicketTimer }>(
        `/ticket_timers/${timerId}`,
        { method: "PATCH", body: { billable } }
      );
      return json({ time_entry: updated.ticket_timer });
    }

    default:
      return error(`Unknown time tool: ${toolName}`);
  }
}

export const timeHandler: DomainHandler = {
  getTools,
  handleCall,
};
