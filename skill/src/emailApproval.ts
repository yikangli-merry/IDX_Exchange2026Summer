import { createHash, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

export type EmailDraftStatus = "pending_approval" | "sent";
export type EmailWorkflowType =
  | "general_draft"
  | "listing_alert"
  | "market_report"
  | "property_summary"
  | "recommendation_digest";

export interface EmailDraftRequest {
  body: string;
  from?: string;
  subject: string;
  to?: string;
  workflowType?: EmailWorkflowType;
}

export interface PendingEmailDraft {
  approvalToken: string;
  body: string;
  createdAt: string;
  draftId: string;
  from: string | null;
  preview: string;
  status: "pending_approval";
  subject: string;
  to: string | null;
  workflowType: EmailWorkflowType;
}

export interface SentEmailDraft extends Omit<PendingEmailDraft, "status"> {
  sentAt: string;
  status: "sent";
}

export interface EmailSendResult {
  draft: PendingEmailDraft | SentEmailDraft;
  messageId?: string;
  response: string;
  sent: boolean;
  status: EmailDraftStatus;
}

export interface EmailTransporter {
  sendMail: (message: {
    from: string;
    html: string;
    subject: string;
    to: string;
  }) => Promise<{ messageId?: string; response?: string }> | { messageId?: string; response?: string };
}

export interface EmailApprovalLogger {
  error: (...data: unknown[]) => void;
}

export interface EmailApprovalOptions {
  env?: Record<string, string | undefined>;
  logger?: EmailApprovalLogger;
  now?: Date;
  transporter?: EmailTransporter;
}

const DEFAULT_EMAIL_SERVICE = "gmail";
const DEFAULT_FROM_NAME = "IDX Exchange";
const SECRET_KEY_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)/i;

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for approved email sending.`);
  }
  return value;
}

function stringValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeAddress(value: string | undefined): string | null {
  return stringValue(value);
}

function normalizeSubject(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("Email subject is required.");
  }
  return normalized;
}

function normalizeBody(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Email body is required.");
  }
  return normalized;
}

function defaultFrom(env: Record<string, string | undefined>): string | null {
  return stringValue(env.EMAIL_FROM) ?? stringValue(env.EMAIL_USER);
}

function approvalId(subject: string, body: string, to: string | null, createdAt: string): string {
  const seed = [subject, body, to ?? "", createdAt, randomUUID()].join("\n");
  return `draft_${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
}

export function buildApprovalToken(draftId: string): string {
  return `SEND EMAIL ${draftId}`;
}

export function isExactApprovalConfirmation(draft: PendingEmailDraft, confirmation: string): boolean {
  return confirmation.trim() === draft.approvalToken;
}

export function buildEmailPreview(subject: string, body: string, to: string | null): string {
  return [
    "Email draft is pending approval.",
    `To: ${to ?? "recipient required before sending"}`,
    `Subject: ${subject}`,
    "",
    body,
    "",
    "Approve with the exact confirmation line shown below."
  ].join("\n");
}

export function createPendingEmailDraft(
  request: EmailDraftRequest,
  options: EmailApprovalOptions = {}
): PendingEmailDraft {
  const env = options.env ?? process.env;
  const createdAt = (options.now ?? new Date()).toISOString();
  const subject = normalizeSubject(request.subject);
  const body = normalizeBody(request.body);
  const to = normalizeAddress(request.to);
  const from = normalizeAddress(request.from) ?? defaultFrom(env);
  const draftId = approvalId(subject, body, to, createdAt);
  const approvalToken = buildApprovalToken(draftId);
  const workflowType = request.workflowType ?? "general_draft";

  return {
    approvalToken,
    body,
    createdAt,
    draftId,
    from,
    preview: [
      buildEmailPreview(subject, body, to),
      "",
      approvalToken
    ].join("\n"),
    status: "pending_approval",
    subject,
    to,
    workflowType
  };
}

export function createEmailTransporter(env: Record<string, string | undefined> = process.env): EmailTransporter {
  return nodemailer.createTransport({
    auth: {
      pass: requiredEnv(env, "EMAIL_PASSWORD"),
      user: requiredEnv(env, "EMAIL_USER")
    },
    service: stringValue(env.EMAIL_SERVICE) ?? DEFAULT_EMAIL_SERVICE
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bodyToHtml(body: string): string {
  return escapeHtml(body).replace(/\n/g, "<br>");
}

function sanitizedEnvValues(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([key, value]) => SECRET_KEY_PATTERN.test(key) && Boolean(value))
    .map(([, value]) => String(value));
}

export function sanitizeEmailError(error: unknown, env: Record<string, string | undefined> = process.env): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of sanitizedEnvValues(env)) {
    message = message.split(secret).join("[redacted]");
  }
  return message;
}

function requireSendAddresses(
  draft: PendingEmailDraft,
  env: Record<string, string | undefined>
): { from: string; to: string } {
  const from = draft.from ?? `${DEFAULT_FROM_NAME} <${requiredEnv(env, "EMAIL_USER")}>`;
  const to = draft.to?.trim();
  if (!to) {
    throw new Error("Email recipient is required before sending.");
  }
  return { from, to };
}

export async function sendApprovedEmail(
  draft: PendingEmailDraft,
  confirmation: string,
  options: EmailApprovalOptions = {}
): Promise<EmailSendResult> {
  if (!draft || draft.status !== "pending_approval") {
    throw new Error("A pending email draft is required.");
  }

  if (!isExactApprovalConfirmation(draft, confirmation)) {
    return {
      draft,
      response: `Email draft ${draft.draftId} is still pending approval. Use exactly: ${draft.approvalToken}`,
      sent: false,
      status: "pending_approval"
    };
  }

  const env = options.env ?? process.env;
  const logger = options.logger ?? console;

  try {
    const { from, to } = requireSendAddresses(draft, env);
    const transporter = options.transporter ?? createEmailTransporter(env);
    const result = await transporter.sendMail({
      from,
      html: bodyToHtml(draft.body),
      subject: draft.subject,
      to
    });
    const sentAt = (options.now ?? new Date()).toISOString();
    const sentDraft: SentEmailDraft = {
      ...draft,
      sentAt,
      status: "sent"
    };

    return {
      draft: sentDraft,
      messageId: result.messageId,
      response: `Email draft ${draft.draftId} was sent after explicit approval.`,
      sent: true,
      status: "sent"
    };
  } catch (error) {
    const sanitizedError = sanitizeEmailError(error, env);
    logger.error("Approved email send failed:", sanitizedError);
    return {
      draft,
      response: `Email draft ${draft.draftId} was not sent: ${sanitizedError}`,
      sent: false,
      status: "pending_approval"
    };
  }
}
