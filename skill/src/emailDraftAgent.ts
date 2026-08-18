import type { ActiveListing } from "./mlsQueries.ts";
import type { MarketQuestionOutput } from "./marketStats.ts";
import type { UserSession } from "./session.ts";

export type EmailDraftType = "market_summary" | "no_context" | "property_summary";

export interface EmailDraftInput {
  message: string;
  recipientName?: string;
  senderName?: string;
  session?: UserSession;
  subject?: string;
}

export interface EmailDraftOutput {
  body: string;
  draftType: EmailDraftType;
  missingContext: boolean;
  response: string;
  subject: string;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "price unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatNumber(value: number | null | undefined, suffix: string): string {
  return value === null || value === undefined ? `${suffix} unavailable` : `${value} ${suffix}`;
}

function listingLabel(listing: ActiveListing): string {
  const location = [listing.address, listing.city].filter(Boolean).join(", ");
  return location || `Listing ${String(listing.listingId ?? "unavailable")}`;
}

function formatListingLine(listing: ActiveListing, index: number): string {
  const bedsBaths = [
    formatNumber(listing.beds, "beds"),
    formatNumber(listing.baths, "baths"),
    formatNumber(listing.sqft, "sqft")
  ].join(", ");
  return `${index + 1}. ${listingLabel(listing)} - ${formatCurrency(listing.price)} - ${bedsBaths}`;
}

function wantsMarketDraft(message: string): boolean {
  return /\b(?:market|trend|stats|statistics|median|average|price per sqft|prices?|sold|dom|days on market)\b/i.test(message);
}

function wantsPropertyDraft(message: string): boolean {
  return /\b(?:property|properties|listing|listings|home|homes|house|houses|condo|townhome)\b/i.test(message);
}

function buildResponse(subject: string, body: string): string {
  return [`Subject: ${subject}`, "", body].join("\n");
}

function defaultGreeting(recipientName: string | undefined): string {
  return recipientName ? `Hi ${recipientName},` : "Hi,";
}

function defaultClosing(senderName: string | undefined): string {
  return senderName ? `Best,\n${senderName}` : "Best,";
}

function draftPropertyEmail(input: EmailDraftInput, listings: ActiveListing[]): EmailDraftOutput {
  const subject = input.subject ?? "Property options for your review";
  const lines = [
    defaultGreeting(input.recipientName),
    "",
    "Here are the active listings that match the recent search:",
    "",
    ...listings.slice(0, 5).map(formatListingLine),
    "",
    "Let me know which properties you would like to discuss or compare in more detail.",
    "",
    defaultClosing(input.senderName)
  ];
  const body = lines.join("\n");

  return {
    body,
    draftType: "property_summary",
    missingContext: false,
    response: buildResponse(subject, body),
    subject
  };
}

function draftMarketEmail(input: EmailDraftInput, marketResult: MarketQuestionOutput): EmailDraftOutput {
  const city = marketResult.city ?? "the selected city";
  const subject = input.subject ?? `Market summary for ${city}`;
  const summary = marketResult.summary;
  const detailLines = summary
    ? [
      `Sold comps: ${summary.soldCount}`,
      `Median close price: ${formatCurrency(summary.medianClosePrice)}`,
      `Average close price: ${formatCurrency(summary.averageClosePrice)}`,
      `Average days on market: ${summary.averageDaysOnMarket ?? "unavailable"}`,
      `List-to-close ratio: ${summary.listToClosePct === null ? "unavailable" : `${summary.listToClosePct}%`}`
    ]
    : [marketResult.reply];
  const lines = [
    defaultGreeting(input.recipientName),
    "",
    `Here is a concise market summary for ${city} over the last ${marketResult.months} month(s):`,
    "",
    ...detailLines.map((line) => `- ${line}`),
    "",
    marketResult.reply,
    "",
    "I can also prepare a property-specific follow-up if you want to compare active listings against these market conditions.",
    "",
    defaultClosing(input.senderName)
  ];
  const body = lines.join("\n");

  return {
    body,
    draftType: "market_summary",
    missingContext: false,
    response: buildResponse(subject, body),
    subject
  };
}

export function draftEmail(input: EmailDraftInput): EmailDraftOutput {
  if (!input?.message || typeof input.message !== "string") {
    throw new Error("A non-empty message string is required.");
  }

  const session = input.session;
  const listings = session?.lastResults ?? [];
  const marketResult = session?.lastMarketResult;
  const message = input.message.trim();

  if (marketResult && (wantsMarketDraft(message) || !wantsPropertyDraft(message))) {
    return draftMarketEmail(input, marketResult);
  }

  if (listings.length > 0) {
    return draftPropertyEmail(input, listings);
  }

  if (marketResult) {
    return draftMarketEmail(input, marketResult);
  }

  const response = "I do not have enough recent property or market context to draft an email yet. Search for listings or ask a market question first.";
  return {
    body: "",
    draftType: "no_context",
    missingContext: true,
    response,
    subject: ""
  };
}
