import { FILTER_COLUMN_MAP, parsePropertyQuery, toRetsPropertyFilters, type PropertyFilter } from "./parser.ts";

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

export { FILTER_COLUMN_MAP, parsePropertyQuery, toRetsPropertyFilters };
