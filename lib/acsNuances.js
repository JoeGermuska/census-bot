// lib/acsNuances.js
// Pure helpers that turn a structured Census answer into short, deterministic
// "nuance banners" — terse caveats explaining ACS quirks the user should know
// about so they can judge whether the number fits their question. No RAG, no
// LLM; just rules driven by dataset / geoType / table id.

import { getRateDenominator } from "./censusRates";

// "B19013_001E" → "B19013"
function tableIdOf(variableId) {
  return String(variableId || "").split("_")[0];
}

const ONE_YEAR_POP_THRESHOLD = 65_000;

/**
 * Given the structured payload for a stat answer, return an array of short
 * banner strings to surface in the methodology panel. Each banner is a single
 * sentence written in plain language with a leading ⚠.
 *
 * Inputs the function reads:
 *   - structured.dataset: "acs1" | "acs5"
 *   - structured.year: number (e.g. 2024)
 *   - structured.geoType: "place" | "county" | "cbsa" | "zcta" | "urban_area" | "state"
 *   - structured.variable (label): used in the rate banner wording
 *   - structured.variableId: the raw Census ID (used to detect rates)
 *   - structured.population: optional population of the geo (when known) —
 *       lets us tailor the small-place 5-year banner.
 */
export function buildNuanceBanners(structured) {
  if (!structured) return [];
  const banners = [];
  const ds = structured.dataset;
  const year = Number(structured.year);
  const geoType = structured.geoType;
  const pop = typeof structured.population === "number" ? structured.population : null;

  // 1. 5-year fallback: explain why we're averaging instead of single-year.
  if (ds === "acs5") {
    if (geoType === "zcta") {
      banners.push(
        "ZCTAs are 5-year-only — Census never publishes 1-year ZIP-level estimates. " +
        `This number averages ${year - 4}–${year}, so it lags real-world change by ~2 years.`
      );
    } else if (geoType === "urban_area") {
      banners.push(
        "Urban Areas are 5-year-only. " +
        `This number averages ${year - 4}–${year}.`
      );
    } else if (pop !== null && pop < ONE_YEAR_POP_THRESHOLD) {
      banners.push(
        `Used 5-year data (averaged ${year - 4}–${year}) because Census doesn't publish ` +
        `1-year estimates for places under 65,000 (this place: ~${pop.toLocaleString()}).`
      );
    } else {
      banners.push(
        `5-year estimate, averaged ${year - 4}–${year}. 1-year data wasn't available for ` +
        `this geography or this variable.`
      );
    }
  }

  // 2. Computed rate: tell the user the percentage isn't a Census-published value.
  if (structured.variableId) {
    const denomId = getRateDenominator(structured.variableId);
    if (denomId) {
      const numTable = tableIdOf(structured.variableId);
      const denomTable = tableIdOf(denomId);
      const tablesNote = numTable === denomTable
        ? `Both come from Table ${numTable}.`
        : `Numerator is in Table ${numTable}; denominator is in Table ${denomTable}.`;
      banners.push(
        `${structured.variable || "This rate"} is computed (numerator ÷ denominator × 100). ${tablesNote} ` +
        `Census doesn't publish the rate directly.`
      );
    }
  }

  // 3. ZCTA-vs-ZIP confusion (always worth noting when querying a ZCTA).
  if (geoType === "zcta") {
    banners.push(
      "Heads-up: ZCTAs aren't identical to USPS ZIPs — they're residential approximations. " +
      "Single-recipient ZIPs (P.O. boxes, internal corporate codes) aren't tabulated."
    );
  }

  // 4. CBSA scope reminder — users sometimes pick the metro thinking it's the city.
  if (geoType === "cbsa") {
    banners.push(
      "This is a metro/micropolitan area: the principal city plus surrounding commuter " +
      "counties. Numbers here will differ substantially from the city alone."
    );
  }

  return banners;
}

/**
 * Build a focused BM25 query for searchAcsDocs that should surface the
 * variable's official definition / universe / methodology passage.
 */
export function buildMethodologyQuery(variableId, variableLabel) {
  const table = tableIdOf(variableId);
  const label = variableLabel || "";
  // Prepend the table id so it gets matched even when the surface label
  // differs from how the docs phrase it (e.g. "Median Gross Rent" vs.
  // "Gross Rent (B25064)").
  return `${table} ${label} definition universe`.trim();
}
