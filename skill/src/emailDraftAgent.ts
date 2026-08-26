import {
  createEmailWorkflowDraft,
  type EmailWorkflowInput,
  type EmailWorkflowOptions
} from "./emailWorkflows.ts";
import type { EmailDraftStatus, EmailWorkflowType } from "./emailApproval.ts";
import type { PendingEmailDraft } from "./emailApproval.ts";
import type { UserSession } from "./session.ts";

export type EmailDraftType =
  | "listing_alert"
  | "market_summary"
  | "no_context"
  | "property_summary"
  | "recommendation_digest";

export interface EmailDraftInput {
  city?: string;
  listingId?: string | number;
  message: string;
  months?: number;
  recipientEmail?: string;
  recipientName?: string;
  senderName?: string;
  session?: UserSession;
  subject?: string;
  to?: string;
}

export interface EmailDraftOutput {
  approvalToken?: string;
  body: string;
  draft?: PendingEmailDraft;
  draftId?: string;
  draftType: EmailDraftType;
  missingContext: boolean;
  preview?: string;
  response: string;
  status?: EmailDraftStatus;
  subject: string;
  to?: string | null;
  workflowType: EmailWorkflowType;
}

const EMAIL_ADDRESS_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function extractEmailAddress(message: string): string | null {
  const match = message.match(EMAIL_ADDRESS_PATTERN);
  return match?.[0] ?? null;
}

function draftTypeFromWorkflow(workflowType: EmailWorkflowType, missingContext: boolean): EmailDraftType {
  if (missingContext || workflowType === "general_draft") {
    return "no_context";
  }
  if (workflowType === "market_report") {
    return "market_summary";
  }
  return workflowType;
}

export async function draftEmail(
  input: EmailDraftInput,
  options: EmailWorkflowOptions = {}
): Promise<EmailDraftOutput> {
  if (!input?.message || typeof input.message !== "string") {
    throw new Error("A non-empty message string is required.");
  }

  const workflowInput: EmailWorkflowInput = {
    city: input.city,
    listingId: input.listingId,
    message: input.message,
    months: input.months,
    recipientEmail: input.recipientEmail ?? input.to ?? extractEmailAddress(input.message),
    recipientName: input.recipientName,
    senderName: input.senderName,
    session: input.session,
    subject: input.subject
  };
  const output = await createEmailWorkflowDraft(workflowInput, options);

  if (!output.draft) {
    return {
      body: "",
      draftType: "no_context",
      missingContext: true,
      response: output.response,
      subject: "",
      workflowType: output.workflowType
    };
  }

  return {
    approvalToken: output.draft.approvalToken,
    body: output.draft.body,
    draft: output.draft,
    draftId: output.draft.draftId,
    draftType: draftTypeFromWorkflow(output.workflowType, output.missingContext),
    missingContext: false,
    preview: output.draft.preview,
    response: output.response,
    status: output.draft.status,
    subject: output.draft.subject,
    to: output.draft.to,
    workflowType: output.workflowType
  };
}
