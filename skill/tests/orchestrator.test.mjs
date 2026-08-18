import assert from "node:assert/strict";
import test from "node:test";
import { clearSession, getSession } from "../src/session.ts";
import { classifyIntent, orchestrate } from "../src/orchestrator.ts";

function marketStats(overrides = {}) {
  return {
    city: "Pasadena",
    months: 12,
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

function stubAgent(agent, response, calls) {
  return async (input) => {
    calls.push({ agent, query: input.query, userId: input.userId });
    return { agent, response };
  };
}

test("classifies single and mixed Week 9 intents", () => {
  assert.equal(classifyIntent("Find homes in Irvine under $1M."), "search");
  assert.equal(classifyIntent("Are prices rising in the Pasadena market?"), "market");
  assert.equal(classifyIntent("Recommend similar listings."), "recommend");
  assert.equal(classifyIntent("What does DOM mean?"), "knowledge");
  assert.equal(classifyIntent("Draft an email summary for my client."), "email");
  assert.equal(
    classifyIntent("Find affordable homes in Pasadena and tell me whether prices are rising."),
    "mixed"
  );
  assert.equal(classifyIntent("hello there"), "unknown");
});

test("routes single-intent requests to the selected agent", async () => {
  const calls = [];
  const output = await orchestrate("Find homes in Irvine.", "route-user", {
    propertySearchAgent: stubAgent("propertySearchAgent", "search reply", calls)
  });

  assert.equal(output.intent, "search");
  assert.equal(output.response, "search reply");
  assert.deepEqual(calls, [{
    agent: "propertySearchAgent",
    query: "Find homes in Irvine.",
    userId: "route-user"
  }]);
});

test("routes mixed search plus market questions through both agents", async () => {
  const calls = [];
  const output = await orchestrate(
    "Find affordable homes in Pasadena and tell me whether prices are rising.",
    "mixed-user",
    {
      marketStatsAgent: stubAgent("marketStatsAgent", "market reply", calls),
      propertySearchAgent: stubAgent("propertySearchAgent", "search reply", calls)
    }
  );

  assert.equal(output.intent, "mixed");
  assert.equal(output.agentResults.length, 2);
  assert.deepEqual(
    new Set(calls.map((call) => call.agent)),
    new Set(["propertySearchAgent", "marketStatsAgent"])
  );
  assert.match(output.response, /Property search:\nsearch reply/);
  assert.match(output.response, /Market stats:\nmarket reply/);
});

test("routes recommendation, knowledge, and email requests to their agents", async () => {
  const calls = [];
  const recommendation = await orchestrate("Recommend similar listings.", "recommend-user", {
    recommendationAgent: stubAgent("recommendationAgent", "recommend reply", calls)
  });
  const knowledge = await orchestrate("What does list-to-close mean?", "knowledge-user", {
    ragAgent: stubAgent("ragAgent", "knowledge reply", calls)
  });
  const email = await orchestrate("Draft an email summary.", "email-user", {
    emailDraftAgent: stubAgent("emailDraftAgent", "email reply", calls)
  });

  assert.equal(recommendation.intent, "recommend");
  assert.equal(knowledge.intent, "knowledge");
  assert.equal(email.intent, "email");
  assert.deepEqual(calls.map((call) => call.agent), [
    "recommendationAgent",
    "ragAgent",
    "emailDraftAgent"
  ]);
});

test("stores recent market context and reuses it for default email drafts", async () => {
  const userId = "market-email-user";
  clearSession(userId);

  const market = await orchestrate("What is the market trend in Pasadena?", userId, {
    marketQuestionOptions: {
      getMarketSummary: async () => marketStats()
    }
  });
  const session = getSession(userId);
  const email = await orchestrate("Draft a market email summary.", userId);

  assert.equal(market.intent, "market");
  assert.equal(session.lastMarketResult.city, "Pasadena");
  assert.equal(email.intent, "email");
  assert.match(email.response, /Subject: Market summary for Pasadena/);
  assert.match(email.response, /Sold comps: 42/);
});

test("returns a friendly fallback for unknown requests", async () => {
  const output = await orchestrate("hello there", "unknown-user");

  assert.equal(output.intent, "unknown");
  assert.equal(output.agentResults.length, 0);
  assert.match(output.response, /not sure how to help/i);
});
