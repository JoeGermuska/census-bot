# ACS Data Interpreter Skill

## Purpose
Turn raw ACS numbers into accurate, well-contextualized findings. Covers how to read Census values correctly, when to caveat findings, how to adjust for inflation, and how to write interpretive summaries.

## Sourcing Census Bureau facts

**Before stating any specific Census threshold, suppression rule, or release-cadence detail, call `search_acs_docs`** with the relevant query (e.g. "1-year publication threshold", "estimate suppression rules", "coefficient of variation thresholds"). Quote the official text with the chunk_id citation.

The authoritative documents are indexed and searchable:
- `ACS_Data_Release_Rules.pdf` — population thresholds, suppression criteria, table availability rules
- `acs_design_methodology_report_2024.pdf` — sampling, weighting, MOE/CV definitions, edit/imputation rules
- `2022_ACSSubjectDefinitions.pdf` — concept and universe definitions for every published variable

**Do not paraphrase specific numerical thresholds from memory.** They change between vintages and are exactly the kind of detail this skill should defer to RAG for. The interpretive rules below are stable; the specific numbers underneath them belong in the docs.

## Core Interpretation Rules

### Rule 1: Always Check the Margin of Error
ACS data is survey-based — every estimate has a margin of error (MOE). A variable ending in `E` has a companion `M` variable for MOE.

```
B25064_001E = $1,847 (median rent)
B25064_001M = ±$43   (90% confidence interval)

This means the true median rent is $1,847 ± $43 with 90% confidence.
```

**When to flag MOE concerns** (practical rules of thumb, not Census-mandated thresholds):
- MOE is a notable share of the estimate → note in your output
- MOE is comparable to or larger than the estimate → warn that the estimate is unreliable
- Small geographies (small counties, census tracts, CDPs) → always show MOE

For the Bureau's published reliability thresholds, call `search_acs_docs` with "coefficient of variation" or "data quality thresholds".

### Rule 2: Sentinel Values
The Census uses specific codes for missing/unavailable data. **Never display these as real numbers:**

| Code | Meaning |
|------|---------|
| `-666666666` | Not available / not applicable |
| `-222222222` | Median not computed (too few cases) |
| `-333333333` | Median >= top of top-coded range |
| `-555555555` | Missing / suppressed |
| `0` in income/rent | Can be legitimate — verify with universe |

**How to handle:** Return `null` or display "Data not available for this geography."

### Rule 3: Universe Matters
Every ACS table applies to a specific universe. An estimate of 0 might mean the thing doesn't exist, OR that the universe is wrong for the question.

Common universe mismatches:
- B25070 (rent burden) → universe is **renter-occupied units** only; don't apply to homeowners
- B19013 (household income) → universe is **households**; not individuals or families
- B07011 (mover income) → universe is **people who moved in past year**
- B15003 (educational attainment) → universe is **population 25 years and over**

### Rule 4: Percent vs. Count
ACS tables report counts (estimates). For percentages:
- Use `PE` variables if available (percent estimates are pre-calculated)
- Otherwise: `percent = (estimate / universe_total) * 100`
- Example: Rent-burdened share = `B25070_010E / B25070_001E * 100`

### Rule 5: MOE for Derived Statistics

When `lookup_census_data` returns both `value` and `moe`, **always** include the MOE in your answer — that's how users gauge reliability. For derived rates (percent rates, mean commute time, etc.) the server pre-computes the MOE for you using these formulas:

- **Proportion** (numerator ⊂ denominator — e.g. unemployment = unemployed / labor force):
  `MOE_P = (1/X) · √(MOE_Y² − P² · MOE_X²)`
  Fall back to the ratio formula if the radicand is negative (rare; very noisy small areas).
- **Ratio** (numerator ⊄ denominator — e.g. mean commute = aggregate minutes / workers):
  `MOE_R = (1/X) · √(MOE_Y² + R² · MOE_X²)`
- **Sum** (combining estimates — e.g. total renters across age brackets):
  `MOE_sum = √(MOE_1² + MOE_2² + … + MOE_n²)`

A percent rate's MOE is in **percentage points**, not percent. Display it as "±0.8 pp" or "±0.8 percentage points" — never "±0.8%". Saying "unemployment rate 4.2% ±0.8%" conflates the rate's unit with the MOE's unit and is technically wrong.

---

## Suppression & Reliability

### Coefficient of variation (CV)
`CV = MOE / (1.645 × estimate)` — the 1.645 converts the 90% CI MOE into a standard error.

CV is the more rigorous reliability check (vs. Rule 1's MOE-as-% heuristic). The Bureau publishes specific CV thresholds for "reliable", "caveat-worthy", and "unreliable" classifications — **call `search_acs_docs` with "coefficient of variation thresholds" before quoting them**, since they vary by table type and have been refined across vintages.

In practice: low CV → use the number directly; mid CV → caveat in narrative; high CV → don't lead with the number, suggest a larger geography or flag unreliability.

### When to prefer 5-year over 1-year
- Geography is below the Bureau's 1-year publication threshold → 1-year isn't published; 5-year is the only option. (Call `search_acs_docs` for "1-year publication threshold" to quote the exact population cutoff.)
- 1-year MOE is large relative to the estimate → 5-year usually has tighter MOE; prefer it.
- Trend questions crossing 2020 → 5-year smooths the COVID-era single-year disruption.
- Small subgroup (e.g. one race × one age bracket × one place) → 5-year reduces sampling variance.

### Why an estimate might be missing
The Bureau suppresses a value when:
- Sample size in the cell falls below the Bureau's quality threshold (call `search_acs_docs` for "data suppression rules" to quote the exact criterion — it's based on unweighted cases and CV, not a single round number).
- Disclosure rules would let an individual be identified.
- The value is top-coded (income or age ceilings) — returned as sentinel `-333333333`.

