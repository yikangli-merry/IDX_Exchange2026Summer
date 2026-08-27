import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILTER_COLUMN_MAP, parsePropertyQuery, toRetsPropertyFilters } from "./parser.ts";
import { getSoldComps, searchActiveListings } from "./mlsQueries.ts";
import { buildCityMarketRowsQuery, getCityMarketSummary, handleMarketQuestion } from "./marketStats.ts";
import { handlePropertyConversation } from "./conversation.ts";
import { clearSession, getSession, updateSession } from "./session.ts";
import {
  buildCompValidationQuery,
  buildRecommendationRowsQuery,
  calculateHybridSimilarityScore,
  formatRecommendationReply,
  recommendSimilarListingsForListing,
  validateListingWithComps
} from "./recommendationEngine.ts";
import {
  buildActiveListingEmbeddingSourceQuery,
  buildCreateListingEmbeddingsTableQuery,
  buildListingEmbeddingText,
  buildSemanticListingCacheQuery,
  cosineSimilarity,
  ensureListingEmbeddingCacheTable,
  findSimilarListings,
  generateListingEmbeddings,
  getEmbedding
} from "./semanticSearch.ts";
import {
  answerRagQuestion,
  buildGroundedAnswerPrompt,
  buildRagContext,
  chunkText,
  citationsFromChunks,
  createRagChunks,
  generateGroundedAnswer,
  indexRagDocuments,
  normalizeRagTopK,
  retrieveRagChunks,
  type IndexedRagChunk,
  type KnowledgeDocument,
  type RagIndexOptions
} from "./ragAssistant.ts";
import { draftEmail, extractEmailAddress, extractSenderName } from "./emailDraftAgent.ts";
import {
  buildApprovalToken,
  createEmailTransporter,
  createPendingEmailDraft,
  isExactApprovalConfirmation,
  sanitizeEmailError,
  sendApprovedEmail
} from "./emailApproval.ts";
import {
  buildListingAlertQuery,
  buildMarketReportRowsQuery,
  buildPropertyCompSummaryQuery,
  buildPropertySummaryListingQuery,
  classifyEmailWorkflow,
  createEmailWorkflowDraft,
  draftListingAlertEmail,
  draftMarketReportEmail,
  draftPropertySummaryEmail,
  draftRecommendationDigestEmail,
  formatMarketReportRow,
  formatPropertyCompSummary
} from "./emailWorkflows.ts";
import {
  classifyIntent,
  formatCombinedResponse,
  isEmailApprovalCommand,
  orchestrate,
  type OrchestrationOutput
} from "./orchestrator.ts";
import {
  formatForWhatsApp,
  formatListingsForWhatsApp,
  onWhatsAppMessage,
  sendTypingIndicator
} from "./whatsappHandler.ts";

export interface SkillInput {
  query: string;
  userId?: string;
}

export type SkillOutput = OrchestrationOutput;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RAG_SOURCE_TYPES: Record<string, string> = {
  "california-real-estate-law-summary.md": "California real estate law summary",
  "mls-column-mapping.md": "MLS field definitions",
  "real-estate-glossary.md": "Real estate glossary",
  "week5-market-summaries.md": "Week 5 market analytics summary"
};

let defaultRagIndexPromise: Promise<IndexedRagChunk[]> | null = null;

function defaultRagReferenceDir(): string {
  return path.resolve(__dirname, "..", "..", "docs", "reference");
}

