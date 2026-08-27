import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompValidationQuery,
  buildRecommendationRowsQuery,
  calculateHybridSimilarityScore,
  formatRecommendationReply,
  recommendSimilarListingsForListing,
  validateListingWithComps
} from "../src/recommendationEngine.ts";

function activeListing(overrides = {}) {
  return {
    address: "123 Main St",
    associationFee: null,
    baths: 2.5,
    beds: 3,
    city: "Irvine",
    daysOnMarket: 10,
    displayId: "OC123",
    hasFireplace: "False",
    hasView: "True",
    latitude: 33.6,
    listingAgent: "Ada Lovelace",
    listingId: "TARGET",
    listingOffice: "IDX Realty",
    longitude: -117.8,
    photoCount: 20,
    poolPrivate: "False",
    price: 1000000,
    sqft: 1800,
    status: "Active",
    type: "SingleFamilyResidence",
    yearBuilt: 1998,
    zip: "92618",
    ...overrides
  };
}

function recommendationRow(id, role, embedding, overrides = {}) {
  return {
    AssociationFee: null,
    DaysOnMarket: 10,
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
    embedding: JSON.stringify(embedding),
    embedding_model: "text-embedding-3-small",
    lat: 33.6,
    lng: -117.8,
    price: 1000000,
    recommendation_role: role,
    sqft: 1800,
    status: "Active",
    type: "SingleFamilyResidence",
    ...overrides
  };
}

test("builds recommendation rows query with parameterized target listing and model", () => {
  const listingId = "A123'; DROP TABLE rets_property; --";
  const built = buildRecommendationRowsQuery(listingId, "test-model");

  assert.match(built.sql, /FROM rets_property r/);
  assert.match(built.sql, /r\.L_ListingID AS ListingID/);
  assert.match(built.sql, /INNER JOIN rets_property_embeddings e/);
  assert.match(built.sql, /CAST\(r\.L_ListingID AS CHAR CHARACTER SET utf8mb4\) COLLATE utf8mb4_unicode_ci = CAST\(\? AS CHAR CHARACTER SET utf8mb4\) COLLATE utf8mb4_unicode_ci/);
  assert.match(built.sql, /CAST\(r\.L_ListingID AS CHAR CHARACTER SET utf8mb4\) COLLATE utf8mb4_unicode_ci = e\.ListingID COLLATE utf8mb4_unicode_ci/);
  assert.match(built.sql, /r\.L_Status = \?/);
  assert.match(built.sql, /e\.embedding_model = \?/);
  assert.match(built.sql, /CAST\(r\.L_ListingID AS CHAR CHARACTER SET utf8mb4\) COLLATE utf8mb4_unicode_ci <> CAST\(\? AS CHAR CHARACTER SET utf8mb4\) COLLATE utf8mb4_unicode_ci/);
  assert.equal(built.sql.includes(listingId), false);
  assert.deepEqual(built.params, [
    listingId,
    "Active",
    "test-model",
    "Active",
    "test-model",
    listingId
  ]);
  assert.deepEqual(built.criteria, {
    listingId,
    model: "test-model",
    status: "Active"
  });
});

test("builds comp validation query with sqft band and safe parameters", () => {
  const city = "Irvine'; DROP TABLE california_sold; --";
  const built = buildCompValidationQuery(city, 1800, 6);

  assert.match(built.sql, /FROM california_sold/);
  assert.match(built.sql, /City = \?/);
  assert.match(built.sql, /PropertyType = \?/);
  assert.match(built.sql, /LivingArea BETWEEN \? AND \?/);
  assert.match(built.sql, /CloseDate >= DATE_SUB\(CURDATE\(\), INTERVAL \? MONTH\)/);
  assert.equal(built.sql.includes(city), false);
  assert.deepEqual(built.params, [city, "Residential", 1440, 2160, 6]);
  assert.deepEqual(built.criteria, {
    city,
    maxSqft: 2160,
    minSqft: 1440,
    months: 6,
    propertyType: "Residential"
  });
});

test("calculates full hybrid score with structured and semantic similarity", () => {
  const score = calculateHybridSimilarityScore(
    activeListing(),
    activeListing({ listingId: "CANDIDATE", price: 1040000, sqft: 2000 }),
    [1, 0],
    [1, 0]
  );

  assert.equal(score.structuredScore, 60);
  assert.equal(score.semanticScore, 40);
  assert.equal(score.totalScore, 100);
  assert.equal(score.priceDelta, 40000);
  assert.equal(score.sqftDelta, 200);
  assert.deepEqual(score.reasons, [
    "price within $50,000",
    "same bedroom count",
    "same city",
    "square footage within 300 sqft",
    "semantic similarity 100%"
  ]);
});

