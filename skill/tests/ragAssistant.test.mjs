import assert from "node:assert/strict";
import test from "node:test";
import {
  answerRagQuestion,
  buildGroundedAnswerPrompt,
  buildRagContext,
  chunkText,
  citationsFromChunks,
  createRagChunks,
  indexRagDocuments,
  normalizeRagTopK,
  retrieveRagChunks
} from "../src/ragAssistant.ts";
import { getDefaultRagIndex, loadDefaultRagDocuments } from "../src/index.ts";

function vectorForText(text) {
  const lower = text.toLowerCase();
  if (lower.includes("market summaries") || lower.includes("median close price") || lower.includes("monthly trend")) {
    return [0, 0, 0, 1];
  }
  if (lower.includes("dom") || lower.includes("days on market")) {
    return [1, 0, 0, 0];
  }
  if (lower.includes("list-to-close") || lower.includes("close price divided by list price")) {
    return [0, 0, 1, 0];
  }
  if (lower.includes("california_sold") || lower.includes("closeprice") || lower.includes("listingkey")) {
    return [0, 1, 0, 0];
  }
  return [0, 0, 0, 0];
}

const docs = [
  {
    content: "DOM means Days on Market. It measures how many days a property has been actively marketed before sale or removal.",
    source: "docs/reference/real-estate-glossary.md",
    sourceType: "glossary",
    title: "Real Estate Glossary"
  },
  {
    content: "The california_sold table includes ListingKey, UnparsedAddress, City, CloseDate, ClosePrice, ListPrice, DaysOnMarket, BedroomsTotal, BathroomsTotalInteger, LivingArea, PropertyType, PropertySubType, and YearBuilt.",
    source: "docs/reference/mls-column-mapping.md",
    sourceType: "MLS column mapping",
    title: "MLS Column Mapping"
  },
  {
    content: "List-to-close ratio equals ClosePrice divided by ListPrice multiplied by 100. It shows how close the final sale price was to the latest list price.",
    source: "docs/reference/real-estate-glossary.md",
    sourceType: "glossary",
    title: "Real Estate Glossary"
  },
  {
    content: "Week 5 market summaries include median close price, average price per square foot, average DOM, list-to-close ratio, and monthly trend summaries from california_sold.",
    source: "docs/reference/week5-market-summaries.md",
    sourceType: "Week 5 market summary",
    title: "Week 5 Market Summaries"
  }
];

test("chunks text with overlap and defensive top-k normalization", () => {
  assert.deepEqual(chunkText("", 10, 2), []);
  assert.deepEqual(chunkText("abcdefghijklmnopqrstuvwxyz", 10, 3), [
    "abcdefghij",
    "hijklmnopq",
    "opqrstuvwx",
    "vwxyz"
  ]);
  assert.equal(normalizeRagTopK(0), 4);
  assert.equal(normalizeRagTopK(999), 20);
});

test("creates source-aware chunks from knowledge documents", () => {
  const chunks = createRagChunks([docs[0]], 80, 10);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].title, "Real Estate Glossary");
  assert.equal(chunks[0].source, "docs/reference/real-estate-glossary.md");
  assert.equal(chunks[0].sourceType, "glossary");
  assert.equal(chunks[0].chunkIndex, 0);
  assert.match(chunks[0].id, /docs-reference-real-estate-glossary-md-0/);
});

test("indexes documents using injected embeddings and retrieves relevant chunks", async () => {
  const calls = [];
  const index = await indexRagDocuments(docs, {
    chunkSize: 500,
    chunkOverlap: 50,
    embeddingProvider: async (text, model) => {
      calls.push({ model, text });
      return vectorForText(text);
    },
    model: "test-embedding-model"
  });

  const results = await retrieveRagChunks("What columns are in california_sold?", index, 2, {
    embeddingProvider: async (text, model) => {
      calls.push({ model, text });
      return vectorForText(text);
    },
    minSimilarity: 0.01,
    model: "test-embedding-model"
  });

  assert.equal(index.length, 4);
  assert.equal(calls.length, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].rank, 1);
  assert.equal(results[0].title, "MLS Column Mapping");
  assert.match(results[0].chunk, /ListingKey/);
});

