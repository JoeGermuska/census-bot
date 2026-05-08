// pages/api/trend.js
// Multi-year ACS trend fetcher. Accepts either:
//   { location: "California" | "Cook County, IL" | "zip 90210" | "Austin, Texas" }
//   { city, state }   (back-compat for the explore wizard)
//
// Variable identification — pick ONE:
//   • { metric: "median rent" }                  curated metrics from VARIABLE_MAP
//   • { variable_id, label, unit, table_id }     free-form — any ACS variable
//   • { share_of_variable_id }                   optional, divides the numerator
//                                                 by this denominator and returns
//                                                 percent (works with either form)
//
// Returns { points: [{year, numericValue, warning?}], locationLabel } so callers
// can render legends + source-trail rows with the canonical resolved geography
// without re-doing geo resolution client-side.

import { fetchCensusVariable } from "../../lib/censusApi";
import { parseQuery, VARIABLE_MAP, STATE_FIPS } from "../../lib/censusTranslator";
import {
  findGeoCandidates,
  findZctaByZip,
  geoParamsFromCandidate,
  candidateLabel,
} from "../../lib/geoCandidates";
import {
  computeRateIfNeeded,
  hasRateConfig,
} from "../../lib/censusRates";
import { validateValue, detectAnomalies } from "../../lib/validateCensusData";
import { validateVariableClaim } from "../../lib/acsVariableMetadata";
import { CURRENT_ACS_YEAR } from "../../lib/censusConstants";

const MIN_YEAR = 2009;
// ACS 1-year estimates (more granular, reliable for annual trends) only cover places with
// 65,000+ population. Below that threshold we restrict to 5 years to avoid sparse/zero data.
const LARGE_CITY_POPULATION = 65000;
const LARGE_CITY_MAX_YEARS = 10;
const SMALL_CITY_MAX_YEARS = 5;

// Geographies that are reliably published across many ACS 5-year vintages —
// safe to use the full 10-year window without checking population. Place /
// county subdivision geographies vary widely in size and need the population
// gate; cbsa/state/county/urban_area generally have stable published series.
const LARGE_BY_DEFAULT_GEO_TYPES = new Set(["state", "cbsa", "urban_area", "county"]);

const VARIABLE_ID_RE = /^[A-Z]\d+_\d+[A-Z]?$/;
const SHARE_FORMAT = "percent";

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

