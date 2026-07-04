import assert from "node:assert/strict";
import test from "node:test";
import { parsePropertyQuery, toRetsPropertyFilters } from "../src/parser.ts";
import { run } from "../src/index.ts";

test("parses condos in Irvine under $1.5M with pool", () => {
  assert.deepEqual(parsePropertyQuery("Show me 3-bedroom condos in Irvine under $1.5M with a pool."), {
    city: "Irvine",
    maxPrice: 1500000,
    beds: 3,
    baths: null,
    sqft: null,
    type: "Condominium",
    pool: "True",
    hasView: null,
    maxHoa: null
  });
});

test("parses townhomes in Newport Beach under $900k", () => {
  assert.deepEqual(parsePropertyQuery("Find townhomes in Newport Beach under $900k."), {
    city: "Newport Beach",
    maxPrice: 900000,
    beds: null,
    baths: null,
    sqft: null,
    type: "Townhouse",
    pool: null,
    hasView: null,
    maxHoa: null
  });
});

test("parses single family homes with bedrooms and bathrooms", () => {
  assert.deepEqual(parsePropertyQuery("Show me single family homes with 4 beds and 3 baths."), {
    city: null,
    maxPrice: null,
    beds: 4,
    baths: 3,
    sqft: null,
    type: "SingleFamilyResidence",
    pool: null,
    hasView: null,
    maxHoa: null
  });
});

test("parses city and view without price or bedrooms", () => {
  assert.deepEqual(parsePropertyQuery("Find properties in Irvine with a view."), {
    city: "Irvine",
    maxPrice: null,
    beds: null,
    baths: null,
    sqft: null,
    type: null,
    pool: null,
    hasView: "True",
    maxHoa: null
  });
});

test("parses square feet and decimal million price", () => {
  assert.deepEqual(parsePropertyQuery("Show me homes over 1800 sqft under $1.2M."), {
    city: null,
    maxPrice: 1200000,
    beds: null,
    baths: null,
    sqft: 1800,
    type: null,
    pool: null,
    hasView: null,
    maxHoa: null
  });
});

test("parses max HOA", () => {
  assert.deepEqual(parsePropertyQuery("Find condos with max HOA 500."), {
    city: null,
    maxPrice: null,
    beds: null,
    baths: null,
    sqft: null,
    type: "Condominium",
    pool: null,
    hasView: null,
    maxHoa: 500
  });
});

test("parses land in Irvine under 500k", () => {
  assert.deepEqual(parsePropertyQuery("Find land in Irvine under 500k."), {
    city: "Irvine",
    maxPrice: 500000,
    beds: null,
    baths: null,
    sqft: null,
    type: "UnimprovedLand",
    pool: null,
    hasView: null,
    maxHoa: null
  });
});

test("parses decimal bathrooms in Newport Beach", () => {
  assert.deepEqual(parsePropertyQuery("3 bedrooms 2.5 baths in Newport Beach."), {
    city: "Newport Beach",
    maxPrice: null,
    beds: 3,
    baths: 2.5,
    sqft: null,
    type: null,
    pool: null,
    hasView: null,
    maxHoa: null
  });
});

test("parses pool and view under $2M", () => {
  assert.deepEqual(parsePropertyQuery("Show homes with pool and view under $2M."), {
    city: null,
    maxPrice: 2000000,
    beds: null,
    baths: null,
    sqft: null,
    type: null,
    pool: "True",
    hasView: "True",
    maxHoa: null
  });
});

test("parses comma price and square feet phrase", () => {
  assert.deepEqual(parsePropertyQuery("Find 2 bed condos in Costa Mesa below $1,200,000 with 1,450 square feet."), {
    city: "Costa Mesa",
    maxPrice: 1200000,
    beds: 2,
    baths: null,
    sqft: 1450,
    type: "Condominium",
    pool: null,
    hasView: null,
    maxHoa: null
  });
});

test("maps parsed filters to rets_property columns", () => {
  const filters = parsePropertyQuery("Show me 3-bedroom condos in Irvine under $1.5M with a pool.");

  assert.deepEqual(toRetsPropertyFilters(filters), {
    L_City: "Irvine",
    L_SystemPrice: 1500000,
    L_Keyword2: 3,
    L_Type_: "Condominium",
    PoolPrivateYN: "True"
  });
});

test("skill wrapper returns both app fields and DB-column filters", async () => {
  await assert.doesNotReject(async () => {
    const result = await run({ query: "Find townhomes in Newport Beach under $900k." });

    assert.equal(result.filters.type, "Townhouse");
    assert.deepEqual(result.retsPropertyFilters, {
      L_City: "Newport Beach",
      L_SystemPrice: 900000,
      L_Type_: "Townhouse"
    });
  });
});
