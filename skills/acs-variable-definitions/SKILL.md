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

## Rate Metrics (DERIVED — require denominator fetch; never display raw count as a rate)
- **poverty rate**: B17001_002E ÷ B17001_001E × 100
  - Numerator: people with income below poverty level (a count, e.g., 127,000)
  - Denominator: population for whom poverty status is determined (NOT total population)
  - Correct answer form: **"14.3%"** — NEVER "127,432" or "127,432 people"
  - Reasonable range: 3%–40% for a U.S. city
- **unemployment rate**: B23025_005E ÷ B23025_003E × 100
  - Numerator: unemployed persons 16+ (a count, e.g., 45,000)
  - Denominator: civilian labor force 16+ (B23025_003E, NOT total population)
  - Correct answer form: **"6.2%"** — NEVER "45,000" or "45,000 people"
  - Reasonable range: 2%–20% for a U.S. city

## Travel / Commute
- **commute time / travel time**: B08303_001E — Mean Travel Time to Work in minutes. Format: decimal minutes (e.g., "28.7 minutes"). This is a MEAN (average), not a median. Reasonable range: 15–45 minutes.

## Education
- **bachelor's degree / college educated / education**: B15003_022E — Count of persons 25+ with a bachelor's degree. Format: integer count. This is a raw count of people, NOT an attainment rate. If the user asks for an attainment rate or percentage, clarify that the system returns a count.

## Sanity Check Rules
If a tool result looks like a large integer (e.g., 45,000 or 127,000) for a metric that should be a percentage (poverty rate, unemployment rate), the system has returned a raw count. In that case respond: "I'm having trouble computing the rate for that metric right now."

Never present a raw count as a rate or percentage.
