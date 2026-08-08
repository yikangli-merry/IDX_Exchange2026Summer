import OpenAI from "openai";
import {
  cosineSimilarity,
  defaultEmbeddingModel,
  getEmbedding,
  normalizeEmbeddingInput,
  type EmbeddingProvider
} from "./semanticSearch.ts";

export const DEFAULT_RAG_CHUNK_SIZE = 600;
export const DEFAULT_RAG_CHUNK_OVERLAP = 100;
export const DEFAULT_RAG_TOP_K = 4;
export const MAX_RAG_TOP_K = 20;
export const DEFAULT_RAG_ANSWER_MODEL = "gpt-4o-mini";
export const DEFAULT_RAG_NO_CONTEXT_REPLY = "I do not have enough indexed source context to answer that question.";

export interface KnowledgeDocument {
  content: string;
  source?: string;
  sourceType?: string;
  title: string;
}

export interface RagChunk {
  chunk: string;
  chunkIndex: number;
  id: string;
  source: string;
  sourceType: string | null;
  title: string;
}

export interface IndexedRagChunk extends RagChunk {
  embedding: number[];
  model: string;
}

export interface RagRetrievalResult extends IndexedRagChunk {
  rank: number;
  similarityScore: number;
}

export interface RagCitation {
  chunkIndex: number;
  rank: number;
  similarityScore: number;
  source: string;
  title: string;
}

export interface RagAnswerOutput {
  answer: string;
  citations: RagCitation[];
  context: string;
  query: string;
  retrievedChunks: RagRetrievalResult[];
}

export interface RagIndexOptions {
  chunkOverlap?: number;
  chunkSize?: number;
  embeddingProvider?: EmbeddingProvider;
  model?: string;
}

export interface RagRetrieveOptions {
  embeddingProvider?: EmbeddingProvider;
  minSimilarity?: number;
  model?: string;
}

export interface RagAnswerGeneratorInput {
  chunks: RagRetrievalResult[];
  context: string;
  model: string;
  query: string;
}

export type RagAnswerGenerator = (input: RagAnswerGeneratorInput) => Promise<string>;

export interface RagAnswerOptions extends RagRetrieveOptions {
  answerGenerator?: RagAnswerGenerator;
  answerModel?: string;
  noContextReply?: string;
  topK?: number;
}

