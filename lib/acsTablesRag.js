// lib/acsTablesRag.js — local lookup over the ACS table catalog.
//
// Loads acs-data/tables-index.json once per cold start. The catalog is built
// by `npm run fetch:acs-tables && npm run index:tables` from the eight
// official Census variables.json/groups.json endpoints (4 kinds × 2 releases).
//
// Used as a *grounding source*: when the bot reports a stat, we verify the
// underlying table exists in the catalog and surface its concept + universe
// + release availability so the UI can render a "More information" panel.
// This is the same pattern as lib/acsRag.js (handbook RAG) but optimized
// for exact-id lookup instead of BM25 search.

import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const INDEX_PATH = resolve(process.cwd(), "acs-data/tables-index.json");

let _indexPromise = null;

async function _loadIndex() {
  try {
    await access(INDEX_PATH);
  } catch {
    throw new Error(
      `Tables index not found at ${INDEX_PATH}. Run: npm run fetch:acs-tables && npm run index:tables`
    );
  }
  const raw = await readFile(INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw);

  // Build a tableId → chunk[] map. Same id can appear in multiple kinds
  // (rare — table-id prefixes usually map to one kind), so keep an array.
  const byTableId = new Map();
  for (const c of parsed.chunks) {
    const t = c.table;
    if (!t?.tableId) continue;
    const key = String(t.tableId).toUpperCase();
    const list = byTableId.get(key) || [];
    list.push(c);
    byTableId.set(key, list);
  }

  return {
    meta: parsed.meta,
    docs: parsed.docs,
    chunks: parsed.chunks,
    byTableId,
  };
}

export function getTablesIndex() {
  if (!_indexPromise) _indexPromise = _loadIndex();
  return _indexPromise;
}

/**
 * Exact lookup by table id. Returns the structured `table` field or null.
 * If the same id exists in multiple kinds, prefers `preferKind` when given,
 * otherwise returns the first chunk (typically Detailed Tables).
 *
 * @param {string} tableId  e.g. "B25064"
 * @param {string} [preferKind]  e.g. "detailed", "subject", "profile", "cprofile"
 * @returns {Promise<object|null>}
 */
export async function getTableById(tableId, preferKind = null) {
  if (!tableId) return null;
  try {
    const idx = await getTablesIndex();
    const list = idx.byTableId.get(String(tableId).toUpperCase());
    if (!list || list.length === 0) return null;
    const chunk = preferKind
      ? (list.find((c) => c.table?.kind === preferKind) || list[0])
      : list[0];
    return chunk.table || null;
  } catch {
    return null; // catalog missing → degrade silently, caller falls back
  }
}

/**
 * Cheap "does this id exist in our catalog?" check. Use to avoid grounding
 * a response on a table id Claude hallucinated.
 */
export async function tableExists(tableId) {
  const t = await getTableById(tableId);
  return t != null;
}

// ── Per-year variable existence + label catalog ──────────────────────────────
//
// acs-data/per-year-variables.json is built by:
//   npm run fetch:per-year-vars && npm run index:per-year-vars
// Shape: { builtAt, years: { "2014": { "B01001_001E": "leaf_label", ... }, ... } }
//
// Two consumer paths:
//   variableExistsInYear(id, year)
//     — lib/censusApi.js's fetchCensusVariable uses this to short-circuit
//       requests for variables not published in a vintage.
//
//   findEquivalentVariableInYear(tableId, currentVariableId, currentYear, targetYear)
//     — lib/sourcing.js / pages/api/trend.js use this to map a redesigned
//       variable's ID across vintages by leaf-label match. Required because
//       Census table redesigns shuffle IDs (B02015_019E was "Sri Lankan"
//       2015–2021 but "Vietnamese" 2022–2024; B02015_022E was "Vietnamese"
//       2015–2021 but "Bangladeshi" 2022–2024). Plotting one ID across
//       vintages without remapping conflates different concepts.
//
// Lazy-loaded; if the catalog isn't built, callers get safe fallbacks.

const PER_YEAR_VAR_PATH = resolve(process.cwd(), "acs-data/per-year-variables.json");

// {[year]: Map<variableId, leafLabel>}. Built once on first access.
let _perYearVarsPromise = null;

