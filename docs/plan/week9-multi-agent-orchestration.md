# Week 9 Multi-Agent Orchestration

Week 9 combines the previous specialized real estate agents behind one OpenClaw entry point. The orchestrator classifies each incoming user query, routes it to the right agent, and merges results when the query contains multiple intents.

## Goal

Build a single intelligent coordinator for the IDX Exchange skill package:

- route property search questions to the active listing conversation agent
- route market questions to the city market statistics agent
- route recommendation requests to the recommendation engine
- route terminology and data-schema questions to the RAG assistant
- route email requests to a draft-only email summary agent
- handle mixed search plus market queries in parallel

## Agent Registry

| Agent | Module | Responsibility |
|---|---|---|
| `propertySearchAgent` | `skill/src/conversation.ts` | Queries `rets_property` with structured filters and session memory. |
| `marketStatsAgent` | `skill/src/marketStats.ts` | Aggregates `california_sold` for trends, comps, DOM, and price metrics. |
| `recommendationAgent` | `skill/src/recommendationEngine.ts` | Finds similar active listings and validates them against sold comps. |
| `ragAgent` | `skill/src/ragAssistant.ts` | Answers real estate terminology, MLS field, and market concept questions from indexed sources. |
| `emailDraftAgent` | `skill/src/emailDraftAgent.ts` | Composes formatted property or market summary email drafts without sending email. |

## Orchestrator Logic

`skill/src/orchestrator.ts` adds:

- `classifyIntent(query)` for `search`, `market`, `recommend`, `knowledge`, `email`, `mixed`, and `unknown`.
- `orchestrate(query, userId, options)` as the unified OpenClaw entry point.
- Dependency-injected agent handlers so unit tests can avoid live MySQL and OpenAI calls.
- A mixed-intent path that runs property search and market stats in parallel with `Promise.all`.
- A friendly fallback when the query does not match any supported real estate workflow.

Example:

```text
Find affordable homes in Pasadena and tell me whether prices are rising.
```

The orchestrator classifies this as `mixed`, calls `propertySearchAgent` and `marketStatsAgent` in parallel, and returns one combined response.

## Email Draft Behavior

Week 9 adds `skill/src/emailDraftAgent.ts`.

The email agent:

- drafts text only
- does not send email
- uses recent `lastResults` listing context for property summaries
- uses recent `lastMarketResult` context for market summaries
- asks the user to search listings or ask a market question first when there is no usable context

## Session Updates

`skill/src/session.ts` now stores `lastMarketResult` in addition to `lastResults`. This allows follow-up requests such as:

```text
Draft a market email summary.
```

to reuse the most recent market stats answer.

## Testing

Run from `skill/`:

```powershell
npm.cmd test
npm.cmd run check
```

Week 9 tests cover:

- intent classification
- single-agent routing
- mixed search plus market routing
- email draft generation with property context
- email draft generation with market context
- no-context email fallback
- unknown-intent fallback
