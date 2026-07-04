export interface PropertyFilter {
  city: string | null;
  maxPrice: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  pool: "True" | null;
  hasView: "True" | null;
  maxHoa: number | null;
}

export const FILTER_COLUMN_MAP = {
  city: "L_City",
  maxPrice: "L_SystemPrice",
  beds: "L_Keyword2",
  baths: "LM_Dec_3",
  sqft: "LM_Int2_3",
  type: "L_Type_",
  pool: "PoolPrivateYN",
  hasView: "ViewYN",
  maxHoa: "AssociationFee"
} as const;

const PROPERTY_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(condo|condos|condominium|condominiums)\b/i, "Condominium"],
  [/\b(townhome|townhomes|townhouse|townhouses)\b/i, "Townhouse"],
  [/\b(single[-\s]?family|single family home|single family homes)\b/i, "SingleFamilyResidence"],
  [/\b(land|lot|lots)\b/i, "UnimprovedLand"]
];

const KNOWN_CITIES = [
  "Newport Beach",
  "Laguna Beach",
  "Huntington Beach",
  "Manhattan Beach",
  "Long Beach",
  "Irvine",
  "Anaheim",
  "Tustin",
  "Orange",
  "Costa Mesa",
  "Santa Ana"
];

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function parseNumericValue(rawAmount: string, rawUnit?: string): number {
  let value = Number(rawAmount.replace(/[$,\s]/g, ""));
  const unit = rawUnit?.toLowerCase();

  if (unit === "k") {
    value *= 1_000;
  }

  if (unit === "m") {
    value *= 1_000_000;
  }

  return Math.round(value);
}

function extractCity(query: string): string | null {
  const knownCity = KNOWN_CITIES.find((city) => new RegExp(`\\b${city}\\b`, "i").test(query));
  if (knownCity) {
    return knownCity;
  }

  const cityMatch = query.match(/\bin\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})(?=\s+(?:under|below|less than|max|with|over|above|at least|min|minimum|for|that|which|near|$)|[,.]|$)/i);
  if (!cityMatch) {
    return null;
  }

  const city = cityMatch[1].replace(/\b(with|under|below|over|above|max|minimum|min)\b.*$/i, "").trim();
  return city ? toTitleCase(city) : null;
}

function extractMaxPrice(query: string): number | null {
  const priceMatch = query.match(/\b(?:under|below|less than|max(?:imum)?|up to|no more than)\s+\$?\s*([\d,.]+(?:\.\d+)?)\s*([kKmM])?\b/i);
  if (priceMatch) {
    return parseNumericValue(priceMatch[1], priceMatch[2]);
  }

  const dollarPriceMatch = query.match(/\$\s*([\d,.]+(?:\.\d+)?)\s*([kKmM])?\b/i);
  if (dollarPriceMatch) {
    return parseNumericValue(dollarPriceMatch[1], dollarPriceMatch[2]);
  }

  return null;
}

function extractBeds(query: string): number | null {
  const bedsMatch = query.match(/\b(\d+(?:\.\d+)?)\s*(?:[-\s])?(?:bed|beds|bedroom|bedrooms|br)\b/i);
  return bedsMatch ? Number(bedsMatch[1]) : null;
}

function extractBaths(query: string): number | null {
  const bathsMatch = query.match(/\b(\d+(?:\.\d+)?)\s*(?:[-\s])?(?:bath|baths|bathroom|bathrooms|ba)\b/i);
  return bathsMatch ? Number(bathsMatch[1]) : null;
}

function extractSqft(query: string): number | null {
  const sqftMatch = query.match(/\b(?:over|above|at least|min(?:imum)?\s*)?\s*([\d,]+)\s*(?:sqft|sq ft|square feet|sf)\b/i);
  return sqftMatch ? Number(sqftMatch[1].replace(/,/g, "")) : null;
}

function extractPropertyType(query: string): string | null {
  const typeMatch = PROPERTY_TYPE_PATTERNS.find(([pattern]) => pattern.test(query));
  return typeMatch?.[1] ?? null;
}

function extractBooleanFeature(query: string, feature: "pool" | "view"): "True" | null {
  const featurePattern = feature === "pool"
    ? /\b(?:with|has|have|including|includes)?\s*(?:a\s+)?(?:private\s+)?pool\b/i
    : /\b(?:with|has|have|including|includes)?\s*(?:a\s+)?(?:ocean\s+|city\s+|mountain\s+|water\s+)?view\b/i;

  return featurePattern.test(query) ? "True" : null;
}

function extractMaxHoa(query: string): number | null {
  const hoaMatch = query.match(/\b(?:max(?:imum)?\s+hoa|hoa\s+(?:under|below|less than|max(?:imum)?|up to|no more than))\s+\$?\s*([\d,.]+)\b/i);
  return hoaMatch ? parseNumericValue(hoaMatch[1]) : null;
}

export function parsePropertyQuery(query: string): PropertyFilter {
  return {
    city: extractCity(query),
    maxPrice: extractMaxPrice(query),
    beds: extractBeds(query),
    baths: extractBaths(query),
    sqft: extractSqft(query),
    type: extractPropertyType(query),
    pool: extractBooleanFeature(query, "pool"),
    hasView: extractBooleanFeature(query, "view"),
    maxHoa: extractMaxHoa(query)
  };
}

export function toRetsPropertyFilters(filter: PropertyFilter): Record<string, string | number> {
  const retsFilters: Record<string, string | number> = {};

  for (const [field, column] of Object.entries(FILTER_COLUMN_MAP)) {
    const value = filter[field as keyof PropertyFilter];
    if (value !== null) {
      retsFilters[column] = value;
    }
  }

  return retsFilters;
}