async function _loadPerYearVars() {
  try {
    await access(PER_YEAR_VAR_PATH);
  } catch {
    return null; // catalog not built — caller falls back to no-op
  }
  try {
    const raw = await readFile(PER_YEAR_VAR_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const byYear = new Map();
    for (const [year, entries] of Object.entries(parsed.years || {})) {
      const map = new Map();
      for (const [id, leaf] of Object.entries(entries)) {
        map.set(String(id), String(leaf || ""));
      }
      byYear.set(String(year), map);
    }
    return byYear;
  } catch {
    return null; // corrupt catalog — same fallback
  }
}

export function getPerYearVarsIndex() {
  if (!_perYearVarsPromise) _perYearVarsPromise = _loadPerYearVars();
  return _perYearVarsPromise;
}

/**
 * Returns true if `variableId` is published in the ACS5 detailed tables for
 * `year`. Returns true defensively (assume valid) when the catalog isn't
 * built or the year isn't in the catalog — callers should treat this as a
 * pre-flight optimization, not an authoritative source of truth.
 *
 * @param {string} variableId  e.g. "B02015_019E"
 * @param {number|string} year e.g. 2014
 * @returns {Promise<boolean>}
 */
export async function variableExistsInYear(variableId, year) {
  if (!variableId) return false;
  const byYear = await getPerYearVarsIndex();
  if (!byYear) return true; // no catalog → defer to live API
  const yearMap = byYear.get(String(year));
  if (!yearMap) return true; // year not indexed → defer to live API
  return yearMap.has(String(variableId));
}

/**
 * Look up the leaf label of a variable in a specific vintage. Returns null
 * when the catalog isn't built or the variable isn't in that year.
 */
export async function getVariableLeafLabel(variableId, year) {
  if (!variableId) return null;
  const byYear = await getPerYearVarsIndex();
  if (!byYear) return null;
  const yearMap = byYear.get(String(year));
  if (!yearMap) return null;
  return yearMap.get(String(variableId)) || null;
}

/**
 * Find the variable_id in `targetYear` whose leaf label matches the leaf
 * label of `currentVariableId` in `currentYear`. Used when a documented
 * redesign has shuffled IDs across vintages — lets us plot a consistent
 * concept (e.g. "Vietnamese") even though the underlying ID changes.
 *
 * Example: findEquivalentVariableInYear("B02015", "B02015_019E", 2024, 2018)
 *          → "B02015_022E"  (because 2024's "Vietnamese" was at _019E,
 *          and 2018's "Vietnamese" was at _022E)
 *
 * Returns null when:
 *   • the per-year catalog isn't built,
 *   • either year isn't indexed,
 *   • currentVariableId isn't in currentYear's catalog,
 *   • no variable in tableId in targetYear has the matching leaf label.
 *
 * @param {string} tableId            e.g. "B02015"
 * @param {string} currentVariableId  the variable id whose label we're matching
 * @param {number|string} currentYear vintage of currentVariableId's label
 * @param {number|string} targetYear  vintage to find the equivalent id in
 * @returns {Promise<string|null>}
 */
export async function findEquivalentVariableInYear(tableId, currentVariableId, currentYear, targetYear) {
  if (!tableId || !currentVariableId) return null;
  const byYear = await getPerYearVarsIndex();
  if (!byYear) return null;

  const currentMap = byYear.get(String(currentYear));
  const targetMap = byYear.get(String(targetYear));
  if (!currentMap || !targetMap) return null;

  const currentLeaf = currentMap.get(String(currentVariableId));
  if (!currentLeaf) return null;

  // If the same id is present in the target year AND has the same leaf,
  // no remap needed — short-circuit.
  if (targetMap.get(String(currentVariableId)) === currentLeaf) {
    return String(currentVariableId);
  }

  // Otherwise scan tableId's variables in targetMap for a leaf match.
  // Estimates only (E suffix); skip MOE companions (M suffix).
  const tablePrefix = `${String(tableId).toUpperCase()}_`;
  for (const [id, leaf] of targetMap) {
    if (!id.startsWith(tablePrefix)) continue;
    if (!id.endsWith("E")) continue;
    if (leaf === currentLeaf) return id;
  }
  return null;
}
