import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCityMarketRowsQuery,
  buildCityMarketStats,
  extractMarketCity,
  formatCityMarketRow,
  formatMarketStatsReply,
  handleMarketQuestion
} from "../src/marketStats.ts";

function sampleRows() {
  return [
    {
      city: "Pasadena",
      closeDate: "2026-01-10",
      closePrice: 1000000,
      daysOnMarket: 10,
      listPrice: 1050000,
      livingArea: 2000,
      propertyType: "Residential"
    },
    {
      city: "Pasadena",
      closeDate: "2026-01-20",
      closePrice: 1200000,
      daysOnMarket: 20,
      listPrice: 1200000,
      livingArea: 2400,
      propertyType: "Residential"
    },
    {
      city: "Pasadena",
      closeDate: "2026-02-05",
      closePrice: 1500000,
      daysOnMarket: 5,
      listPrice: 1400000,
      livingArea: 3000,
      propertyType: "Residential"
    },
    {
      city: "Pasadena",
      closeDate: "2026-03-15",
      closePrice: 900000,
      daysOnMarket: null,
      listPrice: null,
      livingArea: 0,
      propertyType: "Residential"
    }
  ];
}

test("builds market rows query with parameterized city and month filters", () => {
  const city = "Pasadena'; DROP TABLE california_sold; --";
  const built = buildCityMarketRowsQuery(city, 6);

  assert.match(built.sql, /FROM california_sold/);
  assert.match(built.sql, /City = \?/);
  assert.match(built.sql, /PropertyType = \?/);
  assert.match(built.sql, /CloseDate >= DATE_SUB\(CURDATE\(\), INTERVAL \? MONTH\)/);
  assert.match(built.sql, /ClosePrice IS NOT NULL/);
  assert.match(built.sql, /ORDER BY CloseDate ASC/);
  assert.equal(built.sql.includes(city), false);
  assert.deepEqual(built.params, [city, "Residential", 6]);
  assert.deepEqual(built.criteria, {
    city,
    months: 6,
    propertyType: "Residential"
  });
});

test("requires city and caps month window defensively", () => {
  assert.throws(() => buildCityMarketRowsQuery("   "), /city is required/);

  const built = buildCityMarketRowsQuery("Pasadena", 999);
  assert.deepEqual(built.params, ["Pasadena", "Residential", 120]);
});

test("extracts city from common market question wording", () => {
  assert.equal(extractMarketCity("What is the average price per sq ft in Pasadena?"), "Pasadena");
  assert.equal(extractMarketCity("Is now a good time to buy in San Diego?"), "San Diego");
  assert.equal(extractMarketCity("Pasadena market summary"), "Pasadena");
});

test("formats raw city market rows into numeric agent fields", () => {
  assert.deepEqual(
    formatCityMarketRow({
      City: "Pasadena",
      CloseDate: new Date("2026-01-15T12:00:00Z"),
      ClosePrice: "1200000",
      DaysOnMarket: "8",
      ListPrice: "1250000",
      LivingArea: "1600",
      PropertyType: "Residential"
    }),
    {
      city: "Pasadena",
      closeDate: "2026-01-15",
      closePrice: 1200000,
      daysOnMarket: 8,
      listPrice: 1250000,
      livingArea: 1600,
      propertyType: "Residential"
    }
  );
});

test("builds summary metrics and monthly trend from sold rows", () => {
  const stats = buildCityMarketStats("Pasadena", 12, sampleRows());

  assert.deepEqual(stats.summary, {
    averageClosePrice: 1150000,
    averageDaysOnMarket: 11.7,
    averagePricePerSqft: 500,
    city: "Pasadena",
    listToClosePct: 100.8,
    medianClosePrice: 1100000,
    medianDaysOnMarket: 10,
    medianPricePerSqft: 500,
    months: 12,
    soldCount: 4
  });
  assert.deepEqual(stats.trend, [
    {
      avgDaysOnMarket: 15,
      avgPrice: 1100000,
      avgPricePerSqft: 500,
      medianPrice: 1100000,
      month: "2026-01",
      priceChangePct: null,
      sales: 2
    },
    {
      avgDaysOnMarket: 5,
      avgPrice: 1500000,
      avgPricePerSqft: 500,
      medianPrice: 1500000,
      month: "2026-02",
      priceChangePct: 36.4,
      sales: 1
    },
    {
      avgDaysOnMarket: null,
      avgPrice: 900000,
      avgPricePerSqft: null,
      medianPrice: 900000,
      month: "2026-03",
      priceChangePct: -40,
      sales: 1
    }
  ]);
});

test("formats market stats replies with data-backed summary and trend", () => {
  const reply = formatMarketStatsReply(buildCityMarketStats("Pasadena", 12, sampleRows()));

  assert.match(reply, /Market summary for Pasadena/);
  assert.match(reply, /Sold comps: 4/);
  assert.match(reply, /Median close price: \$1,100,000/);
  assert.match(reply, /average DOM: 11\.7 days/);
  assert.match(reply, /List-to-close ratio: 100\.8%/);
  assert.match(reply, /2026-02: \$1,500,000 avg, 1 sale\(s\), \+36\.4% MoM/);
});

test("formats empty market stats as a clear no-data reply", () => {
  const reply = formatMarketStatsReply(buildCityMarketStats("Irvine", 12, []));

  assert.match(reply, /could not find sold residential records for Irvine/i);
});

test("handles market questions without needing a live database in tests", async () => {
  const calls = [];
  const output = await handleMarketQuestion(
    { message: "What is the average price per sq ft in Pasadena?", months: 12 },
    {
      getMarketSummary: async (city, months) => {
        calls.push({ city, months });
        return buildCityMarketStats(city, months, sampleRows());
      }
    }
  );

  assert.deepEqual(calls, [{ city: "Pasadena", months: 12 }]);
  assert.equal(output.city, "Pasadena");
  assert.equal(output.months, 12);
  assert.equal(output.summary.soldCount, 4);
  assert.equal(output.trend.length, 3);
  assert.match(output.reply, /Median price per sqft: \$500/);
});

test("asks for a city when the market question does not include one", async () => {
  const output = await handleMarketQuestion({ message: "What is the median close price?" });

  assert.equal(output.city, null);
  assert.equal(output.months, 12);
  assert.equal(output.summary, null);
  assert.deepEqual(output.trend, []);
  assert.match(output.reply, /Which California city/i);
});
