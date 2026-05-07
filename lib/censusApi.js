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

function isOneYearEligible({ population, geoType }) {
  if (geoType && ONE_YEAR_INELIGIBLE_GEO_TYPES.has(geoType)) return false;
  if (typeof population === "number" && population < ONE_YEAR_POP_THRESHOLD) return false;
  return true;
}

// Prefer ACS 1-year (more recent + single-year) when the geography is
// eligible (≥65K population, not a ZCTA/Urban Area); fall back to 5-year on
// failure or when ineligible. Returns { value, dataset, year }.
export async function fetchCensusValueWithFallback(variableId, geoParams, apiKey, opts = {}) {
  const { year = DEFAULT_YEAR, population = null, geoType = null } = opts;

  if (isOneYearEligible({ population, geoType })) {
    try {
      const value = await fetchCensusValue(variableId, geoParams, apiKey, year, "acs/acs1");
      const num = parseFloat(value);
      if (Number.isFinite(num) && num >= 0) {
        return { value, dataset: "acs1", year };
      }
    } catch {
      // 1-year not published for this geography — silently fall back.
    }
  }

  const value = await fetchCensusValue(variableId, geoParams, apiKey, year, "acs/acs5");
  return { value, dataset: "acs5", year };
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