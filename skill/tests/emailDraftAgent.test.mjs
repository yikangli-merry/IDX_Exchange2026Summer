import assert from "node:assert/strict";
import test from "node:test";
import { draftEmail } from "../src/emailDraftAgent.ts";

function listing(overrides = {}) {
  return {
    address: "123 Main St",
    associationFee: null,
    baths: 2.5,
    beds: 3,
    city: "Irvine",
    daysOnMarket: null,
    displayId: "OC123",
    hasFireplace: null,
    hasView: null,
    latitude: null,
    listingAgent: null,
    listingId: 123,
    listingOffice: null,
    longitude: null,
    photoCount: 24,
    poolPrivate: null,
    price: 1150000,
    sqft: 1800,
    status: "Active",
    type: "SingleFamilyResidence",
    yearBuilt: null,
    zip: "92618",
    ...overrides
  };
}

function marketResult(overrides = {}) {
  return {
    city: "Pasadena",
    months: 12,
    reply: "Market summary for Pasadena over the last 12 month(s).",
    summary: {
      averageClosePrice: 1220000,
      averageDaysOnMarket: 18.4,
      averagePricePerSqft: 655,
      city: "Pasadena",
      listToClosePct: 99.2,
      medianClosePrice: 1180000,
      medianDaysOnMarket: 16,
      medianPricePerSqft: 640,
      months: 12,
      soldCount: 42
    },
    trend: [],
    ...overrides
  };
}

test("drafts a property summary email from recent listing context", () => {
  const output = draftEmail({
    message: "Draft an email about these listings.",
    recipientName: "Alex",
    senderName: "IDX Advisor",
    session: {
      conversationStep: 1,
      lastResults: [listing()]
    }
  });

  assert.equal(output.draftType, "property_summary");
  assert.equal(output.missingContext, false);
  assert.equal(output.subject, "Property options for your review");
  assert.match(output.body, /Hi Alex/);
  assert.match(output.body, /123 Main St, Irvine/);
  assert.match(output.body, /\$1,150,000/);
  assert.match(output.response, /^Subject: Property options/m);
});

test("drafts a market summary email from recent market context", () => {
  const output = draftEmail({
    message: "Please write a market email summary.",
    session: {
      conversationStep: 1,
      lastMarketResult: marketResult()
    }
  });

  assert.equal(output.draftType, "market_summary");
  assert.equal(output.missingContext, false);
  assert.equal(output.subject, "Market summary for Pasadena");
  assert.match(output.body, /Sold comps: 42/);
  assert.match(output.body, /Median close price: \$1,180,000/);
  assert.match(output.body, /Market summary for Pasadena over the last 12 month/);
});

test("returns a clear no-context response when nothing recent is available", () => {
  const output = draftEmail({
    message: "Draft an email.",
    session: {
      conversationStep: 0,
      lastResults: []
    }
  });

  assert.equal(output.draftType, "no_context");
  assert.equal(output.missingContext, true);
  assert.equal(output.subject, "");
  assert.match(output.response, /not have enough recent property or market context/i);
});
