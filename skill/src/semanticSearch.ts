import { createHash } from "node:crypto";
import OpenAI from "openai";
import { query as runQuery } from "./db.ts";
import { formatActiveListingRow, type ActiveListing } from "./mlsQueries.ts";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_SEMANTIC_TOP_K = 5;
export const MAX_SEMANTIC_TOP_K = 50;
export const MAX_EMBEDDING_TEXT_CHARS = 8000;
export const RETS_LISTING_ID_SQL = "CAST(r.L_ListingID AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci";

type RawRow = Record<string, unknown>;

export interface SemanticBuiltQuery {
  params: unknown[];
  sql: string;
}

export interface SemanticListingResult extends ActiveListing {
  rank: number;
  similarityScore: number;
}

export interface ListingEmbeddingRecord {
  contentHash: string;
  embedding: number[];
  listingId: string;
  model: string;
}

export interface ListingEmbeddingGenerationSummary {
  generated: number;
  scanned: number;
  skipped: number;
}

export interface ListingEmbeddingGenerationProgress {
  generated: number;
  listingId?: string;
  processed: number;
  skipped: number;
  total: number;
}

export type EmbeddingProvider = (text: string, model: string) => Promise<number[]>;

export interface FindSimilarListingsOptions {
  cachedRows?: RawRow[];
  embeddingProvider?: EmbeddingProvider;
  model?: string;
}

export interface GenerateListingEmbeddingsOptions {
  embeddingProvider?: EmbeddingProvider;
  ensureTable?: boolean;
  model?: string;
  onProgress?: (progress: ListingEmbeddingGenerationProgress) => void;
  saveEmbedding?: (record: ListingEmbeddingRecord) => Promise<void>;
  sourceRows?: RawRow[];
}

export interface OpenAIEmbeddingClient {
  embeddings: {
    create: (params: {
      encoding_format: "float";
      input: string;
      model: string;
    }) => Promise<{ data: Array<{ embedding: number[] }> }>;
  };
}

let openaiClient: OpenAIEmbeddingClient | null = null;

