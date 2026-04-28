// lib/censusApi.js
import { STATE_FIPS } from "./censusTranslator";

const BASE_URL_BASE = "https://api.census.gov/data";
const DEFAULT_YEAR = "2022";
const DATASET = "acs/acs5";
const variableCache = new Map();

export async function fetchCensusValue(variableId, geoParams, apiKey, year = DEFAULT_YEAR) {
  const { forGeo, inGeo, placeFilter } = geoParams;

  const params = new URLSearchParams({
    get: `NAME,${variableId}`,
    for: forGeo,
    key: apiKey,
  });
  if (inGeo) params.set("in", inGeo);

  const url = `${BASE_URL_BASE}/${year}/acs/acs5?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Census API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!data || data.length < 2) throw new Error("No data returned from Census API.");

  if (placeFilter) {
    const filter = placeFilter.toLowerCase();
    const match = data.slice(1).find(row => row[0].toLowerCase().includes(filter));
    if (!match) throw new Error(`Couldn't find "${placeFilter}" in Census place data.`);
    return match[1];
  }

  return data[1][1];
}

// NEW: fetch the same metric across 5 years
export async function fetchCensusOverTime(variableId, geoParams, apiKey) {
  const years = ["2018", "2019", "2020", "2021", "2022"];

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
    const lower = name.toLowerCase();
    return lower.startsWith(normalizedCity) || lower.includes(`${normalizedCity} city`);
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