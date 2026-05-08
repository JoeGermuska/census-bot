// lib/acsVariableMetadata.js — server-side validator for free-form Census
// variable lookups. Catches hallucinations from Claude's `lookup_census_variable`
// calls before they hit the API and produce silently-wrong numbers.
//
// Load is lazy (first call triggers a one-time read). Source files live at
// docs/raw/tables/<year>/<release>__detailed__variables.json — the file the
// existing fetch:acs-tables script produces.

import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_YEAR = "2024";

// year → Map<variable_id, { id, label, concept, group, leaf, pathTokens }>
const _byYear = new Map();
// year → in-flight promise (so concurrent first calls don't double-load)
const _inFlight = new Map();

// Path to the detailed-tables variables.json the fetch script downloads.
function variablesPath(year) {
  return resolve(
    process.cwd(),
    "docs/raw/tables",
    String(year),
    "acs5__detailed__variables.json"
  );
}

// Path to the detailed-tables groups.json — holds the human-readable
// "universe" string per table (e.g. "Population for whom poverty status is
// determined"). Not present on every variable; lives at table level.
function groupsPath(year) {
  return resolve(
    process.cwd(),
    "docs/raw/tables",
    String(year),
    "acs5__detailed__groups.json"
  );
}

// "Estimate!!Total:!!Not Hispanic or Latino:!!Asian alone"
//   → leaf="asian alone"
//   → pathTokens=["estimate","total","not hispanic or latino","asian alone"]
function parseLabel(label) {
  if (!label) return { leaf: "", pathTokens: [] };
  const parts = String(label)
    .split("!!")
    .map(s => s.trim().replace(/:$/, "").trim().toLowerCase())
    .filter(Boolean);
  return { leaf: parts[parts.length - 1] || "", pathTokens: parts };
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function _loadYear(year) {
  const path = variablesPath(year);
  if (!await exists(path)) {
    throw new Error(
      `ACS variable metadata not found at ${path}. Run: npm run fetch:acs-tables`
    );
  }

  // Universe lives in groups.json keyed by table id (e.g. B17001 →
  // "Population for whom poverty status is determined"). Load it once and
  // attach to every variable in that table.
  const universeByGroup = new Map();
  const gpath = groupsPath(year);
  if (await exists(gpath)) {
    try {
      const groupsJson = JSON.parse(await readFile(gpath, "utf8"));
      for (const grp of groupsJson.groups || []) {
        // Census JSON sometimes spells the field "universe " (trailing space).
        const u = grp["universe"] || grp["universe "] || "";
        if (grp.name) universeByGroup.set(grp.name, String(u).trim());
      }
    } catch (e) {
      console.warn("[acsVariableMetadata] groups.json parse failed:", e.message);
    }
  }

  const raw = await readFile(path, "utf8");
  const json = JSON.parse(raw);
  const vars = json.variables || {};
  const map = new Map();
  for (const id of Object.keys(vars)) {
    if (id === "for" || id === "in" || id === "ucgid") continue; // skip API-control vars
    const v = vars[id];
    const label = v?.label || "";
    const concept = v?.concept || "";
    const group = v?.group || "";
    const universe = universeByGroup.get(group) || "";
    const { leaf, pathTokens } = parseLabel(label);
    map.set(id, { id, label, concept, group, universe, leaf, pathTokens });
  }
  return map;
}

export async function getMetadata(year = DEFAULT_YEAR) {
  if (_byYear.has(year)) return _byYear.get(year);
  if (_inFlight.has(year)) return _inFlight.get(year);
  const promise = _loadYear(year).then(m => {
    _byYear.set(year, m);
    _inFlight.delete(year);
    return m;
  });
  _inFlight.set(year, promise);
  return promise;
}

export async function getVariableMeta(variableId, year = DEFAULT_YEAR) {
  const map = await getMetadata(year);
  return map.get(variableId) || null;
}

// Tokenize a free-form label string the way we'd compare leaf words.
function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(t => t.length >= 2);
}

