import { query } from "./db.ts";

export interface MarketQuestionInput {
  city?: string;
  message: string;
  months?: number;
}

export interface MarketRowsQuery {
  criteria: Record<string, string | number>;
  params: unknown[];
  sql: string;
}

export interface CityMarketRow {
  city: string | null;
  closeDate: string | null;
  closePrice: number | null;
  daysOnMarket: number | null;
  listPrice: number | null;
  livingArea: number | null;
  propertyType: string | null;
}

export interface MonthlyMarketTrend {
  avgDaysOnMarket: number | null;
  avgPrice: number | null;
  avgPricePerSqft: number | null;
  medianPrice: number | null;
  month: string;
  priceChangePct: number | null;
  sales: number;
}

export interface MarketSummary {
  averageClosePrice: number | null;
  averageDaysOnMarket: number | null;
  averagePricePerSqft: number | null;
  city: string;
  listToClosePct: number | null;
  medianClosePrice: number | null;
  medianDaysOnMarket: number | null;
  medianPricePerSqft: number | null;
  months: number;
  soldCount: number;
}

export interface CityMarketStats {
  city: string;
  months: number;
  summary: MarketSummary;
  trend: MonthlyMarketTrend[];
}

export interface MarketQuestionOutput {
  city: string | null;
  months: number;
  reply: string;
  summary: MarketSummary | null;
  trend: MonthlyMarketTrend[];
}

export type MarketSummaryHandler = (city: string, months?: number) => Promise<CityMarketStats>;

export interface MarketQuestionOptions {
  getMarketSummary?: MarketSummaryHandler;
}

type RawMarketRow = Record<string, unknown>;

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 120;
const RESIDENTIAL_PROPERTY_TYPE = "Residential";

function normalizeMonths(months: number | undefined): number {
  if (months === undefined || !Number.isFinite(months)) {
    return DEFAULT_MONTHS;
  }

  const safeMonths = Math.trunc(months);
  if (safeMonths < 1) {
    return DEFAULT_MONTHS;
  }

  return Math.min(safeMonths, MAX_MONTHS);
}

function normalizeCity(city: string): string {
  const normalized = city.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("city is required for market statistics queries.");
  }
  return normalized;
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function extractMarketCity(message: string): string | null {
  const prepositionMatch = message.match(
    /\b(?:in|for|near|around|about)\s+([A-Za-z]+(?:[\s-]+[A-Za-z]+){0,4})(?=\s*(?:[?.,!]|$|\b(?:over|during|last|past|market|trend|trends|price|prices|now|today|this|by|with|from)\b))/i
  );
  if (prepositionMatch) {
    return toTitleCase(prepositionMatch[1]);
  }

  const leadingCityMatch = message.match(
    /^\s*([A-Za-z]+(?:[\s-]+[A-Za-z]+){0,3}?)\s+(?:market|housing|stats|statistics|summary)\b/i
  );
  return leadingCityMatch ? toTitleCase(leadingCityMatch[1]) : null;
}

export function buildCityMarketRowsQuery(city: string, months = DEFAULT_MONTHS): MarketRowsQuery {
  const safeCity = normalizeCity(city);
  const safeMonths = normalizeMonths(months);

  return {
    criteria: {
      city: safeCity,
      months: safeMonths,
      propertyType: RESIDENTIAL_PROPERTY_TYPE
    },
    params: [safeCity, RESIDENTIAL_PROPERTY_TYPE, safeMonths],
    sql: `
      SELECT
        City, CloseDate, ClosePrice, ListPrice,
        DaysOnMarket, LivingArea, PropertyType
      FROM california_sold
      WHERE City = ?
        AND PropertyType = ?
        AND CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        AND ClosePrice IS NOT NULL
      ORDER BY CloseDate ASC
    `.trim()
  };
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return stringValue(value);
}

