# ACS React Chart Skill

How to fulfill chart/visualization requests in CensusBot. The frontend (`components/TrendChart.js`) renders Recharts inline in the chat bubble. This skill defines what tool calls produce what charts.

## Supported chart types

The renderer supports two simple types — pick one based on the user's request:

| Type | When to use | How to produce it |
|---|---|---|
| `line` | Single metric, single place, over time. "Show poverty trend in Detroit." | One `get_census_trend` call. |
| `multi_line` | Same metric across multiple places, over time. "Compare median rent in Austin and Dallas." | One `get_census_trend` call PER place, in parallel. The server combines them. |

Anything else (bar, choropleth, small-multiple, scatter) is **not yet supported**. If the user asks for one, fall back to `line` or `multi_line` for the underlying data and mention the limitation in plain text — but only when not in chart-only mode.

## How the server builds the chart

You do NOT hand-author chart JSON. The flow is:

1. You call `get_census_trend(city, state, metric, startYear, endYear)`.
2. The server executes the call and stores the result as one *series*.
3. If you make multiple `get_census_trend` calls in the same turn, the server collects them all into a multi-line chart automatically.
4. The server emits the final `trend_chart` payload — your text reply is discarded for visualization requests.

**Implication:** for comparisons, just emit two (or more) `tool_use` blocks in a single turn. Do not try to interleave commentary or merge results yourself.

## Required tool inputs

`get_census_trend` requires:
- `city` — e.g. "Austin"
- `state` — full state name, e.g. "Texas"
- `startYear` — integer ≥ 2009
- `endYear` — integer ≥ startYear, ≤ latest available ACS 5-year (2022 today)
- `metric` — optional; the server infers it from the user's prompt if omitted

## Default year ranges

If the user does not specify a range:
- Trend / "over time" → use the last 5 years available (e.g. 2018–2022).
- "Since 2010" / "historical" → use 2010 through latest.
- "Pre vs post COVID" → 2018–2022.

Never fabricate years outside the ACS 5-year availability window.

## Supported metrics

Only metrics in `lib/censusConstants.js` (`QUERY_TYPES`) are valid. Common ones: median household income, median rent, median home value, poverty rate, population, unemployment, median age, mean commute time. If the user asks for an unsupported metric, respond in plain text that it isn't available (the bot will not produce a chart).

## Worked examples

**Single trend:** "Show median rent in Chicago over the last 5 years"
→ `get_census_trend(city="Chicago", state="Illinois", metric="median rent", startYear=2018, endYear=2022)`
→ server emits `chartType: "line"`.

**Comparison:** "Compare median household income in Austin and Dallas since 2018"
→ TWO parallel calls in the same turn:
  - `get_census_trend(city="Austin", state="Texas", metric="median household income", startYear=2018, endYear=2022)`
  - `get_census_trend(city="Dallas", state="Texas", metric="median household income", startYear=2018, endYear=2022)`
→ server emits `chartType: "multi_line"` with two series, color-coded.

**Three-way:** "Population in Phoenix, Houston, and San Antonio 2015–2022"
→ THREE parallel `get_census_trend` calls. Server combines into one multi-line chart.

## What the server emits (reference only)

```jsonc
{
  "type": "trend_chart",
  "chartType": "line" | "multi_line",
  "metric": "Median Rent",
  "location": "Austin, Texas vs Dallas, Texas",
  "series": [
    { "label": "Austin, Texas", "points": [{ "year": 2018, "numericValue": 1200 }, ...] },
    { "label": "Dallas, Texas", "points": [{ "year": 2018, "numericValue": 1100 }, ...] }
  ],
  "source": "U.S. Census Bureau ACS 5-Year Estimates (2018–2022)"
}
```

## Don'ts

- Don't suggest the user open Excel / Sheets / external tools.
- Don't output Census variable IDs (B19013, etc.) in chart-mode replies.
- Don't write commentary alongside chart data — the server will discard it.
- Don't try to plot one metric across two cities by passing two cities to a single tool call. Make two calls.
