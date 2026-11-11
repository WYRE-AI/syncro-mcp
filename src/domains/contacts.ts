/**
 * Contacts domain handler
 *
 * Provides tools for contact operations in Syncro MSP.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { pathId } from "../utils/rest.js";
import { sdkWrite } from "../utils/write-outcome.js";
import {
  ADDITIVE_WRITE,
  READ_ONLY,
} from "../utils/annotations.js";

/**
 * Get contact domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "syncro_contacts_list",
      description:
        "List contacts in Syncro. Can filter by customer ID or search query.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: {
            type: "number",
            description: "Filter contacts by customer ID",
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
      name: "syncro_contacts_get",
      description: "Get details for a specific contact by their ID",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          contact_id: {
            type: "number",
            description: "The contact ID",
          },
        },
        required: ["contact_id"],
      },
    },
    {
      name: "syncro_contacts_create",
      description: "Create a new contact in Syncro",
      annotations: ADDITIVE_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: {
            type: "number",
            description: "Customer ID this contact belongs to (required)",
          },
          name: {
            type: "string",
            description: "Contact name (required)",
          },
          email: {
            type: "string",
            description: "Email address",
          },
          phone: {
            type: "string",
            description: "Phone number",
          },
          mobile: {
            type: "string",
            description: "Mobile phone number",
          },
          address1: {
            type: "string",
            description: "Street address line 1",
          },
          address2: {
            type: "string",
            description: "Street address line 2",
          },
          city: {
            type: "string",
            description: "City",
          },
          state: {
            type: "string",
            description: "State/Province",
          },
          zip: {
            type: "string",
            description: "ZIP/Postal code",
          },
          notes: {
            type: "string",
            description: "Notes about the contact",
          },
        },
        required: ["customer_id", "name"],
      },
    },
  ];
}

/**
 * Handle a contact domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "syncro_contacts_list": {
      const response = await client.contacts.list({
        customer_id: args.customer_id as number | undefined,
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
                contacts: response.contacts,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "syncro_contacts_get": {
      const contactId = pathId(args.contact_id, "contact_id");
      const contact = await client.contacts.get(contactId);

      return {
        content: [{ type: "text", text: JSON.stringify(contact, null, 2) }],
      };
    }

    case "syncro_contacts_create": {
      const contact = await sdkWrite((sdk) =>
        sdk.contacts.create({
          customer_id: args.customer_id as number,
          name: args.name as string,
          email: args.email as string | undefined,
          phone: args.phone as string | undefined,
          mobile: args.mobile as string | undefined,
          address1: args.address1 as string | undefined,
          address2: args.address2 as string | undefined,
          city: args.city as string | undefined,
          state: args.state as string | undefined,
          zip: args.zip as string | undefined,
          notes: args.notes as string | undefined,
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(contact, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown contact tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const contactsHandler: DomainHandler = {
  getTools,
  handleCall,
};
