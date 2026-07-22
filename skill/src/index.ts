import { FILTER_COLUMN_MAP, parsePropertyQuery, toRetsPropertyFilters, type PropertyFilter } from "./parser.ts";
import { getSoldComps, searchActiveListings } from "./mlsQueries.ts";
import { buildCityMarketRowsQuery, getCityMarketSummary, handleMarketQuestion } from "./marketStats.ts";
import { handlePropertyConversation } from "./conversation.ts";
import { clearSession, getSession, updateSession } from "./session.ts";

export interface SkillInput {
  query: string;
}

export interface SkillOutput {
  filters: PropertyFilter;
  retsPropertyFilters: Record<string, string | number>;
}

export async function run(input: SkillInput): Promise<SkillOutput> {
  if (!input?.query || typeof input.query !== "string") {
    throw new Error("A non-empty query string is required.");
  }

  const filters = parsePropertyQuery(input.query);

  return {
    filters,
    retsPropertyFilters: toRetsPropertyFilters(filters)
  };
}

export {
  clearSession,
  FILTER_COLUMN_MAP,
  buildCityMarketRowsQuery,
  getCityMarketSummary,
  getSession,
  getSoldComps,
  handleMarketQuestion,
  handlePropertyConversation,
  parsePropertyQuery,
  searchActiveListings,
  toRetsPropertyFilters,
  updateSession
};
