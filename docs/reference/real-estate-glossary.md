# Real Estate Glossary

This glossary supports the Week 8 document-aware RAG assistant. It defines common real estate and MLS terms used by the IDX Exchange skill.

| Term | Meaning |
|---|---|
| DOM | Days on Market. DOM measures how many days a property has been actively marketed before sale, cancellation, expiration, or removal. In this project it maps to `DaysOnMarket`. |
| MLS | Multiple Listing Service. A shared listing database used by real estate professionals. |
| Active listing | A property currently available for sale. In `rets_property`, active search filters `L_Status` to `Active`. |
| Sold comp | A recently sold comparable property used to estimate value or validate a list price. In this project, sold comps come from `california_sold`. |
| Comps | Comparable properties. Good comps are usually similar in location, size, property type, condition, and sale timing. |
| Escrow | The period and neutral account/process used to hold funds and documents while a real estate transaction is completed. |
| Close price | The final sale price recorded when a transaction closes. In `california_sold`, this maps to `ClosePrice`. |
| List price | The asking price before a property sells. In `california_sold`, this maps to `ListPrice`; in `rets_property`, active list price maps to `L_SystemPrice`. |
| Original list price | The first recorded asking price for a listing, mapped to `OriginalListPrice` in `california_sold`. |
| List-to-close ratio | A pricing metric calculated as `(ClosePrice / ListPrice) * 100`. A value near 100% means the sale closed close to the latest list price. Values above 100% indicate the close price exceeded list price. |
| Price per square foot | A valuation metric calculated as price divided by living area. For sold comps, Week 5 uses `ClosePrice / LivingArea`. |
| Cap rate | Capitalization rate. A real estate investment metric calculated as net operating income divided by property value or purchase price. |
| HOA | Homeowners association. HOA fees are represented by `AssociationFee` for active listings when available. |
| Living area | Interior livable square footage. In this project it maps to `LM_Int2_3` for active listings and `LivingArea` for sold records. |
| Property subtype | A more specific category under a broad property type, such as condominium, townhouse, or single family residence. |
