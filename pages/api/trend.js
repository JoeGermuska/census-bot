// pages/api/trend.js
import { fetchCensusVariable } from "../../lib/censusApi";
import { parseQuery, VARIABLE_MAP } from "../../lib/censusTranslator";
import { hasRateConfig, getRateDenominator, getRateScale } from "../../lib/censusRates";
import { validateValue, detectAnomalies } from "../../lib/validateCensusData";
import { CURRENT_ACS_YEAR } from "../../lib/censusConstants";

const MIN_YEAR = 2009;
// ACS 1-year estimates (more granular, reliable for annual trends) only cover places with
// 65,000+ population. Below that threshold we restrict to 5 years to avoid sparse/zero data.
const LARGE_CITY_POPULATION = 65000;
const LARGE_CITY_MAX_YEARS = 10;
const SMALL_CITY_MAX_YEARS = 5;

function isValidYear(value) {
  return Number.isInteger(value) && value >= MIN_YEAR;
}

function normalizeMetric(metric) {
  return String(metric || "").trim().toLowerCase();
}

function resolveVariableFromMetric(metric) {
  const normalized = normalizeMetric(metric);
  if (!normalized) return null;

  const byKeyword = Object.entries(VARIABLE_MAP).find(([keyword]) => keyword === normalized);
  if (byKeyword) return byKeyword[1];

  const byLabel = Object.values(VARIABLE_MAP).find((variable) => variable.label.toLowerCase() === normalized);
  if (byLabel) return byLabel;

  const byKeywordInMetric = Object.entries(VARIABLE_MAP).find(([keyword]) => normalized.includes(keyword));
  if (byKeywordInMetric) return byKeywordInMetric[1];

  return null;
}

function shouldComputeRate(variableId) {
  return hasRateConfig(variableId);
}

function getDenominatorVariable(variableId) {
  return getRateDenominator(variableId);
}

function getScale(variableId) {
  return getRateScale(variableId) ?? 100;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { city, state, startYear, endYear, metric, query } = req.body ?? {};

  if (!city || typeof city !== "string" || city.trim().length === 0) {
    return res.status(400).json({ error: "Missing required field: city." });
  }

  if (!state || typeof state !== "string" || state.trim().length === 0) {
    return res.status(400).json({ error: "Missing required field: state." });
  }

  if (!isValidYear(startYear) || !isValidYear(endYear)) {
    return res.status(400).json({ error: "startYear and endYear must be valid ACS years." });
  }

  if (startYear > endYear) {
    return res.status(400).json({ error: "startYear must be less than or equal to endYear." });
  }

  let variable = resolveVariableFromMetric(metric);

  if (!variable && typeof query === "string" && query.trim().length > 0) {
    const parsed = parseQuery(query);
    if (!parsed.error) {
      variable = parsed.variable;
    }
  }

  if (!variable) {
    return res.status(400).json({ error: "Missing or unsupported metric for trend query." });
  }

  // Determine city population to enforce appropriate year-range limits.
  // ACS 5-year data for small cities (<65K) is sparse before recent years — cap accordingly.
  let effectiveStartYear = startYear;
  try {
    const population = await fetchCensusVariable({
      year: Number(CURRENT_ACS_YEAR),
      variable: "B01003_001E",
      city,
      state,
    });
    const maxYears = population >= LARGE_CITY_POPULATION ? LARGE_CITY_MAX_YEARS : SMALL_CITY_MAX_YEARS;
    effectiveStartYear = Math.max(startYear, endYear - maxYears + 1);
  } catch {
    // If population lookup fails, fall back to a conservative 5-year window.
    effectiveStartYear = Math.max(startYear, endYear - SMALL_CITY_MAX_YEARS + 1);
  }

  const points = [];

  for (let year = effectiveStartYear; year <= endYear; year += 1) {
    // Sequential requests by design for predictable API usage.
    let metricValue;
    try {
      metricValue = await fetchCensusVariable({
        year,
        variable: variable.id,
        city,
        state,
      });
    } catch (err) {
      // Skip years where data is unavailable rather than aborting the whole request.
      points.push({ year, numericValue: null, warning: err?.message || "No data available" });
      continue;
    }

    let numericValue = metricValue;

    if (shouldComputeRate(variable.id)) {
      const denominatorId = getDenominatorVariable(variable.id);
      let denominator;
      try {
        denominator = await fetchCensusVariable({
          year,
          variable: denominatorId,
          city,
          state,
        });
      } catch (err) {
        points.push({ year, numericValue: null, warning: `Denominator unavailable: ${err?.message}` });
        continue;
      }

      if (!Number.isFinite(denominator) || denominator <= 0) {
        points.push({ year, numericValue: null, warning: `Invalid denominator for ${year}` });
        continue;
      }

      numericValue = (metricValue / denominator) * getScale(variable.id);
    }

    const finalValue = Number(numericValue.toFixed(2));
    const validation = validateValue(variable.id, finalValue);
    if (!validation.ok) {
      points.push({ year, numericValue: null, warning: validation.reason });
      continue;
    }

    const prevNumericValue = points.length > 0 ? points[points.length - 1].numericValue : null;
    const anomaly = detectAnomalies(finalValue, prevNumericValue);
    points.push({
      year,
      numericValue: finalValue,
      ...(anomaly.anomaly ? { warning: anomaly.message } : {}),
    });
  }

  if (points.length === 0 || points.every(p => p.numericValue == null)) {
    return res.status(500).json({
      error: `No Census data found for "${city}, ${state}" in the requested year range.`,
    });
  }

  return res.status(200).json(points);
}