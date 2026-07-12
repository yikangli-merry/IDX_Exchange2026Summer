import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveListingSearchQuery,
  buildSoldCompsQuery,
  formatActiveListingRow,
  formatSoldCompRow,
  normalizePagination,
  rowsToPagedResult
} from "../src/mlsQueries.ts";

test("builds active listing search with default active status and pagination", () => {
  const built = buildActiveListingSearchQuery();

  assert.match(built.sql, /FROM rets_property/);
  assert.match(built.sql, /WHERE L_Status = \?/);
  assert.match(built.sql, /ORDER BY L_SystemPrice ASC/);
  assert.match(built.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(built.params, ["Active", 11, 0]);
  assert.deepEqual(built.pagination, {
    limit: 10,
    offset: 0,
    page: 1,
    queryLimit: 11
  });
});

test("builds active listing search with all supported filters in param order", () => {
  const injectedCity = "Irvine'; DROP TABLE rets_property; --";
  const built = buildActiveListingSearchQuery(
    {
      city: injectedCity,
      maxPrice: 1500000,
      beds: 3,
      baths: 2.5,
      sqft: 1800,
      type: "Condominium",
      pool: "True",
      hasView: "True",
      maxHoa: 500
    },
    2,
    5
  );

  assert.match(built.sql, /L_City = \?/);
  assert.match(built.sql, /L_SystemPrice <= \?/);
  assert.match(built.sql, /L_Keyword2 >= \?/);
  assert.match(built.sql, /LM_Dec_3 >= \?/);
  assert.match(built.sql, /LM_Int2_3 >= \?/);
  assert.match(built.sql, /L_Type_ = \?/);
  assert.match(built.sql, /PoolPrivateYN = \?/);
  assert.match(built.sql, /ViewYN = \?/);
  assert.match(built.sql, /AssociationFee <= \?/);
  assert.equal(built.sql.includes(injectedCity), false);
  assert.deepEqual(built.params, [
    "Active",
    injectedCity,
    1500000,
    3,
    2.5,
    1800,
    "Condominium",
    "True",
    "True",
    500,
    6,
    5
  ]);
});

test("builds sold comps query with city, months, residential constraint, and pagination", () => {
  const city = "Irvine'; DROP TABLE california_sold; --";
  const built = buildSoldCompsQuery(city, 6, 3, 20);

  assert.match(built.sql, /FROM california_sold/);
  assert.match(built.sql, /City = \?/);
  assert.match(built.sql, /CloseDate >= DATE_SUB\(CURDATE\(\), INTERVAL \? MONTH\)/);
  assert.match(built.sql, /PropertyType = \?/);
  assert.match(built.sql, /ORDER BY CloseDate DESC/);
  assert.equal(built.sql.includes(city), false);
  assert.deepEqual(built.params, [city, 6, "Residential", 21, 40]);
  assert.deepEqual(built.criteria, {
    city,
    months: 6,
    propertyType: "Residential"
  });
});

test("normalizes pagination defensively", () => {
  assert.deepEqual(normalizePagination(0, 250), {
    limit: 100,
    offset: 0,
    page: 1,
    queryLimit: 101
  });
});

test("formats active listing rows into agent-friendly camelCase fields", () => {
  assert.deepEqual(
    formatActiveListingRow({
      AssociationFee: "450",
      DaysOnMarket: 12,
      FireplaceYN: "False",
      LA1_UserFirstName: "Ada",
      LA1_UserLastName: "Lovelace",
      L_Address: "123 Main St",
      L_City: "Irvine",
      L_DisplayId: "OC123",
      L_Zip: "92618",
      ListingID: 42,
      LO1_OrganizationName: "IDX Realty",
      PhotoCount: "30",
      PoolPrivateYN: "True",
      ViewYN: "True",
      YearBuilt: "1999",
      baths: "2.5",
      beds: "3",
      lat: "33.6846",
      lng: "-117.8265",
      price: "1500000",
      sqft: "1800",
      status: "Active",
      type: "Condominium"
    }),
    {
      address: "123 Main St",
      associationFee: 450,
      baths: 2.5,
      beds: 3,
      city: "Irvine",
      daysOnMarket: 12,
      displayId: "OC123",
      hasFireplace: "False",
      hasView: "True",
      latitude: 33.6846,
      listingAgent: "Ada Lovelace",
      listingId: 42,
      listingOffice: "IDX Realty",
      longitude: -117.8265,
      photoCount: 30,
      poolPrivate: "True",
      price: 1500000,
      sqft: 1800,
      status: "Active",
      type: "Condominium",
      yearBuilt: 1999,
      zip: "92618"
    }
  );
});

test("formats sold comp rows and trims limit plus one result", () => {
  const rows = [
    {
      BathroomsTotalInteger: "2",
      BedroomsTotal: "3",
      BuyerOfficeName: "Buyer Brokerage",
      City: "Irvine",
      CloseDate: new Date("2026-01-15T12:00:00Z"),
      ClosePrice: "1200000",
      DaysOnMarket: "8",
      ListAgentFullName: "Grace Hopper",
      ListOfficeName: "Seller Brokerage",
      ListPrice: "1250000",
      ListingKey: "SOLD1",
      LivingArea: "1600",
      OriginalListPrice: "1300000",
      PropertySubType: "Condominium",
      PropertyType: "Residential",
      UnparsedAddress: "456 Sold Ave",
      YearBuilt: "2005"
    },
    { ListingKey: "SOLD2" }
  ];

  const result = rowsToPagedResult(
    rows,
    { limit: 1, offset: 0, page: 1, queryLimit: 2 },
    { city: "Irvine", months: 12, propertyType: "Residential" },
    formatSoldCompRow
  );

  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    address: "456 Sold Ave",
    bathrooms: 2,
    bedrooms: 3,
    buyerOfficeName: "Buyer Brokerage",
    city: "Irvine",
    closeDate: "2026-01-15",
    closePrice: 1200000,
    daysOnMarket: 8,
    listAgentFullName: "Grace Hopper",
    listOfficeName: "Seller Brokerage",
    listPrice: 1250000,
    listingKey: "SOLD1",
    livingArea: 1600,
    originalListPrice: 1300000,
    propertySubType: "Condominium",
    propertyType: "Residential",
    yearBuilt: 2005
  });
});

test("requires a city for sold comps", () => {
  assert.throws(() => buildSoldCompsQuery("   "), /city is required/);
});
