// GET /api/search-places?q=Chi&limit=15
// Searches all U.S. Census places by name across all 50 states.
// Builds a global in-memory index on first call (lazy, cached 24h).

import { CURRENT_ACS_YEAR, STATE_NAMES } from "../../lib/censusConstants";

const PLACE_TYPE_SUFFIX = /\s+(city|town|village|cdp|borough|township|charter township|municipality|unified government|consolidated government|metro government|urban county|metropolitan government)$/i;

const STATE_TO_FIPS = {
  "Alabama":"01","Alaska":"02","Arizona":"04","Arkansas":"05","California":"06",
  "Colorado":"08","Connecticut":"09","Delaware":"10","Florida":"12","Georgia":"13",
  "Hawaii":"15","Idaho":"16","Illinois":"17","Indiana":"18","Iowa":"19","Kansas":"20",
  "Kentucky":"21","Louisiana":"22","Maine":"23","Maryland":"24","Massachusetts":"25",
  "Michigan":"26","Minnesota":"27","Mississippi":"28","Missouri":"29","Montana":"30",
  "Nebraska":"31","Nevada":"32","New Hampshire":"33","New Jersey":"34","New Mexico":"35",
  "New York":"36","North Carolina":"37","North Dakota":"38","Ohio":"39","Oklahoma":"40",
  "Oregon":"41","Pennsylvania":"42","Rhode Island":"44","South Carolina":"45",
  "South Dakota":"46","Tennessee":"47","Texas":"48","Utah":"49","Vermont":"50",
  "Virginia":"51","Washington":"53","West Virginia":"54","Wisconsin":"55","Wyoming":"56",
};

let globalIndex = null;  // Array<{ name, state, display }>
let indexBuiltAt = null;
let buildPromise = null;
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

function parseName(rawName) {
  const beforeComma = String(rawName || "").split(",")[0].trim();
  return beforeComma.replace(PLACE_TYPE_SUFFIX, "").trim();
}

async function fetchState(stateName, fips, apiKey) {
  try {
    const url = `https://api.census.gov/data/${CURRENT_ACS_YEAR}/acs/acs5?get=NAME&for=place:*&in=state:${fips}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) return [];
    const seen = new Set();
    const out = [];
    for (const row of data.slice(1)) {
      const name = parseName(row[0]);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, state: stateName, display: `${name}, ${stateName}` });
    }
    return out;
  } catch {
    return [];
  }
}

async function buildIndex(apiKey) {
  const entries = STATE_NAMES.map(s => ({ state: s, fips: STATE_TO_FIPS[s] })).filter(e => e.fips);
  const BATCH = 8;
  const all = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(({ state, fips }) => fetchState(state, fips, apiKey)));
    for (const places of results) all.push(...places);
  }
  all.sort((a, b) => a.display.localeCompare(b.display));
  return all;
}

function getIndex(apiKey) {
  if (globalIndex && indexBuiltAt && Date.now() - indexBuiltAt < INDEX_TTL_MS) {
    return Promise.resolve(globalIndex);
  }
  if (buildPromise) return buildPromise;
  buildPromise = buildIndex(apiKey)
    .then(idx => { globalIndex = idx; indexBuiltAt = Date.now(); buildPromise = null; return idx; })
    .catch(err => { buildPromise = null; throw err; });
  return buildPromise;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(200).json({ results: [] });

  const limit = Math.min(parseInt(req.query.limit || "15", 10), 50);
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing Census API key." });

  // If index is still building, kick it off and tell the client to retry
  if (!globalIndex && buildPromise) {
    return res.status(200).json({ results: [], indexing: true });
  }

  try {
    const index = await getIndex(apiKey);
    const ql = q.toLowerCase();

    // Collect up to limit*3 candidates then sort: starts-with before contains
    const starts = [];
    const contains = [];
    for (const p of index) {
      const nl = p.name.toLowerCase();
      const dl = p.display.toLowerCase();
      if (nl.startsWith(ql)) starts.push(p);
      else if (dl.includes(ql)) contains.push(p);
      if (starts.length + contains.length >= limit * 3) break;
    }
    const results = [...starts, ...contains].slice(0, limit);
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || "Search failed.") });
  }
}
