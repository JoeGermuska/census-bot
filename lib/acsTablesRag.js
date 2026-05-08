// lib/acsTablesRag.js — local lookup over the ACS table catalog.
//
// Loads docs/tables-index.json once per cold start. The catalog is built
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

const INDEX_PATH = resolve(process.cwd(), "docs/tables-index.json");

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
