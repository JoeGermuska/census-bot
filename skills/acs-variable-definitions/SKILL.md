# ACS Variable Definitions

This skill defines the exact Census variables, units, and correct answer forms for each supported metric.
Use it to verify that a tool result is sensible before presenting it to the user.

## Income Metrics (direct estimates — no denominator needed)
- **median income / household income / income**: B19013_001E — Median Household Income. Format: dollar amount (e.g., "$62,450"). A reasonable range for a U.S. city is $25,000–$150,000.
- **per capita income**: B19301_001E — Per Capita Income. Format: dollar amount. Typically 40–60% of median household income for the same place.
- **median household income**: B19013_001E — same as median income above.

## Housing Metrics (direct estimates)
- **median home value / home value / housing value**: B25077_001E — Median Home Value. Format: dollar amount (e.g., "$285,000"). Reasonable range: $50,000–$2,000,000.
- **median rent / rent / gross rent**: B25064_001E — Median Gross Rent. Format: dollar amount (e.g., "$1,050"). Reasonable range: $400–$4,000/month.
- **housing units**: B25001_001E — Total Housing Units. Format: integer count (e.g., "1,234,567").

## Population Metrics (direct estimates)
- **population / total population / how many people / residents**: B01003_001E — Total Population. Format: integer (e.g., "2,693,976").
- **median age / age**: B01002_001E — Median Age. Format: decimal years (e.g., "34.2 years"). Reasonable range: 25–50 years.

## Rate Metrics (DERIVED — require denominator fetch; never display raw count)

### Poverty
- **poverty / poverty rate / below poverty**: B17001_002E ÷ B17001_001E × 100
  - Numerator: people with income below poverty level (a count)
  - Denominator: population for whom poverty status is determined (NOT total population)
  - Correct answer form: **"14.3%"** — NEVER a raw integer like "127,432"
  - Reasonable range: 3%–40% for a U.S. city

### Unemployment
- **unemployment / unemployment rate / unemployed**: B23025_005E ÷ B23025_003E × 100
  - Numerator: unemployed persons 16+ (a count)
  - Denominator: civilian labor force 16+ (B23025_003E)
  - Correct answer form: **"6.2%"** — NEVER a raw integer like "45,000"
  - Reasonable range: 2%–20% for a U.S. city

### Employment
- **employed / employment**: B23025_004E ÷ B23025_003E × 100
  - Numerator: employed persons 16+ (a count)
  - Denominator: civilian labor force 16+ (B23025_003E)
  - Correct answer form: **"94.1%"** — NEVER a raw integer like "1,200,000"
  - Reasonable range: 80%–98% for a U.S. city

### Bachelor's Degree Attainment
- **bachelor's degree / college educated / education**: B15003_022E ÷ B15003_001E × 100
  - Numerator: persons 25+ with a bachelor's degree
  - Denominator: total population 25+ (B15003_001E)
  - Correct answer form: **"32.4%"** — NEVER a raw integer like "480,000"
  - Reasonable range: 10%–70% for a U.S. city

## Travel / Commute (DERIVED — requires denominator)
- **commute time / travel time**: B08136_001E ÷ B08303_001E
  - Numerator: aggregate travel time to work in minutes (B08136_001E — a very large number, e.g., 30,000,000)
  - Denominator: total workers 16+ who commute (B08303_001E — also large, e.g., 1,100,000)
  - Result: mean commute time in minutes (e.g., 28.7 minutes)
  - Correct answer form: **"28.7 minutes"** — NEVER the raw aggregate like "30,450,000" or the worker count like "1,100,000"
  - Reasonable range: 10–60 minutes for a U.S. city

## Sanity Check Rules

If a tool result looks implausible, check the table below before presenting it:

| Metric | Expected form | Red flag (raw count returned instead) |
|---|---|---|
| Poverty rate | "14.3%" | Large integer like 127,000 |
| Unemployment rate | "6.2%" | Large integer like 45,000 |
| Employment rate | "94.1%" | Large integer like 1,200,000 |
| Bachelor's attainment | "32.4%" | Large integer like 480,000 |
| Commute time | "28.7 minutes" | Large integer like 1,100,000 or 30,000,000 |
| Median income | "$62,450" | Number outside $20k–$200k range |
| Median rent | "$1,050/mo" | Number outside $300–$5,000 range |
| Median age | "34.2 years" | Number outside 20–65 range |

If any of these sanity checks fail, respond: "I'm having trouble computing that metric correctly right now."

Never present a raw count as a rate, percentage, or time measure.
