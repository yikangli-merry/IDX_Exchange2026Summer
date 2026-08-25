import { handlePropertyConversation, type ConversationOptions, type ConversationOutput } from "./conversation.ts";
import { draftEmail, type EmailDraftInput, type EmailDraftOutput } from "./emailDraftAgent.ts";
import {
  sendApprovedEmail,
  type EmailApprovalOptions,
  type EmailSendResult,
  type PendingEmailDraft
} from "./emailApproval.ts";
import type { EmailWorkflowOptions } from "./emailWorkflows.ts";
import { formatMarketStatsReply, handleMarketQuestion, type MarketQuestionOptions, type MarketQuestionOutput } from "./marketStats.ts";
import {
  formatRecommendationReply,
  recommendSimilarListingsForListing,
  type ListingRecommendation,
  type RecommendSimilarListingsOptions
} from "./recommendationEngine.ts";
import {
  answerRagQuestion,
  DEFAULT_RAG_NO_CONTEXT_REPLY,
  type IndexedRagChunk,
  type RagAnswerOptions,
  type RagAnswerOutput
} from "./ragAssistant.ts";
import { getSession, updateSession, type UserSession } from "./session.ts";

export type OrchestrationIntent = "email" | "knowledge" | "market" | "mixed" | "recommend" | "search" | "unknown";
export type AgentName = "emailDraftAgent" | "marketStatsAgent" | "propertySearchAgent" | "ragAgent" | "recommendationAgent";
export type ApprovedEmailSender = (draft: PendingEmailDraft, confirmation: string) => Promise<EmailSendResult>;

export interface AgentInvocationInput {
  query: string;
  session: UserSession;
  userId: string;
}

export interface AgentInvocationResult<TData = unknown> {
  agent: AgentName;
  data?: TData;
  response: string;
}

export type AgentHandler<TData = unknown> = (input: AgentInvocationInput) => Promise<AgentInvocationResult<TData>>;

export interface OrchestratorOptions {
  approvedEmailSender?: ApprovedEmailSender;
  emailApprovalOptions?: EmailApprovalOptions;
  emailDraftAgent?: AgentHandler<EmailDraftOutput>;
  emailOptions?: Omit<EmailDraftInput, "message" | "session">;
  emailWorkflowOptions?: EmailWorkflowOptions;
  marketQuestionOptions?: MarketQuestionOptions;
  marketStatsAgent?: AgentHandler<MarketQuestionOutput>;
  propertySearchAgent?: AgentHandler<ConversationOutput>;
  propertySearchOptions?: ConversationOptions;
  ragAgent?: AgentHandler<RagAnswerOutput>;
  ragAnswerOptions?: RagAnswerOptions;
  ragIndex?: IndexedRagChunk[];
  recommendationAgent?: AgentHandler<ListingRecommendation[]>;
  recommendationOptions?: RecommendSimilarListingsOptions;
  recommendationTopK?: number;
}

export interface OrchestrationOutput {
  agentResults: AgentInvocationResult[];
  intent: OrchestrationIntent;
  query: string;
  response: string;
  userId: string;
}

const AGENT_LABELS: Record<AgentName, string> = {
  emailDraftAgent: "Email draft",
  marketStatsAgent: "Market stats",
  propertySearchAgent: "Property search",
  ragAgent: "Knowledge",
  recommendationAgent: "Recommendations"
};

function hasPattern(query: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(query));
}