// Light substantive overlap check: does Claude's claimed label share at least
// one content token with the variable's actual leaf path?
function hasContentOverlap(claimedLabel, variableMeta) {
  if (!claimedLabel || !variableMeta) return false;
  const claimedTokens = new Set(tokenize(claimedLabel));
  // Strip generic boilerplate from the variable side so we don't get false
  // positives from words like "estimate", "total", "alone".
  const BOILERPLATE = new Set([
    "estimate","total","alone","population","or","and","over","under",
    "people","persons","of","the","in","not","a","an","is","are","with",
    "by","from","to","for","at","on",
  ]);
  const variableTokens = variableMeta.pathTokens
    .flatMap(p => tokenize(p))
    .filter(t => !BOILERPLATE.has(t));
  if (variableTokens.length === 0) return claimedTokens.size > 0; // generic vars — skip
  for (const t of variableTokens) {
    if (claimedTokens.has(t)) return true;
  }
  return false;
}

// Search the metadata for variables matching a free-text label, optionally
// scoped to a specific table. Returns up to `max` candidates ranked by token
// overlap with the label.
export async function suggestVariablesForLabel(label, { tableScope = null, max = 5, year = DEFAULT_YEAR } = {}) {
  if (!label) return [];
  const map = await getMetadata(year);
  const queryTokens = new Set(tokenize(label));
  if (queryTokens.size === 0) return [];
  const BOILERPLATE = new Set([
    "estimate","total","alone","population","or","and","over","under",
    "people","persons","of","the","in","not","a","an","is","are","with",
    "by","from","to","for","at","on",
  ]);
  const ranked = [];
  for (const [, meta] of map) {
    if (tableScope && meta.group !== tableScope) continue;
    if (!meta.id.endsWith("E")) continue; // estimates only — skip MOE / annotation columns
    let score = 0;
    for (const part of meta.pathTokens) {
      for (const t of tokenize(part)) {
        if (BOILERPLATE.has(t)) continue;
        if (queryTokens.has(t)) score += 1;
      }
    }
    if (score > 0) ranked.push({ meta, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, max).map(({ meta }) => ({
    id: meta.id,
    label: meta.label.replace(/!!/g, " → "),
    table: meta.group,
    concept: meta.concept,
  }));
}

/**
 * Validate that a free-form Census variable lookup looks legitimate.
 *
 * Returns null when validation passes. Returns a string error otherwise —
 * caller should surface it back to Claude as the tool result so the LLM
 * can fix the call (or call search_acs_docs to find the right variable).
 *
 * Checks:
 *   1. variable_id exists in the ACS 5-year metadata
 *   2. table_id (if provided) matches the variable's actual group
 *   3. claimed label has at least one substantive content-token overlap
 *      with the variable's actual label hierarchy — catches hallucinations
 *      like "Vietnamese Alone" being applied to B02015_009E (which is
 *      actually 'Other East Asian')
 *
 * On a label-mismatch failure, the error message includes up to 3 candidate
 * variable_ids in the same table whose labels DO contain the user's intended
 * tokens — so Claude can immediately retry with a corrected variable_id.
 */
export async function validateVariableClaim({ variable_id, label, table_id }) {
  if (!variable_id) return "Missing variable_id.";
  let meta;
  try {
    meta = await getVariableMeta(variable_id);
  } catch (err) {
    // Metadata file missing — degrade open rather than blocking lookups.
    console.warn("[acsVariableMetadata] metadata unavailable:", err.message);
    return null;
  }
  if (!meta) {
    return (
      `variable_id "${variable_id}" is not a real ACS detailed-table variable. ` +
      `Call search_acs_docs with the metric name to find the correct variable_id, ` +
      `then retry lookup_census_variable.`
    );
  }
  if (table_id && meta.group && table_id !== meta.group) {
    return (
      `variable_id ${variable_id} belongs to table ${meta.group}, not ${table_id}. ` +
      `Re-call lookup_census_variable with table_id="${meta.group}".`
    );
  }
  if (label && !hasContentOverlap(label, meta)) {
    // Find candidates in the same table whose labels DO match the user's intended tokens.
    const suggestions = await suggestVariablesForLabel(label, { tableScope: meta.group, max: 3 });
    const suggestionLines = suggestions.length
      ? suggestions.map(s => `  • ${s.id} — "${s.label}"`).join("\n")
      : "  (no obvious match — call search_acs_docs to find the correct variable)";
    return (
      `Wrong variable for "${label}". You sent variable_id=${variable_id}, but that variable is actually ` +
      `"${meta.label.replace(/!!/g, " → ")}" (concept: "${meta.concept}").\n\n` +
      `IMPORTANT: Retry lookup_census_variable NOW with one of these corrected variable_ids — do not give up and do not write a text response yet:\n${suggestionLines}\n\n` +
      `Pick the one that best matches "${label}" and call the tool again with that variable_id.`
    );
  }
  return null;
}
