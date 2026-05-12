// pages/api/places.js
// Returns the full list of Census places (cities/towns/CDPs) for a given state.
// Replaces the hardcoded STATES_CITIES subset so users can pick any place
// the Census Bureau actually publishes data for (e.g., Bozeman, MT).

import { STATE_FIPS } from "../../lib/censusTranslator";
import { CURRENT_ACS_YEAR } from "../../lib/censusConstants";

const PLACE_TYPE_SUFFIX = /\s+(city|town|village|cdp|borough|township|charter township|municipality|unified government|consolidated government|metro government|urban county|metropolitan government)$/i;

// Larger place types win when names collide within a state.
const TYPE_RANK = {
  city: 0, town: 1, village: 2, borough: 3, cdp: 4,
  township: 5, "charter township": 5,
  municipality: 6, "unified government": 7,
  "consolidated government": 7, "metro government": 7,
  "urban county": 8, "metropolitan government": 8,
};

// In-memory cache: state FIPS → { fetchedAt, places }
const placeCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function parsePlaceName(rawName) {
  const beforeComma = String(rawName || "").split(",")[0].trim();
  const match = beforeComma.match(PLACE_TYPE_SUFFIX);
  const type = match ? match[1].toLowerCase() : null;
  const bareName = beforeComma.replace(PLACE_TYPE_SUFFIX, "").trim();
  return { bareName, type, raw: beforeComma };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stateInput = String(req.query.state || "").trim().toLowerCase();
  if (!stateInput) {
    return res.status(400).json({ error: "Missing required query param: state." });
  }

  const stateFips = STATE_FIPS[stateInput];
  if (!stateFips) {
    return res.status(400).json({ error: `Unknown state: "${req.query.state}".` });
  }

  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server configuration error: missing Census API key." });
  }

  const cached = placeCache.get(stateFips);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json({ state: stateInput, places: cached.places, cached: true });
  }

  const url = `https://api.census.gov/data/${CURRENT_ACS_YEAR}/acs/acs5?get=NAME&for=place:*&in=state:${stateFips}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: `Census API error ${response.status}: ${text}` });
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length < 2) {
      return res.status(502).json({ error: "Invalid Census API response." });
    }

    // Dedupe by bare name, prefer the larger place type when names collide.
    const byBare = new Map();
    for (const row of data.slice(1)) {
      const { bareName, type, raw } = parsePlaceName(row[0]);
      if (!bareName) continue;
      const existing = byBare.get(bareName.toLowerCase());
      const rank = TYPE_RANK[type] ?? 99;
      if (!existing || rank < existing.rank) {
        byBare.set(bareName.toLowerCase(), { name: bareName, type, raw, rank });
      }
    }

    const places = [...byBare.values()]
      .map(({ name, type, raw }) => ({ name, type, raw }))
      .sort((a, b) => a.name.localeCompare(b.name));

    placeCache.set(stateFips, { fetchedAt: Date.now(), places });

    return res.status(200).json({ state: stateInput, places });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || "Failed to fetch places.") });
  }
}
