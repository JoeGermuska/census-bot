// lib/censusRates.js
// Centralizes rate/derived-value computation for variables that are raw counts.
import { fetchCensusValue } from "./censusApi";

// Maps a variable ID to its denominator, scale, and output format.
// scale=100 → percentage; scale=1 → raw division (e.g. mean minutes)
const RATE_CONFIG = {
  "B17001_002E": { denominator: "B17001_001E", scale: 100, format: "percent"  }, // poverty rate
  "B23025_005E": { denominator: "B23025_003E", scale: 100, format: "percent"  }, // unemployment rate
  "B08136_001E": { denominator: "B08303_001E", scale: 1,   format: "minutes"  }, // mean commute: aggregate minutes ÷ workers
  "B15003_022E": { denominator: "B15003_001E", scale: 100, format: "percent"  }, // bachelor's attainment rate
  "B15003_017E": { denominator: "B15003_001E", scale: 100, format: "percent"  }, // high school graduation rate
  "B15003_025E": { denominator: "B15003_001E", scale: 100, format: "percent"  }, // graduate or professional degree rate
  "B23025_004E": { denominator: "B23025_003E", scale: 100, format: "percent"  }, // employment rate
  "B23025_002E": { denominator: "B23025_001E", scale: 100, format: "percent"  }, // labor force participation rate
};

/**
 * If variableId has a rate config, fetches the denominator and returns
 * { value: string, format }. Returns null if no config exists or the
 * denominator fetch fails (caller falls back to raw value).
 */
export async function computeRateIfNeeded(variableId, rawCount, geoParams, apiKey, year) {
  const config = RATE_CONFIG[variableId];
  if (!config) return null;

  try {
    const denominatorRaw = await fetchCensusValue(config.denominator, geoParams, apiKey, year);
    const denominator = parseFloat(denominatorRaw);

    if (!Number.isFinite(denominator) || denominator <= 0) return null;

    const rate = (parseFloat(rawCount) / denominator) * config.scale;
    const decimals = config.format === "minutes" ? 1 : 2;
    return { value: rate.toFixed(decimals), format: config.format };
  } catch {
    return null;
  }
}

/** Expose scale factor so the trend route can reuse the same config. */
export function getRateScale(variableId) {
  return RATE_CONFIG[variableId]?.scale ?? null;
}

export function getRateDenominator(variableId) {
  return RATE_CONFIG[variableId]?.denominator ?? null;
}

export function hasRateConfig(variableId) {
  return variableId in RATE_CONFIG;
}
