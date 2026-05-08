// lib/acsAlternativesLoader.js — runtime loader for the auto-derived
// alternatives map. Reads lib/acsAlternatives.json (built by
// scripts/derive-acs-alternatives.mjs) lazily on first call and caches
// in-process for the rest of the cold-start lifetime.
//
// Public API:
//   getDerivedAlternatives(variableId, { max = 3 } = {})
//     → Array<{ id, reason, label, table, concept }> | []
//   When the source JSON is missing (e.g. someone didn't run the derive
//   script), returns [] silently — chip rendering degrades to "no chip".

import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { getVariableMeta } from "./acsVariableMetadata";

const ALTERNATIVES_PATH = resolve(process.cwd(), "lib/acsAlternatives.json");

let _altsPromise = null;

async function _load() {
  try {
    await access(ALTERNATIVES_PATH);
  } catch {
    console.warn(`[acsAlternativesLoader] ${ALTERNATIVES_PATH} not found — alternatives chips disabled. Run: npm run derive:alternatives`);
    return { alternatives: {}, meta: null };
  }
  const raw = await readFile(ALTERNATIVES_PATH, "utf8");
  return JSON.parse(raw);
}

function _getJson() {
  if (!_altsPromise) _altsPromise = _load();
  return _altsPromise;
}

/**
 * Derived alternatives for a Census variable, enriched with current label/
 * table/concept from the live metadata so callers don't need to look those up
 * separately.
 *
 * @param {string} variableId
 * @param {object} [opts]
 * @param {number} [opts.max=3]   how many alternatives to return
 * @returns {Promise<Array<{id, reason, label, table, concept}>>}
 */
export async function getDerivedAlternatives(variableId, { max = 3 } = {}) {
  if (!variableId) return [];
  const json = await _getJson();
  const raw = (json.alternatives && json.alternatives[variableId]) || [];

  // Filter out C-prefix collapsed tables (small-geo duplicates of B-tables —
  // same data, just different geo level). For chip display these are noise.
  // Also dedupe by reason text so we don't show the same explanation twice.
  const seenReasons = new Set();
  const filtered = [];
  for (const a of raw) {
    if (/^C\d/.test(a.id)) continue;
    if (seenReasons.has(a.reason)) continue;
    seenReasons.add(a.reason);
    filtered.push(a);
    if (filtered.length >= max) break;
  }

  // Resolve labels from the variable metadata. If the metadata file is missing
  // we degrade to id+reason only (no human-readable label).
  const enriched = await Promise.all(filtered.map(async ({ id, reason }) => {
    let meta = null;
    try {
      meta = await getVariableMeta(id);
    } catch {
      // ignore — degrade
    }
    return {
      id,
      reason,
      label: meta?.label ? meta.label.replace(/!!/g, " → ") : id,
      table: meta?.group || "",
      concept: meta?.concept || "",
    };
  }));
  return enriched;
}

/**
 * Build the chip-payload shape the existing AlternativesBlock UI consumes.
 * Each option carries `pickedMetric` so a click pre-resolves that variable
 * on the next request without going through Claude again.
 *
 * @param {string} variableId         the source variable
 * @param {string} sourceLabel        precise label of the source variable (for the prompt copy)
 * @param {string} sourceFormat       "number" | "currency" | "percent" | "years" | "minutes" | "index"
 * @param {string} userMsg            the user's original query (re-issued on chip click)
 * @returns {Promise<{kind, prompt, options, originalQuery} | null>}
 */
export async function buildDerivedAltChipPayload(variableId, sourceLabel, sourceFormat, userMsg) {
  const alts = await getDerivedAlternatives(variableId, { max: 4 });
  if (alts.length === 0) return null;

  // Strip a leading "[Picked X]" marker if the user just clicked a chip — keeps
  // the underlying re-issued query clean.
  const cleanMsg = String(userMsg || "").replace(/^\s*\[Picked [^\]]+\]\s*/i, "");

  return {
    kind: "metric",
    prompt: `Did you mean a different "${sourceLabel}" measure?`,
    options: alts.map(a => {
      // Last 2 path segments tend to be the most informative chunk of the label.
      const shortLabel = a.label.split(" → ").slice(-2).join(" → ") || a.label;
      return {
        label: shortLabel,
        sublabel: `${a.reason} (Table ${a.table})`,
        value: `[Picked ${shortLabel}] ${cleanMsg}`,
        meta: {
          pickedMetric: {
            variableId: a.id,
            label: shortLabel,
            table: a.table,
            // Inherit the source variable's format — wrong sometimes (e.g.
            // a count alt for a percent source) but right for the common case
            // where alts are sibling counts/percents.
            format: sourceFormat || "number",
          },
        },
      };
    }),
    originalQuery: userMsg,
  };
}
