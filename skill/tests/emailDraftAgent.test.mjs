import assert from "node:assert/strict";
import test from "node:test";
import { draftEmail, extractEmailAddress, extractSenderName } from "../src/emailDraftAgent.ts";

const env = {
  EMAIL_FROM: "IDX Exchange <advisor@example.com>",
  EMAIL_USER: "advisor@example.com"
};

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

test("extracts a recipient email address from the draft request text", () => {
  assert.equal(
    extractEmailAddress("Draft a market report email to client@example.com for Irvine."),
    "client@example.com"
  );
  assert.equal(extractEmailAddress("Draft a market report email."), null);
});

test("extracts a sender name from signature instructions", () => {
  assert.equal(
    extractSenderName("Draft an email. And change the signature to Best, Merry"),
    "Merry"
  );
  assert.equal(extractSenderName("Please sign it as Yikang Li."), "Yikang Li");
  assert.equal(extractSenderName("Draft a market report email."), null);
});

test("drafts a pending property summary email from recent listing context", async () => {
  const output = await draftEmail({
    message: "Draft an email about these listings.",
    recipientName: "Alex",
    senderName: "IDX Advisor",
    session: {
      conversationStep: 1,
      lastResults: [listing()]
    }
  }, {
    env,
    propertySummary: {
      compRows: []
    }
  });

  assert.equal(output.draftType, "property_summary");
  assert.equal(output.missingContext, false);
  assert.equal(output.status, "pending_approval");
  assert.match(output.draftId, /^draft_/);
  assert.match(output.body, /Hi Alex/);
  assert.match(output.body, /123 Main St, Irvine/);
  assert.match(output.body, /\$1,150,000/);
  assert.match(output.preview, /SEND EMAIL draft_/);
});

test("drafts a pending market summary email from recent market context", async () => {
  const output = await draftEmail({
    message: "Please write a market email summary to client@example.com. Change the signature to Best, Merry",
    session: {
      conversationStep: 1,
      lastMarketResult: marketResult()
    }
  }, { env });

  assert.equal(output.draftType, "market_summary");
  assert.equal(output.missingContext, false);
  assert.equal(output.status, "pending_approval");
  assert.equal(output.subject, "Weekly market report for Pasadena");
  assert.equal(output.to, "client@example.com");
  assert.match(output.body, /42 sale/);
  assert.match(output.body, /aggregated california_sold analytics/);
  assert.match(output.body, /Best,\nMerry/);
  assert.match(output.response, /SEND EMAIL draft_/);
});

test("returns a clear no-context response when nothing recent is available", async () => {
  const output = await draftEmail({
    message: "Draft an email.",
    session: {
      conversationStep: 0,
      lastResults: []
    }
  }, { env });

  assert.equal(output.draftType, "no_context");
  assert.equal(output.missingContext, true);
  assert.equal(output.subject, "");
  assert.match(output.response, /not have enough recent property, market, or recommendation context/i);
});
