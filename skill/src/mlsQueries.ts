import { query } from "./db.ts";
import type { PropertyFilter } from "./parser.ts";

export interface Pagination {
  limit: number;
  offset: number;
  page: number;
  queryLimit: number;
}

export interface BuiltQuery {
  criteria: Record<string, string | number>;
  pagination: Pagination;
  params: unknown[];
  sql: string;
}

export interface PagedResult<TItem> {
  criteria: Record<string, string | number>;
  hasMore: boolean;
  items: TItem[];
  limit: number;
  offset: number;
  page: number;
}

export type ActiveListingFilters = Partial<PropertyFilter>;

export interface ActiveListing {
  address: string | null;
  associationFee: number | null;
  baths: number | null;
  beds: number | null;
  city: string | null;
  daysOnMarket: number | null;
  displayId: string | null;
  hasFireplace: string | null;
  hasView: string | null;
  latitude: number | null;
  listingAgent: string | null;
  listingId: string | number | null;
  listingOffice: string | null;
  longitude: number | null;
  photoCount: number | null;
  poolPrivate: string | null;
  price: number | null;
  sqft: number | null;
  status: string | null;
  type: string | null;
  yearBuilt: number | null;
  zip: string | null;
}

export interface SoldComp {
  address: string | null;
  bathrooms: number | null;
  bedrooms: number | null;
  buyerOfficeName: string | null;
  city: string | null;
  closeDate: string | null;
  closePrice: number | null;
  daysOnMarket: number | null;
  listAgentFullName: string | null;
  listOfficeName: string | null;
  listPrice: number | null;
  listingKey: string | number | null;
  livingArea: number | null;
  originalListPrice: number | null;
  propertySubType: string | null;
  propertyType: string | null;
  yearBuilt: number | null;
}

type RawRow = Record<string, unknown>;

const MAX_LIMIT = 100;

function normalizePositiveInteger(
  value: number | undefined,
  defaultValue: number,
  maxValue = Number.POSITIVE_INFINITY
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }

  const normalized = Math.trunc(value);
  if (normalized < 1) {
    return defaultValue;
  }
  return Math.min(normalized, maxValue);
}

export function normalizePagination(page = 1, limit = 10): Pagination {
  const safePage = normalizePositiveInteger(page, 1);
  const safeLimit = normalizePositiveInteger(limit, 10, MAX_LIMIT);
  return {
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    page: safePage,
    queryLimit: safeLimit + 1
  };
}

function addCriterion(
  criteria: Record<string, string | number>,
  params: unknown[],
  key: string,
  value: string | number | null | undefined
): boolean {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  criteria[key] = value;
  params.push(value);
  return true;
}

export function buildActiveListingSearchQuery(
  filters: ActiveListingFilters = {},
  page = 1,
  limit = 10
): BuiltQuery {
  const pagination = normalizePagination(page, limit);
  const where = ["L_Status = ?"];
  const params: unknown[] = ["Active"];
  const criteria: Record<string, string | number> = { status: "Active" };

  if (addCriterion(criteria, params, "city", filters.city)) {
    where.push("L_City = ?");
  }
  if (addCriterion(criteria, params, "maxPrice", filters.maxPrice)) {
    where.push("L_SystemPrice <= ?");
  }
  if (addCriterion(criteria, params, "beds", filters.beds)) {
    where.push("L_Keyword2 >= ?");
  }
  if (addCriterion(criteria, params, "baths", filters.baths)) {
    where.push("LM_Dec_3 >= ?");
  }
  if (addCriterion(criteria, params, "sqft", filters.sqft)) {
    where.push("LM_Int2_3 >= ?");
  }
  if (addCriterion(criteria, params, "type", filters.type)) {
    where.push("L_Type_ = ?");
  }
  if (addCriterion(criteria, params, "pool", filters.pool)) {
    where.push("PoolPrivateYN = ?");
  }
  if (addCriterion(criteria, params, "hasView", filters.hasView)) {
    where.push("ViewYN = ?");
  }
  if (addCriterion(criteria, params, "maxHoa", filters.maxHoa)) {
    where.push("AssociationFee <= ?");
  }

  params.push(pagination.queryLimit, pagination.offset);

  return {
    criteria,
    pagination,
    params,
    sql: `
      SELECT
        ListingID, L_DisplayId, L_Address, L_City, L_Zip,
        L_SystemPrice AS price, L_Keyword2 AS beds, LM_Dec_3 AS baths,
        LM_Int2_3 AS sqft, L_Type_ AS type, L_Status AS status,
        LMD_MP_Latitude AS lat, LMD_MP_Longitude AS lng,
        YearBuilt, AssociationFee, DaysOnMarket,
        PoolPrivateYN, ViewYN, FireplaceYN, PhotoCount,
        LA1_UserFirstName, LA1_UserLastName, LO1_OrganizationName
      FROM rets_property
      WHERE ${where.join(" AND ")}
      ORDER BY L_SystemPrice ASC
      LIMIT ? OFFSET ?
    `.trim()
  };
}

