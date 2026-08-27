import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListingAlertQuery,
  buildMarketReportRowsQuery,
  createEmailWorkflowDraft,
  draftListingAlertEmail,
  draftMarketReportEmail,
  draftPropertySummaryEmail,
  draftRecommendationDigestEmail
} from "../src/emailWorkflows.ts";

const env = {
  EMAIL_FROM: "IDX Exchange <advisor@example.com>",
  EMAIL_USER: "advisor@example.com"
};

function rawListing(index, overrides = {}) {
  return {
    DaysOnMarket: index,
    L_Address: `${index} Main St`,
    L_City: "Irvine",
    L_DisplayId: `OC${index}`,
    L_Status: "Active",
    L_SystemPrice: 1000000 + index * 1000,
    ListingID: `L${index}`,
    LM_Dec_3: 2,
    LM_Int2_3: 1800 + index,
    L_Keyword2: 3,
    PhotoCount: 20 + index,
    ...overrides
  };
}

function listing(index, overrides = {}) {
  return {
    address: `${index} Main St`,
    associationFee: null,
    baths: 2,
    beds: 3,
    city: "Irvine",
    daysOnMarket: index,
    displayId: `OC${index}`,
    hasFireplace: null,
    hasView: null,
    latitude: null,
    listingAgent: null,
    listingId: `L${index}`,
    listingOffice: null,
    longitude: null,
    photoCount: 20 + index,
    poolPrivate: null,
    price: 1000000 + index * 1000,
    sqft: 1800 + index,
    status: "Active",
    type: "SingleFamilyResidence",
    yearBuilt: null,
    zip: "92618",
    ...overrides
  };
}

function marketRow(index, overrides = {}) {
  return {
    UnparsedAddress: `${index} Sold Detail Ave`,
    avg_close_price: 1200000 + index * 1000,
    avg_days_on_market: 10 + index,
    avg_price_per_sqft: 600 + index,
    list_to_close_pct: 98 + index / 10,
    period: `2026-${String(index).padStart(2, "0")}`,
    sold_count: index,
    ...overrides
  };
}

test("builds listing alert queries with a hard five-row result limit", () => {
  const built = buildListingAlertQuery({ city: "Irvine", maxPrice: 1200000 }, 99);

  assert.match(built.sql, /FROM rets_property/);
  assert.match(built.sql, /LIMIT \?/);
  assert.equal(built.criteria.limit, 5);
  assert.deepEqual(built.params, ["Active", "Irvine", 1200000, 5]);
});

test("builds market report queries from aggregated california_sold analytics under fifty rows", () => {
  const built = buildMarketReportRowsQuery("Pasadena", 12);

  assert.match(built.sql, /FROM california_sold/);
  assert.match(built.sql, /GROUP BY DATE_FORMAT\(CloseDate, '%Y-%m'\)/);
  assert.equal(built.criteria.limit < 50, true);
  assert.deepEqual(built.params, ["Pasadena", "Residential", 12]);
});

test("drafts a pending listing alert email and limits listing details to five", async () => {
  const output = await draftListingAlertEmail({
    filters: { city: "Irvine", maxPrice: 1300000 },
    message: "Draft a new listing alert email.",
    recipientEmail: "client@example.com"
  }, {
    env,
    listingAlert: {
      rows: Array.from({ length: 6 }, (_, index) => rawListing(index + 1))
    }
  });

  assert.equal(output.missingContext, false);
  assert.equal(output.draft.status, "pending_approval");
  assert.equal(output.draft.workflowType, "listing_alert");
  assert.match(output.draft.body, /1 Main St/);
  assert.match(output.draft.body, /5 Main St/);
  assert.doesNotMatch(output.draft.body, /6 Main St/);
  assert.match(output.response, new RegExp(output.draft.approvalToken));
});

test("drafts a pending market report without exposing sold-detail rows", async () => {
  const output = await draftMarketReportEmail({
    city: "Pasadena",
    message: "Prepare a weekly market report email.",
    recipientEmail: "client@example.com"
  }, {
    env,
    marketReport: {
      rows: Array.from({ length: 13 }, (_, index) => marketRow(index + 1))
    }
  });

  assert.equal(output.draft.status, "pending_approval");
  assert.equal(output.draft.workflowType, "market_report");
  assert.match(output.draft.body, /aggregated california_sold analytics/);
  assert.match(output.draft.body, /2026-12/);
  assert.doesNotMatch(output.draft.body, /2026-13/);
  assert.doesNotMatch(output.draft.body, /Sold Detail Ave/);
  assert.match(output.draft.body, /does not export full MLS sold datasets/);
});

test("drafts a pending property summary card from recent listing context and comps", async () => {
  const output = await draftPropertySummaryEmail({
    message: "Write a property summary card email.",
    recipientEmail: "client@example.com",
    session: {
      conversationStep: 1,
      lastResults: [listing(1)]
    }
  }, {
    env,
    propertySummary: {
      compRows: [{
        avg_price_per_sqft: 650,
        comp_count: 8
      }]
    }
  });

  assert.equal(output.draft.status, "pending_approval");
  assert.equal(output.draft.workflowType, "property_summary");
  assert.match(output.draft.body, /1 Main St, Irvine/);
  assert.match(output.draft.body, /Photos: 21/);
  assert.match(output.draft.body, /8 sold comp/);
  assert.match(output.draft.body, /\$1,170,650/);
});

test("drafts a pending recommendation digest and limits recommendations to five", async () => {
  const output = await draftRecommendationDigestEmail({
    message: "Prepare a personalized recommendation digest.",
    recipientEmail: "client@example.com",
    session: {
      conversationStep: 1,
      lastResults: [listing(1)]
    }
  }, {
    env,
    recommendationDigest: {
      recommendations: Array.from({ length: 6 }, (_, index) => listing(index + 1))
    }
  });

  assert.equal(output.draft.status, "pending_approval");
  assert.equal(output.draft.workflowType, "recommendation_digest");
  assert.match(output.draft.body, /1 Main St/);
  assert.match(output.draft.body, /5 Main St/);
  assert.doesNotMatch(output.draft.body, /6 Main St/);
});

test("returns a no-context fallback instead of creating a draft", async () => {
  const output = await createEmailWorkflowDraft({
    message: "Draft an email.",
    recipientEmail: "client@example.com"
  }, { env });

  assert.equal(output.draft, null);
  assert.equal(output.missingContext, true);
  assert.equal(output.workflowType, "general_draft");
  assert.match(output.response, /not have enough recent/i);
});
