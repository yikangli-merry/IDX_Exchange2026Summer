# MLS Column Mapping Reference

This reference supports the Week 8 RAG assistant. It summarizes the MLS fields already used by the Week 2 through Week 7 skill code and aligns the project schema with the updated Week 8 source guidance.

## `rets_property` Active Listings

`rets_property` stores active listing records used by search, conversations, semantic search, and recommendations.

This table is a mixed schema. Several fields, such as `YearBuilt`, `AssociationFee`, `PoolPrivateYN`, `ViewYN`, `FireplaceYN`, and status-style fields, match common Trestle/RESO naming. The core search fields used in this project, including `L_SystemPrice`, `L_Keyword2`, `LM_Dec_3`, `LM_Int2_3`, `L_City`, and `L_Address`, are IDX legacy-style names and should be indexed through the project schema reference when the RAG assistant needs reliable answers about active listing fields.

| Column | Agent field | Meaning |
|---|---|---|
| `ListingID` | `listingId` | Internal listing identifier used for joins and recommendations. |
| `L_DisplayId` | `displayId` | Public-facing listing display id. |
| `L_Address` | `address` | Listing street address. |
| `L_City` | `city` | Listing city. |
| `L_Zip` | `zip` | Listing ZIP code. |
| `L_SystemPrice` | `price` | Current active list price. |
| `L_Keyword2` | `beds` | Bedroom count. |
| `LM_Dec_3` | `baths` | Bathroom count. |
| `LM_Int2_3` | `sqft` | Living area in square feet. |
| `L_Type_` | `type` | Property type, such as condominium, townhouse, single family residence, or land. |
| `L_Status` | `status` | Listing status. Active listing search filters this column to `Active`. |
| `LMD_MP_Latitude` | `latitude` | Listing latitude. |
| `LMD_MP_Longitude` | `longitude` | Listing longitude. |
| `YearBuilt` | `yearBuilt` | Year the property was built. |
| `AssociationFee` | `associationFee` | HOA or association fee when available. |
| `DaysOnMarket` | `daysOnMarket` | Number of days the listing has been marketed. |
| `PoolPrivateYN` | `poolPrivate` | Whether the listing has a private pool. |
| `ViewYN` | `hasView` | Whether the listing has a view. |
| `FireplaceYN` | `hasFireplace` | Whether the listing has a fireplace. |
| `PhotoCount` | `photoCount` | Number of listing photos. |
| `LA1_UserFirstName`, `LA1_UserLastName` | `listingAgent` | Listing agent name. |
| `LO1_OrganizationName` | `listingOffice` | Listing office name. |
| `L_Remarks` | `remarks` | Marketing remarks used by semantic search embeddings. |

## `california_sold` Sold Comparables

`california_sold` stores historical sold residential records used by sold comps, market statistics, trend analysis, and recommendation validation.

The `california_sold` columns map almost entirely to Trestle/RESO-standard field names, so this table is covered by the Trestle metadata documentation source for Week 8.

| Column | Agent field | Meaning |
|---|---|---|
| `ListingKey` | `listingKey` | Sold listing identifier. |
| `UnparsedAddress` | `address` | Sold property address. |
| `City` | `city` | Sold property city. |
| `CloseDate` | `closeDate` | Date when the sale closed. |
| `ClosePrice` | `closePrice` | Final sale price. |
| `OriginalListPrice` | `originalListPrice` | Initial list price when available. |
| `ListPrice` | `listPrice` | Latest list price before sale. |
| `DaysOnMarket` | `daysOnMarket` | Days on market before the sale closed. |
| `BedroomsTotal` | `bedrooms` | Bedroom count. |
| `BathroomsTotalInteger` | `bathrooms` | Bathroom count. |
| `LivingArea` | `livingArea` | Living area in square feet. |
| `PropertyType` | `propertyType` | Broad property category. Week 5 and Week 7 filter this to `Residential`. |
| `PropertySubType` | `propertySubType` | More specific property subtype. |
| `YearBuilt` | `yearBuilt` | Year the sold property was built. |
| `ListAgentFullName` | `listAgentFullName` | Listing agent name for the sold record. |
| `ListOfficeName` | `listOfficeName` | Listing office name for the sold record. |
| `BuyerOfficeName` | `buyerOfficeName` | Buyer office name for the sold record. |

## Derived Metrics

- Price per square foot: `ClosePrice / LivingArea`.
- List-to-close ratio: `(ClosePrice / ListPrice) * 100`.
- Average DOM: average of `DaysOnMarket` across relevant records.
- Median close price: median of `ClosePrice` across relevant records.