test("indexes the updated Week 8 source set including Week 5 market summaries", async () => {
  const index = await indexRagDocuments(docs, {
    chunkSize: 500,
    chunkOverlap: 50,
    embeddingProvider: async (text) => vectorForText(text)
  });
  const results = await retrieveRagChunks("Which source explains median close price and monthly trend?", index, 1, {
    embeddingProvider: async (text) => vectorForText(text),
    minSimilarity: 0.01
  });

  assert.deepEqual(
    new Set(index.map((chunk) => chunk.source)),
    new Set([
      "docs/reference/real-estate-glossary.md",
      "docs/reference/mls-column-mapping.md",
      "docs/reference/week5-market-summaries.md"
    ])
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Week 5 Market Summaries");
  assert.match(results[0].chunk, /median close price/);
});

test("formats retrieved context and source citations", async () => {
  const index = await indexRagDocuments(docs, {
    embeddingProvider: async (text) => vectorForText(text)
  });
  const results = await retrieveRagChunks("What does DOM mean?", index, 1, {
    embeddingProvider: async (text) => vectorForText(text),
    minSimilarity: 0.01
  });
  const context = buildRagContext(results);
  const citations = citationsFromChunks(results);

  assert.match(context, /\[1\] Real Estate Glossary/);
  assert.match(context, /Source type: glossary/);
  assert.deepEqual(citations, [{
    chunkIndex: 0,
    rank: 1,
    similarityScore: 1,
    source: "docs/reference/real-estate-glossary.md",
    title: "Real Estate Glossary"
  }]);
});

test("answers with grounded context and citations through injected generator", async () => {
  const index = await indexRagDocuments(docs, {
    embeddingProvider: async (text) => vectorForText(text)
  });
  const output = await answerRagQuestion("What is a list-to-close ratio?", index, {
    answerGenerator: async ({ context, query }) => {
      assert.match(query, /list-to-close/);
      assert.match(context, /ClosePrice divided by ListPrice/);
      return "List-to-close ratio is ClosePrice divided by ListPrice times 100, based on the glossary.";
    },
    embeddingProvider: async (text) => vectorForText(text),
    minSimilarity: 0.01,
    topK: 4
  });

  assert.match(output.answer, /ClosePrice divided by ListPrice/);
  assert.equal(output.citations.length, 1);
  assert.equal(output.citations[0].title, "Real Estate Glossary");
});

test("does not call answer generator when no indexed source context is relevant", async () => {
  const index = await indexRagDocuments(docs, {
    embeddingProvider: async (text) => vectorForText(text)
  });
  let generatorCalled = false;
  const output = await answerRagQuestion("What is the HOA pet policy?", index, {
    answerGenerator: async () => {
      generatorCalled = true;
      return "This should not be used.";
    },
    embeddingProvider: async () => [0, 0, 0, 0],
    minSimilarity: 0.01
  });

  assert.equal(generatorCalled, false);
  assert.equal(output.citations.length, 0);
  assert.match(output.answer, /not have enough indexed source context/i);
});

test("builds a grounded answer prompt that restricts answers to source context", () => {
  const prompt = buildGroundedAnswerPrompt("What does DOM mean?", "DOM means Days on Market.");

  assert.match(prompt, /using only the source context/);
  assert.match(prompt, /not enough indexed source context/);
  assert.match(prompt, /Question: What does DOM mean\?/);
});

test("loads default RAG reference documents and builds a project index with injected embeddings", async () => {
  const defaultDocs = await loadDefaultRagDocuments();
  const sources = defaultDocs.map((doc) => doc.source);

  assert.equal(defaultDocs.length >= 3, true);
  assert.equal(sources.includes("docs/reference/mls-column-mapping.md"), true);
  assert.equal(sources.includes("docs/reference/real-estate-glossary.md"), true);
  assert.equal(sources.includes("docs/reference/week5-market-summaries.md"), true);

  const index = await getDefaultRagIndex({
    embeddingProvider: async (text) => vectorForText(text),
    model: "test-embedding-model"
  });

  assert.equal(index.length > defaultDocs.length, true);
  assert.equal(index.every((chunk) => chunk.model === "test-embedding-model"), true);
});