export function buildSoldCompsQuery(city: string, months = 12, page = 1, limit = 50): BuiltQuery {
  const safeCity = city.trim();
  if (!safeCity) {
    throw new Error("city is required for sold comps queries.");
  }

  const safeMonths = normalizePositiveInteger(months, 12, 120);
  const pagination = normalizePagination(page, limit);
  const criteria = {
    city: safeCity,
    months: safeMonths,
    propertyType: "Residential"
  };

  return {
    criteria,
    pagination,
    params: [safeCity, safeMonths, criteria.propertyType, pagination.queryLimit, pagination.offset],
    sql: `
      SELECT
        ListingKey, UnparsedAddress, City, CloseDate, ClosePrice,
        OriginalListPrice, ListPrice, DaysOnMarket,
        BedroomsTotal, BathroomsTotalInteger, LivingArea,
        PropertyType, PropertySubType, YearBuilt,
        ListAgentFullName, ListOfficeName, BuyerOfficeName
      FROM california_sold
      WHERE City = ?
        AND CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        AND PropertyType = ?
      ORDER BY CloseDate DESC
      LIMIT ? OFFSET ?
    `.trim()
  };
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function idValue(value: unknown): string | number | null {
  if (typeof value === "number") {
    return value;
  }
  return stringValue(value);
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return stringValue(value);
}

function fullName(firstName: unknown, lastName: unknown): string | null {
  return [stringValue(firstName), stringValue(lastName)].filter(Boolean).join(" ") || null;
}

export function formatActiveListingRow(row: RawRow): ActiveListing {
  return {
    address: stringValue(row.L_Address),
    associationFee: numberValue(row.AssociationFee),
    baths: numberValue(row.baths),
    beds: numberValue(row.beds),
    city: stringValue(row.L_City),
    daysOnMarket: numberValue(row.DaysOnMarket),
    displayId: stringValue(row.L_DisplayId),
    hasFireplace: stringValue(row.FireplaceYN),
    hasView: stringValue(row.ViewYN),
    latitude: numberValue(row.lat),
    listingAgent: fullName(row.LA1_UserFirstName, row.LA1_UserLastName),
    listingId: idValue(row.ListingID),
    listingOffice: stringValue(row.LO1_OrganizationName),
    longitude: numberValue(row.lng),
    photoCount: numberValue(row.PhotoCount),
    poolPrivate: stringValue(row.PoolPrivateYN),
    price: numberValue(row.price),
    sqft: numberValue(row.sqft),
    status: stringValue(row.status),
    type: stringValue(row.type),
    yearBuilt: numberValue(row.YearBuilt),
    zip: stringValue(row.L_Zip)
  };
}

export function formatSoldCompRow(row: RawRow): SoldComp {
  return {
    address: stringValue(row.UnparsedAddress),
    bathrooms: numberValue(row.BathroomsTotalInteger),
    bedrooms: numberValue(row.BedroomsTotal),
    buyerOfficeName: stringValue(row.BuyerOfficeName),
    city: stringValue(row.City),
    closeDate: dateValue(row.CloseDate),
    closePrice: numberValue(row.ClosePrice),
    daysOnMarket: numberValue(row.DaysOnMarket),
    listAgentFullName: stringValue(row.ListAgentFullName),
    listOfficeName: stringValue(row.ListOfficeName),
    listPrice: numberValue(row.ListPrice),
    listingKey: idValue(row.ListingKey),
    livingArea: numberValue(row.LivingArea),
    originalListPrice: numberValue(row.OriginalListPrice),
    propertySubType: stringValue(row.PropertySubType),
    propertyType: stringValue(row.PropertyType),
    yearBuilt: numberValue(row.YearBuilt)
  };
}

export function rowsToPagedResult<TItem>(
  rows: RawRow[],
  pagination: Pagination,
  criteria: Record<string, string | number>,
  formatter: (row: RawRow) => TItem
): PagedResult<TItem> {
  const visibleRows = rows.slice(0, pagination.limit);
  return {
    criteria,
    hasMore: rows.length > pagination.limit,
    items: visibleRows.map(formatter),
    limit: pagination.limit,
    offset: pagination.offset,
    page: pagination.page
  };
}

export async function searchActiveListings(
  filters: ActiveListingFilters = {},
  page = 1,
  limit = 10
): Promise<PagedResult<ActiveListing>> {
  const builtQuery = buildActiveListingSearchQuery(filters, page, limit);
  const rows = await query<RawRow>(builtQuery.sql, builtQuery.params);
  return rowsToPagedResult(
    rows,
    builtQuery.pagination,
    builtQuery.criteria,
    formatActiveListingRow
  );
}

export async function getSoldComps(
  city: string,
  months = 12,
  page = 1,
  limit = 50
): Promise<PagedResult<SoldComp>> {
  const builtQuery = buildSoldCompsQuery(city, months, page, limit);
  const rows = await query<RawRow>(builtQuery.sql, builtQuery.params);
  return rowsToPagedResult(rows, builtQuery.pagination, builtQuery.criteria, formatSoldCompRow);
}
