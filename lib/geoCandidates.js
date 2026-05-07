// lib/geoCandidates.js
// Server-side helper: find ACS geography candidates matching a free-text name.
// Searches across place, county, county subdivision, CBSA, and urban area —
// the geographies a user might type by name. Tract / block group / PUMA are
// id-based, not name-based, so they're not searched here.

import { STATE_FIPS } from "./censusTranslator";
import { CURRENT_ACS_YEAR } from "./censusConstants";

const PLACE_TYPE_SUFFIX = /\s+(city|town|village|cdp|borough|township|charter township|municipality|unified government|consolidated government|metro government|urban county|metropolitan government)$/i;
const COUNTY_SUFFIX = /\s+(county|parish|borough|census area|municipio|municipality)$/i;
const SUBDIVISION_SUFFIX = /\s+(township|town|borough|charter township|district|gore|grant|location|plantation|reservation|village)$/i;

const PLACE_TYPE_RANK = {
  city: 0, town: 1, village: 2, borough: 3, cdp: 4,
  township: 5, "charter township": 5,
  municipality: 6, "unified government": 7,
  "consolidated government": 7, "metro government": 7,
  "urban county": 8, "metropolitan government": 8,
};

const FIPS_TO_STATE_NAME = (() => {
  const map = {};
  for (const [name, fips] of Object.entries(STATE_FIPS)) {
    if (name.length > 2 && !map[fips]) {
      map[fips] = name.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return map;
})();

const ALL_STATE_FIPS = [...new Set(Object.entries(STATE_FIPS)
  .filter(([k]) => k.length > 2)
  .map(([, v]) => v))];

const BASE_URL = `https://api.census.gov/data/${CURRENT_ACS_YEAR}/acs/acs5`;
const POP_VAR = "B01003_001E";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const placeCache = new Map();   // FIPS → { fetchedAt, rows }
const countyCache = new Map();  // FIPS → { fetchedAt, rows }
const subdivCache = new Map();  // FIPS → { fetchedAt, rows }
let cbsaCache = null;           // { fetchedAt, rows }
let urbanCache = null;          // { fetchedAt, rows }

function isFresh(entry) {
  return entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API error ${res.status} for ${url}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length < 2) return [];
  return data;
}

// ── Per-geography fetchers ───────────────────────────────────────────────────

async function fetchPlacesForState(stateFips, apiKey) {
  if (isFresh(placeCache.get(stateFips))) return placeCache.get(stateFips).rows;
  const data = await fetchJson(`${BASE_URL}?get=NAME,${POP_VAR}&for=place:*&in=state:${stateFips}&key=${apiKey}`);
  const rows = data.slice(1).map((row) => {
    const beforeComma = String(row[0] || "").split(",")[0].trim();
    const m = beforeComma.match(PLACE_TYPE_SUFFIX);
    const placeType = m ? m[1].toLowerCase() : null;
    const bareName = beforeComma.replace(PLACE_TYPE_SUFFIX, "").trim();
    return {
      geoType: "place",
      placeKind: placeType === "cdp" ? "cdp" : "incorporated",
      placeType,
      name: bareName,
      stateName: FIPS_TO_STATE_NAME[stateFips] || "",
      stateFips,
      placeFips: row[row.length - 1],
      population: num(row[1]),
      rank: PLACE_TYPE_RANK[placeType] ?? 99,
    };
  });
  placeCache.set(stateFips, { fetchedAt: Date.now(), rows });
  return rows;
}

async function fetchCountiesForState(stateFips, apiKey) {
  if (isFresh(countyCache.get(stateFips))) return countyCache.get(stateFips).rows;
  const data = await fetchJson(`${BASE_URL}?get=NAME,${POP_VAR}&for=county:*&in=state:${stateFips}&key=${apiKey}`);
  const rows = data.slice(1).map((row) => {
    const beforeComma = String(row[0] || "").split(",")[0].trim();
    const bareName = beforeComma.replace(COUNTY_SUFFIX, "").trim();
    const suffixMatch = beforeComma.match(COUNTY_SUFFIX);
    const countyType = suffixMatch ? suffixMatch[1].toLowerCase() : "county";
    return {
      geoType: "county",
      countyType,
      name: bareName,
      stateName: FIPS_TO_STATE_NAME[stateFips] || "",
      stateFips,
      countyFips: row[row.length - 1],
      population: num(row[1]),
    };
  });
  countyCache.set(stateFips, { fetchedAt: Date.now(), rows });
  return rows;
}

async function fetchSubdivisionsForState(stateFips, apiKey) {
  if (isFresh(subdivCache.get(stateFips))) return subdivCache.get(stateFips).rows;
  // County subdivisions exist in 29 states. The endpoint returns empty/error in others.
  let data;
  try {
    data = await fetchJson(`${BASE_URL}?get=NAME,${POP_VAR}&for=county%20subdivision:*&in=state:${stateFips}&key=${apiKey}`);
  } catch {
    subdivCache.set(stateFips, { fetchedAt: Date.now(), rows: [] });
    return [];
  }
  const rows = data.slice(1).map((row) => {
    const beforeComma = String(row[0] || "").split(",")[0].trim();
    const m = beforeComma.match(SUBDIVISION_SUFFIX);
    const subdivType = m ? m[1].toLowerCase() : null;
    const bareName = beforeComma.replace(SUBDIVISION_SUFFIX, "").trim();
    // Skip placeholder "County subdivisions not defined" rows
    if (/not defined/i.test(bareName)) return null;
    return {
      geoType: "county_subdivision",
      subdivType,
      name: bareName,
      stateName: FIPS_TO_STATE_NAME[stateFips] || "",
      stateFips,
      population: num(row[1]),
    };
  }).filter(Boolean);
  subdivCache.set(stateFips, { fetchedAt: Date.now(), rows });
  return rows;
}

async function fetchAllCBSAs(apiKey) {
  if (isFresh(cbsaCache)) return cbsaCache.rows;
  const data = await fetchJson(`${BASE_URL}?get=NAME,${POP_VAR}&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*&key=${apiKey}`);
  const rows = data.slice(1).map((row) => {
    const full = String(row[0] || "").trim();
    const isMetro = /Metro Area$/i.test(full);
    const isMicro = /Micro Area$/i.test(full);
    const stripped = full.replace(/\s+(Metro|Micro)\s+Area$/i, "").trim();
    const lastComma = stripped.lastIndexOf(",");
    const principal = lastComma > 0 ? stripped.slice(0, lastComma).trim() : stripped;
    const stateAbbrs = lastComma > 0 ? stripped.slice(lastComma + 1).trim() : "";
    return {
      geoType: "cbsa",
      cbsaType: isMetro ? "metro" : isMicro ? "micro" : "cbsa",
      name: principal,
      principalCities: principal.split("-").map((s) => s.trim()),
      stateAbbrs,
      fullName: full,
      cbsaFips: row[row.length - 1],
      population: num(row[1]),
    };
  });
  cbsaCache = { fetchedAt: Date.now(), rows };
  return rows;
}

async function fetchAllUrbanAreas(apiKey) {
  if (isFresh(urbanCache)) return urbanCache.rows;
  const data = await fetchJson(`${BASE_URL}?get=NAME,${POP_VAR}&for=urban%20area:*&key=${apiKey}`);
  const rows = data.slice(1).map((row) => {
    const full = String(row[0] || "").trim();
    const stripped = full.replace(/\s+Urban\s+Area$/i, "").trim();
    const lastComma = stripped.lastIndexOf(",");
    const principal = lastComma > 0 ? stripped.slice(0, lastComma).trim() : stripped;
    const stateAbbrs = lastComma > 0 ? stripped.slice(lastComma + 1).trim() : "";
    return {
      geoType: "urban_area",
      name: principal,
      principalCities: principal.split(/--|—/).map((s) => s.trim()),
      stateAbbrs,
      fullName: full,
      uaFips: row[row.length - 1],
      population: num(row[1]),
    };
  });
  urbanCache = { fetchedAt: Date.now(), rows };
  return rows;
}

// ── Public: find candidates ──────────────────────────────────────────────────

function dedupePlacesPerState(places) {
  const byKey = new Map();
  for (const p of places) {
    const key = `${p.stateFips}::${p.name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || p.rank < existing.rank) byKey.set(key, p);
  }
  return [...byKey.values()];
}

/**
 * Find geography candidates matching a name. Searches in parallel across
 * place, county, county subdivision, CBSA, and urban area.
 *
 * @param {string} name - bare name like "Bozeman", "Gallatin", "Springfield"
 * @param {object} opts
 * @param {string} [opts.stateName] - restrict to one state (full name or postal abbr)
 * @returns {Promise<Array>} ranked candidate list
 */
export async function findGeoCandidates(name, { stateName = null } = {}) {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) throw new Error("Missing CENSUS_API_KEY.");

  const target = String(name || "").trim().toLowerCase();
  if (!target) return [];

  const stateFipsList = stateName
    ? [STATE_FIPS[String(stateName).trim().toLowerCase()]].filter(Boolean)
    : ALL_STATE_FIPS;

  // Per-state fetches: places, counties, subdivisions
  const perStatePromises = stateFipsList.flatMap((fips) => [
    fetchPlacesForState(fips, apiKey).catch(() => []),
    fetchCountiesForState(fips, apiKey).catch(() => []),
    fetchSubdivisionsForState(fips, apiKey).catch(() => []),
  ]);
  // Nationwide fetches: CBSAs, urban areas
  const nationwidePromises = [
    fetchAllCBSAs(apiKey).catch(() => []),
    fetchAllUrbanAreas(apiKey).catch(() => []),
  ];

  const [perStateResults, nationwideResults] = await Promise.all([
    Promise.all(perStatePromises),
    Promise.all(nationwidePromises),
  ]);

  const places = [];
  const counties = [];
  const subdivisions = [];
  for (let i = 0; i < perStateResults.length; i += 3) {
    places.push(...perStateResults[i]);
    counties.push(...perStateResults[i + 1]);
    subdivisions.push(...perStateResults[i + 2]);
  }
  const [cbsas, urbanAreas] = nationwideResults;

  const matches = [];

  // Place matches: exact name match
  for (const p of places) {
    if (p.name.toLowerCase() === target) matches.push(p);
  }

  // County matches: exact match on bare name (without "County" suffix)
  for (const c of counties) {
    if (c.name.toLowerCase() === target) matches.push(c);
  }

  // County subdivision matches
  for (const s of subdivisions) {
    if (s.name.toLowerCase() === target) matches.push(s);
  }

  // CBSA matches: principal city contains the target
  const stateFipsToAbbr = Object.fromEntries(
    Object.entries(STATE_FIPS).filter(([k]) => k.length === 2).map(([k, v]) => [v, k.toUpperCase()])
  );
  const stateRestrictAbbrs = stateFipsList.map((f) => stateFipsToAbbr[f]).filter(Boolean);

  for (const cb of cbsas) {
    const matchesPrincipal = cb.principalCities.some((c) => c.toLowerCase() === target);
    if (!matchesPrincipal) continue;
    if (stateRestrictAbbrs.length > 0) {
      const cbsaStates = cb.stateAbbrs.split("-").map((s) => s.toUpperCase());
      if (!cbsaStates.some((s) => stateRestrictAbbrs.includes(s))) continue;
    }
    matches.push(cb);
  }

  // Urban area matches: principal contains the target
  for (const ua of urbanAreas) {
    const matchesPrincipal = ua.principalCities.some((c) => c.toLowerCase() === target);
    if (!matchesPrincipal) continue;
    if (stateRestrictAbbrs.length > 0) {
      const uaStates = ua.stateAbbrs.split(/--|-/).map((s) => s.toUpperCase());
      if (!uaStates.some((s) => stateRestrictAbbrs.includes(s))) continue;
    }
    matches.push(ua);
  }

  // Dedupe places per (state, name) — prefer larger place type
  const dedupedPlaces = dedupePlacesPerState(matches.filter((m) => m.geoType === "place"));
  const others = matches.filter((m) => m.geoType !== "place");
  const merged = [...dedupedPlaces, ...others];

  // Sort: largest population first within type, type order place > county > cbsa > urban_area > subdivision
  const TYPE_ORDER = { place: 0, county: 1, cbsa: 2, urban_area: 3, county_subdivision: 4 };
  merged.sort((a, b) => {
    const ta = TYPE_ORDER[a.geoType] ?? 99;
    const tb = TYPE_ORDER[b.geoType] ?? 99;
    if (ta !== tb) return ta - tb;
    return (b.population ?? -1) - (a.population ?? -1);
  });

  return merged;
}

/**
 * Resolve a 5-digit ZIP code to a ZCTA candidate (population, name).
 * ZCTAs are nationwide; we hit the ZCTA endpoint directly.
 */
export async function findZctaByZip(zip) {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) throw new Error("Missing CENSUS_API_KEY.");
  const cleaned = String(zip || "").trim();
  if (!/^\d{5}$/.test(cleaned)) return null;
  try {
    const data = await fetchJson(`${BASE_URL}?get=NAME,${POP_VAR}&for=zip%20code%20tabulation%20area:${cleaned}&key=${apiKey}`);
    if (data.length < 2) return null;
    const row = data[1];
    return {
      geoType: "zcta",
      name: cleaned,
      fullName: String(row[0] || ""),
      population: num(row[1]),
    };
  } catch {
    return null;
  }
}

/**
 * Extract a candidate "place phrase" from a free-text query.
 * "median income in Bozeman" → { name: "Bozeman", state: null }
 * "median income in Springfield, IL" → { name: "Springfield", state: "IL" }
 */
export function extractGeoPhrase(query) {
  const lower = String(query || "").toLowerCase();
  const inIdx = lower.indexOf(" in ");
  if (inIdx === -1) return null;
  const tail = String(query).slice(inIdx + 4).trim().replace(/[?.!]+$/, "");
  if (!tail) return null;
  if (tail.includes(",")) {
    const [name, state] = tail.split(",").map((s) => s.trim());
    return { name, state };
  }
  return { name: tail, state: null };
}

/**
 * Build Census API geo params (forGeo / inGeo) from a picked candidate.
 * Returned shape is compatible with fetchCensusValue() in lib/censusApi.js.
 */
export function geoParamsFromCandidate(c) {
  if (!c || typeof c !== "object") return null;
  switch (c.geoType) {
    case "place":
      if (!c.placeFips || !c.stateFips) return null;
      return {
        forGeo: `place:${c.placeFips}`,
        inGeo: `state:${c.stateFips}`,
      };
    case "county":
      if (!c.countyFips || !c.stateFips) return null;
      return {
        forGeo: `county:${c.countyFips}`,
        inGeo: `state:${c.stateFips}`,
      };
    case "cbsa":
      if (!c.cbsaFips) return null;
      return {
        forGeo: `metropolitan statistical area/micropolitan statistical area:${c.cbsaFips}`,
      };
    case "urban_area":
      if (!c.uaFips) return null;
      return { forGeo: `urban area:${c.uaFips}` };
    case "zcta":
      if (!c.name) return null;
      return { forGeo: `zip code tabulation area:${c.name}` };
    case "state":
      if (!c.stateFips) return null;
      return { forGeo: `state:${c.stateFips}` };
    default:
      return null;
  }
}

/**
 * Human-readable label for a picked candidate (used in the answer sentence).
 */
export function candidateLabel(c) {
  switch (c.geoType) {
    case "place":
      return `${c.name}, ${c.stateName}`;
    case "county":
      return `${c.name} ${c.countyType === "county" ? "County" : c.countyType.replace(/\b\w/g, (x) => x.toUpperCase())}, ${c.stateName}`;
    case "county_subdivision":
      return `${c.name}${c.subdivType ? ` ${c.subdivType}` : ""}, ${c.stateName}`;
    case "cbsa":
      return c.fullName;
    case "urban_area":
      return c.fullName;
    case "zcta":
      return `ZIP ${c.name}`;
    default:
      return c.name || "Unknown";
  }
}

/**
 * Human-readable label + sublabel for a candidate, for use in UI chips.
 */
export function describeCandidate(c) {
  const fmtPop = (p) =>
    p == null ? "" : p >= 1_000_000 ? `${(p / 1_000_000).toFixed(1)}M` : p >= 1_000 ? `${(p / 1_000).toFixed(0)}K` : `${p}`;
  switch (c.geoType) {
    case "place":
      return {
        label: `${c.name}, ${c.stateName}`,
        sublabel: `${c.placeKind === "cdp" ? "CDP (unincorporated)" : "City"} · pop ${fmtPop(c.population)}`,
        icon: "",
      };
    case "county":
      return {
        label: `${c.name} ${c.countyType === "county" ? "County" : c.countyType.replace(/\b\w/g, (x) => x.toUpperCase())}, ${c.stateName}`,
        sublabel: `County · pop ${fmtPop(c.population)}`,
        icon: "",
      };
    case "county_subdivision":
      return {
        label: `${c.name}${c.subdivType ? ` ${c.subdivType}` : ""}, ${c.stateName}`,
        sublabel: `Township / county subdivision · pop ${fmtPop(c.population)}`,
        icon: "",
      };
    case "cbsa":
      return {
        label: c.fullName,
        sublabel: `${c.cbsaType === "metro" ? "Metropolitan" : "Micropolitan"} Statistical Area · pop ${fmtPop(c.population)}`,
        icon: "",
      };
    case "urban_area":
      return {
        label: c.fullName,
        sublabel: `Urban Area · pop ${fmtPop(c.population)}`,
        icon: "",
      };
    case "zcta":
      return {
        label: `ZIP ${c.name}`,
        sublabel: `ZIP Code Tabulation Area · pop ${fmtPop(c.population)}`,
        icon: "",
      };
    default:
      return { label: c.name || "Unknown", sublabel: "", icon: "" };
  }
}
