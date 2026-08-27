# Schema Annotations

This document explains how the final assistant uses the two main MLS-backed tables in the IDX Exchange project.

## `rets_property`

`rets_property` stores active listing records. It powers property search, conversational refinement, semantic listing search, and recommendation candidates.

| Field | Project usage | Notes |
|---|---|---|
| `L_ListingID` | Listing identifier | Physical MLS id column. Query builders alias it as `ListingID` for agent-facing rows. |
| `L_Status` | Active listing filter | Active search should filter to `Active` records. |
| `L_Address` | Display address | Used in WhatsApp listing summaries and email drafts. |
| `L_City` | City filter and display value | Used for search filters, recommendation matching, and market context. |
| `L_SystemPrice` | Listing price | Used for max price filters, display, and structured recommendation scoring. |
| `L_Keyword2` | Bedroom count | Used for parsed bedroom filters and structured similarity. |
| `LM_Dec_3` | Bathroom count | Used for parsed bathroom filters and listing display. |
| `LM_Int2_3` | Living area | Used for square-foot filters, display, semantic text, and comp matching. |
| `L_Type_` | Property type | Used for parsed property type filters. |
| `PoolPrivateYN` | Pool flag | Used for natural language pool preferences. |
| `ViewYN` | View flag | Used for natural language view preferences. |
| `AssociationFee` | HOA amount | Used for maximum HOA filters. |
| `L_Remarks` | Listing description | Used as the main semantic search text source. |

## `rets_property_embeddings`

`rets_property_embeddings` is the local embedding cache for active listing semantic search and hybrid recommendations. It can be created and refreshed from `skill/` with:

```powershell
npm.cmd run embeddings:generate
```

| Field | Project usage | Notes |
|---|---|---|
| `ListingID` | Cache key for active listing embeddings | Matches `rets_property.L_ListingID` after string conversion. |
| `embedding` | OpenAI embedding vector | Stored as JSON and parsed before cosine similarity scoring. |
| `embedding_model` | Embedding model name | Defaults to `text-embedding-3-small` unless overridden by `OPENAI_EMBEDDING_MODEL`. |
| `content_hash` | Listing text freshness check | Regenerated when the listing embedding text changes. |
| `updated_at` | Cache refresh timestamp | Maintained by MySQL on insert or update. |

## `california_sold`

`california_sold` stores historical sold comparable records. It powers city market summaries, trend analysis, comp validation, and market report email drafts.

| Field | Project usage | Notes |
|---|---|---|
| `ListingKey` | Sold record identifier | Used for internal row identity when formatting sold comps. |
| `UnparsedAddress` | Sold property address | Used only in compact comp summaries when needed. |
| `City` | Market and comp filter | Required for city market summaries and same-city comp validation. |
| `CloseDate` | Time window filter | Used for recent market windows and monthly trends. |
| `ClosePrice` | Sold price metric | Used for median price, average price, and comp-supported value. |
| `ListPrice` | List-to-close ratio | Used with `ClosePrice` to calculate sale-to-list behavior. |
| `OriginalListPrice` | Pricing context | Used as optional historical pricing context. |
| `DaysOnMarket` | Market speed metric | Used for average and median DOM. |
| `BedroomsTotal` | Comparable feature | Used to describe sold comps. |
| `BathroomsTotalInteger` | Comparable feature | Used to describe sold comps. |
| `LivingArea` | Price-per-square-foot metric | Used for PPSF and comp matching bands. |
| `PropertyType` | Residential filter | Used to keep market summaries focused on relevant residential sales. |
| `PropertySubType` | Property subtype context | Used for readable summaries where available. |
| `YearBuilt` | Property context | Used as optional comp context. |

## Derived Metrics

| Metric | Formula or source | Used by |
|---|---|---|
| Median close price | Median of `ClosePrice` | Market stats, reports |
| Average close price | Average of `ClosePrice` | Market stats, reports |
| Price per square foot | `ClosePrice / LivingArea` | Market stats, comp validation |
| Days on market | `DaysOnMarket` | Market stats, reports |
| List-to-close ratio | `(ClosePrice / ListPrice) * 100` | RAG answer, market summaries |
| Monthly trend | Group sold rows by close month | Market stats, demo narrative |

## Data Safety Notes

- Do not commit raw MLS exports, database dumps, credentials, or `.env` files.
- Use aggregated `california_sold` results for market reports instead of exposing full sold-detail rows.
- Keep `rets_property_embeddings` as generated local state; do not commit embedding cache exports.
- Keep WhatsApp responses concise and limited to the most relevant listings.
- Use approval-gated email drafts so generated content can be reviewed before sending.
