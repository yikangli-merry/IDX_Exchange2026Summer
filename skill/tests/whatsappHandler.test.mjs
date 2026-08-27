import assert from "node:assert/strict";
import test from "node:test";
import {
  WHATSAPP_ERROR_REPLY,
  WHATSAPP_NO_RESULTS_REPLY,
  formatForWhatsApp,
  onWhatsAppMessage
} from "../src/whatsappHandler.ts";

function orchestrationResult(overrides = {}) {
  return {
    agentResults: [],
    intent: "search",
    query: "Find homes in Irvine.",
    response: "search reply",
    userId: "whatsapp-user",
    ...overrides
  };
}

function listing(index, overrides = {}) {
  return {
    address: `${index} Main St`,
    baths: 2,
    beds: 3,
    city: "Irvine",
    daysOnMarket: 10 + index,
    price: 1000000 + index * 1000,
    sqft: 1800 + index,
    ...overrides
  };
}

test("sends typing indicator before calling the orchestrator", async () => {
  const events = [];
  const reply = await onWhatsAppMessage("Find homes in Irvine.", "whatsapp-user", {
    orchestrator: async (message, userId) => {
      events.push(["orchestrate", message, userId]);
      return orchestrationResult({ query: message, userId });
    },
    sendTypingIndicator: async (userId) => {
      events.push(["typing", userId]);
    }
  });

  assert.equal(reply, "search reply");
  assert.deepEqual(events, [
    ["typing", "whatsapp-user"],
    ["orchestrate", "Find homes in Irvine.", "whatsapp-user"]
  ]);
});

test("formats property search listings for WhatsApp and limits results to five", () => {
  const reply = formatForWhatsApp(orchestrationResult({
    agentResults: [{
      agent: "propertySearchAgent",
      data: {
        results: Array.from({ length: 6 }, (_, index) => listing(index + 1))
      },
      response: "raw property reply"
    }]
  }));

  assert.match(reply, /1\. 1 Main St, Irvine/);
  assert.match(reply, /\$1,001,000 \| 3bd\/2ba \| 1,801 sqft \| 11 days on market/);
  assert.match(reply, /5\. 5 Main St, Irvine/);
  assert.doesNotMatch(reply, /6 Main St/);
});

test("formats recommendation arrays returned by an agent", () => {
  const reply = formatForWhatsApp(orchestrationResult({
    agentResults: [{
      agent: "recommendationAgent",
      data: [listing(1, { address: "10 Oak St", price: "$1,100,000" })],
      response: "raw recommendation reply"
    }],
    intent: "recommend"
  }));

  assert.match(reply, /10 Oak St, Irvine/);
  assert.match(reply, /\$1,100,000/);
});

test("preserves mixed orchestration responses so market summaries are not dropped", () => {
  const reply = formatForWhatsApp(orchestrationResult({
    agentResults: [{
      agent: "propertySearchAgent",
      data: {
        results: [listing(1)]
      },
      response: "listing reply"
    }, {
      agent: "marketStatsAgent",
      response: "market reply"
    }],
    intent: "mixed",
    response: "Property search:\nlisting reply\n\nMarket stats:\nmarket reply"
  }));

  assert.match(reply, /Property search:\nlisting reply/);
  assert.match(reply, /Market stats:\nmarket reply/);
});

test("returns regular responses when there are no listings", () => {
  const reply = formatForWhatsApp(orchestrationResult({
    agentResults: [{
      agent: "marketStatsAgent",
      response: "Pasadena median close price is $1.18M."
    }],
    intent: "market",
    response: "Pasadena median close price is $1.18M."
  }));

  assert.equal(reply, "Pasadena median close price is $1.18M.");
});

test("returns no-results fallback when there are no listings or response", () => {
  const reply = formatForWhatsApp(orchestrationResult({ response: "   " }));

  assert.equal(reply, WHATSAPP_NO_RESULTS_REPLY);
});

test("returns a user-friendly error when orchestration fails", async () => {
  const errors = [];
  const reply = await onWhatsAppMessage("Find homes in Irvine.", "whatsapp-user", {
    logger: {
      error: (...data) => errors.push(data)
    },
    orchestrator: async () => {
      throw new Error("database unavailable");
    },
    sendTypingIndicator: async () => {}
  });

  assert.equal(reply, WHATSAPP_ERROR_REPLY);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /WhatsApp orchestration error/);
});
