/**
 * Domain handlers index
 *
 * Lazy-loads domain handlers to avoid loading everything upfront.
 */

import type { DomainHandler } from "../utils/types.js";
import type { DomainName } from "../utils/types.js";

// Cache for loaded domain handlers
const domainCache = new Map<DomainName, DomainHandler>();

/**
 * Lazy-load a domain handler
 */
export async function getDomainHandler(
  domain: DomainName
): Promise<DomainHandler> {
  // Check cache first
  const cached = domainCache.get(domain);
  if (cached) {
    return cached;
  }

  // Dynamically import the domain handler
  let handler: DomainHandler;

  switch (domain) {
    case "customers": {
      const { customersHandler } = await import("./customers.js");
      handler = customersHandler;
      break;
    }
    case "tickets": {
      const { ticketsHandler } = await import("./tickets.js");
      handler = ticketsHandler;
      break;
    }
    case "assets": {
      const { assetsHandler } = await import("./assets.js");
      handler = assetsHandler;
      break;
    }
    case "contacts": {
      const { contactsHandler } = await import("./contacts.js");
      handler = contactsHandler;
      break;
    }
    case "invoices": {
      const { invoicesHandler } = await import("./invoices.js");
      handler = invoicesHandler;
      break;
    }
    case "time": {
      const { timeHandler } = await import("./time.js");
      handler = timeHandler;
      break;
    }
    default:
      throw new Error(`Unknown domain: ${domain}`);
  }

  // Cache the handler
  domainCache.set(domain, handler);
  return handler;
}

/**
 * Get all available domain names
 */
export function getAvailableDomains(): DomainName[] {
  return ["customers", "tickets", "assets", "contacts", "invoices", "time"];
}

/**
 * Clear the domain cache (useful for testing)
 */
export function clearDomainCache(): void {
  domainCache.clear();
}
