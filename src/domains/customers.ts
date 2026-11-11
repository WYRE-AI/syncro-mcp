/**
 * Customers domain handler
 *
 * Provides tools for customer operations in Syncro MSP.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { sdkWrite } from "../utils/write-outcome.js";
import {
  ADDITIVE_WRITE,
  READ_ONLY,
} from "../utils/annotations.js";
import { elicitText } from "../utils/elicitation.js";

/**
 * Get customer domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "syncro_customers_list",
      description:
        "List customers in Syncro. Can filter by query, email, phone, or include disabled customers.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Search query (matches business name, contact name, etc.)",
          },
          business_name: {
            type: "string",
            description: "Filter by business name",
          },
          email: {
            type: "string",
            description: "Filter by email address",
          },
          phone: {
            type: "string",
            description: "Filter by phone number",
          },
          include_disabled: {
            type: "boolean",
            description: "Include disabled customers in results",
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
      name: "syncro_customers_get",
      description: "Get details for a specific customer by their ID",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          customer_id: {
            type: "number",
            description: "The customer ID",
          },
        },
        required: ["customer_id"],
      },
    },
    {
      name: "syncro_customers_create",
      description: "Create a new customer in Syncro",
      annotations: ADDITIVE_WRITE,
      inputSchema: {
        type: "object" as const,
        properties: {
          business_name: {
            type: "string",
            description: "Business/company name",
          },
          firstname: {
            type: "string",
            description: "Primary contact first name",
          },
          lastname: {
            type: "string",
            description: "Primary contact last name",
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
          address: {
            type: "string",
            description: "Street address",
          },
          address_2: {
            type: "string",
            description: "Address line 2",
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
            description: "Notes about the customer",
          },
        },
      },
    },
    {
      name: "syncro_customers_search",
      description:
        "Search for customers using a query string. Matches against business name, contact name, email, and other fields.",
      annotations: READ_ONLY,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query string",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 25)",
          },
        },
        required: ["query"],
      },
    },
  ];
}

/**
 * Handle a customer domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "syncro_customers_list": {
      let query = args.query as string | undefined;

      // If no filters provided, elicit a search term from the user
      const hasFilters =
        args.query || args.business_name || args.email || args.phone;

      if (!hasFilters) {
        const searchTerm = await elicitText(
          "No search filters provided. Would you like to search for a specific customer?",
          "search",
          "Enter a customer name, email, or keyword to search"
        );

        if (searchTerm) {
          query = searchTerm;
        }
      }

      const response = await client.customers.list({
        query,
        business_name: args.business_name as string | undefined,
        email: args.email as string | undefined,
        phone: args.phone as string | undefined,
        include_disabled: args.include_disabled as boolean | undefined,
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
                customers: response.customers,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "syncro_customers_get": {
      const customerId = args.customer_id as number;
      const customer = await client.customers.get(customerId);

      return {
        content: [{ type: "text", text: JSON.stringify(customer, null, 2) }],
      };
    }

    case "syncro_customers_create": {
      const customer = await sdkWrite(() =>
        client.customers.create({
          business_name: args.business_name as string | undefined,
          firstname: args.firstname as string | undefined,
          lastname: args.lastname as string | undefined,
          email: args.email as string | undefined,
          phone: args.phone as string | undefined,
          mobile: args.mobile as string | undefined,
          address: args.address as string | undefined,
          address_2: args.address_2 as string | undefined,
          city: args.city as string | undefined,
          state: args.state as string | undefined,
          zip: args.zip as string | undefined,
          notes: args.notes as string | undefined,
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(customer, null, 2) }],
      };
    }

    case "syncro_customers_search": {
      const query = args.query as string;
      const limit = (args.limit as number) || 25;

      const response = await client.customers.list({
        query,
        perPage: limit,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: response.customers.length,
                customers: response.customers,
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
        content: [{ type: "text", text: `Unknown customer tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const customersHandler: DomainHandler = {
  getTools,
  handleCall,
};
