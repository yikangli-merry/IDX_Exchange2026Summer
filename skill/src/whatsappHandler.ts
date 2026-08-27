import { orchestrate, type OrchestrationOutput } from "./orchestrator.ts";

export const WHATSAPP_LISTING_LIMIT = 5;
export const WHATSAPP_NO_RESULTS_REPLY = "No results found.";
export const WHATSAPP_ERROR_REPLY = "Sorry, I hit an issue. Please try again.";

export type WhatsAppOrchestrator = (
  message: string,
  userId: string
) => Promise<OrchestrationOutput>;

export type WhatsAppTypingIndicator = (userId: string) => Promise<void> | void;

export interface WhatsAppLogger {
  error: (...data: unknown[]) => void;
}

export interface WhatsAppMessageOptions {
  logger?: WhatsAppLogger;
  orchestrator?: WhatsAppOrchestrator;
  sendTypingIndicator?: WhatsAppTypingIndicator;
}

interface ListingLike {
  address: string | null;
  baths: number | null;
  beds: number | null;
  city: string | null;
  daysOnMarket: number | null;
  price: number | null;
  sqft: number | null;
}

type UnknownRecord = Record<string, unknown>;

export async function sendTypingIndicator(_userId: string): Promise<void> {
  return;
}

export async function onWhatsAppMessage(
  message: string,
  userId: string,
  options: WhatsAppMessageOptions = {}
): Promise<string> {
  const logger = options.logger ?? console;
  const typingIndicator = options.sendTypingIndicator ?? sendTypingIndicator;
  const runOrchestrator = options.orchestrator ?? orchestrate;

  try {
    await typingIndicator(userId);
  } catch (err) {
    logger.error("WhatsApp typing indicator error:", err);
  }

  try {
    const result = await runOrchestrator(message, userId);
    return formatForWhatsApp(result);
  } catch (err) {
    logger.error("WhatsApp orchestration error:", err);
    return WHATSAPP_ERROR_REPLY;
  }
}

export function formatForWhatsApp(result: OrchestrationOutput): string {
  if (result.intent === "mixed") {
    const response = result.response.trim();
    if (response) {
      return response;
    }
  }

  const listings = collectListings(result);
  if (listings.length > 0) {
    return formatListingsForWhatsApp(listings);
  }

  const response = stringValue(result.response);
  return response ?? WHATSAPP_NO_RESULTS_REPLY;
}

export function formatListingsForWhatsApp(
  listings: readonly ListingLike[],
  limit = WHATSAPP_LISTING_LIMIT
): string {
  const visibleListings = listings.slice(0, limit);
  if (visibleListings.length === 0) {
    return WHATSAPP_NO_RESULTS_REPLY;
  }

  return visibleListings
    .map((listing, index) => formatListingForWhatsApp(listing, index))
    .join("\n\n");
}

function collectListings(result: OrchestrationOutput): ListingLike[] {
  const containers: unknown[] = [result];

  for (const agentResult of result.agentResults) {
    containers.push(agentResult.data);
  }

  return containers.flatMap((container) => listingsFromContainer(container));
}

function listingsFromContainer(container: unknown): ListingLike[] {
  if (Array.isArray(container)) {
    return container.map(normalizeListing).filter((listing): listing is ListingLike => listing !== null);
  }
  if (!isRecord(container)) {
    return [];
  }

  return ["listings", "results", "items"]
    .flatMap((key) => {
      const value = container[key];
      return Array.isArray(value) ? value : [];
    })
    .map(normalizeListing)
    .filter((listing): listing is ListingLike => listing !== null);
}

function normalizeListing(value: unknown): ListingLike | null {
  if (!isRecord(value) || !looksLikeListing(value)) {
    return null;
  }

  return {
    address: stringValue(value.address ?? value.L_Address ?? value.UnparsedAddress),
    baths: numberValue(value.baths ?? value.bathrooms ?? value.BathroomsTotalInteger),
    beds: numberValue(value.beds ?? value.bedrooms ?? value.BedroomsTotal),
    city: stringValue(value.city ?? value.L_City ?? value.City),
    daysOnMarket: numberValue(value.daysOnMarket ?? value.DaysOnMarket),
    price: numberValue(value.price ?? value.L_SystemPrice ?? value.listPrice ?? value.closePrice),
    sqft: numberValue(value.sqft ?? value.livingArea ?? value.LivingArea ?? value.LM_Int2_3)
  };
}

function looksLikeListing(value: UnknownRecord): boolean {
  return [
    "address",
    "L_Address",
    "UnparsedAddress",
    "city",
    "L_City",
    "City",
    "price",
    "L_SystemPrice",
    "listPrice",
    "closePrice",
    "beds",
    "bedrooms",
    "BedroomsTotal",
    "baths",
    "bathrooms",
    "BathroomsTotalInteger",
    "sqft",
    "livingArea",
    "LivingArea",
    "daysOnMarket",
    "DaysOnMarket"
  ].some((key) => key in value);
}

function formatListingForWhatsApp(listing: ListingLike, index: number): string {
  const location = [listing.address ?? "Address unavailable", listing.city].filter(Boolean).join(", ");
  const details = [
    formatCurrency(listing.price),
    `${formatNumber(listing.beds, "bd")}/${formatNumber(listing.baths, "ba")}`,
    formatNumber(listing.sqft, "sqft"),
    listing.daysOnMarket === null
      ? "DOM unavailable"
      : `${formatInteger(listing.daysOnMarket)} days on market`
  ];

  return `${index + 1}. ${location}\n   ${details.join(" | ")}`;
}

function formatCurrency(value: number | null): string {
  if (value === null) {
    return "Price unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  }).format(value);
}

function formatNumber(value: number | null, label: string): string {
  if (value === null) {
    return `${label} unavailable`;
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: label === "sqft" ? 0 : 1
  }).format(value)}${label === "sqft" ? ` ${label}` : label}`;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(String(value).replace(/[$,]/g, "").trim());
  return Number.isFinite(normalized) ? normalized : null;
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
