// lib/validateCensusData.js
// Pure validation and anomaly detection — no external dependencies, no LLM.

const CENSUS_SENTINELS = new Set([
  -666666666, -999999999, -888888888, -555555555, -333333333, -222222222,
]);

const VARIABLE_RANGES = {
  "B01003_001E": { min: 1,         max: 400_000_000, name: "Population" },
  "B19013_001E": { min: 1,         max: 300_000,     name: "Median income" },
  "B19301_001E": { min: 1,         max: 300_000,     name: "Per capita income" },
  "B17001_002E": { min: 0,         max: 100,         name: "Poverty rate" },
  "B23025_005E": { min: 0,         max: 100,         name: "Unemployment rate" },
  "B08136_001E": { min: 0,         max: 100,         name: "Commute time" },
  "B15003_022E": { min: 0,         max: 100,         name: "Bachelor degree rate" },
  "B23025_004E": { min: 0,         max: 100,         name: "Employment rate" },
  "B25064_001E": { min: 1,         max: 10_000,      name: "Median rent" },
  "B25077_001E": { min: 1,         max: 5_000_000,   name: "Median home value" },
  "B01002_001E": { min: 0,         max: 120,         name: "Median age" },
};

/**
 * Validates a raw Census API value for a given variable.
 * @param {string} variableId - Census variable ID (e.g. "B01003_001E")
 * @param {*} value - Raw value from Census API
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateValue(variableId, value) {
  if (value == null) {
    return { ok: false, reason: "Value is null or undefined" };
  }

  const num = Number(value);

  if (!Number.isFinite(num)) {
    return { ok: false, reason: `Non-finite value: ${value}` };
  }

  if (CENSUS_SENTINELS.has(num)) {
    return { ok: false, reason: "Census sentinel value (data suppressed or not available)" };
  }

  const range = VARIABLE_RANGES[variableId];
  if (range) {
    if (num < range.min || num > range.max) {
      return { ok: false, reason: `${range.name} value ${num} is outside expected range [${range.min}, ${range.max}]` };
    }
  } else if (num < 0) {
    return { ok: false, reason: `Unexpected negative value: ${num}` };
  }

  return { ok: true };
}

/**
 * Detects anomalously large changes between two consecutive values.
 * Does NOT block — only annotates.
 * @param {number} currentValue
 * @param {number|null} previousValue
 * @returns {{ anomaly: boolean, message?: string }}
 */
export function detectAnomalies(currentValue, previousValue) {
  if (previousValue == null || previousValue === 0) {
    return { anomaly: false };
  }

  const pctChange = Math.abs(currentValue - previousValue) / Math.abs(previousValue);

  if (pctChange > 0.5) {
    return {
      anomaly: true,
      message: "Unusually large change compared to previous period",
    };
  }

  return { anomaly: false };
}