function titleFromMarkdown(content: string, fileName: string): string {
  const heading = content.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  return fileName
    .replace(/\.md$/u, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function loadDefaultRagDocuments(
  referenceDir = defaultRagReferenceDir()
): Promise<KnowledgeDocument[]> {
  let entries;
  try {
    entries = await readdir(referenceDir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(fileNames.map(async (fileName) => {
    const content = await readFile(path.join(referenceDir, fileName), "utf8");
    return {
      content,
      source: `docs/reference/${fileName}`,
      sourceType: DEFAULT_RAG_SOURCE_TYPES[fileName] ?? "Project reference",
      title: titleFromMarkdown(content, fileName)
    };
  }));
}

async function getDefaultRagIndex(options: RagIndexOptions = {}): Promise<IndexedRagChunk[]> {
  const hasCustomOptions = Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return indexRagDocuments(await loadDefaultRagDocuments(), options);
  }

  defaultRagIndexPromise ??= loadDefaultRagDocuments()
    .then((documents) => indexRagDocuments(documents));
  return defaultRagIndexPromise;
}

export async function run(input: SkillInput): Promise<SkillOutput> {
  if (!input?.query || typeof input.query !== "string") {
    throw new Error("A non-empty query string is required.");
  }

  const userId = input.userId ?? "default-user";
  if (classifyIntent(input.query) === "knowledge") {
    return orchestrate(input.query, userId, {
      ragIndex: await getDefaultRagIndex()
    });
  }

  return orchestrate(input.query, userId);
}

export {
  clearSession,
  FILTER_COLUMN_MAP,
  buildActiveListingEmbeddingSourceQuery,
  buildApprovalToken,
  buildCityMarketRowsQuery,
  buildCompValidationQuery,
  buildCreateListingEmbeddingsTableQuery,
  classifyIntent,
  draftEmail,
  formatCombinedResponse,
  buildGroundedAnswerPrompt,
  buildListingEmbeddingText,
  buildListingAlertQuery,
  buildMarketReportRowsQuery,
  buildPropertyCompSummaryQuery,
  buildPropertySummaryListingQuery,
  buildRagContext,
  buildRecommendationRowsQuery,
  buildSemanticListingCacheQuery,
  calculateHybridSimilarityScore,
  chunkText,
  citationsFromChunks,
  classifyEmailWorkflow,
  cosineSimilarity,
  createRagChunks,
  createEmailTransporter,
  createEmailWorkflowDraft,
  createPendingEmailDraft,
  draftListingAlertEmail,
  draftMarketReportEmail,
  draftPropertySummaryEmail,
  draftRecommendationDigestEmail,
  ensureListingEmbeddingCacheTable,
  extractEmailAddress,
  extractSenderName,
  findSimilarListings,
  formatForWhatsApp,
  formatMarketReportRow,
  formatPropertyCompSummary,
  formatRecommendationReply,
  formatListingsForWhatsApp,
  generateListingEmbeddings,
  generateGroundedAnswer,
  getCityMarketSummary,
  getDefaultRagIndex,
  getEmbedding,
  getSession,
  getSoldComps,
  handleMarketQuestion,
  handlePropertyConversation,
  answerRagQuestion,
  indexRagDocuments,
  loadDefaultRagDocuments,
  isEmailApprovalCommand,
  isExactApprovalConfirmation,
  normalizeRagTopK,
  onWhatsAppMessage,
  orchestrate,
  parsePropertyQuery,
  recommendSimilarListingsForListing,
  retrieveRagChunks,
  sanitizeEmailError,
  searchActiveListings,
  sendApprovedEmail,
  sendTypingIndicator,
  toRetsPropertyFilters,
  updateSession,
  validateListingWithComps
};

export type {
  EmbeddingProvider,
  FindSimilarListingsOptions,
  GenerateListingEmbeddingsOptions,
  ListingEmbeddingGenerationSummary,
  ListingEmbeddingRecord,
  SemanticListingResult
} from "./semanticSearch.ts";

export type {
  IndexedRagChunk,
  KnowledgeDocument,
  RagAnswerGenerator,
  RagAnswerGeneratorInput,
  RagAnswerOptions,
  RagAnswerOutput,
  RagChunk,
  RagCitation,
  RagIndexOptions,
  RagRetrievalResult,
  RagRetrieveOptions
} from "./ragAssistant.ts";

export type {
  EmailDraftInput,
  EmailDraftOutput,
  EmailDraftType
} from "./emailDraftAgent.ts";

export type {
  EmailApprovalLogger,
  EmailApprovalOptions,
  EmailDraftRequest,
  EmailDraftStatus,
  EmailSendResult,
  EmailTransporter,
  EmailWorkflowType,
  PendingEmailDraft,
  SentEmailDraft
} from "./emailApproval.ts";

export type {
  EmailWorkflowBuiltQuery,
  EmailWorkflowDraftOutput,
  EmailWorkflowInput,
  EmailWorkflowOptions,
  ListingAlertSearchOptions,
  MarketReportOptions,
  MarketReportRow,
  PropertyCompSummary,
  PropertySummaryOptions,
  RecommendationDigestOptions
} from "./emailWorkflows.ts";

export type {
  AgentHandler,
  AgentInvocationInput,
  AgentInvocationResult,
  AgentName,
  ApprovedEmailSender,
  OrchestrationIntent,
  OrchestrationOutput,
  OrchestratorOptions
} from "./orchestrator.ts";

export type {
  WhatsAppLogger,
  WhatsAppMessageOptions,
  WhatsAppOrchestrator,
  WhatsAppTypingIndicator
} from "./whatsappHandler.ts";

export type {
  CompValidation,
  HybridSimilarityScore,
  ListingRecommendation,
  RecommendSimilarListingsOptions,
  ValidateListingWithCompsOptions
} from "./recommendationEngine.ts";
