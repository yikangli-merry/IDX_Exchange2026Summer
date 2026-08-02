import { query as runQuery } from "./db.ts";
import { formatActiveListingRow, type ActiveListing } from "./mlsQueries.ts";
import {
  cosineSimilarity,
  defaultEmbeddingModel,
  parseEmbedding
} from "./semanticSearch.ts";

type RawRow = Record<string, unknown>;
type QueryRunner = <TRow extends RawRow = RawRow>(sql: string, params?: unknown[]) => Promise<TRow[]>;

export const DEFAULT_RECOMMENDATION_TOP_K = 5;
export const MAX_RECOMMENDATION_TOP_K = 50;
export const DEFAULT_COMP_VALIDATION_MONTHS = 6;
export const RESIDENTIAL_PROPERTY_TYPE = "Residential";

export interface RecommendationBuiltQuery {
  criteria: Record<string, number | string>;
  params: unknown[];
  sql: string;
}

export interface HybridSimilarityScore {
  priceDelta: number | null;
  reasons: string[];
  semanticScore: number;
  semanticSimilarity: number;
  sqftDelta: number | null;
  structuredScore: number;
  totalScore: number;
}

export interface CompValidation {
  avgPricePerSqft: number | null;
  city: string | null;
  compCount: number;
  compPrice: number | null;
  deltaPct: number | null;
  listPrice: number | null;
  months: number;
  sqft: number | null;
  status: "missing_input" | "no_comps" | "validated";
}

export interface ListingRecommendation extends ActiveListing {
  compValidation: CompValidation;
  rank: number;
  score: HybridSimilarityScore;
}

export interface ValidateListingWithCompsOptions {
  queryRunner?: QueryRunner;
  rows?: RawRow[];
}

export interface RecommendSimilarListingsOptions {
  compValidator?: (listing: ActiveListing) => Promise<CompValidation>;
  model?: string;
  queryRunner?: QueryRunner;
  recommendationRows?: RawRow[];
}

function normalizePositiveInteger(
  value: number | undefined,
  defaultValue: number,
  maxValue = Number.POSITIVE_INFINITY
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

export function normalizeRecommendationTopK(topK = DEFAULT_RECOMMENDATION_TOP_K): number {
  return normalizePositiveInteger(topK, DEFAULT_RECOMMENDATION_TOP_K, MAX_RECOMMENDATION_TOP_K);
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

function normalizeCity(city: string): string {
  const normalized = city.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("city is required for comp validation.");
  }
  return normalized;
}

function normalizeSqft(sqft: number): number {
  if (!Number.isFinite(sqft) || sqft <= 0) {
    throw new Error("sqft must be a positive number for comp validation.");
  }
  return sqft;
}

function normalizePrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("price must be a positive number for comp validation.");
  }
  return price;
}

