import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveListingEmbeddingSourceQuery,
  buildCreateListingEmbeddingsTableQuery,
  buildListingEmbeddingText,
  buildSemanticListingCacheQuery,
  buildUpsertListingEmbeddingQuery,
  contentHash,
  cosineSimilarity,
  findSimilarListings,
  generateListingEmbeddings,
  getEmbedding,
  parseEmbedding
} from "../src/semanticSearch.ts";

function cachedListing(id, embedding, overrides = {}) {
  return {
    AssociationFee: null,
    DaysOnMarket: 4,
    FireplaceYN: "False",
    L_Address: `${id} Main St`,
    L_City: "Irvine",
    L_DisplayId: `OC${id}`,
    L_Zip: "92618",
    ListingID: id,
    LO1_OrganizationName: "IDX Realty",
    PhotoCount: 20,
    PoolPrivateYN: "False",
    ViewYN: "True",
    YearBuilt: 1998,
    baths: 2.5,
    beds: 3,
    content_hash: "hash",
    embedding: Array.isArray(embedding) ? JSON.stringify(embedding) : embedding,
    embedding_model: "text-embedding-3-small",
    lat: 33.6,
    lng: -117.8,
    price: 1250000,
    sqft: 1800,
    status: "Active",
    type: "SingleFamilyResidence",
    ...overrides
  };
}

test("builds listing embedding text from key RETS fields and remarks", () => {
  const text = buildListingEmbeddingText({
    L_City: "Irvine",
    L_Keyword2: "4",
    L_Remarks: "Charming craftsman with mountain views and character.",
    L_SystemPrice: "1250000",
    L_Type_: "SingleFamilyResidence",
    LM_Dec_3: "3.5",
    LM_Int2_3: "2400",
    YearBuilt: "1987"
  });

  assert.match(text, /SingleFamilyResidence in Irvine, CA/);
  assert.match(text, /4 beds, 3\.5 baths/);
  assert.match(text, /2,400 sq ft/);
  assert.match(text, /Built 1987/);
  assert.match(text, /Price: \$1,250,000/);
  assert.match(text, /mountain views and character/);
  assert.equal(/\s{2,}/.test(text), false);
});

test("computes cosine similarity and handles incompatible vectors safely", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([1, 2], [1]), 0);
});

test("parses JSON embeddings and rejects malformed values", () => {
  assert.deepEqual(parseEmbedding("[1, 2, 3]"), [1, 2, 3]);
  assert.deepEqual(parseEmbedding(["0.1", "0.2"]), [0.1, 0.2]);
  assert.equal(parseEmbedding("not json"), null);
  assert.equal(parseEmbedding("[1, null]"), null);
});

test("builds semantic search SQL around active listings and cache table", () => {
  const createTableSql = buildCreateListingEmbeddingsTableQuery();
  assert.match(createTableSql, /CREATE TABLE IF NOT EXISTS rets_property_embeddings/);
  assert.match(createTableSql, /ListingID VARCHAR\(64\)/);
  assert.match(createTableSql, /embedding JSON/);
  assert.match(createTableSql, /embedding_model VARCHAR\(100\)/);
  assert.match(createTableSql, /content_hash CHAR\(64\)/);

  const sourceQuery = buildActiveListingEmbeddingSourceQuery("test-model", 25);
  assert.match(sourceQuery.sql, /FROM rets_property r/);
  assert.match(sourceQuery.sql, /r\.L_ListingID AS ListingID/);
  assert.match(sourceQuery.sql, /LEFT JOIN rets_property_embeddings e/);
  assert.match(sourceQuery.sql, /CAST\(r\.L_ListingID AS CHAR CHARACTER SET utf8mb4\) COLLATE utf8mb4_unicode_ci = e\.ListingID COLLATE utf8mb4_unicode_ci/);
  assert.match(sourceQuery.sql, /r\.L_Status = \?/);
  assert.match(sourceQuery.sql, /LIMIT 25/);
  assert.deepEqual(sourceQuery.params, ["test-model", "Active"]);

  const cacheQuery = buildSemanticListingCacheQuery("test-model");
  assert.match(cacheQuery.sql, /r\.L_ListingID AS ListingID/);
  assert.match(cacheQuery.sql, /INNER JOIN rets_property_embeddings e/);
  assert.match(cacheQuery.sql, /CAST\(r\.L_ListingID AS CHAR CHARACTER SET utf8mb4\) COLLATE utf8mb4_unicode_ci = e\.ListingID COLLATE utf8mb4_unicode_ci/);
  assert.match(cacheQuery.sql, /r\.L_Status = \?/);
  assert.match(cacheQuery.sql, /e\.embedding_model = \?/);
  assert.deepEqual(cacheQuery.params, ["Active", "test-model"]);

  const upsert = buildUpsertListingEmbeddingQuery({
    contentHash: "abc",
    embedding: [0.1, 0.2],
    listingId: "123",
    model: "test-model"
  });
  assert.match(upsert.sql, /ON DUPLICATE KEY UPDATE/);
  assert.deepEqual(upsert.params, ["123", "[0.1,0.2]", "test-model", "abc"]);
});

