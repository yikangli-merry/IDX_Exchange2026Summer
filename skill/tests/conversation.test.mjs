import assert from "node:assert/strict";
import test from "node:test";
import { handlePropertyConversation } from "../src/conversation.ts";
import { clearSession, getSession } from "../src/session.ts";

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

function result(items, overrides = {}) {
  return {
    criteria: {},
    hasMore: false,
    items,
    limit: 3,
    offset: 0,
    page: 1,
    ...overrides
  };
}

test("asks follow-up questions and returns listings after enough preferences", async () => {
  const userId = "conversation-user";
  clearSession(userId);
  const calls = [];
  const searchListings = async (filters, page, limit) => {
    calls.push({ filters, page, limit });
    return result([listing()]);
  };

  const cityReply = await handlePropertyConversation(
    { message: "Find homes in Irvine.", userId },
    { searchListings }
  );
  assert.equal(cityReply.askedFor, "maxPrice");
  assert.match(cityReply.reply, /budget/i);

  const budgetReply = await handlePropertyConversation(
    { message: "Under $1.2M.", userId },
    { searchListings }
  );
  assert.equal(budgetReply.askedFor, "type");
  assert.match(budgetReply.reply, /condo, townhome, or single family/i);

  const resultsReply = await handlePropertyConversation(
    { message: "Single family with at least 3 beds.", userId },
    { searchListings }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    filters: {
      baths: undefined,
      beds: 3,
      city: "Irvine",
      maxPrice: 1200000,
      pool: undefined,
      type: "SingleFamilyResidence"
    },
    limit: 3,
    page: 1
  });
  assert.match(resultsReply.reply, /123 Main St/);
  assert.match(resultsReply.reply, /\$1,150,000/);
  assert.match(resultsReply.reply, /3 beds \/ 2.5 baths/);
  assert.match(resultsReply.reply, /24 photos/);
});

test("updates budget without losing earlier session preferences", async () => {
  const userId = "budget-update-user";
  clearSession(userId);
  const calls = [];
  const searchListings = async (filters) => {
    calls.push(filters);
    return result([listing()]);
  };

  await handlePropertyConversation(
    { message: "Find single family homes in Irvine under $1.2M with 3 beds.", userId },
    { searchListings }
  );
  await handlePropertyConversation(
    { message: "Actually under $1M.", userId },
    { searchListings }
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1].city, "Irvine");
  assert.equal(calls[1].maxPrice, 1000000);
  assert.equal(calls[1].beds, 3);
  assert.equal(calls[1].type, "SingleFamilyResidence");
});

test("keeps sessions isolated by user id", async () => {
  const firstUser = "first-user";
  const secondUser = "second-user";
  clearSession(firstUser);
  clearSession(secondUser);

  await handlePropertyConversation({ message: "Find homes in Irvine.", userId: firstUser });
  await handlePropertyConversation({ message: "Find homes in Newport Beach.", userId: secondUser });

  assert.equal(getSession(firstUser).city, "Irvine");
  assert.equal(getSession(secondUser).city, "Newport Beach");
});

test("clears the active session on reset", async () => {
  const userId = "reset-user";
  clearSession(userId);

  await handlePropertyConversation(
    { message: "Find single family homes in Irvine under $1.2M with 3 beds.", userId },
    { searchListings: async () => result([listing()]) }
  );

  const resetReply = await handlePropertyConversation({ message: "reset", userId });

  assert.equal(resetReply.reset, true);
  assert.match(resetReply.reply, /cleared/i);
  assert.deepEqual(getSession(userId), { conversationStep: 0, lastResults: [] });
});

test("asks for city before searching when city is missing", async () => {
  const userId = "missing-city-user";
  clearSession(userId);

  const reply = await handlePropertyConversation({ message: "Under $1M.", userId });

  assert.equal(reply.askedFor, "city");
  assert.match(reply.reply, /city/i);
});

test("formats an empty result with a refinement suggestion", async () => {
  const userId = "empty-results-user";
  clearSession(userId);

  const reply = await handlePropertyConversation(
    { message: "Find single family homes in Irvine under $1.2M with 3 beds.", userId },
    { searchListings: async () => result([]) }
  );

  assert.match(reply.reply, /No matching active listings/i);
  assert.match(reply.reply, /broadening the budget, property type, or bedroom count/i);
});

test("uses previous session filters for more results", async () => {
  const userId = "more-results-user";
  clearSession(userId);
  const calls = [];
  const searchListings = async (filters, page, limit) => {
    calls.push({ filters, page, limit });
    return result([listing()], { hasMore: page === 1, page });
  };

  await handlePropertyConversation(
    { message: "Find single family homes in Irvine under $1.2M with 3 beds.", userId },
    { searchListings }
  );
  const moreReply = await handlePropertyConversation(
    { message: "more", userId },
    { searchListings }
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1].page, 2);
  assert.equal(calls[1].filters.city, "Irvine");
  assert.equal(calls[1].filters.maxPrice, 1200000);
  assert.match(moreReply.reply, /123 Main St/);
});