export function defaultEmbeddingModel(env: Record<string, string | undefined> = process.env): string {
  return env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function getOpenAIClient(): OpenAIEmbeddingClient {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
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

export function normalizeTopK(topK = DEFAULT_SEMANTIC_TOP_K): number {
  return normalizePositiveInteger(topK, DEFAULT_SEMANTIC_TOP_K, MAX_SEMANTIC_TOP_K);
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

function firstValue(row: RawRow, keys: string[]): unknown {
  return keys.map((key) => row[key]).find((value) => value !== null && value !== undefined && value !== "");
}

function firstString(row: RawRow, keys: string[]): string | null {
  return stringValue(firstValue(row, keys));
}

function firstNumber(row: RawRow, keys: string[]): number | null {
  return numberValue(firstValue(row, keys));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatCount(value: number | null, unit: string): string | null {
  return value === null ? null : `${value.toLocaleString("en-US")} ${unit}`;
}

export function normalizeEmbeddingInput(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_EMBEDDING_TEXT_CHARS);
}

export function buildListingEmbeddingText(row: RawRow): string {
  const type = firstString(row, ["L_Type_", "type"]);
  const city = firstString(row, ["L_City", "city"]);
  const zip = firstString(row, ["L_Zip", "zip"]);
  const beds = firstNumber(row, ["L_Keyword2", "beds"]);
  const baths = firstNumber(row, ["LM_Dec_3", "baths"]);
  const sqft = firstNumber(row, ["LM_Int2_3", "sqft"]);
  const yearBuilt = firstNumber(row, ["YearBuilt", "yearBuilt"]);
  const price = firstNumber(row, ["L_SystemPrice", "price"]);
  const remarks = firstString(row, ["L_Remarks", "remarks"]);

  const location = [city, zip].filter(Boolean).join(" ");
  const parts = [
    [type ?? "Property", location ? `in ${location}, CA` : null].filter(Boolean).join(" "),
    [formatCount(beds, "beds"), formatCount(baths, "baths")].filter(Boolean).join(", "),
    formatCount(sqft, "sq ft"),
    yearBuilt === null ? null : `Built ${yearBuilt}.`,
    price === null ? null : `Price: ${formatCurrency(price)}.`,
    remarks
  ].filter((part): part is string => Boolean(part));

  return normalizeEmbeddingInput(parts.join(" "));
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function parseEmbedding(value: unknown): number[] | null {
  let parsed = value;

  if (parsed instanceof Uint8Array) {
    parsed = Buffer.from(parsed).toString("utf8");
  }

  if (typeof parsed === "string") {
    const trimmed = parsed.trim();
    if (!trimmed) {
      return null;
    }

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }

  if (parsed.some((value) => value === null || value === undefined || value === "")) {
    return null;
  }

  const embedding = parsed.map((value) => Number(value));
  return embedding.every(Number.isFinite) ? embedding : null;
}

function requireEmbedding(value: unknown, label: string): number[] {
  const embedding = parseEmbedding(value);
  if (!embedding) {
    throw new Error(`${label} must be a non-empty numeric embedding vector.`);
  }
  return embedding;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export async function getEmbedding(
  text: string,
  model = defaultEmbeddingModel(),
  client: OpenAIEmbeddingClient = getOpenAIClient()
): Promise<number[]> {
  const input = normalizeEmbeddingInput(text);
  if (!input) {
    throw new Error("A non-empty text string is required to create an embedding.");
  }

  const response = await client.embeddings.create({
    encoding_format: "float",
    input,
    model
  });

  return requireEmbedding(response.data?.[0]?.embedding, "OpenAI embedding response");
}

export function buildCreateListingEmbeddingsTableQuery(): string {
  return `
    CREATE TABLE IF NOT EXISTS rets_property_embeddings (
      ListingID VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
      embedding JSON NOT NULL,
      embedding_model VARCHAR(100) NOT NULL,
      content_hash CHAR(64) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_rets_property_embeddings_model (embedding_model),
      INDEX idx_rets_property_embeddings_hash (content_hash)
    )
  `.trim();
}

export function buildActiveListingEmbeddingSourceQuery(
  model = defaultEmbeddingModel(),
  limit?: number
): SemanticBuiltQuery {
  const params: unknown[] = [model, "Active"];
  const limitClause = limit === undefined ? "" : `LIMIT ${normalizePositiveInteger(limit, 100)}`;

  return {
    params,
    sql: `
      SELECT
        r.L_ListingID AS ListingID, r.L_DisplayId, r.L_Address, r.L_City, r.L_Zip,
        r.L_SystemPrice AS price, r.L_Keyword2 AS beds, r.LM_Dec_3 AS baths,
        r.LM_Int2_3 AS sqft, r.L_Type_ AS type, r.L_Status AS status,
        r.LMD_MP_Latitude AS lat, r.LMD_MP_Longitude AS lng,
        r.YearBuilt, r.AssociationFee, r.DaysOnMarket, r.L_Remarks,
        r.PoolPrivateYN, r.ViewYN, r.FireplaceYN, r.PhotoCount,
        r.LA1_UserFirstName, r.LA1_UserLastName, r.LO1_OrganizationName,
        e.embedding AS cached_embedding,
        e.embedding_model AS cached_embedding_model,
        e.content_hash AS cached_content_hash
      FROM rets_property r
      LEFT JOIN rets_property_embeddings e
        ON ${RETS_LISTING_ID_SQL} = e.ListingID COLLATE utf8mb4_unicode_ci
        AND e.embedding_model = ?
      WHERE r.L_Status = ?
      ORDER BY r.L_ListingID ASC
      ${limitClause}
    `.trim()
  };
}

export function buildSemanticListingCacheQuery(model = defaultEmbeddingModel()): SemanticBuiltQuery {
  return {
    params: ["Active", model],
    sql: `
      SELECT
        r.L_ListingID AS ListingID, r.L_DisplayId, r.L_Address, r.L_City, r.L_Zip,
        r.L_SystemPrice AS price, r.L_Keyword2 AS beds, r.LM_Dec_3 AS baths,
        r.LM_Int2_3 AS sqft, r.L_Type_ AS type, r.L_Status AS status,
        r.LMD_MP_Latitude AS lat, r.LMD_MP_Longitude AS lng,
        r.YearBuilt, r.AssociationFee, r.DaysOnMarket,
        r.PoolPrivateYN, r.ViewYN, r.FireplaceYN, r.PhotoCount,
        r.LA1_UserFirstName, r.LA1_UserLastName, r.LO1_OrganizationName,
        e.embedding, e.embedding_model, e.content_hash
      FROM rets_property r
      INNER JOIN rets_property_embeddings e
        ON ${RETS_LISTING_ID_SQL} = e.ListingID COLLATE utf8mb4_unicode_ci
      WHERE r.L_Status = ?
        AND e.embedding_model = ?
      ORDER BY r.L_ListingID ASC
    `.trim()
  };
}

export function buildUpsertListingEmbeddingQuery(record: ListingEmbeddingRecord): SemanticBuiltQuery {
  return {
    params: [
      record.listingId,
      JSON.stringify(record.embedding),
      record.model,
      record.contentHash
    ],
    sql: `
      INSERT INTO rets_property_embeddings
        (ListingID, embedding, embedding_model, content_hash)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        embedding = VALUES(embedding),
        embedding_model = VALUES(embedding_model),
        content_hash = VALUES(content_hash),
        updated_at = CURRENT_TIMESTAMP
    `.trim()
  };
}

export async function ensureListingEmbeddingCacheTable(): Promise<void> {
  await runQuery<RawRow>(buildCreateListingEmbeddingsTableQuery());
}

async function saveListingEmbedding(record: ListingEmbeddingRecord): Promise<void> {
  const builtQuery = buildUpsertListingEmbeddingQuery(record);
  await runQuery<RawRow>(builtQuery.sql, builtQuery.params);
}

function listingId(row: RawRow): string | null {
  return stringValue(firstValue(row, ["ListingID", "L_ListingID", "listingId"]));
}

function hasCurrentCachedEmbedding(row: RawRow, hash: string, model: string): boolean {
  return (
    stringValue(row.cached_content_hash) === hash &&
    stringValue(row.cached_embedding_model) === model &&
    parseEmbedding(row.cached_embedding) !== null
  );
}

export async function generateListingEmbeddings(
  limit?: number,
  options: GenerateListingEmbeddingsOptions = {}
): Promise<ListingEmbeddingGenerationSummary> {
  const model = options.model ?? defaultEmbeddingModel();
  const embeddingProvider = options.embeddingProvider ?? getEmbedding;
  const save = options.saveEmbedding ?? saveListingEmbedding;

  if (options.ensureTable !== false) {
    await ensureListingEmbeddingCacheTable();
  }

  const rows = options.sourceRows ?? await (async () => {
    const builtQuery = buildActiveListingEmbeddingSourceQuery(model, limit);
    return runQuery<RawRow>(builtQuery.sql, builtQuery.params);
  })();

  const summary = {
    generated: 0,
    scanned: rows.length,
    skipped: 0
  };
  let processed = 0;

  const emitProgress = (listingId?: string): void => {
    options.onProgress?.({
      generated: summary.generated,
      listingId,
      processed,
      skipped: summary.skipped,
      total: summary.scanned
    });
  };

  emitProgress();

  for (const row of rows) {
    const id = listingId(row);
    const text = buildListingEmbeddingText(row);

    if (!id || !text) {
      summary.skipped += 1;
      processed += 1;
      emitProgress(id ?? undefined);
      continue;
    }

    const hash = contentHash(text);
    if (hasCurrentCachedEmbedding(row, hash, model)) {
      summary.skipped += 1;
      processed += 1;
      emitProgress(id);
      continue;
    }

    const embedding = requireEmbedding(await embeddingProvider(text, model), "listing embedding");
    await save({
      contentHash: hash,
      embedding,
      listingId: id,
      model
    });
    summary.generated += 1;
    processed += 1;
    emitProgress(id);
  }

  return summary;
}

export async function findSimilarListings(
  searchText: string,
  topK = DEFAULT_SEMANTIC_TOP_K,
  options: FindSimilarListingsOptions = {}
): Promise<SemanticListingResult[]> {
  const queryText = normalizeEmbeddingInput(searchText);
  if (!queryText) {
    throw new Error("A non-empty search query is required.");
  }

  const model = options.model ?? defaultEmbeddingModel();
  const embeddingProvider = options.embeddingProvider ?? getEmbedding;
  const queryEmbedding = requireEmbedding(
    await embeddingProvider(queryText, model),
    "query embedding"
  );

  const rows = options.cachedRows ?? await (async () => {
    const builtQuery = buildSemanticListingCacheQuery(model);
    return runQuery<RawRow>(builtQuery.sql, builtQuery.params);
  })();

  const scoredListings = rows.flatMap((row) => {
    const listingEmbedding = parseEmbedding(row.embedding);
    if (!listingEmbedding || listingEmbedding.length !== queryEmbedding.length) {
      return [];
    }

    return [{
      listing: formatActiveListingRow(row),
      similarityScore: cosineSimilarity(queryEmbedding, listingEmbedding)
    }];
  });

  return scoredListings
    .sort((left, right) => {
      const scoreDifference = right.similarityScore - left.similarityScore;
      if (scoreDifference !== 0) {
        return scoreDifference;
      }
      return String(left.listing.listingId ?? "").localeCompare(String(right.listing.listingId ?? ""));
    })
    .slice(0, normalizeTopK(topK))
    .map((item, index) => ({
      ...item.listing,
      rank: index + 1,
      similarityScore: item.similarityScore
    }));
}
