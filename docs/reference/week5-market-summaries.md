# Week 5 Market Summaries

This reference supports the Week 8 RAG assistant by summarizing the Week 5 market analytics agent. It gives the RAG index a compact source for market terminology and the metrics generated from `california_sold`.

## Source Table

Week 5 uses the `california_sold` table for residential sold-comps analysis. The market statistics layer filters records by city, residential property type, and a recent time window, using 12 months as the default analysis period.

## Core Metrics

| Metric | Meaning | Source fields |
|---|---|---|
| Sold count | Number of matching sold residential records in the selected city and time window. | `City`, `PropertyType`, `CloseDate` |
| Median close price | Middle value of sold prices after sorting all `ClosePrice` values. | `ClosePrice` |
| Average close price | Mean of sold prices in the result set. | `ClosePrice` |
| Median price per square foot | Median of `ClosePrice / LivingArea` for rows with valid living area. | `ClosePrice`, `LivingArea` |
| Average price per square foot | Average of `ClosePrice / LivingArea` for rows with valid living area. | `ClosePrice`, `LivingArea` |
| Average DOM | Average number of days on market for matching sold records. | `DaysOnMarket` |
| Median DOM | Median number of days on market for matching sold records. | `DaysOnMarket` |
| List-to-close ratio | Average of `(ClosePrice / ListPrice) * 100` for records with valid list price. | `ClosePrice`, `ListPrice` |

## Monthly Trend Summary

The Week 5 market analytics agent groups sold records by close month. For each month it calculates sales volume, average close price, median close price, average DOM, average price per square foot, and month-over-month average price change.

## RAG Usage

The Week 8 RAG assistant should use this source when answering questions about market terminology or derived metrics, especially price per square foot, DOM, list-to-close ratio, median close price, and monthly trend summaries.
