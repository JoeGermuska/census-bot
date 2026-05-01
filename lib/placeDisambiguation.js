// lib/placeDisambiguation.js
// Server-side helper: find Census Place candidates matching a bare city name,
// across one specified state or all 50 states. Used by the chatbot to ask the
// user which place they meant when the query is ambiguous.

import { STATE_FIPS } from "./censusTranslator";
import { CURRENT_ACS_YEAR } from "./censusConstants";

const PLACE_TYPE_SUFFIX = /\s+(city|town|village|cdp|borough|township|charter township|municipality|unified government|consolidated government|metro government|urban county|metropolitan government)$/i;

const TYPE_RANK = {
  city: 0, town: 1, village: 2, borough: 3, cdp: 4,
  township: 5, "charter township": 5,
  municipality: 6, "unified government": 7,
  "consolidated government": 7, "metro government": 7,
  "urban county": 8, "metropolitan government": 8,
};

// Build the reverse FIPS→name map once. STATE_FIPS includes both full names
// AND postal abbreviations; we only want the full names for display.
const FIPS_TO_STATE_NAME = (() => {
  const map = {};
  for (const [name, fips] of Object.entries(STATE_FIPS)) {
    if (name.length > 2 && !map[fips]) {
      map[fips] = name.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return map;
})();

const placesByStateCache = new Map(); // FIPS → { fetchedAt, rows: [{name,type,fips}] }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function parsePlaceRow(rawName) {
  const beforeComma = String(rawName || "").split(",")[0].trim();
  const match = beforeComma.match(PLACE_TYPE_SUFFIX);
  const type = match ? match[1].toLowerCase() : null;
  const bareName = beforeComma.replace(PLACE_TYPE_SUFFIX, "").trim();
  return { bareName, type };
}

async function fetchPlacesForState(stateFips, apiKey) {
  const cached = placesByStateCache.get(stateFips);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rows;
  }
  const url = `https://api.census.gov/data/${CURRENT_ACS_YEAR}/acs/acs5?get=NAME,B01003_001E&for=place:*&in=state:${stateFips}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API error ${res.status} for state ${stateFips}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length < 2) return [];
  const rows = data.slice(1).map((row) => {
    const { bareName, type } = parsePlaceRow(row[0]);
    const pop = Number(row[1]);
    return {
      name: bareName,
      type,
      fips: stateFips,
      stateName: FIPS_TO_STATE_NAME[stateFips] || "",
      population: Number.isFinite(pop) && pop >= 0 ? pop : null,
      rank: TYPE_RANK[type] ?? 99,
    };
  });
  placesByStateCache.set(stateFips, { fetchedAt: Date.now(), rows });
  return rows;
}

function dedupeByStateName(matches) {
  // Within a single state, prefer larger place types when names collide.
  const byKey = new Map();
  for (const m of matches) {
    const key = `${m.fips}::${m.name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || m.rank < existing.rank) byKey.set(key, m);
  }
  return [...byKey.values()];
}

/**
 * Find place candidates matching a bare city name.
 * @param {string} cityName - bare name, e.g. "Springfield"
 * @param {string|null} stateName - optional state name or postal code; null = all states
 * @returns {Promise<Array<{name, type, stateName, population, fips}>>}
 */
export async function findPlaceCandidates(cityName, stateName = null) {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) throw new Error("Missing CENSUS_API_KEY.");

  const target = String(cityName || "").trim().toLowerCase();
  if (!target) return [];

  const stateFipsList = stateName
    ? [STATE_FIPS[String(stateName).trim().toLowerCase()]].filter(Boolean)
    : [...new Set(Object.values(STATE_FIPS))];

  // Fetch in parallel — server caches per state, so subsequent calls are free.
  const results = await Promise.allSettled(
    stateFipsList.map((fips) => fetchPlacesForState(fips, apiKey))
  );

  const matches = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const row of r.value) {
      if (row.name.toLowerCase() === target) matches.push(row);
    }
  }

  return dedupeByStateName(matches).sort((a, b) => {
    // Largest population first — most likely the place the user meant.
    const ap = a.population ?? -1;
    const bp = b.population ?? -1;
    return bp - ap;
  });
}

/**
 * Extract a candidate "place phrase" from a free-text query when no comma is present.
 * E.g. "median income in Springfield" → "Springfield"
 *      "rent in San Francisco" → "San Francisco"
 */
export function extractBarePlaceName(query) {
  const inIdx = String(query || "").toLowerCase().indexOf(" in ");
  if (inIdx === -1) return null;
  const tail = query.slice(inIdx + 4).trim();
  if (!tail) return null;
  if (tail.includes(",")) return null; // user already specified state
  return tail.replace(/[?.!]+$/, "").trim();
}
