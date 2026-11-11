/**
 * Invoices domain handler
 *
 * Provides tools for invoice operations in Syncro MSP.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { guardWrite } from "../utils/write-guard.js";
import { clip } from "../utils/prompt-text.js";
import {
  ADDITIVE_WRITE,
  DESTRUCTIVE,
  READ_ONLY,
} from "../utils/annotations.js";

/**
 * Get invoice domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "syncro_invoices_list",
      description:
        "List invoices in Syncro. Can filter by customer, status, or date range.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: {
            type: "number",
            description: "Filter invoices by customer ID",
          },
          status: {
            type: "string",
            enum: ["draft", "sent", "viewed", "partial", "paid", "void"],
            description: "Filter invoices by status",
          },
          since_date: {
            type: "string",
            description: "Filter invoices since this date (ISO 8601 format)",
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
      name: "syncro_invoices_get",
      description:
        "Get details for a specific invoice by its ID, including line items",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          invoice_id: {
            type: "number",
            description: "The invoice ID",
          },
        },
        required: ["invoice_id"],
      },
    },
    {
      name: "syncro_invoices_create",
      description: "Create a new invoice in Syncro",
      annotations: ADDITIVE_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: {
            type: "number",
            description: "Customer ID (required)",
          },
          date: {
            type: "string",
            description: "Invoice date (ISO 8601 format, defaults to today)",
          },
          due_date: {
            type: "string",
            description: "Due date (ISO 8601 format)",
          },
          notes: {
            type: "string",
            description: "Invoice notes",
          },
        },
        required: ["customer_id"],
      },
    },
    {
      name: "syncro_invoices_email",
      description:
        "⚠ HIGH-IMPACT. Email an invoice to the customer. Sending cannot be undone. Confirm with the user before invoking.",
      annotations: DESTRUCTIVE,
      inputSchema: {
        type: "object" as const,
        properties: {
          invoice_id: {
            type: "number",
            description: "The invoice ID to email (required)",
          },
          cc_emails: {
            type: "string",
            description: "CC email addresses (comma-separated)",
          },
          subject: {
            type: "string",
            description: "Custom email subject",
          },
          message: {
            type: "string",
            description: "Custom email message body",
          },
          confirm: {
            type: "boolean",
            description:
              "Set true only after the user approved sending this email. Required when the client cannot show a confirmation prompt (always the case over HTTP)",
          },
        },
        required: ["invoice_id"],
      },
    },
  ];
}

/**
 * Handle an invoice domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "syncro_invoices_list": {
      const response = await client.invoices.list({
        customer_id: args.customer_id as number | undefined,
        status: args.status as
          | "draft"
          | "sent"
          | "viewed"
          | "partial"
          | "paid"
          | "void"
          | undefined,
        since_date: args.since_date as string | undefined,
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
                invoices: response.invoices,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "syncro_invoices_get": {
      const invoiceId = args.invoice_id as number;
      const invoice = await client.invoices.get(invoiceId);

      return {
        content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }],
      };
    }

    case "syncro_invoices_create": {
      const invoice = await client.invoices.create({
        customer_id: args.customer_id as number,
        date: args.date as string | undefined,
        due_date: args.due_date as string | undefined,
        notes: args.notes as string | undefined,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }],
      };
    }

    case "syncro_invoices_email": {
      const invoiceId = args.invoice_id as number;
      const cc = args.cc_emails ? `, cc ${clip(args.cc_emails)}` : "";
      const subject = args.subject ? `, subject "${clip(args.subject)}"` : "";
      const blocked = await guardWrite(
        `Email Syncro invoice ${invoiceId} to the customer${cc}${subject}? Sending cannot be undone.`,
        { destructive: true, args }
      );
      if (blocked) return blocked;

      await client.invoices.email(invoiceId, {
        cc_emails: args.cc_emails as string | undefined,
        subject: args.subject as string | undefined,
        message: args.message as string | undefined,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: `Invoice ${invoiceId} has been emailed to the customer`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown invoice tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const invoicesHandler: DomainHandler = {
  getTools,
  handleCall,
};
