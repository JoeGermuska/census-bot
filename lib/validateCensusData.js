// lib/validateCensusData.js
// Pure validation and anomaly detection — no external dependencies, no LLM.

// Census sentinels: placeholder values returned in place of real estimates
// when data isn't available, can't be computed, or is intentionally withheld.
// Each carries a distinct meaning — surface the right one so callers can
// explain to users *why* a number is missing.
const SENTINEL_REASONS = {
  "-666666666": "Estimate not available or not applicable for this geography",
  "-555555555": "Estimate suppressed for disclosure protection",
  "-333333333": "Median is at or above the top of the top-coded range",
  "-222222222": "Median couldn't be computed (too few sample cases)",
  "-888888888": "Estimate is not applicable",
  "-999999999": "Estimate could not be computed",
};

export function sentinelReason(value) {
  return SENTINEL_REASONS[String(Number(value))] || null;
}

// Validation runs on the RAW Census value, before any rate or scale transform.
// Variables that get rate-computed downstream (poverty, unemployment, bachelor's,
// aggregate travel time, etc.) are intentionally absent — those raw counts can
// legitimately reach the millions for state-sized geographies, and the post-
// division rate is bounded by the formula.
const VARIABLE_RANGES = {
  "B01003_001E": { min: 1, max: 400_000_000, name: "Population" },
  "B19013_001E": { min: 1, max: 400_000,     name: "Median household income" },
  "B19301_001E": { min: 1, max: 400_000,     name: "Per capita income" },
  "B19113_001E": { min: 1, max: 500_000,     name: "Median family income" },
  "B25064_001E": { min: 1, max: 10_000,      name: "Median rent" },
  "B25077_001E": { min: 1, max: 5_000_000,   name: "Median home value" },
  "B25001_001E": { min: 1, max: 200_000_000, name: "Total housing units" },
  "B01002_001E": { min: 0, max: 120,         name: "Median age" },
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

  const sentinel = sentinelReason(num);
  if (sentinel) {
    return { ok: false, reason: sentinel, sentinel: true };
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
