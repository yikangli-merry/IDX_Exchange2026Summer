import { createPendingEmailDraft, type EmailApprovalOptions, type EmailWorkflowType, type PendingEmailDraft } from "./emailApproval.ts";
import { formatActiveListingRow, type ActiveListing, type ActiveListingFilters } from "./mlsQueries.ts";
import { extractMarketCity, type MarketQuestionOutput, type MonthlyMarketTrend } from "./marketStats.ts";
import { recommendSimilarListingsForListing, type ListingRecommendation } from "./recommendationEngine.ts";
import { query as runQuery } from "./db.ts";
import type { UserSession } from "./session.ts";

type RawRow = Record<string, unknown>;
type QueryRunner = <TRow extends RawRow = RawRow>(sql: string, params?: readonly unknown[]) => Promise<TRow[]>;

export interface EmailWorkflowInput {
  city?: string;
  filters?: ActiveListingFilters;
  listingId?: string | number;
  message: string;
  months?: number;
  recipientEmail?: string;
  recipientName?: string;
  senderName?: string;
  session?: UserSession;
  subject?: string;
}

export interface EmailWorkflowDraftOutput {
  draft: PendingEmailDraft | null;
  missingContext: boolean;
  response: string;
  workflowType: EmailWorkflowType;
}

export interface ListingAlertSearchOptions {
  queryRunner?: QueryRunner;
  rows?: RawRow[];
}

export interface MarketReportOptions {
  queryRunner?: QueryRunner;
  rows?: RawRow[];
}

export interface PropertySummaryOptions {
  compRows?: RawRow[];
  listingRows?: RawRow[];
  queryRunner?: QueryRunner;
}

export interface RecommendationDigestOptions {
  recommendations?: ListingRecommendation[];
  recommendationProvider?: (listingId: string | number, topK?: number) => Promise<ListingRecommendation[]>;
}

export interface EmailWorkflowOptions extends EmailApprovalOptions {
  listingAlert?: ListingAlertSearchOptions;
  marketReport?: MarketReportOptions;
  propertySummary?: PropertySummaryOptions;
  recommendationDigest?: RecommendationDigestOptions;
}

export interface EmailWorkflowBuiltQuery {
  criteria: Record<string, number | string>;
  params: unknown[];
  sql: string;
}

export interface MarketReportRow {
  avgDaysOnMarket: number | null;
  avgPricePerSqft: number | null;
  avgClosePrice: number | null;
  listToClosePct: number | null;
  period: string | null;
  soldCount: number;
}

export interface PropertyCompSummary {
  avgPricePerSqft: number | null;
  compCount: number;
  compPrice: number | null;
}

const MAX_EMAIL_LISTINGS = 5;
const MAX_MARKET_REPORT_ROWS = 12;
const DEFAULT_MARKET_REPORT_MONTHS = 12;
const DEFAULT_COMP_MONTHS = 6;
const RESIDENTIAL_PROPERTY_TYPE = "Residential";

function normalizePositiveInteger(
  value: number | undefined,
  defaultValue: number,
  maxValue: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }

  const normalized = Math.trunc(value);
  if (normalized < 1) {
    return defaultValue;
  }
  return Math.min(normalized, maxValue);
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "unavailable" : `${value}%`;
}

function formatNumber(value: number | null | undefined, suffix: string): string {
  return value === null || value === undefined ? "unavailable" : `${value} ${suffix}`;
}

