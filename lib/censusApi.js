// lib/censusApi.js
import { STATE_FIPS } from "./censusTranslator";
import { CURRENT_ACS_YEAR } from "./censusConstants";

// Census NAME field looks like "Chicago city, Illinois" or "Chicago Heights city, Illinois".
// Strip ", State" and known place-type suffixes to get the bare city name for exact matching.
const PLACE_TYPE_SUFFIX = /\s+(city|town|village|cdp|borough|township|charter township|municipality|unified government|consolidated government|metro government|urban county|metropolitan government)$/i;

function extractBareName(censusNameField) {
  const beforeComma = String(censusNameField || "").split(",")[0].trim().toLowerCase();
  return beforeComma.replace(PLACE_TYPE_SUFFIX, "").trim();
}

// Returns true only when the Census NAME row matches the requested city exactly.
// Falls back to a "city"-suffixed prefix check so minor suffix variations still match.
function matchesCityName(censusNameField, normalizedCityQuery) {
  const lower = String(censusNameField || "").toLowerCase();
  const bareName = extractBareName(lower);
  if (bareName === normalizedCityQuery) return true;
  // Secondary: the name starts with exactly "chicago city" (guards against "chicago heights city")
  const exactPrefixed = `${normalizedCityQuery} `;
  const placePart = lower.split(",")[0].trim();
  return placePart === `${normalizedCityQuery} city` ||
         placePart === `${normalizedCityQuery} town` ||
         placePart === `${normalizedCityQuery} village` ||
         placePart === `${normalizedCityQuery} borough` ||
         placePart === `${normalizedCityQuery} cdp` ||
         placePart.startsWith(exactPrefixed) && bareName === normalizedCityQuery;
}

const BASE_URL_BASE = "https://api.census.gov/data";
const DEFAULT_YEAR = CURRENT_ACS_YEAR;
const DATASET = "acs/acs5";
const variableCache = new Map();

// Census Bureau only publishes ACS 1-year estimates for geographies with
// 65,000+ population. ZCTAs and Urban Areas are 5-year-only regardless of size.
const ONE_YEAR_POP_THRESHOLD = 65000;
const ONE_YEAR_INELIGIBLE_GEO_TYPES = new Set(["zcta", "urban_area"]);

// "B25064_001E" → "B25064_001M". Returns null when the variable doesn't end
// in "E" (e.g. percent-estimate "PE" or "MA" suffixes have different MOE
// companions and the simple substitution doesn't apply).
export function moeIdFor(variableId) {
  const id = String(variableId || "");
  if (!/E$/.test(id)) return null;
  return id.slice(0, -1) + "M";
}

// Same fetch as fetchCensusValue but returns the estimate AND its companion
// margin-of-error variable in a single API call. ACS 90% CI is the standard
// MOE convention. Returns null fields if the geography doesn't publish either.
export async function fetchCensusValueWithMOE(variableId, geoParams, apiKey, year = DEFAULT_YEAR, dataset = "acs/acs5") {
  const moeId = moeIdFor(variableId);
  if (!moeId) {
    // Variable has no simple E→M companion; fall back to estimate-only.
    const value = await fetchCensusValue(variableId, geoParams, apiKey, year, dataset);
    return { value, moe: null };
  }

  const { forGeo, inGeo, placeFilter } = geoParams;
  const params = new URLSearchParams({
    get: `NAME,${variableId},${moeId}`,
    for: forGeo,
    key: apiKey,
  });
  if (inGeo) params.set("in", inGeo);

  const url = `${BASE_URL_BASE}/${year}/${dataset}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Census API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length < 2) throw new Error("No data returned from Census API.");

  const header = data[0];
  const valueIdx = header.indexOf(variableId);
  const moeIdx = header.indexOf(moeId);

  let row;
  if (placeFilter) {
    const filter = placeFilter.toLowerCase();
    row = data.slice(1).find(r => matchesCityName(r[0], filter));
    if (!row) throw new Error(`Couldn't find "${placeFilter}" in Census place data.`);
  } else {
    row = data[1];
  }

  return {
    value: valueIdx === -1 ? null : row[valueIdx],
    moe: moeIdx === -1 ? null : row[moeIdx],
  };
}

export async function fetchCensusValue(variableId, geoParams, apiKey, year = DEFAULT_YEAR, dataset = "acs/acs5") {
  const { forGeo, inGeo, placeFilter } = geoParams;

  const params = new URLSearchParams({
    get: `NAME,${variableId}`,
    for: forGeo,
    key: apiKey,
  });
  if (inGeo) params.set("in", inGeo);

  const url = `${BASE_URL_BASE}/${year}/${dataset}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Census API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!data || data.length < 2) throw new Error("No data returned from Census API.");

  if (placeFilter) {
    const filter = placeFilter.toLowerCase();
    const match = data.slice(1).find(row => matchesCityName(row[0], filter));
    if (!match) throw new Error(`Couldn't find "${placeFilter}" in Census place data.`);
    return match[1];
  }

  return data[1][1];
}

