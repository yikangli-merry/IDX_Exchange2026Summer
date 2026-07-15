import { searchActiveListings, type ActiveListing, type ActiveListingFilters, type PagedResult } from "./mlsQueries.ts";
import { parsePropertyQuery, type PropertyFilter } from "./parser.ts";
import { clearSession, getSession, updateSession, type UserSession } from "./session.ts";

export interface ConversationInput {
  userId: string;
  message: string;
  page?: number;
  limit?: number;
}

export interface ConversationOutput {
  askedFor?: "city" | "maxPrice" | "type" | "beds";
  filters: ActiveListingFilters;
  hasMore?: boolean;
  reply: string;
  reset?: boolean;
  results?: ActiveListing[];
  session: UserSession;
}

export type ListingSearchHandler = (
  filters: ActiveListingFilters,
  page?: number,
  limit?: number
) => Promise<PagedResult<ActiveListing>>;

export interface ConversationOptions {
  defaultLimit?: number;
  searchListings?: ListingSearchHandler;
}

const DEFAULT_LIMIT = 3;
const RESET_PATTERN = /^(?:reset|clear|clear search|start over|restart|new search)$/i;
const MORE_PATTERN = /^(?:more|next|show more|next page)$/i;

function mergeParsedFilters(session: UserSession, filters: PropertyFilter): Partial<UserSession> {
  const updates: Partial<UserSession> = {};

  if (filters.city !== null) {
    updates.city = filters.city;
  }
  if (filters.maxPrice !== null) {
    updates.maxPrice = filters.maxPrice;
  }
  if (filters.beds !== null) {
    updates.beds = filters.beds;
  }
  if (filters.baths !== null) {
    updates.baths = filters.baths;
  }
  if (filters.type !== null) {
    updates.type = filters.type;
  }
  if (filters.pool !== null) {
    updates.pool = filters.pool;
  }

  return { ...session, ...updates };
}

function filtersFromSession(session: UserSession): ActiveListingFilters {
  return {
    city: session.city,
    maxPrice: session.maxPrice,
    beds: session.beds,
    baths: session.baths,
    type: session.type,
    pool: session.pool
  };
}

function nextQuestion(session: UserSession): ConversationOutput["askedFor"] | null {
  if (!session.city) {
    return "city";
  }
  if (!session.maxPrice) {
    return "maxPrice";
  }
  if (!session.type) {
    return "type";
  }
  if (!session.beds) {
    return "beds";
  }

  return null;
}

function questionReply(field: NonNullable<ConversationOutput["askedFor"]>): string {
  if (field === "city") {
    return "Which city should I search in?";
  }
  if (field === "maxPrice") {
    return "What is your budget?";
  }
  if (field === "type") {
    return "Any preference: condo, townhome, or single family?";
  }

  return "How many bedrooms do you need?";
}

function questionStep(field: NonNullable<ConversationOutput["askedFor"]>): number {
  return {
    city: 1,
    maxPrice: 2,
    type: 3,
    beds: 4
  }[field];
}

function formatCurrency(value: number | null): string {
  if (value === null) {
    return "price unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatNumber(value: number | null, label: string): string {
  return value === null ? `${label} unavailable` : `${value} ${label}`;
}

function formatSearchSummary(session: UserSession): string {
  const parts = [
    session.city,
    session.maxPrice ? `under ${formatCurrency(session.maxPrice)}` : null,
    session.type,
    session.beds ? `${session.beds}+ beds` : null,
    session.baths ? `${session.baths}+ baths` : null,
    session.pool ? "with pool" : null
  ].filter(Boolean);

  return parts.join(", ");
}

function formatListing(listing: ActiveListing, index: number): string {
  const address = listing.address ?? "Address unavailable";
  const price = formatCurrency(listing.price);
  const bedsBaths = `${formatNumber(listing.beds, "beds")} / ${formatNumber(listing.baths, "baths")}`;
  const photos = listing.photoCount === null ? "photo count unavailable" : `${listing.photoCount} photos`;

  return `${index + 1}. ${address} - ${price} - ${bedsBaths} - ${photos}`;
}

function formatResults(session: UserSession, result: PagedResult<ActiveListing>): string {
  const summary = formatSearchSummary(session);

  if (result.items.length === 0) {
    return `No matching active listings found for ${summary}. Try broadening the budget, property type, or bedroom count.`;
  }

  const lines = [
    `Found ${result.items.length} active listing(s) for ${summary}:`,
    ...result.items.map(formatListing)
  ];

  if (result.hasMore) {
    lines.push('Reply "more" to see the next page.');
  }

  return lines.join("\n");
}

export async function handlePropertyConversation(
  input: ConversationInput,
  options: ConversationOptions = {}
): Promise<ConversationOutput> {
  if (!input?.userId || typeof input.userId !== "string") {
    throw new Error("A non-empty userId is required.");
  }
  if (!input?.message || typeof input.message !== "string") {
    throw new Error("A non-empty message is required.");
  }

  const trimmedMessage = input.message.trim();

  if (RESET_PATTERN.test(trimmedMessage)) {
    clearSession(input.userId);
    const session = getSession(input.userId);
    return {
      filters: filtersFromSession(session),
      reply: "Search preferences cleared. What city should I search in?",
      reset: true,
      session
    };
  }

  const isMoreRequest = MORE_PATTERN.test(trimmedMessage);
  let session = getSession(input.userId);

  if (!isMoreRequest) {
    const parsedFilters = parsePropertyQuery(trimmedMessage);
    const mergedSession = mergeParsedFilters(session, parsedFilters);
    session = updateSession(input.userId, {
      ...mergedSession,
      currentPage: undefined,
      lastResults: []
    });
  }

  const missingField = nextQuestion(session);
  if (missingField) {
    session = updateSession(input.userId, { conversationStep: questionStep(missingField) });
    return {
      askedFor: missingField,
      filters: filtersFromSession(session),
      reply: questionReply(missingField),
      session
    };
  }

  const searchListings = options.searchListings ?? searchActiveListings;
  const page = input.page ?? (isMoreRequest ? (session.currentPage ?? 1) + 1 : 1);
  const limit = input.limit ?? options.defaultLimit ?? DEFAULT_LIMIT;
  const result = await searchListings(filtersFromSession(session), page, limit);

  session = updateSession(input.userId, {
    conversationStep: session.conversationStep + 1,
    currentPage: result.page,
    lastResults: result.items
  });

  return {
    filters: filtersFromSession(session),
    hasMore: result.hasMore,
    reply: formatResults(session, result),
    results: result.items,
    session
  };
}