function normalizeCity(city: string | null | undefined): string | null {
  const normalized = city?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function hasUsableFilters(filters: ActiveListingFilters): boolean {
  return Boolean(
    filters.city ||
    filters.maxPrice ||
    filters.beds ||
    filters.baths ||
    filters.type ||
    filters.pool ||
    filters.hasView ||
    filters.maxHoa
  );
}

function filtersFromSession(session: UserSession | undefined): ActiveListingFilters {
  return {
    baths: session?.baths,
    beds: session?.beds,
    city: session?.city,
    maxPrice: session?.maxPrice,
    pool: session?.pool,
    type: session?.type
  };
}

function normalizeListingLimit(limit = MAX_EMAIL_LISTINGS): number {
  return normalizePositiveInteger(limit, MAX_EMAIL_LISTINGS, MAX_EMAIL_LISTINGS);
}

function addCriterion(
  criteria: Record<string, number | string>,
  params: unknown[],
  key: string,
  value: number | string | null | undefined
): boolean {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  criteria[key] = value;
  params.push(value);
  return true;
}

export function buildListingAlertQuery(filters: ActiveListingFilters = {}, limit = MAX_EMAIL_LISTINGS): EmailWorkflowBuiltQuery {
  const safeLimit = normalizeListingLimit(limit);
  const criteria: Record<string, number | string> = {
    limit: safeLimit,
    status: "Active"
  };
  const params: unknown[] = ["Active"];
  const where = ["L_Status = ?"];

  if (addCriterion(criteria, params, "city", filters.city)) {
    where.push("L_City = ?");
  }
  if (addCriterion(criteria, params, "maxPrice", filters.maxPrice)) {
    where.push("L_SystemPrice <= ?");
  }
  if (addCriterion(criteria, params, "beds", filters.beds)) {
    where.push("L_Keyword2 >= ?");
  }
  if (addCriterion(criteria, params, "baths", filters.baths)) {
    where.push("LM_Dec_3 >= ?");
  }
  if (addCriterion(criteria, params, "type", filters.type)) {
    where.push("L_Type_ = ?");
  }
  if (addCriterion(criteria, params, "pool", filters.pool)) {
    where.push("PoolPrivateYN = ?");
  }
  if (addCriterion(criteria, params, "hasView", filters.hasView)) {
    where.push("ViewYN = ?");
  }
  if (addCriterion(criteria, params, "maxHoa", filters.maxHoa)) {
    where.push("AssociationFee <= ?");
  }

  return {
    criteria,
    params,
    sql: `
      SELECT
        L_ListingID AS ListingID, L_DisplayId, L_Address, L_City,
        L_SystemPrice AS price, L_Keyword2 AS beds, LM_Dec_3 AS baths,
        LM_Int2_3 AS sqft, L_Type_ AS type, L_Status AS status,
        DaysOnMarket, PhotoCount
      FROM rets_property
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(DaysOnMarket, 999999) ASC, L_ListingID DESC
      LIMIT ${safeLimit}
    `.trim()
  };
}

export function buildMarketReportRowsQuery(city: string, months = DEFAULT_MARKET_REPORT_MONTHS): EmailWorkflowBuiltQuery {
  const safeCity = normalizeCity(city);
  if (!safeCity) {
    throw new Error("city is required for market report emails.");
  }
  const safeMonths = normalizePositiveInteger(months, DEFAULT_MARKET_REPORT_MONTHS, DEFAULT_MARKET_REPORT_MONTHS);

  return {
    criteria: {
      city: safeCity,
      limit: MAX_MARKET_REPORT_ROWS,
      months: safeMonths,
      propertyType: RESIDENTIAL_PROPERTY_TYPE
    },
    params: [safeCity, RESIDENTIAL_PROPERTY_TYPE, safeMonths],
    sql: `
      SELECT
        DATE_FORMAT(CloseDate, '%Y-%m') AS period,
        COUNT(*) AS sold_count,
        AVG(ClosePrice) AS avg_close_price,
        AVG(ClosePrice / NULLIF(LivingArea, 0)) AS avg_price_per_sqft,
        AVG(DaysOnMarket) AS avg_days_on_market,
        AVG((ClosePrice / NULLIF(ListPrice, 0)) * 100) AS list_to_close_pct
      FROM california_sold
      WHERE City = ?
        AND PropertyType = ?
        AND CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        AND ClosePrice IS NOT NULL
      GROUP BY DATE_FORMAT(CloseDate, '%Y-%m')
      ORDER BY period DESC
      LIMIT ${MAX_MARKET_REPORT_ROWS}
    `.trim()
  };
}

export function buildPropertySummaryListingQuery(listingId: string | number): EmailWorkflowBuiltQuery {
  const safeListingId = stringValue(listingId);
  if (!safeListingId) {
    throw new Error("listingId is required for property summary emails.");
  }

  return {
    criteria: {
      listingId: safeListingId,
      limit: 1,
      status: "Active"
    },
    params: [safeListingId, "Active"],
    sql: `
      SELECT
        L_ListingID AS ListingID, L_DisplayId, L_Address, L_City, L_Zip,
        L_SystemPrice AS price, L_Keyword2 AS beds, LM_Dec_3 AS baths,
        LM_Int2_3 AS sqft, L_Type_ AS type, L_Status AS status,
        YearBuilt, AssociationFee, DaysOnMarket,
        PoolPrivateYN, ViewYN, FireplaceYN, PhotoCount
      FROM rets_property
      WHERE CAST(L_ListingID AS CHAR) = ?
        AND L_Status = ?
      LIMIT 1
    `.trim()
  };
}

export function buildPropertyCompSummaryQuery(
  city: string,
  sqft: number,
  months = DEFAULT_COMP_MONTHS
): EmailWorkflowBuiltQuery {
  const safeCity = normalizeCity(city);
  if (!safeCity) {
    throw new Error("city is required for property comp summary emails.");
  }
  if (!Number.isFinite(sqft) || sqft <= 0) {
    throw new Error("sqft must be a positive number for property comp summary emails.");
  }

  const safeMonths = normalizePositiveInteger(months, DEFAULT_COMP_MONTHS, DEFAULT_MARKET_REPORT_MONTHS);
  const minSqft = Math.round(sqft * 0.8);
  const maxSqft = Math.round(sqft * 1.2);

  return {
    criteria: {
      city: safeCity,
      maxSqft,
      minSqft,
      months: safeMonths,
      propertyType: RESIDENTIAL_PROPERTY_TYPE
    },
    params: [safeCity, RESIDENTIAL_PROPERTY_TYPE, minSqft, maxSqft, safeMonths],
    sql: `
      SELECT
        COUNT(*) AS comp_count,
        AVG(ClosePrice / NULLIF(LivingArea, 0)) AS avg_price_per_sqft
      FROM california_sold
      WHERE City = ?
        AND PropertyType = ?
        AND LivingArea BETWEEN ? AND ?
        AND CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        AND ClosePrice IS NOT NULL
        AND LivingArea IS NOT NULL
    `.trim()
  };
}

export function formatMarketReportRow(row: RawRow): MarketReportRow {
  return {
    avgClosePrice: numberValue(row.avg_close_price ?? row.avgClosePrice),
    avgDaysOnMarket: numberValue(row.avg_days_on_market ?? row.avgDaysOnMarket),
    avgPricePerSqft: numberValue(row.avg_price_per_sqft ?? row.avgPricePerSqft),
    listToClosePct: numberValue(row.list_to_close_pct ?? row.listToClosePct),
    period: stringValue(row.period),
    soldCount: numberValue(row.sold_count ?? row.soldCount) ?? 0
  };
}

export function formatPropertyCompSummary(row: RawRow, sqft: number | null): PropertyCompSummary {
  const avgPricePerSqft = numberValue(row.avg_price_per_sqft ?? row.avgPricePerSqft);
  return {
    avgPricePerSqft,
    compCount: numberValue(row.comp_count ?? row.compCount) ?? 0,
    compPrice: avgPricePerSqft !== null && sqft !== null ? Math.round(avgPricePerSqft * sqft) : null
  };
}

export function classifyEmailWorkflow(message: string, session?: UserSession): EmailWorkflowType {
  const normalized = message.trim();
  if (/\b(?:listing alert|new listing|new listings|alert)\b/i.test(normalized)) {
    return "listing_alert";
  }
  if (/\b(?:recommendation digest|recommendations digest|personalized digest|digest|similar listings)\b/i.test(normalized)) {
    return "recommendation_digest";
  }
  if (/\b(?:weekly market report|market report|market email|market summary|market update|trend report)\b/i.test(normalized)) {
    return "market_report";
  }
  if (/\b(?:property summary|property card|listing summary|listing card|home summary|these listings|this listing)\b/i.test(normalized)) {
    return "property_summary";
  }
  if (session?.lastMarketResult && !(session.lastResults?.length)) {
    return "market_report";
  }
  if (session?.lastResults?.length) {
    return "property_summary";
  }
  return "general_draft";
}

function greeting(name: string | undefined): string {
  return name ? `Hi ${name},` : "Hi,";
}

function closing(name: string | undefined): string {
  return name ? `Best,\n${name}` : "Best,";
}

function listingLocation(listing: ActiveListing): string {
  return [listing.address, listing.city].filter(Boolean).join(", ") || `Listing ${listing.listingId ?? "unavailable"}`;
}

function listingLine(listing: ActiveListing, index: number): string {
  return `${index + 1}. ${listingLocation(listing)} - ${formatCurrency(listing.price)} - ${formatNumber(listing.beds, "beds")} / ${formatNumber(listing.baths, "baths")} - ${formatNumber(listing.sqft, "sqft")} - ${listing.photoCount ?? "photo count unavailable"} photos`;
}

function marketTrendLines(rows: MarketReportRow[]): string[] {
  return rows.slice(0, MAX_MARKET_REPORT_ROWS).map((row) => [
    row.period ?? "Unknown period",
    `${row.soldCount} sale(s)`,
    `${formatCurrency(row.avgClosePrice)} avg close`,
    `${formatCurrency(row.avgPricePerSqft)} avg $/sqft`,
    `${formatNumber(row.avgDaysOnMarket === null ? null : Math.round(row.avgDaysOnMarket * 10) / 10, "DOM")}`,
    `${formatPercent(row.listToClosePct === null ? null : Math.round(row.listToClosePct * 10) / 10)} list-to-close`
  ].join(" | "));
}

function rowsFromMarketResult(result: MarketQuestionOutput): MarketReportRow[] {
  const trend = result.trend.length > 0 ? result.trend : [];
  if (trend.length > 0) {
    return trend.slice(-MAX_MARKET_REPORT_ROWS).reverse().map((row: MonthlyMarketTrend) => ({
      avgClosePrice: row.avgPrice,
      avgDaysOnMarket: row.avgDaysOnMarket,
      avgPricePerSqft: row.avgPricePerSqft,
      listToClosePct: result.summary?.listToClosePct ?? null,
      period: row.month,
      soldCount: row.sales
    }));
  }

  return [{
    avgClosePrice: result.summary?.averageClosePrice ?? null,
    avgDaysOnMarket: result.summary?.averageDaysOnMarket ?? null,
    avgPricePerSqft: result.summary?.averagePricePerSqft ?? null,
    listToClosePct: result.summary?.listToClosePct ?? null,
    period: `${result.months} month summary`,
    soldCount: result.summary?.soldCount ?? 0
  }];
}

function workflowDraft(
  input: EmailWorkflowInput,
  workflowType: EmailWorkflowType,
  subject: string,
  body: string,
  options: EmailWorkflowOptions
): EmailWorkflowDraftOutput {
  const draft = createPendingEmailDraft({
    body,
    subject,
    to: input.recipientEmail,
    workflowType
  }, options);

  return {
    draft,
    missingContext: false,
    response: draft.preview,
    workflowType
  };
}

function missingContext(workflowType: EmailWorkflowType, response: string): EmailWorkflowDraftOutput {
  return {
    draft: null,
    missingContext: true,
    response,
    workflowType
  };
}

async function getListingAlertListings(
  filters: ActiveListingFilters,
  options: ListingAlertSearchOptions = {}
): Promise<ActiveListing[]> {
  if (options.rows) {
    return options.rows.slice(0, MAX_EMAIL_LISTINGS).map(formatActiveListingRow);
  }

  const builtQuery = buildListingAlertQuery(filters, MAX_EMAIL_LISTINGS);
  const queryRunner = options.queryRunner ?? runQuery;
  const rows = await queryRunner<RawRow>(builtQuery.sql, builtQuery.params);
  return rows.slice(0, MAX_EMAIL_LISTINGS).map(formatActiveListingRow);
}

async function getMarketReportRows(
  city: string,
  months: number,
  options: MarketReportOptions = {}
): Promise<MarketReportRow[]> {
  if (options.rows) {
    return options.rows.slice(0, MAX_MARKET_REPORT_ROWS).map(formatMarketReportRow);
  }

  const builtQuery = buildMarketReportRowsQuery(city, months);
  const queryRunner = options.queryRunner ?? runQuery;
  const rows = await queryRunner<RawRow>(builtQuery.sql, builtQuery.params);
  return rows.slice(0, MAX_MARKET_REPORT_ROWS).map(formatMarketReportRow);
}

async function getPropertyListing(
  listingId: string | number,
  options: PropertySummaryOptions = {}
): Promise<ActiveListing | null> {
  if (options.listingRows) {
    return options.listingRows[0] ? formatActiveListingRow(options.listingRows[0]) : null;
  }

  const builtQuery = buildPropertySummaryListingQuery(listingId);
  const queryRunner = options.queryRunner ?? runQuery;
  const rows = await queryRunner<RawRow>(builtQuery.sql, builtQuery.params);
  return rows[0] ? formatActiveListingRow(rows[0]) : null;
}

async function getPropertyComps(
  listing: ActiveListing,
  options: PropertySummaryOptions = {}
): Promise<PropertyCompSummary | null> {
  if (options.compRows) {
    return options.compRows[0] ? formatPropertyCompSummary(options.compRows[0], listing.sqft) : null;
  }
  if (!listing.city || !listing.sqft) {
    return null;
  }

  const builtQuery = buildPropertyCompSummaryQuery(listing.city, listing.sqft, DEFAULT_COMP_MONTHS);
  const queryRunner = options.queryRunner ?? runQuery;
  const rows = await queryRunner<RawRow>(builtQuery.sql, builtQuery.params);
  return rows[0] ? formatPropertyCompSummary(rows[0], listing.sqft) : null;
}

export async function draftListingAlertEmail(
  input: EmailWorkflowInput,
  options: EmailWorkflowOptions = {}
): Promise<EmailWorkflowDraftOutput> {
  const filters = input.filters ?? filtersFromSession(input.session);
  if (!hasUsableFilters(filters)) {
    return missingContext("listing_alert", "I need a saved search or recent search filters before drafting a listing alert email.");
  }

  const listings = await getListingAlertListings(filters, options.listingAlert);
  const subject = input.subject ?? `New listing alert${filters.city ? ` for ${filters.city}` : ""}`;
  const body = [
    greeting(input.recipientName),
    "",
    "Here are new active listings that match the saved search:",
    "",
    ...(listings.length > 0 ? listings.map(listingLine) : ["No matching new active listings were found for this saved search yet."]),
    "",
    "This is a draft only and will not be sent unless explicitly approved.",
    "",
    closing(input.senderName)
  ].join("\n");

  return workflowDraft(input, "listing_alert", subject, body, options);
}

export async function draftMarketReportEmail(
  input: EmailWorkflowInput,
  options: EmailWorkflowOptions = {}
): Promise<EmailWorkflowDraftOutput> {
  const sessionMarket = input.session?.lastMarketResult;
  const city = normalizeCity(input.city)
    ?? normalizeCity(sessionMarket?.city ?? undefined)
    ?? extractMarketCity(input.message);
  if (!city) {
    return missingContext("market_report", "I need a California city before drafting a weekly market report email.");
  }

  const months = normalizePositiveInteger(input.months, DEFAULT_MARKET_REPORT_MONTHS, DEFAULT_MARKET_REPORT_MONTHS);
  const rows = sessionMarket?.city?.toLowerCase() === city.toLowerCase()
    ? rowsFromMarketResult(sessionMarket)
    : await getMarketReportRows(city, months, options.marketReport);
  const subject = input.subject ?? `Weekly market report for ${city}`;
  const detailLines = marketTrendLines(rows);
  const body = [
    greeting(input.recipientName),
    "",
    `Here is the weekly market report for ${city}, based on aggregated california_sold analytics:`,
    "",
    ...(detailLines.length > 0 ? detailLines.map((line) => `- ${line}`) : ["- No sold residential analytics were found for this report window."]),
    "",
    "The report uses aggregated market statistics only and does not export full MLS sold datasets.",
    "",
    closing(input.senderName)
  ].join("\n");

  return workflowDraft(input, "market_report", subject, body, options);
}

export async function draftPropertySummaryEmail(
  input: EmailWorkflowInput,
  options: EmailWorkflowOptions = {}
): Promise<EmailWorkflowDraftOutput> {
  const sessionListing = input.session?.lastResults?.[0] ?? null;
  const listingId = input.listingId ?? sessionListing?.listingId ?? null;
  const listing = listingId && (!sessionListing || String(sessionListing.listingId ?? "") !== String(listingId))
    ? await getPropertyListing(listingId, options.propertySummary)
    : sessionListing;

  if (!listing) {
    return missingContext("property_summary", "I need a recent listing or listing id before drafting a property summary email.");
  }

  const comps = await getPropertyComps(listing, options.propertySummary);
  const subject = input.subject ?? `Property summary: ${listingLocation(listing)}`;
  const compLine = comps && comps.compCount > 0
    ? `Recent comps: ${comps.compCount} sold comp(s), estimated comp-supported value ${formatCurrency(comps.compPrice)}.`
    : "Recent comps: unavailable for this property summary.";
  const body = [
    greeting(input.recipientName),
    "",
    `Here is a concise property summary for ${listingLocation(listing)}:`,
    "",
    `Price: ${formatCurrency(listing.price)}`,
    `Details: ${formatNumber(listing.beds, "beds")} / ${formatNumber(listing.baths, "baths")} / ${formatNumber(listing.sqft, "sqft")}`,
    `Photos: ${listing.photoCount ?? "photo count unavailable"}`,
    `Days on market: ${listing.daysOnMarket ?? "unavailable"}`,
    compLine,
    "",
    "This is a draft only and will not be sent unless explicitly approved.",
    "",
    closing(input.senderName)
  ].join("\n");

  return workflowDraft(input, "property_summary", subject, body, options);
}

export async function draftRecommendationDigestEmail(
  input: EmailWorkflowInput,
  options: EmailWorkflowOptions = {}
): Promise<EmailWorkflowDraftOutput> {
  const targetListingId = input.listingId ?? input.session?.lastResults?.[0]?.listingId ?? null;
  if (!targetListingId) {
    return missingContext("recommendation_digest", "I need a recent listing or listing id before drafting a recommendation digest email.");
  }

  const provider = options.recommendationDigest?.recommendationProvider
    ?? ((listingId: string | number, topK = MAX_EMAIL_LISTINGS) => recommendSimilarListingsForListing(listingId, topK));
  const recommendations = (options.recommendationDigest?.recommendations ?? await provider(targetListingId, MAX_EMAIL_LISTINGS))
    .slice(0, MAX_EMAIL_LISTINGS);
  const subject = input.subject ?? "Personalized recommendation digest";
  const body = [
    greeting(input.recipientName),
    "",
    "Here are personalized active-listing recommendations based on the recent property context:",
    "",
    ...(recommendations.length > 0 ? recommendations.map(listingLine) : ["No recommendation matches are available yet."]),
    "",
    "This digest is a draft only and will not be sent unless explicitly approved.",
    "",
    closing(input.senderName)
  ].join("\n");

  return workflowDraft(input, "recommendation_digest", subject, body, options);
}

export async function createEmailWorkflowDraft(
  input: EmailWorkflowInput,
  options: EmailWorkflowOptions = {}
): Promise<EmailWorkflowDraftOutput> {
  if (!input?.message || typeof input.message !== "string") {
    throw new Error("A non-empty message string is required.");
  }

  const workflowType = classifyEmailWorkflow(input.message, input.session);
  if (workflowType === "listing_alert") {
    return draftListingAlertEmail(input, options);
  }
  if (workflowType === "market_report") {
    return draftMarketReportEmail(input, options);
  }
  if (workflowType === "recommendation_digest") {
    return draftRecommendationDigestEmail(input, options);
  }
  if (workflowType === "property_summary") {
    return draftPropertySummaryEmail(input, options);
  }

  return missingContext("general_draft", "I do not have enough recent property, market, or recommendation context to draft an email yet.");
}
