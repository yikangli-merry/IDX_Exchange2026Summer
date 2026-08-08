# Week 8 RAG Demo

Week 8 adds a document-aware RAG assistant on top of the existing TypeScript skill. The assistant answers real estate concept, MLS field, and market terminology questions using indexed source documents.

## Knowledge Sources

- `docs/reference/mls-column-mapping.md`
- `docs/reference/real-estate-glossary.md`
- `docs/reference/california-real-estate-law-summary.md`
- Existing Week 2 through Week 7 code and documentation under `skill/` and `docs/`

## Pipeline

1. Chunk source documents with a default chunk size of 600 characters and 100 characters of overlap.
2. Embed each chunk using the existing Week 6 embedding provider.
3. Embed the user question.
4. Retrieve the top 4 chunks by cosine similarity.
5. Generate an answer using only the retrieved source context.
6. Return the answer with citations that include source document names and chunk indexes.

## Demo Questions

### What does DOM mean?

Expected grounded answer:

DOM means Days on Market. It measures how many days a property has been actively marketed before sale, cancellation, expiration, or removal. In this project, DOM maps to the `DaysOnMarket` field.

Source:

- `docs/reference/real-estate-glossary.md`
- `docs/reference/mls-column-mapping.md`

### What columns are in california_sold?

Expected grounded answer:

The `california_sold` table includes fields such as `ListingKey`, `UnparsedAddress`, `City`, `CloseDate`, `ClosePrice`, `OriginalListPrice`, `ListPrice`, `DaysOnMarket`, `BedroomsTotal`, `BathroomsTotalInteger`, `LivingArea`, `PropertyType`, `PropertySubType`, `YearBuilt`, `ListAgentFullName`, `ListOfficeName`, and `BuyerOfficeName`.

Source:

- `docs/reference/mls-column-mapping.md`

### What is a list-to-close ratio?

Expected grounded answer:

List-to-close ratio is calculated as `(ClosePrice / ListPrice) * 100`. It shows how close the final sale price was to the latest list price. A value near 100% means the sale closed close to list price, while a value above 100% means the close price exceeded list price.

Source:

- `docs/reference/real-estate-glossary.md`
- `docs/reference/mls-column-mapping.md`

## Local Verification

Run from `_project/skill`:

```powershell
npm.cmd test
npm.cmd run check
```
