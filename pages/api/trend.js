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
import { findRedesignInRange, getTableChanges } from "../../lib/acsTableChanges";
import { findEquivalentVariableInYear, getVariableLeafLabel } from "../../lib/acsTablesRag";
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

  // Defensive snap: callers (especially Claude, whose training cutoff may be
  // earlier than the latest published ACS vintage) often pass an endYear from
  // their own knowledge rather than the actual current vintage. Clamp UP so
  // charts always extend to the latest 5-year release.
  const currentAcsYear = Number(CURRENT_ACS_YEAR);
  const clampedEndYear = Number.isFinite(currentAcsYear) && endYear < currentAcsYear
    ? currentAcsYear
    : endYear;

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
    startYear, endYear: clampedEndYear, geoType, geoParams, population,
  });

  const apiKey = process.env.CENSUS_API_KEY;
  const points = [];

  // Per-year variable-id remap: when the cited table is documented as
  // redesigned (lib/acsTableChanges.js), the user-supplied variable_id may
  // map to a DIFFERENT concept in earlier vintages (e.g. B02015_019E was
  // "Sri Lankan" in 2015–2021 and "Vietnamese" in 2022–2024). Plotting one
  // ID across vintages without remapping conflates concepts.
  //
  // Strategy: take the leaf label of the user's variable_id in the latest
  // (current) vintage as the source of truth for "what concept did the
  // user intend?". Then for each fetched year, look up the variable in the
  // SAME table whose leaf label matches in THAT year's catalog. If no
  // match, the concept didn't exist in that vintage — surface a per-year
  // warning so the chart shows a gap rather than a misleading number.
  const tableChanges = getTableChanges(variable.id);
  const needsRemap = !!(tableChanges && tableChanges.length > 0);
  const remappedIdsByYear = new Map(); // year → resolved variable_id (or null)
  const remapTrace = []; // [{year, fromId, toId}] for the response payload

  for (let year = effectiveStartYear; year <= clampedEndYear; year += 1) {
    // Resolve the right variable_id for this year. For unredesigned tables
    // this is identity; for redesigned tables it may differ.
    let yearVariableId = variable.id;
    let remapNote = null;
    if (needsRemap) {
      const equiv = await findEquivalentVariableInYear(
        variable.id.split("_")[0], variable.id, CURRENT_ACS_YEAR, year
      );
      if (equiv) {
        yearVariableId = equiv;
        remappedIdsByYear.set(year, equiv);
        if (equiv !== variable.id) {
          remapTrace.push({ year, fromId: variable.id, toId: equiv });
        }
      } else {
        remappedIdsByYear.set(year, null);
        remapNote = `"${variable.label}" not present in ${year} vintage of this table.`;
      }
    }

    if (remapNote) {
      points.push({ year, numericValue: null, warning: remapNote });
      continue;
    }

    // Sequential by design — predictable Census API usage.
    let metricValue;
    try {
      metricValue = await fetchCensusVariable({ year, variable: yearVariableId, geoParams });
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

  // Series-level concept-shift detection. Two layers, in priority order:
  //   1. Documented redesign in lib/acsTableChanges.js — produces a SPECIFIC
  //      warning citing the Census Bureau's published redesign year. When
  //      per-year ID remapping succeeded, the warning is INFORMATIONAL
  //      ("we remapped IDs across vintages so the chart shows the right
  //      concept"); when it failed, the warning is more cautionary.
  //   2. Heuristic 50× ratio detector — catches undocumented or unknown
  //      redesigns. Generic "values jumped" message. Only fires for
  //      undocumented tables since documented ones are remapped above.
  const CONCEPT_SHIFT_RATIO = 50;
  const seriesWarning = await (async () => {
    const valid = points.filter((p) => p.numericValue != null && Number.isFinite(p.numericValue));
    if (valid.length < 2) return null;
    const seriesStartYear = valid[0].year;
    const seriesEndYear = valid[valid.length - 1].year;

    // Layer 1: documented redesign. Cite the Census source AND surface the
    // specific leaf labels so users see exactly what changed.
    const remapsHappened = remapTrace.length > 0;
    const documented = findRedesignInRange(variable.id, seriesStartYear, seriesEndYear);
    if (documented) {
      const tableId = String(variable.id).split("_")[0];

      // Pull the leaf labels of the user's variable_id from the latest
      // vintage (post-redesign meaning) and a pre-redesign vintage (what
      // the same id used to mean). These are the smoking-gun details the
      // user actually wants — "B02015_019E was 'Sri Lankan', is now
      // 'Vietnamese'."
      const postLabel = await getVariableLeafLabel(variable.id, CURRENT_ACS_YEAR);
      const preLabel = await getVariableLeafLabel(variable.id, documented.year - 1);

      // The remap pointed pre-redesign years at one or more equivalent
      // IDs. In practice it's almost always a single ID, but we'll list
      // them all if there's a mix. (Set ordering follows insertion order
      // — first-seen first, which is fine for display.)
      const equivalentIds = Array.from(new Set(remapTrace.map((r) => r.toId)));
      const equivalentSummary =
        equivalentIds.length === 1
          ? `${equivalentIds[0]}`
          : equivalentIds.join(", ");

      let severity, headline, message;

      if (remapsHappened) {
        severity = "info";
        headline = `${tableId} was redesigned in ${documented.year} — IDs adapted automatically`;
        const idMeaningClause =
          preLabel && postLabel && preLabel !== postLabel
            ? `${variable.id} was “${preLabel}” before ${documented.year} and means “${postLabel}” from ${documented.year} onward. `
            : "";
        const remapClause =
          equivalentIds.length > 0
            ? `For pre-${documented.year} years, this chart fetched ${equivalentSummary} ` +
              `(the “${postLabel || variable.label}” position in those vintages) ` +
              `so the series tracks the concept consistently.`
            : `This chart adapted the variable_id per year so the series tracks ` +
              `the concept consistently.`;
        message =
          `Census reorganized ${tableId} in ${documented.year} — sub-categories ` +
          `were expanded and reordered, which shifted variable_ids. ` +
          idMeaningClause + remapClause;
      } else {
        severity = "warning";
        headline = `${tableId} was redesigned in ${documented.year}`;
        const idMeaningClause =
          preLabel && postLabel && preLabel !== postLabel
            ? ` In pre-${documented.year} vintages, ${variable.id} referred to “${preLabel}”, not “${postLabel}”.`
            : "";
        message =
          `Census redesigned this table in ${documented.year}.` +
          idMeaningClause +
          ` No equivalent variable_id for "${variable.label}" was found in ` +
          `earlier vintages, so those years appear as gaps.`;
      }

      return {
        kind: "documented_redesign",
        severity,
        headline,
        message,
        year: documented.year,
        tableId,
        currentLabel: postLabel,
        previousLabel: preLabel,
        equivalentIds,
        tableSummary: documented.summary,
        tableSource: documented.source,
        remapped: remapsHappened,
        remapTrace: remapsHappened ? remapTrace : undefined,
      };
    }

    // Layer 2: heuristic detector for undocumented changes.
    for (let i = 1; i < valid.length; i += 1) {
      const a = Math.abs(valid[i - 1].numericValue);
      const b = Math.abs(valid[i].numericValue);
      if (a < 1 || b < 1) continue;
      const ratio = a > b ? a / b : b / a;
      if (ratio >= CONCEPT_SHIFT_RATIO) {
        return {
          kind: "concept_shift",
          severity: "warning",
          headline: `Possible variable redefinition between ${valid[i - 1].year} and ${valid[i].year}`,
          message:
            `Values jumped ~${ratio.toFixed(0)}× between ${valid[i - 1].year} ` +
            `(${valid[i - 1].numericValue.toLocaleString()}) and ${valid[i].year} ` +
            `(${valid[i].numericValue.toLocaleString()}). The Census may have ` +
            `changed this variable's universe or definition across vintages. ` +
            `Compare years on either side cautiously.`,
          year: valid[i].year,
          prevYear: valid[i - 1].year,
          ratio: Number(ratio.toFixed(1)),
        };
      }
    }
    return null;
  })();

  // Body-level locationLabel echo (replaces the X-Resolved-Location header).
  // `unit` carries the format the caller should use for axis labels and
  // tooltips — falls back to variable.format when no override was provided.
  return res.status(200).json({
    points,
    ...(seriesWarning ? { seriesWarning } : {}),
    locationLabel,
    unit: cleanShareOf ? SHARE_FORMAT : variable.format,
    variableId: variable.id,
    variableLabel: variable.label,
    tableId: typeof table_id === "string" && table_id.trim() ? table_id.trim() : null,
  });
}
