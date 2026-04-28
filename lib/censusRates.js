// lib/censusRates.js
// Centralizes rate computation for variables that are raw counts but should be displayed as %.
import { fetchCensusValue } from "./censusApi";

// Maps a count variable ID to its correct denominator variable and scaling factor.
const RATE_CONFIG = {
  "B17001_002E": { denominator: "B17001_001E", scale: 100 }, // poverty rate: below poverty / poverty universe
  "B23025_005E": { denominator: "B23025_003E", scale: 100 }, // unemployment rate: unemployed / civilian labor force
};

/**
 * If variableId has a rate config, fetches the denominator and returns
 * { value: string, format: "percent" }. Returns null if no config exists
 * or if the denominator fetch fails (caller falls back to raw value).
 */
export async function computeRateIfNeeded(variableId, rawCount, geoParams, apiKey, year) {
  const config = RATE_CONFIG[variableId];
  if (!config) return null;

  try {
    const denominatorRaw = await fetchCensusValue(config.denominator, geoParams, apiKey, year);
    const denominator = parseFloat(denominatorRaw);

    if (!Number.isFinite(denominator) || denominator <= 0) return null;

    const rate = (parseFloat(rawCount) / denominator) * config.scale;
    return { value: rate.toFixed(2), format: "percent" };
  } catch {
    return null;
  }
}
