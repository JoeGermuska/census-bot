// lib/sourcing.js
// Single chokepoint for "how does this stat get sourced and explained?"
// Used by both deterministic stat lookups (chat.js fast path, free-form
// variable tool) and trend-chart fetches. Each producer attaches a
// _sourceEntry shaped object; attachNuancesAndMethodology enriches it
// with table-catalog grounding, MOE methodology, and a RAG-fetched
// methodology passage.

import { formatValue, parseQuery } from "./censusTranslator";
import { getRateDenominator, getRateMethodology } from "./censusRates";
import { getTableById } from "./acsTablesRag";
import { searchAcsDocs } from "./acsRag";
import { buildNuanceBanners, buildMethodologyQuery } from "./acsNuances";

// Minimum BM25 score for a RAG passage to be considered "good enough" to
// surface as the variable's methodology citation. Below this, we skip rather
// than include a weak match that would confuse the user.
export const RAG_METHODOLOGY_MIN_SCORE = 1.0;
export const RAG_METHODOLOGY_MAX_CHARS = 600;

// Format a numeric MOE for display alongside an estimate. Percent rates have
// MOEs in *percentage points*, not percent — using "pp" avoids conflating the
// rate's scale with the MOE's scale.
export function formatMOE(numericMOE, format) {
  if (numericMOE == null) return null;
  const n = Math.abs(Number(numericMOE));
  if (!Number.isFinite(n)) return null;
  switch (format) {
    case "currency": return `±${formatValue(n, "currency")}`;
    case "number":   return `±${formatValue(n, "number")}`;
    case "percent":  return `±${parseFloat(n.toFixed(2))} pp`;
    case "years":    return `±${parseFloat(n.toFixed(2))} years`;
    case "minutes":  return `±${parseFloat(n.toFixed(2))} minutes`;
    default:         return `±${parseFloat(n.toFixed(2))}`;
  }
}

// "B19013_001E" → "B19013"
export function tableIdOf(variableId) {
  return String(variableId || "").split("_")[0];
}

// Build the source-link payload for a given primary variable. Includes the
// denominator's table when it differs from the numerator's (e.g. mean commute,
// where B08136 / B08303 come from two different tables).
export function buildSourceTables(variableId) {
  const tables = new Set([tableIdOf(variableId)]);
  const denom = getRateDenominator(variableId);
  if (denom) tables.add(tableIdOf(denom));
  return Array.from(tables).map((tableId) => ({
    tableId,
    url: `https://censusreporter.org/tables/${tableId}/`,
  }));
}

// Friendly label for the dataset used: "ACS 2024 1-Year Estimates" or
// "ACS 2020–2024 5-Year Estimates".
export function buildSourceLabel(dataset, year) {
  const yr = Number(year);
  if (dataset === "acs1") return `ACS ${yr} 1-Year Estimates`;
  return `ACS ${yr - 4}–${yr} 5-Year Estimates`;
}

// Only authoritative references are eligible to ground a variable's methodology
// citation: the Subject Definitions, the Design & Methodology Report, the
// general-audience handbook, and the geography handbook. Audience-specific
// handbooks (journalists, congress, federal, etc.) are excluded because their
// phrasing often outscores the real references on BM25 keyword overlap without
// being the right source to cite.
export function isAuthoritativeMethodologyDoc(doc) {
  if (!doc) return false;
  if (doc.kind === "definitions" || doc.kind === "methodology") return true;
  if (doc.id === "handbook-general" || doc.id === "handbook-geography") return true;
  return false;
}

// Strip page-number / running-header noise that PDF text extractors prepend
// or append to a page's text. Conservative: only removes a 1-4 digit number
// that stands ALONE at the very start or end of the chunk (followed/preceded
// by whitespace). Real prose almost never starts with "92 households…".
export function stripPageNoise(text) {
  return String(text || "")
    .replace(/^\s*\d{1,4}\s+/, "")
    .replace(/\s+\d{1,4}\s*$/, "")
    .trim();
}

// Truncate at a sentence boundary near the budget so the snippet doesn't
// end mid-thought.
export function truncateAtSentence(text, maxChars) {
  const s = String(text || "");
  if (s.length <= maxChars) return s;
  const window = s.slice(0, maxChars);
  const lastDot = window.lastIndexOf(". ");
  if (lastDot > maxChars * 0.6) return window.slice(0, lastDot + 1);
  return window.replace(/\s+\S*$/, "") + "…";
}

// Build the MOE methodology citation: how the MOE attached to this stat was
// computed and where the rule comes from. Direct API MOEs cite the companion
// variable; derived rate MOEs cite the proportion or ratio formula.
export function buildMOEMethodology(variableId) {
  if (!variableId) return null;
  const rateMethod = getRateMethodology(variableId);
  if (rateMethod) {
    return {
      kind: rateMethod.kind, // "proportion" | "ratio"
      formula: rateMethod.formula,
      description:
        `Derived from numerator (${variableId}) and denominator ` +
        `(${rateMethod.denominator}) MOEs using the ACS ${rateMethod.kind} formula.`,
      sourceLabel: "ACS Statistical Testing guidance — MOE for derived statistics",
    };
  }
  const moeId = String(variableId).replace(/E$/, "M");
  return {
    kind: "direct",
    formula: null,
    description:
      `Margin of error reported directly by the Census Bureau on companion ` +
      `variable ${moeId} (90% confidence interval).`,
    sourceLabel: "U.S. Census Bureau — ACS published MOE",
  };
}

