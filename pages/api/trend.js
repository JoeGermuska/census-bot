// pages/api/trend.js
import { fetchCensusVariable } from "../../lib/censusApi";
import { parseQuery, VARIABLE_MAP } from "../../lib/censusTranslator";

const POVERTY_VARIABLE = "B17001_002E";
const POPULATION_VARIABLE = "B01003_001E";
const MIN_YEAR = 2009;

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

function shouldComputePovertyRate(metric, variableId) {
  return normalizeMetric(metric).includes("poverty rate") || variableId === POVERTY_VARIABLE;
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

  const points = [];

  try {
    for (let year = startYear; year <= endYear; year += 1) {
      // Sequential requests by design for predictable API usage.
      const metricValue = await fetchCensusVariable({
        year,
        variable: variable.id,
        city,
        state,
      });

      let numericValue = metricValue;

      // For poverty-rate requests, convert poverty count to a true percentage.
      if (shouldComputePovertyRate(metric, variable.id)) {
        const population = await fetchCensusVariable({
          year,
          variable: POPULATION_VARIABLE,
          city,
          state,
        });

        if (!Number.isFinite(population) || population <= 0) {
          throw new Error(`Invalid population value returned for ${city}, ${state} in ${year}.`);
        }

        numericValue = (metricValue / population) * 100;
      }

      points.push({ year, numericValue: Number(numericValue.toFixed(2)) });
    }

    return res.status(200).json(points);
  } catch (err) {
    console.error("Trend fetch error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to fetch Census trend data.",
    });
  }
}