export function formatCityMarketRow(row: RawMarketRow): CityMarketRow {
  return {
    city: stringValue(row.City),
    closeDate: dateValue(row.CloseDate),
    closePrice: numberValue(row.ClosePrice),
    daysOnMarket: numberValue(row.DaysOnMarket),
    listPrice: numberValue(row.ListPrice),
    livingArea: numberValue(row.LivingArea),
    propertyType: stringValue(row.PropertyType)
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[midpoint];
  }

  return (sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2;
}

function roundValue(value: number | null, digits = 0): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function validNumbers(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function pricePerSqft(row: CityMarketRow): number | null {
  if (row.closePrice === null || row.livingArea === null || row.livingArea <= 0) {
    return null;
  }

  return row.closePrice / row.livingArea;
}

function listToCloseRatio(row: CityMarketRow): number | null {
  if (row.closePrice === null || row.listPrice === null || row.listPrice <= 0) {
    return null;
  }

  return (row.closePrice / row.listPrice) * 100;
}

function monthKey(closeDate: string | null): string | null {
  if (!closeDate) {
    return null;
  }

  const matchedDate = closeDate.match(/^(\d{4})-(\d{2})/);
  if (matchedDate) {
    return `${matchedDate[1]}-${matchedDate[2]}`;
  }

  const parsedDate = new Date(closeDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const year = parsedDate.getUTCFullYear();
  const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildMonthlyTrend(rows: CityMarketRow[]): MonthlyMarketTrend[] {
  const monthBuckets = new Map<string, CityMarketRow[]>();

  for (const row of rows) {
    const month = monthKey(row.closeDate);
    if (!month) {
      continue;
    }

    monthBuckets.set(month, [...(monthBuckets.get(month) ?? []), row]);
  }

  let previousAvgPrice: number | null = null;
  return [...monthBuckets.entries()]
    .sort(([leftMonth], [rightMonth]) => leftMonth.localeCompare(rightMonth))
    .map(([month, monthRows]) => {
      const closePrices = validNumbers(monthRows.map((row) => row.closePrice));
      const avgPrice = roundValue(average(closePrices));
      const priceChangePct = previousAvgPrice && avgPrice
        ? roundValue(((avgPrice - previousAvgPrice) / previousAvgPrice) * 100, 1)
        : null;
      previousAvgPrice = avgPrice;

      return {
        avgDaysOnMarket: roundValue(average(validNumbers(monthRows.map((row) => row.daysOnMarket))), 1),
        avgPrice,
        avgPricePerSqft: roundValue(average(validNumbers(monthRows.map(pricePerSqft)))),
        medianPrice: roundValue(median(closePrices)),
        month,
        priceChangePct,
        sales: monthRows.length
      };
    });
}

function buildSummary(city: string, months: number, rows: CityMarketRow[]): MarketSummary {
  const closePrices = validNumbers(rows.map((row) => row.closePrice));
  const pricePerSqftValues = validNumbers(rows.map(pricePerSqft));
  const domValues = validNumbers(rows.map((row) => row.daysOnMarket));
  const listToCloseValues = validNumbers(rows.map(listToCloseRatio));

  return {
    averageClosePrice: roundValue(average(closePrices)),
    averageDaysOnMarket: roundValue(average(domValues), 1),
    averagePricePerSqft: roundValue(average(pricePerSqftValues)),
    city,
    listToClosePct: roundValue(average(listToCloseValues), 1),
    medianClosePrice: roundValue(median(closePrices)),
    medianDaysOnMarket: roundValue(median(domValues), 1),
    medianPricePerSqft: roundValue(median(pricePerSqftValues)),
    months,
    soldCount: rows.length
  };
}

export function buildCityMarketStats(
  city: string,
  months: number,
  rows: CityMarketRow[]
): CityMarketStats {
  const safeCity = normalizeCity(city);
  const safeMonths = normalizeMonths(months);

  return {
    city: safeCity,
    months: safeMonths,
    summary: buildSummary(safeCity, safeMonths, rows),
    trend: buildMonthlyTrend(rows)
  };
}

export async function getCityMarketSummary(city: string, months = DEFAULT_MONTHS): Promise<CityMarketStats> {
  const builtQuery = buildCityMarketRowsQuery(city, months);
  const rows = await query<RawMarketRow>(builtQuery.sql, builtQuery.params);
  return buildCityMarketStats(
    String(builtQuery.criteria.city),
    Number(builtQuery.criteria.months),
    rows.map(formatCityMarketRow)
  );
}

function formatCurrency(value: number | null): string {
  if (value === null) {
    return "unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatNumber(value: number | null, suffix: string): string {
  return value === null ? "unavailable" : `${value}${suffix}`;
}

function formatPercent(value: number | null): string {
  return value === null ? "unavailable" : `${value}%`;
}

function formatTrendRow(row: MonthlyMarketTrend): string {
  const change = row.priceChangePct === null
    ? "first month"
    : `${row.priceChangePct > 0 ? "+" : ""}${row.priceChangePct}% MoM`;

  return `${row.month}: ${formatCurrency(row.avgPrice)} avg, ${row.sales} sale(s), ${change}`;
}

export function formatMarketStatsReply(stats: CityMarketStats): string {
  if (stats.summary.soldCount === 0) {
    return `I could not find sold residential records for ${stats.city} in the last ${stats.months} month(s).`;
  }

  const trendLines = stats.trend.slice(-3).map(formatTrendRow);
  const lines = [
    `Market summary for ${stats.city} over the last ${stats.months} month(s):`,
    `Sold comps: ${stats.summary.soldCount}. Median close price: ${formatCurrency(stats.summary.medianClosePrice)}; average close price: ${formatCurrency(stats.summary.averageClosePrice)}.`,
    `Median price per sqft: ${formatCurrency(stats.summary.medianPricePerSqft)}; average DOM: ${formatNumber(stats.summary.averageDaysOnMarket, " days")}.`,
    `List-to-close ratio: ${formatPercent(stats.summary.listToClosePct)}.`
  ];

  if (trendLines.length > 0) {
    lines.push(`Recent trend: ${trendLines.join(" | ")}.`);
  }

  return lines.join("\n");
}

export async function handleMarketQuestion(
  input: MarketQuestionInput,
  options: MarketQuestionOptions = {}
): Promise<MarketQuestionOutput> {
  if (!input?.message || typeof input.message !== "string") {
    throw new Error("A non-empty message string is required.");
  }

  const months = normalizeMonths(input.months);
  const city = input.city ? normalizeCity(input.city) : extractMarketCity(input.message);
  if (!city) {
    return {
      city: null,
      months,
      reply: "Which California city should I analyze?",
      summary: null,
      trend: []
    };
  }

  const getMarketSummary = options.getMarketSummary ?? getCityMarketSummary;
  const stats = await getMarketSummary(city, months);
  return {
    city: stats.city,
    months: stats.months,
    reply: formatMarketStatsReply(stats),
    summary: stats.summary,
    trend: stats.trend
  };
}