// Build the tableInfo block from the local catalog (acs-data/tables-index.json).
// Returns null if the catalog is missing or doesn't contain this table id.
export async function buildTableInfo(variableId, year) {
  const tableId = String(variableId || "").split("_")[0];
  if (!tableId) return null;
  const t = await getTableById(tableId);
  if (!t) return null;
  return {
    tableId: t.tableId,
    kind: t.kind,
    kindLabel: t.kindLabel,
    concept: t.concept,
    universe: t.universe,
    releases: t.releases,
    endpoints: t.endpoints,
    variableCount: t.variableCount,
    chunkId: `acs-tables-${t.kind}-${year || 2024}__${t.tableId}`,
    catalogSource: `Verified against local ACS ${year || 2024} table catalog`,
  };
}

// Augment a structured stat payload with deterministic nuance banners,
// (best-effort) a RAG-fetched methodology passage, the MOE methodology
// citation, and table-info lifted from the local table catalog. Mutates
// and returns `structured` for convenience. Never throws — RAG/catalog
// misses degrade silently.
export async function attachNuancesAndMethodology(structured, variableId) {
  if (!structured) return structured;
  // Make sure the raw variableId is present so banner rules can read it.
  if (variableId && !structured.variableId) structured.variableId = variableId;

  structured.nuances = buildNuanceBanners(structured);

  // Cheap, pure-code MOE methodology block — only attach when we actually
  // have an MOE to explain.
  if (structured.moe != null && variableId) {
    structured.moeMethodology = buildMOEMethodology(variableId);
  }

  // Run the handbook RAG search and the local table-catalog lookup in
  // parallel — they're independent and the table lookup is fast.
  // Methodology search is restricted to authoritative references (Subject
  // Definitions / Design & Methodology / general+geography handbooks) so
  // audience-specific handbooks (journalists, congress, etc.) can't outscore
  // them on BM25 keyword overlap and end up cited as the methodology source.
  const [methodologyResult, tableInfoResult] = await Promise.allSettled([
    (async () => {
      const query = buildMethodologyQuery(variableId, structured.variable);
      return searchAcsDocs(query, { topK: 1, docFilter: isAuthoritativeMethodologyDoc });
    })(),
    buildTableInfo(variableId, structured.year),
  ]);

  if (methodologyResult.status === "fulfilled") {
    const top = methodologyResult.value?.results?.[0];
    if (top && top.score >= RAG_METHODOLOGY_MIN_SCORE) {
      structured.methodology = {
        text: truncateAtSentence(stripPageNoise(top.text), RAG_METHODOLOGY_MAX_CHARS),
        doc_title: top.doc_title,
        doc_url: top.doc_url,
        page: top.page,
        chunk_id: top.chunk_id,
      };
    }
  }

  if (tableInfoResult.status === "fulfilled" && tableInfoResult.value) {
    structured.tableInfo = tableInfoResult.value;
  }

  return structured;
}

// Build a _sourceEntry for a successful trend-chart fetch. Aggregates a
// multi-year series into a single source row keyed by (variable, place):
// the SourceTrail UI doesn't need one row per year — it shows the variable,
// place, year range, and the latest value. attachNuancesAndMethodology can
// then enrich it with table-catalog and methodology data the same way it
// does for single-stat fetches.
//
// Variable can come from two paths:
//   • Explicit: pass `variableId` + `variableLabel` + `unit` (free-form trends —
//     caller already knows the variable).
//   • Inferred: pass `metric` and we resolve via parseQuery (curated trends).
// Returns null if neither path yields a variable.
export function buildTrendSourceEntry({
  location, metric, points,
  variableId: variableIdOverride = null,
  variableLabel: variableLabelOverride = null,
  unit: unitOverride = null,
  tableId: tableIdOverride = null,
}) {
  const placeLabel = location || "Series";
  const validPoints = (points || []).filter((p) => p && p.numericValue != null);
  if (validPoints.length === 0) return null;

  const years = validPoints.map((p) => Number(p.year)).filter(Number.isFinite);
  if (years.length === 0) return null;
  const startYear = Math.min(...years);
  const endYear = Math.max(...years);
  const lastValue = validPoints[validPoints.length - 1].numericValue;

  // Prefer the explicit variable identity (free-form trends carry it
  // directly from the trend tool). Fall back to parseQuery on the metric
  // label for curated trends where only the metric name is known.
  let variable = null;
  if (variableIdOverride && variableLabelOverride) {
    variable = {
      id: variableIdOverride,
      label: variableLabelOverride,
      format: unitOverride || "number",
    };
  } else if (metric) {
    try {
      const parsed = parseQuery(`${metric} in ${placeLabel}`);
      if (!parsed.error && parsed.variable) variable = parsed.variable;
    } catch {
      // fall through — caller will get null
    }
  }
  if (!variable) return null;

  // Build the table list. If the caller supplied a tableId override (free-form
  // trends), prefer it; otherwise derive from the variable id and any rate
  // denominator companion table.
  const tables = tableIdOverride
    ? [{ tableId: tableIdOverride, url: `https://censusreporter.org/tables/${tableIdOverride}/` }]
    : buildSourceTables(variable.id);

  return {
    kind: "stat",
    variableId: variable.id,
    variable: variable.label,
    place: placeLabel,
    year: endYear,
    years: [startYear, endYear],
    dataset: "acs5",
    value: lastValue,
    moe: null,
    moeFormatted: null,
    unit: variable.format,
    source: `U.S. Census Bureau ACS 5-Year Estimates (${startYear}–${endYear})`,
    tables,
  };
}
