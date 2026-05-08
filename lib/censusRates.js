// lib/censusRates.js
// Centralizes rate/derived-value computation for variables that are raw counts.
import { fetchCensusValue, fetchCensusValueWithMOE } from "./censusApi";

// Maps a variable ID to its denominator, scale, output format, and MOE kind.
// scale=100 → percentage; scale=1 → raw division (e.g. mean minutes).
// kind="proportion": numerator is a subset of denominator (e.g. unemployed ⊂
//   labor force) — use the ACS proportion MOE formula.
// kind="ratio": numerator is NOT a subset of denominator (e.g. aggregate
//   commute minutes ÷ workers) — use the ratio MOE formula.
const RATE_CONFIG = {
  "B17001_002E": { denominator: "B17001_001E", scale: 100, format: "percent", kind: "proportion" }, // poverty rate
  "B23025_005E": { denominator: "B23025_003E", scale: 100, format: "percent", kind: "proportion" }, // unemployment rate
  "B08136_001E": { denominator: "B08303_001E", scale: 1,   format: "minutes", kind: "ratio"      }, // mean commute: aggregate minutes ÷ workers
  "B15003_022E": { denominator: "B15003_001E", scale: 100, format: "percent", kind: "proportion" }, // bachelor's attainment rate
  "B15003_017E": { denominator: "B15003_001E", scale: 100, format: "percent", kind: "proportion" }, // high school graduation rate
  "B15003_025E": { denominator: "B15003_001E", scale: 100, format: "percent", kind: "proportion" }, // graduate or professional degree rate
  "B23025_004E": { denominator: "B23025_003E", scale: 100, format: "percent", kind: "proportion" }, // employment rate
  "B23025_002E": { denominator: "B23025_001E", scale: 100, format: "percent", kind: "proportion" }, // labor force participation rate

  // Education — additional levels
  "B15003_021E": { denominator: "B15003_001E", scale: 100, format: "percent", kind: "proportion" }, // associate's degree rate
  "B15003_023E": { denominator: "B15003_001E", scale: 100, format: "percent", kind: "proportion" }, // master's degree rate
  "B15003_024E": { denominator: "B15003_001E", scale: 100, format: "percent", kind: "proportion" }, // professional school degree rate

  // Housing
  "B25002_003E": { denominator: "B25002_001E", scale: 100, format: "percent", kind: "proportion" }, // vacancy rate
  "B25003_002E": { denominator: "B25003_001E", scale: 100, format: "percent", kind: "proportion" }, // homeownership rate
  "B25003_003E": { denominator: "B25003_001E", scale: 100, format: "percent", kind: "proportion" }, // renter-occupied rate

  // Means of transportation to work — all rates against B08301_001E (total workers)
  "B08301_003E": { denominator: "B08301_001E", scale: 100, format: "percent", kind: "proportion" }, // drove alone
  "B08301_004E": { denominator: "B08301_001E", scale: 100, format: "percent", kind: "proportion" }, // carpool
  "B08301_010E": { denominator: "B08301_001E", scale: 100, format: "percent", kind: "proportion" }, // public transit
  "B08301_018E": { denominator: "B08301_001E", scale: 100, format: "percent", kind: "proportion" }, // bicycle
  "B08301_019E": { denominator: "B08301_001E", scale: 100, format: "percent", kind: "proportion" }, // walked
  "B08301_021E": { denominator: "B08301_001E", scale: 100, format: "percent", kind: "proportion" }, // worked from home
};

// MOE for a derived rate Y/X, scaled by `scale`.
// Formulas come from the ACS Statistical Testing guidance:
//   proportion:  MOE_P = (1/X) * sqrt(MOE_Y² − P² · MOE_X²)
//                (if the radicand is negative — rare, noisy small areas —
//                 fall back to the ratio formula so we don't return NaN)
//   ratio:       MOE_R = (1/X) * sqrt(MOE_Y² + R² · MOE_X²)
// All inputs are raw counts/MOEs on the same scale; output is on the rate's
// scale (e.g. percentage points when scale=100).
export function computeRateMOE({ numerator, numeratorMOE, denominator, denominatorMOE, scale, kind }) {
  const X = Number(denominator);
  const Y = Number(numerator);
  const mY = Number(numeratorMOE);
  const mX = Number(denominatorMOE);
  if (!Number.isFinite(X) || X <= 0) return null;
  if (!Number.isFinite(Y) || !Number.isFinite(mY) || !Number.isFinite(mX)) return null;
  if (mY < 0 || mX < 0) return null;

  const ratio = Y / X;
  let moe;
  if (kind === "proportion") {
    const inside = mY * mY - ratio * ratio * mX * mX;
    moe = inside >= 0
      ? (1 / X) * Math.sqrt(inside)
      : (1 / X) * Math.sqrt(mY * mY + ratio * ratio * mX * mX);
  } else {
    moe = (1 / X) * Math.sqrt(mY * mY + ratio * ratio * mX * mX);
  }
  return moe * scale;
}

/**
 * If variableId has a rate config, fetches the denominator and returns
 * { value: string, format, moe? }. Returns null if no config exists or the
 * denominator fetch fails (caller falls back to raw value).
 *
 * The 5th argument may be either a year string (legacy callers) or an
 * options object `{ year, dataset, numeratorMOE }`. Pass `numeratorMOE`
 * (the raw MOE that came back with the numerator) to also get back a
 * computed MOE for the derived rate. The denominator must come from the
 * same dataset as the numerator so the rate is internally consistent.
 */
export async function computeRateIfNeeded(variableId, rawCount, geoParams, apiKey, opts) {
  const config = RATE_CONFIG[variableId];
  if (!config) return null;

  const { year, dataset = "acs/acs5", numeratorMOE = null } =
    typeof opts === "string" ? { year: opts } : (opts || {});

  const wantMOE = numeratorMOE != null && config.kind != null;

  try {
    let denominator, denominatorMOE = null;
    if (wantMOE) {
      const r = await fetchCensusValueWithMOE(config.denominator, geoParams, apiKey, year, dataset);
      denominator = parseFloat(r.value);
      denominatorMOE = r.moe == null ? null : parseFloat(r.moe);
    } else {
      const denominatorRaw = await fetchCensusValue(config.denominator, geoParams, apiKey, year, dataset);
      denominator = parseFloat(denominatorRaw);
    }

    if (!Number.isFinite(denominator) || denominator <= 0) return null;

    const numerator = parseFloat(rawCount);
    const rate = (numerator / denominator) * config.scale;

    let moe = null;
    if (wantMOE && denominatorMOE != null) {
      const computed = computeRateMOE({
        numerator,
        numeratorMOE: parseFloat(numeratorMOE),
        denominator,
        denominatorMOE,
        scale: config.scale,
        kind: config.kind,
      });
      if (computed != null && Number.isFinite(computed)) moe = computed.toFixed(4);
    }

    // Store with enough precision that the display layer can render up to
    // 3 decimal places without losing significant digits.
    return { value: rate.toFixed(4), format: config.format, moe };
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
