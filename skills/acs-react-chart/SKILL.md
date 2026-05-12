# ACS React Chart Skill

How to fulfill chart/visualization requests in CensusBot. The frontend renders charts inline in the chat bubble via two hand-written components: `components/TrendChart.js` (line/multi-line) and `components/BarChart.js` (categorical horizontal bars). This skill defines which tool call produces which chart.

## Supported chart types

Pick one based on the shape of the user's question:

| Chart type | When to use | How to produce it |
|---|---|---|
| `line` | Single metric, single place, **over time**. "Show poverty trend in Detroit." | One `get_census_trend` call. |
| `multi_line` | Same metric, multiple places, **over time**. "Compare median rent in Austin and Dallas." | One `get_census_trend` call PER place, in parallel. The server combines them. |
| `bar_chart` | Single place, **categorical breakdown** of one variable. "Race in Irvine." "Languages spoken at home in Queens." "Household types in Detroit." Not a time series. | One `get_census_breakdown` call with a `bars[]` array — one entry per category, each with its variable_id + label + table_id. |

Anything else (choropleth, small-multiple, scatter, before/after dumbbell) is **not yet supported**. If the user asks for one, fall back to whichever of the three above best fits the underlying data and mention the limitation in plain text.

## How the server builds the chart

You do NOT hand-author chart JSON. The flow is:

1. You make ONE OR MORE tool calls (parallel `get_census_trend` for multi-line, single `get_census_breakdown` for bar charts).
2. The server fetches the data, validates each variable claim, attaches per-cell source entries, and emits the final chart payload (`trend_chart` or `bar_chart`).
3. Your text reply is discarded for visualization requests — the chart payload IS the reply.

**Implication:** emit tool_use blocks; the server merges them into one chart. Don't write prose alongside chart data.

## How to choose between `get_census_trend` and `get_census_breakdown`

- **Time on the x-axis** (years, "over time", "trend", "since 2015", "during the pandemic") → `get_census_trend`.
- **Categories on the y-axis** (race, language, age groups, household type, place of birth, education levels) at a SINGLE point in time → `get_census_breakdown`.
- **Both** (categories over time) → not supported with one tool call. Pick the more important axis. If the user asks for "race in Irvine over time", they probably want the current breakdown (bar_chart) — confirm or ask which year.

## `get_census_trend` — required inputs

- `location` — free-form geography string. "Austin, Texas" / "California" / "Cook County, Illinois" / "zip 90210".
- `startYear` — integer ≥ 2009.
- `endYear` — integer ≥ startYear, ≤ the latest published ACS 5-Year vintage. The system prompt names the current vintage; default to it when the user doesn't specify.
- `metric` — required when using a curated metric (median rent, population, unemployment rate, etc.).
- OR `variable_id` + `label` + `unit` + `table_id` for any free-form ACS variable.

## `get_census_breakdown` — required inputs

- `location` — same free-form geography string format.
- `title` — short human-readable chart title. "Race composition" / "Language spoken at home" / "Household types".
- `bars` — array of at least 2 objects, each with:
  - `variable_id` — e.g. `B02001_002E`
  - `label` — precise human-readable bar label, e.g. `White Alone` (not just `White`)
  - `table_id` — e.g. `B02001`
- `unit` — optional; defaults to `number`. Use `currency` / `percent` / `years` / `minutes` when appropriate.
- `share_of_variable_id` — optional. When set, each bar's value is divided by this denominator and rendered as a percentage. Example: `B02001_001E` (total population) for "race as share of total".

The server sorts bars descending by value automatically.

## Default year ranges

If the user does not specify a range for a trend:
- "Over time" / no range given → last 10 years ending at the current ACS year.
- "Since 2010" → 2010 through current.
- "Pre vs post COVID" → 2018 through current.
- "Last N years" → last N years ending at current.

For breakdowns, no year input is needed — the server uses the current ACS vintage automatically.

## Worked examples

**Single trend:** "Show median rent in Chicago over the last 5 years"
→ `get_census_trend(location="Chicago, Illinois", metric="median rent", startYear=2020, endYear=2024)`
→ server emits `chartType: "line"`.

**Trend comparison:** "Compare median household income in Austin and Dallas since 2018"
→ TWO parallel calls:
  - `get_census_trend(location="Austin, Texas", metric="median household income", startYear=2018, endYear=2024)`
  - `get_census_trend(location="Dallas, Texas", metric="median household income", startYear=2018, endYear=2024)`
→ server emits `chartType: "multi_line"`.

**Bar chart — race:** "Create a bar chart for population of different races in Irvine, CA"
→ ONE `get_census_breakdown` call:
```
get_census_breakdown(
  location = "Irvine, California",
  title = "Race composition",
  bars = [
    {variable_id: "B02001_002E", label: "White Alone",                     table_id: "B02001"},
    {variable_id: "B02001_003E", label: "Black or African American Alone", table_id: "B02001"},
    {variable_id: "B02001_004E", label: "American Indian / Alaska Native", table_id: "B02001"},
    {variable_id: "B02001_005E", label: "Asian Alone",                     table_id: "B02001"},
    {variable_id: "B02001_006E", label: "Native Hawaiian / Pacific Islander", table_id: "B02001"},
    {variable_id: "B02001_007E", label: "Some Other Race Alone",           table_id: "B02001"},
    {variable_id: "B02001_008E", label: "Two or More Races",               table_id: "B02001"},
  ],
  unit = "number"
)
```
→ server emits `bar_chart` with bars sorted descending by population.

**Bar chart — share of total:** "What share of Irvine is each race?"
→ Same as above plus `share_of_variable_id="B02001_001E"`. Server divides each bar by total population and renders as percent.

**Bar chart — language at home:** "Languages spoken at home in San Jose"
→ Use B16001 (or C16001 for collapsed). Pick the major sub-categories:
```
bars = [
  {variable_id: "B16001_002E", label: "English only",         table_id: "B16001"},
  {variable_id: "B16001_005E", label: "Spanish",              table_id: "B16001"},
  {variable_id: "B16001_038E", label: "Chinese",              table_id: "B16001"},
  ...
]
```

## What the server emits (reference)

`trend_chart`:
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
  "source": "U.S. Census Bureau ACS 5-Year Estimates (2018–2024)"
}
```

`bar_chart`:
```jsonc
{
  "type": "bar_chart",
  "metric": "Race composition",
  "location": "Irvine, California",
  "unit": "number",
  "bars": [
    { "label": "Asian Alone",  "value": 138500, "moe": 1200, "variableId": "B02001_005E", "tableId": "B02001" },
    { "label": "White Alone",  "value": 102300, "moe":  900, "variableId": "B02001_002E", "tableId": "B02001" },
    ...
  ],
  "source": "ACS 2024 1-Year Estimates, U.S. Census Bureau",
  "totalLabel": "Sum across categories: 307,670",
  "sortDescending": true
}
```

## Don'ts

- Don't suggest the user open Excel / Sheets / external tools.
- Don't output Census variable IDs (B19013, etc.) in chart-mode replies.
- Don't write commentary alongside chart data — the server will discard it.
- Don't pack two cities into a single `get_census_trend` call — make two calls.
- Don't call BOTH `get_census_trend` and `get_census_breakdown` in the same turn. Pick one chart type. (If both fire, the server prefers the bar chart.)
- Don't pass labels that don't match the underlying variable. The server runs `validateVariableClaim` on every bar; a mislabeled variable_id will reject the whole chart with an error you'll need to retry.
