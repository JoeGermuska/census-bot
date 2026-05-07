// pages/api/place-geoid.js
// Returns the 7-digit Census GEOID for a city + state by querying the ACS API.
import { STATE_FIPS } from "../../lib/censusTranslator";

const PLACE_TYPE_SUFFIX = /\s+(city|town|village|cdp|borough|township|charter township|municipality|unified government|consolidated government|metro government|urban county|metropolitan government)$/i;

function extractBareName(censusName) {
  const beforeComma = String(censusName || "").split(",")[0].trim().toLowerCase();
  return beforeComma.replace(PLACE_TYPE_SUFFIX, "").trim();
}

function matchesCityName(censusName, cityQuery) {
  const lower = String(censusName || "").toLowerCase();
  const bareName = extractBareName(lower);
  if (bareName === cityQuery) return true;
  const placePart = lower.split(",")[0].trim();
  return (
    placePart === `${cityQuery} city` ||
    placePart === `${cityQuery} town` ||
    placePart === `${cityQuery} village` ||
    placePart === `${cityQuery} borough` ||
    placePart === `${cityQuery} cdp`
  );
}

// In-memory cache — survives across requests in the same server process
const cache = new Map();

export default async function handler(req, res) {
  const { city, state } = req.query;
  if (!city || !state) {
    return res.status(400).json({ error: "city and state are required" });
  }

  const cityNorm  = city.trim().toLowerCase();
  const stateNorm = state.trim().toLowerCase();
  const cacheKey  = `${cityNorm}|${stateNorm}`;

  if (cache.has(cacheKey)) {
    return res.json(cache.get(cacheKey));
  }

  const stateFips = STATE_FIPS[stateNorm];
  if (!stateFips) {
    return res.status(400).json({ error: `Unknown state: ${state}` });
  }

  const apiKey = process.env.CENSUS_API_KEY;
  const url = `https://api.census.gov/data/2022/acs/acs5?get=NAME&for=place:*&in=state:${stateFips}${apiKey ? `&key=${apiKey}` : ""}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Census API ${response.status}`);
    const data = await response.json();

    if (!Array.isArray(data) || data.length < 2) {
      return res.status(404).json({ error: "No place data returned" });
    }

    const header   = data[0]; // ["NAME", "state", "place"]
    const stateIdx = header.indexOf("state");
    const placeIdx = header.indexOf("place");

    const match = data.slice(1).find(row => matchesCityName(row[0], cityNorm));
    if (!match) {
      return res.status(404).json({ error: `No place found for "${city}, ${state}"` });
    }

    const geoid    = `${match[stateIdx]}${match[placeIdx]}`; // e.g. "1714000"
    const citySlug = match[0].split(",")[0].trim().replace(/\s+/g, "_"); // "Chicago_city"
    const result   = { geoid, citySlug };
    cache.set(cacheKey, result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
