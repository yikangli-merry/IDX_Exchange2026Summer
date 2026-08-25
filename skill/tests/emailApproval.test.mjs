import assert from "node:assert/strict";
import test from "node:test";
import {
  createPendingEmailDraft,
  sendApprovedEmail
} from "../src/emailApproval.ts";

const env = {
  EMAIL_FROM: "IDX Exchange <advisor@example.com>",
  EMAIL_PASSWORD: "super-secret-app-password",
  EMAIL_SERVICE: "gmail",
  EMAIL_USER: "advisor@example.com"
};

function draft(overrides = {}) {
  return createPendingEmailDraft({
    body: "Here is the property update.",
    subject: "Property update",
    to: "client@example.com",
    workflowType: "property_summary",
    ...overrides
  }, { env, now: new Date("2026-08-25T10:00:00Z") });
}

test("does not send when the approval confirmation is missing", async () => {
  const sentMessages = [];
  const pendingDraft = draft();
  const result = await sendApprovedEmail(pendingDraft, "send it", {
    env,
    transporter: {
      sendMail: async (message) => {
        sentMessages.push(message);
        return { messageId: "sent-1" };
      }
    }
  });

  assert.equal(result.sent, false);
  assert.equal(result.status, "pending_approval");
  assert.equal(sentMessages.length, 0);
  assert.match(result.response, new RegExp(pendingDraft.draftId));
});

test("does not send when the draft id does not match exactly", async () => {
  const sentMessages = [];
  const pendingDraft = draft();
  const result = await sendApprovedEmail(pendingDraft, "SEND EMAIL draft_wrong", {
    env,
    transporter: {
      sendMail: async (message) => {
        sentMessages.push(message);
        return { messageId: "sent-1" };
      }
    }
  });

  assert.equal(result.sent, false);
  assert.equal(sentMessages.length, 0);
});

test("sends only after the exact approval token is provided", async () => {
  const sentMessages = [];
  const pendingDraft = draft();
  const result = await sendApprovedEmail(pendingDraft, pendingDraft.approvalToken, {
    env,
    now: new Date("2026-08-25T10:05:00Z"),
    transporter: {
      sendMail: async (message) => {
        sentMessages.push(message);
        return { messageId: "sent-1" };
      }
    }
  });

  assert.equal(result.sent, true);
  assert.equal(result.status, "sent");
  assert.equal(result.messageId, "sent-1");
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0], {
    from: "IDX Exchange <advisor@example.com>",
    html: "Here is the property update.",
    subject: "Property update",
    to: "client@example.com"
  });
});

test("redacts secrets from send errors before logging or returning them", async () => {
  const logs = [];
  const pendingDraft = draft();
  const result = await sendApprovedEmail(pendingDraft, pendingDraft.approvalToken, {
    env,
    logger: {
      error: (...data) => logs.push(data)
    },
    transporter: {
      sendMail: async () => {
        throw new Error(`SMTP rejected password ${env.EMAIL_PASSWORD}`);
      }
    }
  });

  const logged = JSON.stringify(logs);
  assert.equal(result.sent, false);
  assert.doesNotMatch(result.response, new RegExp(env.EMAIL_PASSWORD));
  assert.doesNotMatch(logged, new RegExp(env.EMAIL_PASSWORD));
  assert.match(result.response, /\[redacted\]/);
  assert.match(logged, /\[redacted\]/);
});