export function classifyIntent(query: string): OrchestrationIntent {
  const normalized = query.trim();
  if (!normalized) {
    return "unknown";
  }

  const wantsEmail = isEmailApprovalCommand(normalized) || hasPattern(normalized, [
    /\b(?:draft|compose|write|prepare)\b.*\b(?:email|mail|message|summary)\b/i,
    /\b(?:draft|compose|write|prepare|send)\b.*\b(?:listing alert|market report|property summary|recommendation digest|digest)\b/i,
    /\b(?:email|mail)\b/i
  ]);
  if (wantsEmail) {
    return "email";
  }

  const wantsSearch = hasPattern(normalized, [
    /\b(?:find|show|search|looking for)\b/i,
    /\b(?:home|homes|house|houses|property|properties|condo|condos|townhome|townhomes|single family|listing|listings)\b/i,
    /\b(?:bed|beds|bedroom|bedrooms|bath|baths|pool|view|under|below|affordable)\b/i
  ]);
  const wantsMarket = hasPattern(normalized, [
    /\b(?:market|trend|trends|statistics|stats)\b/i,
    /\b(?:median|average|price per sq(?:uare)? ?ft|price per sqft)\b/i,
    /\bprices?\s+(?:are\s+)?(?:rising|falling|increasing|dropping|going up|going down)\b/i,
    /\b(?:sold comps?|close price|days on market|dom|list-to-close)\b/i
  ]);
  const wantsKnowledge = hasPattern(normalized, [
    /\b(?:what does|define|meaning of|explain)\b/i,
    /\bwhat is\s+(?:dom|days on market|a list-to-close|the list-to-close|list-to-close)\b/i,
    /\b(?:column|columns|schema|field|fields|california_sold|rets_property)\b/i
  ]);
  if (wantsKnowledge && !wantsSearch) {
    return "knowledge";
  }

  if (wantsSearch && wantsMarket) {
    return "mixed";
  }

  const wantsRecommendation = hasPattern(normalized, [
    /\b(?:recommend|recommendation|similar|comparable|alternative|like this|liked listing|another like)\b/i
  ]);
  if (wantsRecommendation) {
    return "recommend";
  }

  if (wantsMarket) {
    return "market";
  }

  if (wantsSearch) {
    return "search";
  }

  return "unknown";
}

export function isEmailApprovalCommand(query: string): boolean {
  return /^SEND EMAIL \S+$/u.test(query.trim());
}