When a sentinel comes back, the validation layer flags it with a *specific* reason. Surface that reason to the user (e.g. "this estimate was suppressed for disclosure protection"), not a generic "data unavailable."

---

## Inflation Adjustment

**Always adjust for inflation when comparing dollar values across years.**

Recommended: Use the **CPI-U (All Items, U.S. City Average)** or the **CPI-U Shelter component** for housing-specific analysis.

```javascript
// Approximate CPI adjustment factors (2023 base = 1.0)
// Multiply historical values by these to convert to 2023 dollars
const CPI_FACTORS = {
  2016: 1.255,
  2017: 1.234,
  2018: 1.211,
  2019: 1.192,
  2020: 1.181,
  2021: 1.133,
  2022: 1.051,
  2023: 1.000,
  2024: 0.967, // approximate
};

function toConstantDollars(value, fromYear, toYear = 2023) {
  const adjusted = value * (CPI_FACTORS[toYear] / CPI_FACTORS[fromYear]);
  return Math.round(adjusted);
}

// Example: $1,500 rent in 2016 → 2023 dollars
toConstantDollars(1500, 2016); // → $1,882
```

**Note**: Always state whether values are in nominal or real (inflation-adjusted) dollars.

---

## How to Write Interpretive Summaries

### For a single value
> "The median gross rent in California in 2022 was **$1,847/month** (±$43), based on ACS 1-year estimates. This represents approximately **28%** of the state's median household income."

### For a trend finding
> "California's median rent rose from **$1,297/month in 2016** to **$1,847/month in 2022** — a **42% nominal increase**, or approximately **13% in real (inflation-adjusted) terms**."

### For a comparison finding
> "Renters in California paid a median of **$1,847/month** compared to **$1,107/month** in Texas — a difference of **$740/month** ($8,880/year). California renters were also more likely to be severely cost-burdened: **26% of CA renters** spent 50%+ of income on rent, vs. **15% in Texas**."

### For a migration finding
> "Recent in-migrants to Texas from other states had a median household income of **$68,400** (B07011), compared to a state median of **$63,900** (B19013) — suggesting that California out-migrants skew slightly higher-income than the average Texas resident, which may partially offset the housing cost advantage."

---

## Benchmarks for Contextualizing Housing Costs

Use these to frame whether a number is "high" or "low":

| Metric | Affordable Threshold | Stressed | Severely Stressed |
|--------|---------------------|----------|-------------------|
| Rent-to-income ratio | < 30% | 30–50% | > 50% |
| Home price-to-income ratio | < 3x annual income | 3–5x | > 5x |
| Vacancy rate (healthy market) | 5–7% | < 3% (tight) | > 10% (oversupplied) |
| Median rent as % of median wage | < 30% | 30–40% | > 40% |

**National context (2022 ACS):**
- US median rent: $1,279/month
- California median rent: $1,847/month (44% above national)
- Texas median rent: $1,107/month (13% below national)
- Idaho median rent: $1,050/month (18% below national, but +40% since 2019)

---

## What NOT to Say

1. ❌ "The data shows that California is unaffordable" → Say: "X% of California renters are cost-burdened"
2. ❌ "People who moved to Texas saved money" → Say: "Texas median rent is $740/month lower than California's"
3. ❌ "This number represents all Californians" → Check and state the universe
4. ❌ Showing 2020 ACS 1-year data → It wasn't released; note the gap
5. ❌ Comparing 5-year estimates from overlapping periods as if independent → Explain the overlap

---

## Output Structure for Research Queries

When returning findings to a user, use this structure:

```json
{
  "headline_finding": "Renters who moved from California to Texas saved an estimated $740/month in 2022",
  "key_metrics": [
    { "label": "CA Median Rent", "value": "$1,847", "year": 2022, "source": "B25064_001E" },
    { "label": "TX Median Rent", "value": "$1,107", "year": 2022, "source": "B25064_001E" },
    { "label": "CA Cost-Burdened Renters", "value": "26%", "year": 2022, "source": "B25070_010E" },
    { "label": "TX Cost-Burdened Renters", "value": "15%", "year": 2022, "source": "B25070_010E" }
  ],
  "caveats": [
    "ACS does not track individuals — these are averages for all renters, not specifically movers",
    "2020 data gap — trend line skips from 2019 to 2021",
    "Values in nominal dollars; adjust for inflation for cross-year comparisons"
  ],
  "recommended_visualization": "dual-line chart showing CA vs TX median rent 2016–2023",
  "follow_up_questions": [
    "How does this differ for renters vs. homebuyers?",
    "Which Texas cities saw the largest influx of California migrants?",
    "Did home prices in destination states rise in response to in-migration?"
  ]
}
```