// Classify a 1-Year-fetch failure or skip into a user-readable reason.
// Grounded in the official Census ACS Data Release Rules (Oct 2024):
//   https://www2.census.gov/programs-surveys/acs/tech_docs/data_suppression/ACS_Data_Release_Rules.pdf
//
// Key thresholds we encode:
//   • 1-Year Detailed Tables (B-prefix): 65,000-person geography minimum
//   • All MSAs receive 1-Year regardless of size (smallest MSA in 2022 = 58,130)
//   • ZCTAs and Urban Areas: no 1-Year publication at all
//   • Estimates can be suppressed for data quality (CV / unweighted-case rules)
//     even when geography is eligible — so a null result ≠ "below 65K"
function preCheckOneYear({ population, geoType }) {
  if (geoType === "zcta") {
    return {
      eligible: false,
      reason: "ZIP-code geographies (ZCTAs) don't have ACS 1-Year publications — only the 5-Year version covers them, per the Census Bureau's data release rules.",
    };
  }
  if (geoType === "urban_area") {
    return {
      eligible: false,
      reason: "Urban Areas don't have ACS 1-Year estimates published, per the Census Bureau's data release rules.",
    };
  }
  // Metro/Micro Statistical Areas always have 1-Year (per Census rules); skip
  // the population check for them.
  if (geoType === "cbsa" || geoType === "metropolitan_statistical_area") {
    return { eligible: true, reason: null };
  }
  if (geoType && ONE_YEAR_INELIGIBLE_GEO_TYPES.has(geoType)) {
    return {
      eligible: false,
      reason: `${geoType} geographies aren't published in ACS 1-Year detailed tables.`,
    };
  }
  if (typeof population === "number" && population < ONE_YEAR_POP_THRESHOLD) {
    return {
      eligible: false,
      reason: `This place has ${population.toLocaleString()} people — below the 65,000-person threshold the Census Bureau requires for ACS 1-Year detailed tables (per the official ACS Data Release Rules).`,
    };
  }
  return { eligible: true, reason: null };
}

// Distinguish API failure modes so we don't blame "population below 65K" for a
// transient 503 or generic network error.
function classifyApiError(err, populationKnown) {
  const msg = String(err?.message || err || "");
  if (/\b503\b|maintenance|undergoing|overloaded|temporarily/i.test(msg)) {
    return "The Census Bureau's 1-Year API was temporarily unavailable (likely undergoing maintenance). The 5-Year estimate is shown instead — retry shortly to attempt 1-Year again.";
  }
  if (/\b404\b|not found|no data|empty/i.test(msg)) {
    return populationKnown
      ? "ACS 1-Year doesn't publish this combination of variable + geography (commonly because the place is below the 65,000-population threshold or the estimate was suppressed for data quality)."
      : "ACS 1-Year doesn't publish this geography — most commonly because its population is below the Census Bureau's 65,000-person threshold for 1-Year detailed tables.";
  }
  return `1-Year API error: ${msg.slice(0, 200)}`;
}

// Same as fetchCensusValueWithFallback but also returns the companion MOE.
// Returns { value, moe, dataset, year, fallbackReason }.
//
//   fallbackReason is null when 1-Year was used. When 5-Year was used, it
//   describes WHY 1-Year wasn't viable (population, geo type, variable
//   suppression, API error). Surface this to the user — they shouldn't have
//   to wonder "why didn't the bot use the more recent 1-Year number?"
export async function fetchCensusValueWithMOEAndFallback(variableId, geoParams, apiKey, opts = {}) {
  const { year = DEFAULT_YEAR, population = null, geoType = null } = opts;
  const pre = preCheckOneYear({ population, geoType });

  // Always TRY 1-year unless the geo type is clearly ineligible (ZCTA/UA).
  // For population-below-65K we still try, in case the Census published it
  // anyway in some supplemental tabulation.
  let oneYearFallbackReason = pre.eligible ? null : pre.reason;
  const wantsOneYearAttempt = !geoType || (geoType !== "zcta" && geoType !== "urban_area");

  if (wantsOneYearAttempt) {
    try {
      const result = await fetchCensusValueWithMOE(variableId, geoParams, apiKey, year, "acs/acs1");
      const num = parseFloat(result.value);
      if (Number.isFinite(num) && num >= 0) {
        return { ...result, dataset: "acs1", year, fallbackReason: null };
      }
      // Got a sentinel/null. Per ACS Data Release Rules, this means the
      // estimate was suppressed for data quality (insufficient unweighted
      // cases, high coefficient of variation), OR the variable isn't tabulated
      // in 1-Year for this universe.
      if (!oneYearFallbackReason) {
        oneYearFallbackReason = `The ACS 1-Year value for ${variableId} is suppressed for this geography — typically because the unweighted sample size or coefficient of variation didn't meet the Census Bureau's quality thresholds (per the ACS Data Release Rules). The 5-Year estimate aggregates 60 months of data and isn't subject to the same suppression.`;
      }
    } catch (err) {
      if (!oneYearFallbackReason) {
        oneYearFallbackReason = classifyApiError(err, typeof population === "number");
      }
    }
  }

  // Diagnostic: when we know a place should be 1-Year-eligible per the Census
  // rules (population ≥ 65K and geoType isn't restricted), log loudly so we
  // notice when something we expect to work doesn't. Per user directive:
  // "If the reasoning for census documents implies there should be 1 year
  // data available, you should assume you are making an error and look deeper."
  const shouldHave1Year = pre.eligible
    && typeof population === "number"
    && population >= ONE_YEAR_POP_THRESHOLD
    && geoType !== "zcta"
    && geoType !== "urban_area";
  if (shouldHave1Year) {
    console.warn(
      `[acs-fallback] 1-Year was expected per Census rules (pop=${population}, geoType=${geoType}) but FELL BACK to 5-Year. ` +
      `variable=${variableId}, geo=${JSON.stringify(geoParams)}, reason="${oneYearFallbackReason}". ` +
      `This is worth investigating — could be a wrong geo-FIPS, a transient API error, or actual data suppression.`
    );
  }

  const result = await fetchCensusValueWithMOE(variableId, geoParams, apiKey, year, "acs/acs5");
  return { ...result, dataset: "acs5", year, fallbackReason: oneYearFallbackReason };
}