function extractTargetListingId(query: string, session: UserSession): string | number | null {
  const matchedId = query.match(/\b(?:listing|mls|id)\s*#?:?\s*([A-Za-z0-9-]+)/i);
  if (matchedId?.[1]) {
    return matchedId[1];
  }

  return session.lastResults?.[0]?.listingId ?? null;
}

async function runPropertySearchAgent(
  input: AgentInvocationInput,
  options: OrchestratorOptions
): Promise<AgentInvocationResult<ConversationOutput>> {
  const output = await handlePropertyConversation(
    { message: input.query, userId: input.userId },
    options.propertySearchOptions
  );
  return {
    agent: "propertySearchAgent",
    data: output,
    response: output.reply
  };
}

async function runMarketStatsAgent(
  input: AgentInvocationInput,
  options: OrchestratorOptions
): Promise<AgentInvocationResult<MarketQuestionOutput>> {
  const output = await handleMarketQuestion(
    { message: input.query },
    options.marketQuestionOptions
  );
  updateSession(input.userId, { lastMarketResult: output });

  return {
    agent: "marketStatsAgent",
    data: output,
    response: output.reply
  };
}

async function runRecommendationAgent(
  input: AgentInvocationInput,
  options: OrchestratorOptions
): Promise<AgentInvocationResult<ListingRecommendation[]>> {
  const targetListingId = extractTargetListingId(input.query, input.session);
  if (!targetListingId) {
    return {
      agent: "recommendationAgent",
      data: [],
      response: "I need a recent listing or a listing id before I can recommend similar active listings."
    };
  }

  const recommendations = await recommendSimilarListingsForListing(
    targetListingId,
    options.recommendationTopK,
    options.recommendationOptions
  );
  updateSession(input.userId, { lastResults: recommendations });

  return {
    agent: "recommendationAgent",
    data: recommendations,
    response: formatRecommendationReply(recommendations)
  };
}

async function runRagAgent(
  input: AgentInvocationInput,
  options: OrchestratorOptions
): Promise<AgentInvocationResult<RagAnswerOutput>> {
  const index = options.ragIndex ?? [];
  if (index.length === 0) {
    return {
      agent: "ragAgent",
      response: DEFAULT_RAG_NO_CONTEXT_REPLY
    };
  }

  const output = await answerRagQuestion(input.query, index, options.ragAnswerOptions);
  return {
    agent: "ragAgent",
    data: output,
    response: output.answer
  };
}

async function runEmailDraftAgent(
  input: AgentInvocationInput,
  options: OrchestratorOptions
): Promise<AgentInvocationResult<EmailDraftOutput | EmailSendResult>> {
  if (isEmailApprovalCommand(input.query)) {
    const pendingDraft = getSession(input.userId).pendingEmailDraft;
    if (!pendingDraft) {
      return {
        agent: "emailDraftAgent",
        response: "There is no pending email draft to send. Please draft an email first."
      };
    }

    const sender = options.approvedEmailSender
      ?? ((draft: PendingEmailDraft, confirmation: string) => sendApprovedEmail(
        draft,
        confirmation,
        options.emailApprovalOptions
      ));
    const output = await sender(pendingDraft, input.query);
    if (output.sent) {
      updateSession(input.userId, { pendingEmailDraft: undefined });
    }

    return {
      agent: "emailDraftAgent",
      data: output,
      response: output.response
    };
  }

  const output = await draftEmail({
    ...options.emailOptions,
    message: input.query,
    session: getSession(input.userId)
  }, options.emailWorkflowOptions);

  if (output.draft) {
    updateSession(input.userId, { pendingEmailDraft: output.draft });
  }

  return {
    agent: "emailDraftAgent",
    data: output,
    response: output.response
  };
}

async function invokeAgent(
  agent: AgentName,
  input: AgentInvocationInput,
  options: OrchestratorOptions
): Promise<AgentInvocationResult> {
  if (agent === "propertySearchAgent") {
    return options.propertySearchAgent?.(input) ?? runPropertySearchAgent(input, options);
  }
  if (agent === "marketStatsAgent") {
    return options.marketStatsAgent?.(input) ?? runMarketStatsAgent(input, options);
  }
  if (agent === "recommendationAgent") {
    return options.recommendationAgent?.(input) ?? runRecommendationAgent(input, options);
  }
  if (agent === "ragAgent") {
    return options.ragAgent?.(input) ?? runRagAgent(input, options);
  }

  return options.emailDraftAgent?.(input) ?? runEmailDraftAgent(input, options);
}

export function formatCombinedResponse(results: AgentInvocationResult[]): string {
  return results
    .map((result) => `${AGENT_LABELS[result.agent]}:\n${result.response}`)
    .join("\n\n");
}

export async function orchestrate(
  query: string,
  userId = "default-user",
  options: OrchestratorOptions = {}
): Promise<OrchestrationOutput> {
  if (!query || typeof query !== "string") {
    throw new Error("A non-empty query string is required.");
  }
  if (!userId || typeof userId !== "string") {
    throw new Error("A non-empty userId is required.");
  }

  const trimmedQuery = query.trim();
  const intent = classifyIntent(trimmedQuery);
  const input: AgentInvocationInput = {
    query: trimmedQuery,
    session: getSession(userId),
    userId
  };

  if (intent === "unknown") {
    return {
      agentResults: [],
      intent,
      query: trimmedQuery,
      response: "I'm not sure how to help with that. Try asking about properties, market trends, recommendations, real estate terms, or email drafts.",
      userId
    };
  }

  if (intent === "mixed") {
    const agentResults = await Promise.all([
      invokeAgent("propertySearchAgent", input, options),
      invokeAgent("marketStatsAgent", input, options)
    ]);

    return {
      agentResults,
      intent,
      query: trimmedQuery,
      response: formatCombinedResponse(agentResults),
      userId
    };
  }

  const agentByIntent: Record<Exclude<OrchestrationIntent, "mixed" | "unknown">, AgentName> = {
    email: "emailDraftAgent",
    knowledge: "ragAgent",
    market: "marketStatsAgent",
    recommend: "recommendationAgent",
    search: "propertySearchAgent"
  };
  const result = await invokeAgent(agentByIntent[intent], input, options);

  return {
    agentResults: [result],
    intent,
    query: trimmedQuery,
    response: result.response,
    userId
  };
}

export { formatMarketStatsReply };
