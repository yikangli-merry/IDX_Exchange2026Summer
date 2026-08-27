# Week 12 Final Demo Plan

Week 12 packages the IDX Multi-Agent Real Estate Assistant into a final capstone demo. The goal is to show one tight, end-to-end assistant flow instead of walking through each feature separately.

## Demo Objective

Demonstrate that the assistant can receive real estate questions through WhatsApp, route each request through the correct agent, use both MLS databases, answer grounded knowledge questions, and draft an email only after human approval.

The demo should show these capabilities in one sequence:

- Natural language property search from `rets_property`
- Multi-turn conversational memory
- Market analytics and trends from `california_sold`
- Semantic similarity search and recommendations
- RAG knowledge answers from indexed project docs
- WhatsApp-friendly response formatting
- Email draft workflow with explicit approval gate

## Pre-Demo Readiness

Run these from `skill/` before the live demo:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run embeddings:generate
```

The test and check commands verify the package without live services. The embedding command is the live semantic-search setup step; it requires a real `OPENAI_API_KEY`, MySQL credentials, and an accessible `rets_property` table. If `.env` still contains placeholder values, replace them locally before running the command.

## Five-Minute Demo Script

### 0:00-0:30 - Setup

- Open the local project and test terminal.
- Show that the assistant is running through the OpenClaw skill package.
- Mention that secrets, local `.env`, database dumps, and raw MLS exports are not committed.
- Mention that listing embeddings have already been generated for the demo environment.

### 0:30-1:45 - Mixed Search and Market Question

Send a WhatsApp message like:

```text
Find 3 bedroom homes in Irvine under $1.5M and tell me how the Irvine market is trending.
```

Expected result:

- Orchestrator classifies this as a mixed intent.
- `propertySearchAgent` searches `rets_property`.
- `marketStatsAgent` summarizes `california_sold`.
- The response includes active listings plus a market trend summary.

### 1:45-2:35 - Multi-Turn Refinement

Send a follow-up in the same thread:

```text
Only show condos with a pool.
```

Expected result:

- Session memory keeps the previous city and budget.
- Newly parsed filters refine the search.
- The reply returns a smaller, mobile-friendly set of listings.

### 2:35-3:35 - Semantic Search and Recommendation

Send a semantic-style request:

```text
Show me something similar with natural light, a modern kitchen, and walkable neighborhood feel.
```

Then ask:

```text
Recommend similar listings to the first one.
```

Expected result:

- `semanticSearchAgent` uses listing text, `L_Remarks`, and cached embeddings.
- Recommendation scoring combines structured similarity and semantic similarity.
- Comp validation uses recent `california_sold` records to explain price support.

### 3:35-4:15 - RAG Knowledge Question

Ask:

```text
What is a list-to-close ratio?
```

Expected result:

- `ragAgent` answers from the default `docs/reference/*.md` RAG index.
- The answer stays grounded in source context.
- Citations point to the relevant reference docs.

### 4:15-5:00 - Email Draft and Approval Gate

Ask:

```text
Draft a market report email for this client.
```

Expected result:

- `emailDraftAgent` creates a pending draft.
- The draft includes a `draftId`, approval token, recipient, subject, body, and preview.
- No email is sent automatically.

Then show the explicit send format:

```text
SEND EMAIL <draftId>
```

Expected result:

- Only the exact approval command can send.
- Casual confirmations such as `yes`, `ok`, or `send it` do not send.

## Backup Demo Recording Checklist

- Record the terminal showing `npm.cmd test` passing.
- Record the terminal showing `npm.cmd run check` passing.
- Record the terminal showing `npm.cmd run embeddings:generate` completing on the demo machine.
- Record the WhatsApp mixed-intent query and response.
- Record a follow-up refinement that uses session memory.
- Record a semantic search result and one recommendation with comp validation.
- Record a RAG answer with citations.
- Record an email draft preview and the approval gate behavior.
- Avoid showing real API keys, passwords, `.env`, personal phone numbers, or private MLS exports.

## Verification Commands

Run from `_project/skill`:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run embeddings:generate
```

Expected result:

- All unit tests pass.
- TypeScript syntax checks pass.
- Listing embeddings are present in `rets_property_embeddings` before semantic and recommendation demos.
- No live MySQL, OpenAI, WhatsApp, or email provider is required for the unit tests; MySQL and OpenAI are required for embedding generation and live semantic/RAG behavior.