// Prefer ACS 1-year (more recent + single-year) when the geography is
// eligible (≥65K population, not a ZCTA/Urban Area); fall back to 5-year on
// failure or when ineligible. Returns { value, dataset, year, fallbackReason }.
export async function fetchCensusValueWithFallback(variableId, geoParams, apiKey, opts = {}) {
  const { year = DEFAULT_YEAR, population = null, geoType = null } = opts;
  const pre = preCheckOneYear({ population, geoType });

  let oneYearFallbackReason = pre.eligible ? null : pre.reason;
  const wantsOneYearAttempt = !geoType || (geoType !== "zcta" && geoType !== "urban_area");

  if (wantsOneYearAttempt) {
    try {
      const value = await fetchCensusValue(variableId, geoParams, apiKey, year, "acs/acs1");
      const num = parseFloat(value);
      if (Number.isFinite(num) && num >= 0) {
        return { value, dataset: "acs1", year, fallbackReason: null };
      }
      if (!oneYearFallbackReason) {
        oneYearFallbackReason = `Variable ${variableId} isn't published in ACS 1-Year for this geography.`;
      }
    } catch {
      if (!oneYearFallbackReason) {
        oneYearFallbackReason = `ACS 1-Year API didn't return data for this geography — typically because the place is below the 65,000-population threshold.`;
      }
    }
  }

  const value = await fetchCensusValue(variableId, geoParams, apiKey, year, "acs/acs5");
  return { value, dataset: "acs5", year, fallbackReason: oneYearFallbackReason };
}

// Fetch the same metric across the 5 most recent ACS years ending at CURRENT_ACS_YEAR.
export async function fetchCensusOverTime(variableId, geoParams, apiKey) {
  const endYear = parseInt(CURRENT_ACS_YEAR, 10);
  const years = Array.from({ length: 5 }, (_, i) => String(endYear - 4 + i));

  const results = await Promise.allSettled(
    years.map(year => fetchCensusValue(variableId, geoParams, apiKey, year))
  );

  return years.map((year, i) => ({
    year: parseInt(year),
    rawValue: results[i].status === "fulfilled" ? results[i].value : null,
  }));
}

export async function fetchCensusVariable({ year, variable, city, state }) {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    throw new Error("Server configuration error: missing Census API key.");
  }

  if (!year || !variable || !city || !state) {
    throw new Error("Missing required fields: year, variable, city, and state are required.");
  }

  const normalizedState = String(state).trim().toLowerCase();
  const stateFips = STATE_FIPS[normalizedState];
  if (!stateFips) {
    throw new Error(`Unsupported or invalid state: "${state}".`);
  }

  const normalizedCity = String(city).trim().toLowerCase();
  const normalizedYear = String(year);
  const cacheKey = `${normalizedYear}:${variable}:${normalizedCity}:${stateFips}`;
  if (variableCache.has(cacheKey)) {
    return variableCache.get(cacheKey);
  }

  const params = new URLSearchParams({
    get: `NAME,${variable}`,
    for: "place:*",
    in: `state:${stateFips}`,
    key: apiKey,
  });

  const url = `${BASE_URL_BASE}/${normalizedYear}/${DATASET}?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Census API error ${response.status} for year ${year}: ${text}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[0])) {
    throw new Error(`Invalid Census response format for year ${year}.`);
  }

  const variableIndex = data[0].indexOf(variable);
  if (variableIndex === -1) {
    throw new Error(`Variable "${variable}" not present in Census response for year ${year}.`);
  }

  const targetRow = data.slice(1).find((row) => {
    const name = row?.[0];
    if (typeof name !== "string") return false;
    return matchesCityName(name, normalizedCity);
  });

  if (!targetRow) {
    throw new Error(`No Census place match found for "${city}, ${state}" in year ${year}.`);
  }

  const rawValue = targetRow[variableIndex];
  const numericValue = Number(rawValue);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error(`Missing or invalid value for "${variable}" in ${year}.`);
  }

  variableCache.set(cacheKey, numericValue);
  return numericValue;
}