test("applies price and square-foot threshold bands", () => {
  const target = activeListing();
  const embeddingA = [1, 0];
  const embeddingB = [0, 1];

  assert.equal(
    calculateHybridSimilarityScore(
      target,
      activeListing({ city: "Pasadena", listingId: "A", price: 1100000, sqft: 2400, beds: 2 }),
      embeddingA,
      embeddingB
    ).structuredScore,
    17
  );

  assert.equal(
    calculateHybridSimilarityScore(
      target,
      activeListing({ city: "Pasadena", listingId: "B", price: 1250000, sqft: 3000, beds: 2 }),
      embeddingA,
      embeddingB
    ).structuredScore,
    5
  );

  assert.equal(
    calculateHybridSimilarityScore(
      target,
      activeListing({ city: "Pasadena", listingId: "C", price: 1400000, sqft: 3000, beds: 2 }),
      embeddingA,
      embeddingB
    ).structuredScore,
    0
  );
});

test("validates list price against injected comp rows without a live database", async () => {
  const validation = await validateListingWithComps(
    "Irvine",
    2000,
    1250000,
    6,
    { rows: [{ avg_ppsf: "600", comp_count: "3" }] }
  );

  assert.deepEqual(validation, {
    avgPricePerSqft: 600,
    city: "Irvine",
    compCount: 3,
    compPrice: 1200000,
    deltaPct: 4.2,
    listPrice: 1250000,
    months: 6,
    sqft: 2000,
    status: "validated"
  });
});

test("handles missing comp inputs and no comp rows safely", async () => {
  const missing = await validateListingWithComps(null, null, 1000000);
  assert.equal(missing.status, "missing_input");
  assert.equal(missing.compPrice, null);

  const noComps = await validateListingWithComps(
    "Irvine",
    1800,
    1000000,
    6,
    { rows: [{ avg_ppsf: null, comp_count: 0 }] }
  );
  assert.equal(noComps.status, "no_comps");
  assert.equal(noComps.compCount, 0);
  assert.equal(noComps.deltaPct, null);
});

test("recommends ranked topK listings, excludes target, and attaches comp validation", async () => {
  const compCalls = [];
  const recommendations = await recommendSimilarListingsForListing(
    "TARGET",
    2,
    {
      compValidator: async (listing) => {
        compCalls.push(listing.listingId);
        return {
          avgPricePerSqft: 600,
          city: listing.city,
          compCount: 4,
          compPrice: 1080000,
          deltaPct: -7.4,
          listPrice: listing.price,
          months: 6,
          sqft: listing.sqft,
          status: "validated"
        };
      },
      recommendationRows: [
        recommendationRow("TARGET", "target", [1, 0]),
        recommendationRow("A", "candidate", [1, 0], { price: 1010000, sqft: 1850 }),
        recommendationRow("B", "candidate", [0.9, 0.1], { price: 1100000, sqft: 2100 }),
        recommendationRow("C", "candidate", [0, 1], { price: 1300000, sqft: 3000 }),
        recommendationRow("BAD", "candidate", [1, 0, 0])
      ]
    }
  );

  assert.deepEqual(recommendations.map((item) => item.listingId), ["A", "B"]);
  assert.deepEqual(recommendations.map((item) => item.rank), [1, 2]);
  assert.deepEqual(compCalls, ["A", "B"]);
  assert.equal(recommendations[0].score.totalScore, 100);
  assert.equal(recommendations[0].compValidation.status, "validated");
});

test("formats recommendation replies for WhatsApp-friendly output", () => {
  const reply = formatRecommendationReply([
    {
      ...activeListing({ listingId: "A", address: "10 Oak St", price: 1100000 }),
      compValidation: {
        avgPricePerSqft: 600,
        city: "Irvine",
        compCount: 5,
        compPrice: 1080000,
        deltaPct: 1.9,
        listPrice: 1100000,
        months: 6,
        sqft: 1800,
        status: "validated"
      },
      rank: 1,
      score: {
        priceDelta: 100000,
        reasons: ["same city", "same bedroom count"],
        semanticScore: 32,
        semanticSimilarity: 0.8,
        sqftDelta: 100,
        structuredScore: 37,
        totalScore: 69
      }
    }
  ]);

  assert.match(reply, /Top 1 similar active listing/);
  assert.match(reply, /1\. 10 Oak St, Irvine - \$1,100,000/);
  assert.match(reply, /Score: 69\/100 \(structured 37, semantic 32\)/);
  assert.match(reply, /Why: same city; same bedroom count/);
  assert.match(reply, /Comps: \$1,080,000 supported by 5 sold comp\(s\)/);
});

test("formats empty recommendation results clearly", () => {
  assert.match(
    formatRecommendationReply([]),
    /could not find similar active listings with cached embeddings/i
  );
});