function roundValue(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function roundCurrency(value: number | null): number | null {
  return roundValue(value, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function sameText(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function listingIdValue(listing: ActiveListing): string {
  return String(listing.listingId ?? "");
}

function rowRole(row: RawRow): string | null {
  return stringValue(row.recommendation_role ?? row.role);
}

function rowListingId(row: RawRow): string {
  return String(row.ListingID ?? row.listingId ?? "");
}

function rowEmbedding(row: RawRow): number[] | null {
  return parseEmbedding(row.embedding ?? row.cached_embedding);
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

function formatPercent(value: number | null): string {
  return value === null ? "unavailable" : `${value > 0 ? "+" : ""}${value}%`;
}

export function buildRecommendationRowsQuery(
  listingId: string | number,
  model = defaultEmbeddingModel()
): RecommendationBuiltQuery {
  const safeListingId = stringValue(listingId);
  if (!safeListingId) {
    throw new Error("listingId is required for recommendations.");
  }

  return {
    criteria: {
      listingId: safeListingId,
      model,
      status: "Active"
    },
    params: [safeListingId, "Active", model, "Active", model, safeListingId],
    sql: `
      SELECT
        'target' AS recommendation_role,
        r.ListingID, r.L_DisplayId, r.L_Address, r.L_City, r.L_Zip,
        r.L_SystemPrice AS price, r.L_Keyword2 AS beds, r.LM_Dec_3 AS baths,
        r.LM_Int2_3 AS sqft, r.L_Type_ AS type, r.L_Status AS status,
        r.LMD_MP_Latitude AS lat, r.LMD_MP_Longitude AS lng,
        r.YearBuilt, r.AssociationFee, r.DaysOnMarket,
        r.PoolPrivateYN, r.ViewYN, r.FireplaceYN, r.PhotoCount,
        r.LA1_UserFirstName, r.LA1_UserLastName, r.LO1_OrganizationName,
        e.embedding, e.embedding_model, e.content_hash
      FROM rets_property r
      INNER JOIN rets_property_embeddings e
        ON CAST(r.ListingID AS CHAR) = e.ListingID
      WHERE CAST(r.ListingID AS CHAR) = ?
        AND r.L_Status = ?
        AND e.embedding_model = ?
      UNION ALL
      SELECT
        'candidate' AS recommendation_role,
        r.ListingID, r.L_DisplayId, r.L_Address, r.L_City, r.L_Zip,
        r.L_SystemPrice AS price, r.L_Keyword2 AS beds, r.LM_Dec_3 AS baths,
        r.LM_Int2_3 AS sqft, r.L_Type_ AS type, r.L_Status AS status,
        r.LMD_MP_Latitude AS lat, r.LMD_MP_Longitude AS lng,
        r.YearBuilt, r.AssociationFee, r.DaysOnMarket,
        r.PoolPrivateYN, r.ViewYN, r.FireplaceYN, r.PhotoCount,
        r.LA1_UserFirstName, r.LA1_UserLastName, r.LO1_OrganizationName,
        e.embedding, e.embedding_model, e.content_hash
      FROM rets_property r
      INNER JOIN rets_property_embeddings e
        ON CAST(r.ListingID AS CHAR) = e.ListingID
      WHERE r.L_Status = ?
        AND e.embedding_model = ?
        AND CAST(r.ListingID AS CHAR) <> ?
      ORDER BY ListingID ASC
    `.trim()
  };
}

export function buildCompValidationQuery(
  city: string,
  sqft: number,
  months = DEFAULT_COMP_VALIDATION_MONTHS
): RecommendationBuiltQuery {
  const safeCity = normalizeCity(city);
  const safeSqft = normalizeSqft(sqft);
  const safeMonths = normalizePositiveInteger(months, DEFAULT_COMP_VALIDATION_MONTHS, 120);
  const minSqft = roundValue(safeSqft * 0.8, 2) ?? safeSqft * 0.8;
  const maxSqft = roundValue(safeSqft * 1.2, 2) ?? safeSqft * 1.2;

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
        AVG(ClosePrice / NULLIF(LivingArea, 0)) AS avg_ppsf,
        COUNT(*) AS comp_count
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

export function calculateHybridSimilarityScore(
  target: ActiveListing,
  candidate: ActiveListing,
  targetEmbedding: number[],
  candidateEmbedding: number[]
): HybridSimilarityScore {
  let structuredScore = 0;
  const reasons: string[] = [];

  const priceDelta = target.price !== null && candidate.price !== null
    ? Math.abs(target.price - candidate.price)
    : null;
  if (priceDelta !== null) {
    if (priceDelta < 50_000) {
      structuredScore += 20;
      reasons.push("price within $50,000");
    } else if (priceDelta < 150_000) {
      structuredScore += 12;
      reasons.push("price within $150,000");
    } else if (priceDelta < 300_000) {
      structuredScore += 5;
      reasons.push("price within $300,000");
    }
  }

  if (target.beds !== null && candidate.beds !== null && target.beds === candidate.beds) {
    structuredScore += 15;
    reasons.push("same bedroom count");
  }

  if (sameText(target.city, candidate.city)) {
    structuredScore += 15;
    reasons.push("same city");
  }

  const sqftDelta = target.sqft !== null && candidate.sqft !== null
    ? Math.abs(target.sqft - candidate.sqft)
    : null;
  if (sqftDelta !== null) {
    if (sqftDelta < 300) {
      structuredScore += 10;
      reasons.push("square footage within 300 sqft");
    } else if (sqftDelta < 700) {
      structuredScore += 5;
      reasons.push("square footage within 700 sqft");
    }
  }

  const semanticSimilarity = cosineSimilarity(targetEmbedding, candidateEmbedding);
  const semanticScore = roundValue(clamp(semanticSimilarity, 0, 1) * 40, 2) ?? 0;
  const totalScore = roundValue(structuredScore + semanticScore, 2) ?? structuredScore;

  if (semanticScore > 0) {
    reasons.push(`semantic similarity ${roundValue(semanticSimilarity * 100, 1)}%`);
  }

  return {
    priceDelta,
    reasons,
    semanticScore,
    semanticSimilarity: roundValue(semanticSimilarity, 4) ?? 0,
    sqftDelta,
    structuredScore,
    totalScore
  };
}

export async function validateListingWithComps(
  city: string | null | undefined,
  sqft: number | null | undefined,
  price: number | null | undefined,
  months = DEFAULT_COMP_VALIDATION_MONTHS,
  options: ValidateListingWithCompsOptions = {}
): Promise<CompValidation> {
  const safeMonths = normalizePositiveInteger(months, DEFAULT_COMP_VALIDATION_MONTHS, 120);
  const safeCity = typeof city === "string" ? city.trim().replace(/\s+/g, " ") : "";
  const safeSqft = numberValue(sqft);
  const safePrice = numberValue(price);

  if (!safeCity || safeSqft === null || safeSqft <= 0 || safePrice === null || safePrice <= 0) {
    return {
      avgPricePerSqft: null,
      city: safeCity || null,
      compCount: 0,
      compPrice: null,
      deltaPct: null,
      listPrice: safePrice,
      months: safeMonths,
      sqft: safeSqft,
      status: "missing_input"
    };
  }

  const rows = options.rows ?? await (async () => {
    const builtQuery = buildCompValidationQuery(safeCity, safeSqft, safeMonths);
    const queryRunner = options.queryRunner ?? runQuery;
    return queryRunner<RawRow>(builtQuery.sql, builtQuery.params);
  })();

  const firstRow = rows[0] ?? {};
  const avgPricePerSqft = numberValue(firstRow.avg_ppsf ?? firstRow.avgPpsf);
  const compCount = numberValue(firstRow.comp_count ?? firstRow.compCount) ?? 0;

  if (compCount <= 0 || avgPricePerSqft === null || avgPricePerSqft <= 0) {
    return {
      avgPricePerSqft: avgPricePerSqft === null ? null : roundValue(avgPricePerSqft, 2),
      city: safeCity,
      compCount,
      compPrice: null,
      deltaPct: null,
      listPrice: safePrice,
      months: safeMonths,
      sqft: safeSqft,
      status: "no_comps"
    };
  }

  const compPrice = avgPricePerSqft * safeSqft;
  return {
    avgPricePerSqft: roundValue(avgPricePerSqft, 2),
    city: safeCity,
    compCount,
    compPrice: roundCurrency(compPrice),
    deltaPct: roundValue(((safePrice - compPrice) / compPrice) * 100, 1),
    listPrice: safePrice,
    months: safeMonths,
    sqft: safeSqft,
    status: "validated"
  };
}

function findTargetRow(rows: RawRow[], listingId: string): RawRow | null {
  return rows.find((row) => rowRole(row) === "target")
    ?? rows.find((row) => rowListingId(row) === listingId)
    ?? null;
}

function candidateRows(rows: RawRow[], targetListingId: string): RawRow[] {
  return rows.filter((row) => {
    const role = rowRole(row);
    const id = rowListingId(row);
    return id && id !== targetListingId && role !== "target";
  });
}

function compareRecommendations(left: ListingRecommendation, right: ListingRecommendation): number {
  const totalDifference = right.score.totalScore - left.score.totalScore;
  if (totalDifference !== 0) {
    return totalDifference;
  }

  const semanticDifference = right.score.semanticScore - left.score.semanticScore;
  if (semanticDifference !== 0) {
    return semanticDifference;
  }

  const leftPriceDelta = left.score.priceDelta ?? Number.POSITIVE_INFINITY;
  const rightPriceDelta = right.score.priceDelta ?? Number.POSITIVE_INFINITY;
  if (leftPriceDelta !== rightPriceDelta) {
    return leftPriceDelta - rightPriceDelta;
  }

  return listingIdValue(left).localeCompare(listingIdValue(right));
}

export async function recommendSimilarListingsForListing(
  listingId: string | number,
  topK = DEFAULT_RECOMMENDATION_TOP_K,
  options: RecommendSimilarListingsOptions = {}
): Promise<ListingRecommendation[]> {
  const safeListingId = stringValue(listingId);
  if (!safeListingId) {
    throw new Error("listingId is required for recommendations.");
  }

  const model = options.model ?? defaultEmbeddingModel();
  const rows = options.recommendationRows ?? await (async () => {
    const builtQuery = buildRecommendationRowsQuery(safeListingId, model);
    const queryRunner = options.queryRunner ?? runQuery;
    return queryRunner<RawRow>(builtQuery.sql, builtQuery.params);
  })();

  const targetRow = findTargetRow(rows, safeListingId);
  if (!targetRow) {
    throw new Error("Target active listing with cached embedding was not found.");
  }

  const targetEmbedding = rowEmbedding(targetRow);
  if (!targetEmbedding) {
    throw new Error("Target listing must have a cached embedding.");
  }

  const targetListing = formatActiveListingRow(targetRow);
  const scored = candidateRows(rows, rowListingId(targetRow)).flatMap((row) => {
    const candidateEmbedding = rowEmbedding(row);
    if (!candidateEmbedding || candidateEmbedding.length !== targetEmbedding.length) {
      return [];
    }

    const candidate = formatActiveListingRow(row);
    return [{
      candidate,
      score: calculateHybridSimilarityScore(
        targetListing,
        candidate,
        targetEmbedding,
        candidateEmbedding
      )
    }];
  });

  const recommendationLimit = normalizeRecommendationTopK(topK);
  const ordered = scored
    .map((item) => ({
      ...item.candidate,
      compValidation: {
        avgPricePerSqft: null,
        city: item.candidate.city,
        compCount: 0,
        compPrice: null,
        deltaPct: null,
        listPrice: item.candidate.price,
        months: DEFAULT_COMP_VALIDATION_MONTHS,
        sqft: item.candidate.sqft,
        status: "missing_input" as const
      },
      rank: 0,
      score: item.score
    }))
    .sort(compareRecommendations)
    .slice(0, recommendationLimit);

  const compValidator = options.compValidator
    ?? ((listing: ActiveListing) => validateListingWithComps(
      listing.city,
      listing.sqft,
      listing.price,
      DEFAULT_COMP_VALIDATION_MONTHS,
      { queryRunner: options.queryRunner }
    ));

  return Promise.all(ordered.map(async (recommendation, index) => ({
    ...recommendation,
    compValidation: await compValidator(recommendation),
    rank: index + 1
  })));
}

function formatCompValidation(validation: CompValidation): string {
  if (validation.status === "validated") {
    return `Comps: ${formatCurrency(validation.compPrice)} supported by ${validation.compCount} sold comp(s); list is ${formatPercent(validation.deltaPct)} vs comps.`;
  }

  if (validation.status === "no_comps") {
    return "Comps: no recent sold comps found for this city and size range.";
  }

  return "Comps: unavailable because city, sqft, or list price is missing.";
}

export function formatRecommendationReply(recommendations: ListingRecommendation[]): string {
  if (recommendations.length === 0) {
    return "I could not find similar active listings with cached embeddings yet.";
  }

  const lines = [`Top ${recommendations.length} similar active listing(s):`];
  for (const recommendation of recommendations) {
    const location = [recommendation.address, recommendation.city].filter(Boolean).join(", ") || "Address unavailable";
    const reasons = recommendation.score.reasons.length > 0
      ? recommendation.score.reasons.join("; ")
      : "semantic and listing-field similarity";

    lines.push(
      `${recommendation.rank}. ${location} - ${formatCurrency(recommendation.price)}`,
      `Score: ${recommendation.score.totalScore}/100 (structured ${recommendation.score.structuredScore}, semantic ${recommendation.score.semanticScore}).`,
      `Why: ${reasons}.`,
      formatCompValidation(recommendation.compValidation)
    );
  }

  return lines.join("\n");
}