test("calls OpenAI embeddings client with normalized text and selected model", async () => {
  const calls = [];
  const client = {
    embeddings: {
      create: async (payload) => {
        calls.push(payload);
        return {
          data: [{ embedding: [0.1, 0.2, 0.3] }]
        };
      }
    }
  };

  const embedding = await getEmbedding("hello\nworld", "test-model", client);

  assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
  assert.deepEqual(calls, [{
    encoding_format: "float",
    input: "hello world",
    model: "test-model"
  }]);
});

test("finds top 5 listings by query embedding similarity", async () => {
  const calls = [];
  const results = await findSimilarListings(
    "mountain views with character",
    5,
    {
      cachedRows: [
        cachedListing("A", [0.9, 0.1]),
        cachedListing("B", [1, 0]),
        cachedListing("C", [0.7, 0.7]),
        cachedListing("D", [0.4, 0.9]),
        cachedListing("E", [0.2, 0.98]),
        cachedListing("F", [0, 1]),
        cachedListing("G", [1, 0, 0]),
        cachedListing("H", "not json")
      ],
      embeddingProvider: async (text, model) => {
        calls.push({ model, text });
        return [1, 0];
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    model: "text-embedding-3-small",
    text: "mountain views with character"
  });
  assert.deepEqual(results.map((result) => result.listingId), ["B", "A", "C", "D", "E"]);
  assert.deepEqual(results.map((result) => result.rank), [1, 2, 3, 4, 5]);
  assert.equal(results[0].similarityScore, 1);
  assert.equal(results[0].address, "B Main St");
});

test("generates only missing or stale listing embeddings when source rows are injected", async () => {
  const currentRow = {
    L_City: "Irvine",
    L_Remarks: "Already cached listing.",
    ListingID: "CURRENT",
    cached_embedding: "[1,0]",
    cached_embedding_model: "test-model"
  };
  currentRow.cached_content_hash = contentHash(buildListingEmbeddingText(currentRow));

  const staleRow = {
    L_City: "Irvine",
    L_Remarks: "Needs a new embedding.",
    ListingID: "STALE",
    cached_content_hash: "old-hash",
    cached_embedding: "[0,1]",
    cached_embedding_model: "test-model"
  };

  const providerCalls = [];
  const progressEvents = [];
  const saved = [];
  const summary = await generateListingEmbeddings(undefined, {
    embeddingProvider: async (text, model) => {
      providerCalls.push({ model, text });
      return [0.4, 0.6];
    },
    ensureTable: false,
    model: "test-model",
    onProgress: (progress) => {
      progressEvents.push(progress);
    },
    saveEmbedding: async (record) => {
      saved.push(record);
    },
    sourceRows: [currentRow, staleRow]
  });

  assert.deepEqual(summary, {
    generated: 1,
    scanned: 2,
    skipped: 1
  });
  assert.equal(providerCalls.length, 1);
  assert.match(providerCalls[0].text, /Needs a new embedding/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].listingId, "STALE");
  assert.deepEqual(saved[0].embedding, [0.4, 0.6]);
  assert.deepEqual(
    progressEvents.map(({ generated, processed, skipped, total }) => ({ generated, processed, skipped, total })),
    [
      { generated: 0, processed: 0, skipped: 0, total: 2 },
      { generated: 0, processed: 1, skipped: 1, total: 2 },
      { generated: 1, processed: 2, skipped: 1, total: 2 }
    ]
  );
});
