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
  retrieveRagChunks
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

export async function run(input: SkillInput): Promise<SkillOutput> {
  if (!input?.query || typeof input.query !== "string") {
    throw new Error("A non-empty query string is required.");
  }

  return orchestrate(input.query, input.userId ?? "default-user");
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
  getEmbedding,
  getSession,
  getSoldComps,
  handleMarketQuestion,
  handlePropertyConversation,
  answerRagQuestion,
  indexRagDocuments,
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