function toTitleCase(text) {
  return String(text || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// Resolve any of the accepted input shapes to a single geoParams payload.
// Returns { geoParams, locationLabel, population, geoType } on success,
// or { error } describing what went wrong.
async function resolveTrendGeo({ location, city, state }) {
  const cleanLocation = typeof location === "string" ? location.trim() : "";
  const cleanCity = typeof city === "string" ? city.trim() : "";
  const cleanState = typeof state === "string" ? state.trim() : "";

  // Back-compat: explore wizard sends {city, state}. If both are present and
  // we don't have a free-form `location`, treat them as a "City, State" phrase.
  let phrase;
  if (cleanLocation) {
    phrase = cleanLocation;
  } else if (cleanCity && cleanState) {
    phrase = `${cleanCity}, ${cleanState}`;
  } else if (cleanState) {
    phrase = cleanState;
  } else if (cleanCity) {
    phrase = cleanCity;
  } else {
    return { error: "Missing location: pass `location`, or `city` + `state`." };
  }

  // 1. State-only shortcut (e.g. "California", "Texas").
  const lowerPhrase = phrase.toLowerCase();
  if (STATE_FIPS[lowerPhrase]) {
    return {
      geoParams: { forGeo: `state:${STATE_FIPS[lowerPhrase]}` },
      locationLabel: toTitleCase(phrase),
      population: null,
      geoType: "state",
    };
  }

  // 2. ZCTA shortcut: "zip 90210" / "zcta 90210".
  const zipMatch = phrase.match(/\b(\d{5})\b/);
  if (zipMatch && /\b(zip|zcta)\b/i.test(phrase)) {
    const zcta = await findZctaByZip(zipMatch[1]).catch(() => null);
    if (zcta) {
      return {
        geoParams: geoParamsFromCandidate(zcta),
        locationLabel: candidateLabel(zcta),
        population: null,
        geoType: "zcta",
      };
    }
  }

  // 3. Candidate lookup for everything else: places, counties, CBSAs, urban
  // areas, county subdivisions, CDPs. Split on first comma so "Cook County, IL"
  // → name="Cook County", state="IL".
  let name = phrase;
  let stateHint = null;
  if (phrase.includes(",")) {
    const [n, s] = phrase.split(",").map((p) => p.trim());
    name = n;
    stateHint = s || null;
  }

  // County names are stored bare in findGeoCandidates ("Cook" not "Cook County"),
  // so retry with the suffix stripped if the literal name returned nothing.
  const COUNTY_LIKE_SUFFIX_RE = /\s+(county|parish|census area)$/i;
  const userTypedCountySuffix = COUNTY_LIKE_SUFFIX_RE.test(name);

  try {
    let candidates = await findGeoCandidates(name, { stateName: stateHint });
    if ((!candidates || candidates.length === 0) && userTypedCountySuffix) {
      const stripped = name.replace(COUNTY_LIKE_SUFFIX_RE, "").trim();
      candidates = await findGeoCandidates(stripped, { stateName: stateHint });
    }
    if (candidates && candidates.length > 0) {
      // Prefer the county candidate when the user explicitly typed "County".
      let picked = candidates[0];
      if (userTypedCountySuffix) {
        const county = candidates.find((c) => c.geoType === "county");
        if (county) picked = county;
      }
      const geoParams = geoParamsFromCandidate(picked);
      if (geoParams) {
        return {
          geoParams,
          locationLabel: candidateLabel(picked),
          population: typeof picked.population === "number" ? picked.population : null,
          geoType: picked.geoType || null,
        };
      }
    }
  } catch {
    // fall through to error
  }

  return { error: `Couldn't resolve "${phrase}" to an ACS geography.` };
}

// Resolve which Census variable to fetch. Two paths:
//   • Curated: caller passes `metric`. We look it up in VARIABLE_MAP and
//     also try parseQuery(`query`) as a fallback. Returns full {id, label, format}.
//   • Free-form: caller passes `variable_id` + `label` + `unit`. We validate
//     against the live ACS metadata so a wrong-label / wrong-table claim
//     gets caught before we burn N years of API calls.
async function resolveTrendVariable({ metric, query, variable_id, label, unit, table_id }) {
  const cleanVarId = typeof variable_id === "string" ? variable_id.trim() : "";

  if (cleanVarId) {
    if (!VARIABLE_ID_RE.test(cleanVarId)) {
      return { error: `Invalid variable_id "${cleanVarId}". Must look like "B03002_006E".` };
    }
    if (!label || !unit || !table_id) {
      return { error: "Free-form trend requires variable_id, label, unit, and table_id." };
    }
    // Validate against the live ACS metadata catalog. Same gate
    // lookup_census_variable uses — catches hallucinated picks before fetch.
    const validationError = await validateVariableClaim({
      variable_id: cleanVarId, label, table_id,
    });
    if (validationError) return { error: validationError };
    return { variable: { id: cleanVarId, label, format: unit } };
  }

  // Curated path: metric or query string.
  const fromMetric = resolveVariableFromMetric(metric);
  if (fromMetric) return { variable: fromMetric };

  if (typeof query === "string" && query.trim().length > 0) {
    const parsed = parseQuery(query);
    if (!parsed.error && parsed.variable) return { variable: parsed.variable };
  }

  return { error: "Missing or unsupported metric for trend query." };
}

// Pick the right year-window cap based on the resolved geography. State /
// CBSA / urban area / county geos are stable enough for the full 10-year
// window without a population probe; smaller place / subdivision geos need
// the probe so we don't return sparse / suppressed years.
async function pickEffectiveStartYear({ startYear, endYear, geoType, geoParams, population }) {
  if (LARGE_BY_DEFAULT_GEO_TYPES.has(geoType)) {
    return Math.max(startYear, endYear - LARGE_CITY_MAX_YEARS + 1);
  }
  let pop = population;
  if (pop == null) {
    try {
      pop = await fetchCensusVariable({
        year: Number(CURRENT_ACS_YEAR),
        variable: "B01003_001E",
        geoParams,
      });
    } catch {
      pop = null;
    }
  }
  const maxYears =
    typeof pop === "number" && pop >= LARGE_CITY_POPULATION
      ? LARGE_CITY_MAX_YEARS
      : SMALL_CITY_MAX_YEARS;
  return Math.max(startYear, endYear - maxYears + 1);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    city,
    state,
    location,
    startYear,
    endYear,
    metric,
    query,
    variable_id,
    label,
    unit,
    table_id,
    share_of_variable_id,
  } = req.body ?? {};

  if (!isValidYear(startYear) || !isValidYear(endYear)) {
    return res.status(400).json({ error: "startYear and endYear must be valid ACS years." });
  }
  if (startYear > endYear) {
    return res.status(400).json({ error: "startYear must be less than or equal to endYear." });
  }

  const geo = await resolveTrendGeo({ location, city, state });
  if (geo.error) {
    return res.status(400).json({ error: geo.error });
  }
  const { geoParams, locationLabel, population, geoType } = geo;

  const varResult = await resolveTrendVariable({
    metric, query, variable_id, label, unit, table_id,
  });
  if (varResult.error) {
    return res.status(400).json({ error: varResult.error });
  }
  const { variable } = varResult;

  // Validate share_of_variable_id shape if provided.
  const cleanShareOf = typeof share_of_variable_id === "string" ? share_of_variable_id.trim() : "";
  if (cleanShareOf && !VARIABLE_ID_RE.test(cleanShareOf)) {
    return res.status(400).json({ error: `Invalid share_of_variable_id "${cleanShareOf}".` });
  }

  const effectiveStartYear = await pickEffectiveStartYear({
    startYear, endYear, geoType, geoParams, population,
  });

  const apiKey = process.env.CENSUS_API_KEY;
  const points = [];

  for (let year = effectiveStartYear; year <= endYear; year += 1) {
    // Sequential by design — predictable Census API usage.
    let metricValue;
    try {
      metricValue = await fetchCensusVariable({ year, variable: variable.id, geoParams });
    } catch (err) {
      points.push({ year, numericValue: null, warning: err?.message || "No data available" });
      continue;
    }

    let numericValue = metricValue;
    let pointFormat = variable.format;

    // Three rate-derivation paths, in order:
    //   1. Curated rate config (poverty, unemployment, etc.) → computeRateIfNeeded.
    //   2. Free-form share_of_variable_id supplied by the caller → manual divide.
    //   3. Otherwise → raw value (no derivation).
    // We share the trend cache via `fetcher` so denominators don't refetch
    // each year. (10-year trend with a shared denominator = 10 cache hits.)
    const fetcher = (varId) =>
      fetchCensusVariable({ year, variable: varId, geoParams });

    if (hasRateConfig(variable.id)) {
      try {
        const rateResult = await computeRateIfNeeded(variable.id, metricValue, geoParams, apiKey, {
          year, dataset: "acs/acs5", fetcher,
        });
        if (rateResult) {
          numericValue = parseFloat(rateResult.value);
          pointFormat = rateResult.format;
        } else {
          points.push({ year, numericValue: null, warning: `Rate computation failed for ${year}` });
          continue;
        }
      } catch (err) {
        points.push({ year, numericValue: null, warning: `Denominator unavailable: ${err?.message}` });
        continue;
      }
    } else if (cleanShareOf) {
      let denominator;
      try {
        denominator = await fetcher(cleanShareOf);
      } catch (err) {
        points.push({ year, numericValue: null, warning: `Denominator unavailable: ${err?.message}` });
        continue;
      }
      if (!Number.isFinite(denominator) || denominator <= 0) {
        points.push({ year, numericValue: null, warning: `Invalid denominator for ${year}` });
        continue;
      }
      numericValue = (metricValue / denominator) * 100;
      pointFormat = SHARE_FORMAT;
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
      // pointFormat unused per-point today, but reserved for future
      // multi-format trends (e.g. mixing currency + percent series).
    });
  }

  if (points.length === 0 || points.every((p) => p.numericValue == null)) {
    return res.status(500).json({
      error: `No Census data found for "${locationLabel}" in the requested year range.`,
    });
  }

  // Body-level locationLabel echo (replaces the X-Resolved-Location header).
  // `unit` carries the format the caller should use for axis labels and
  // tooltips — falls back to variable.format when no override was provided.
  return res.status(200).json({
    points,
    locationLabel,
    unit: cleanShareOf ? SHARE_FORMAT : variable.format,
    variableId: variable.id,
    variableLabel: variable.label,
    tableId: typeof table_id === "string" && table_id.trim() ? table_id.trim() : null,
  });
}