export interface OpenAIChatClient {
  chat: {
    completions: {
      create: (params: {
        messages: Array<{ content: string; role: "system" | "user" }>;
        model: string;
        temperature: number;
      }) => Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
}

let openaiChatClient: OpenAIChatClient | null = null;

function getOpenAIChatClient(): OpenAIChatClient {
  if (!openaiChatClient) {
    openaiChatClient = new OpenAI();
  }
  return openaiChatClient;
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

function normalizeChunkSettings(chunkSize?: number, chunkOverlap?: number): {
  chunkOverlap: number;
  chunkSize: number;
  step: number;
} {
  const safeChunkSize = normalizePositiveInteger(chunkSize, DEFAULT_RAG_CHUNK_SIZE);
  const requestedOverlap = normalizePositiveInteger(chunkOverlap, DEFAULT_RAG_CHUNK_OVERLAP, safeChunkSize - 1);
  const safeOverlap = Math.max(0, Math.min(requestedOverlap, safeChunkSize - 1));

  return {
    chunkOverlap: safeOverlap,
    chunkSize: safeChunkSize,
    step: Math.max(1, safeChunkSize - safeOverlap)
  };
}

export function normalizeRagTopK(topK = DEFAULT_RAG_TOP_K): number {
  return normalizePositiveInteger(topK, DEFAULT_RAG_TOP_K, MAX_RAG_TOP_K);
}

function requireText(value: string, label: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function sourceForDocument(doc: KnowledgeDocument): string {
  return doc.source?.trim() || doc.title.trim();
}

function chunkId(doc: KnowledgeDocument, chunkIndex: number): string {
  return `${sourceForDocument(doc).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${chunkIndex}`;
}

function requireEmbeddingVector(value: number[], label: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(Number.isFinite)) {
    throw new Error(`${label} must be a non-empty numeric embedding vector.`);
  }
  return value;
}

export function chunkText(
  text: string,
  chunkSize = DEFAULT_RAG_CHUNK_SIZE,
  chunkOverlap = DEFAULT_RAG_CHUNK_OVERLAP
): string[] {
  const normalized = normalizeEmbeddingInput(text);
  if (!normalized) {
    return [];
  }

  const settings = normalizeChunkSettings(chunkSize, chunkOverlap);
  const chunks: string[] = [];

  for (let start = 0; start < normalized.length; start += settings.step) {
    const chunk = normalized.slice(start, start + settings.chunkSize).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (start + settings.chunkSize >= normalized.length) {
      break;
    }
  }

  return chunks;
}

export function createRagChunks(
  docs: KnowledgeDocument[],
  chunkSize = DEFAULT_RAG_CHUNK_SIZE,
  chunkOverlap = DEFAULT_RAG_CHUNK_OVERLAP
): RagChunk[] {
  return docs.flatMap((doc) => {
    const title = requireText(doc.title, "document title");
    const source = requireText(sourceForDocument(doc), "document source");
    const sourceType = doc.sourceType?.trim() || null;

    return chunkText(doc.content, chunkSize, chunkOverlap).map((chunk, index) => ({
      chunk,
      chunkIndex: index,
      id: chunkId({ ...doc, source, title }, index),
      source,
      sourceType,
      title
    }));
  });
}

export async function indexRagDocuments(
  docs: KnowledgeDocument[],
  options: RagIndexOptions = {}
): Promise<IndexedRagChunk[]> {
  const model = options.model ?? defaultEmbeddingModel();
  const embeddingProvider = options.embeddingProvider ?? getEmbedding;
  const chunks = createRagChunks(docs, options.chunkSize, options.chunkOverlap);
  const indexed: IndexedRagChunk[] = [];

  for (const chunk of chunks) {
    indexed.push({
      ...chunk,
      embedding: requireEmbeddingVector(await embeddingProvider(chunk.chunk, model), "chunk embedding"),
      model
    });
  }

  return indexed;
}

function compareResults(left: RagRetrievalResult, right: RagRetrievalResult): number {
  const scoreDifference = right.similarityScore - left.similarityScore;
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  return left.id.localeCompare(right.id);
}

export async function retrieveRagChunks(
  query: string,
  index: IndexedRagChunk[],
  topK = DEFAULT_RAG_TOP_K,
  options: RagRetrieveOptions = {}
): Promise<RagRetrievalResult[]> {
  const queryText = requireText(query, "query");
  const model = options.model ?? defaultEmbeddingModel();
  const embeddingProvider = options.embeddingProvider ?? getEmbedding;
  const queryEmbedding = requireEmbeddingVector(
    await embeddingProvider(queryText, model),
    "query embedding"
  );
  const minSimilarity = options.minSimilarity ?? 0;

  return index
    .map((chunk) => ({
      ...chunk,
      rank: 0,
      similarityScore: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .filter((chunk) => chunk.similarityScore >= minSimilarity)
    .sort(compareResults)
    .slice(0, normalizeRagTopK(topK))
    .map((chunk, index) => ({
      ...chunk,
      rank: index + 1
    }));
}

export function buildRagContext(chunks: RagRetrievalResult[]): string {
  return chunks
    .map((chunk) => [
      `[${chunk.rank}] ${chunk.title} (${chunk.source})`,
      chunk.sourceType ? `Source type: ${chunk.sourceType}` : null,
      chunk.chunk
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}

export function citationsFromChunks(chunks: RagRetrievalResult[]): RagCitation[] {
  return chunks.map((chunk) => ({
    chunkIndex: chunk.chunkIndex,
    rank: chunk.rank,
    similarityScore: chunk.similarityScore,
    source: chunk.source,
    title: chunk.title
  }));
}

export function buildGroundedAnswerPrompt(query: string, context: string): string {
  return [
    "Answer the user's real estate question using only the source context below.",
    "If the context does not contain enough information, say that there is not enough indexed source context.",
    "Keep the answer concise and include source names when useful.",
    "",
    "Source context:",
    context,
    "",
    `Question: ${query}`
  ].join("\n");
}

export async function generateGroundedAnswer(
  input: RagAnswerGeneratorInput,
  client: OpenAIChatClient = getOpenAIChatClient()
): Promise<string> {
  const prompt = buildGroundedAnswerPrompt(input.query, input.context);
  const response = await client.chat.completions.create({
    messages: [
      {
        content: "You are a document-grounded RAG assistant for IDX Exchange real estate workflows.",
        role: "system"
      },
      {
        content: prompt,
        role: "user"
      }
    ],
    model: input.model,
    temperature: 0
  });

  return response.choices[0]?.message?.content?.trim() || DEFAULT_RAG_NO_CONTEXT_REPLY;
}

export async function answerRagQuestion(
  query: string,
  index: IndexedRagChunk[],
  options: RagAnswerOptions = {}
): Promise<RagAnswerOutput> {
  const retrievedChunks = await retrieveRagChunks(query, index, options.topK, options);
  const context = buildRagContext(retrievedChunks);
  const noContextReply = options.noContextReply ?? DEFAULT_RAG_NO_CONTEXT_REPLY;

  if (retrievedChunks.length === 0) {
    return {
      answer: noContextReply,
      citations: [],
      context,
      query,
      retrievedChunks
    };
  }

  const answerGenerator = options.answerGenerator ?? generateGroundedAnswer;
  const answer = await answerGenerator({
    chunks: retrievedChunks,
    context,
    model: options.answerModel ?? DEFAULT_RAG_ANSWER_MODEL,
    query
  });

  return {
    answer: answer.trim() || noContextReply,
    citations: citationsFromChunks(retrievedChunks),
    context,
    query,
    retrievedChunks
  };
}
