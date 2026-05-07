// scripts/index-acs-tables.mjs — build docs/tables-index.json from the
// fetched variables.json + groups.json files.
// Run: npm run index:tables [-- --year=2024]
//
// Strategy:
//   1. Load every (release × kind) pair from docs/raw/tables/<year>/.
//   2. Merge by (kind, table id), recording which releases publish each.
//   3. Pull universe + concept from groups.json — universe lives there only.
//   4. Emit one chunk per (kind, table id). Body lists concept, universe,
//      releases, endpoints, and the variable list (capped at MAX_VARS_INLINE).
//   5. BM25-tokenize using the same tokenizer as the docs index.
//
// Output: docs/tables-index.json — same schema shape as docs/index.json
//   so a future loader can mirror lib/acsRag.js cleanly.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceList, TABLE_KINDS } from "./acs-table-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const yearArg = args.find(a => a.startsWith("--year="))?.split("=")[1];
const YEAR = yearArg || "2024";

const RAW_DIR = resolve(PROJECT_ROOT, "docs/raw/tables", YEAR);
const OUT_PATH = resolve(PROJECT_ROOT, "docs/tables-index.json");

const MAX_VARS_INLINE = 25;

// ── Tokenizer (mirrors scripts/index-acs-docs.mjs:tokenize and lib/acsRag.js:tokenizeQuery) ──
const STOPWORDS = new Set([
  "a","an","and","or","but","if","then","than","that","this","these","those",
  "the","of","in","on","at","to","for","with","by","from","as","is","are","be",
  "been","being","was","were","it","its","they","them","their","there","here",
  "we","our","you","your","i","my","me","do","does","did","not","no","yes",
  "so","such","also","can","could","should","would","may","might","will","shall",
  "have","has","had","having","each","any","all","some","more","most","other",
  "into","over","under","about","because","while","during","between","without",
  "within","across","upon","among","through","via","etc","eg","ie",
]);

function stem(token) {
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y";
  if (token.endsWith("sses")) return token.slice(0, -2);
  if (token.endsWith("ses") && token.length > 4) return token.slice(0, -1);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  return token;
}

function tokenize(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const raw = lower.split(/[^a-z0-9-]+/g);
  const out = [];
  for (let t of raw) {
    if (!t) continue;
    t = t.replace(/^-+|-+$/g, "");
    if (!t || t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(stem(t));
    if (t.includes("-")) {
      const joined = t.replace(/-/g, "");
      if (joined.length >= 2 && !STOPWORDS.has(joined)) out.push(stem(joined));
    }
  }
  return out;
}

// ── File loading ────────────────────────────────────────────────────────────
async function fileExists(p) { try { await access(p); return true; } catch { return false; } }

async function loadJson(path) {
  if (!await fileExists(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

// groups.json sometimes has the key as "universe " (trailing space) — a known
// Census API quirk. Read both spellings defensively.
function getUniverse(group) {
  return group?.universe || group?.["universe "] || null;
}

// "Estimate!!Total!!Male" → "Estimate › Total › Male"
function formatLabel(label) {
  return String(label || "").replace(/!!/g, " › ").trim();
}

// "B25064_001E" → "B25064", "S2502_C01_001E" → "S2502", "DP02_0001E" → "DP02"
function tableIdFromVar(varId) {
  const m = String(varId || "").match(/^([A-Z]+\d+)/);
  return m ? m[1] : null;
}

const RELEASE_BLURBS = {
  acs5: "ACS 5-Year (5-year estimates, all geographies including small areas)",
  acs1: "ACS 1-Year (1-year estimates, geographies with population ≥ 65,000)",
};

// ── Build the merged catalog ────────────────────────────────────────────────
async function buildCatalog() {
  const sources = buildSourceList(YEAR);

  // Map: `${kind}::${tableId}` → entry
  const tableMap = new Map();

  for (const src of sources) {
    const groupsPath = resolve(RAW_DIR, `${src.release}__${src.kind}__groups.json`);
    const varsPath   = resolve(RAW_DIR, `${src.release}__${src.kind}__variables.json`);
    const groupsDoc = await loadJson(groupsPath);
    const varsDoc   = await loadJson(varsPath);
    if (!groupsDoc && !varsDoc) {
      console.log(`  skip ${src.release}/${src.kind} — no files in ${RAW_DIR}`);
      continue;
    }

    // Build a quick lookup of group-level concept + universe.
    const groupsArr = Array.isArray(groupsDoc?.groups) ? groupsDoc.groups : [];
    const groupMeta = new Map();
    for (const g of groupsArr) {
      groupMeta.set(g.name, {
        concept: g.description || null,
        universe: getUniverse(g),
      });
    }

    const variables = varsDoc?.variables || {};
    let varCount = 0;
    for (const [varId, v] of Object.entries(variables)) {
      // Filter out predicate metadata rows like "for", "in", "ucgid".
      if (!varId || !/^[A-Z]/.test(varId)) continue;
      const tableId = v?.group || tableIdFromVar(varId);
      // "NAME" and similar geography fields don't belong to a table group.
      if (!tableId || !/^[A-Z]+\d+$/.test(tableId)) continue;

      const key = `${src.kind}::${tableId}`;
      let entry = tableMap.get(key);
      if (!entry) {
        const meta = groupMeta.get(tableId) || {};
        entry = {
          tableId,
          kind: src.kind,
          kindLabel: src.kindLabel,
          concept: meta.concept || v?.concept || null,
          universe: meta.universe || null,
          releases: new Set(),
          endpoints: new Set(),
          variables: new Map(),
        };
        tableMap.set(key, entry);
      } else {
        // First non-null wins for concept/universe — both releases publish the same metadata
        // for shared tables, but this protects against an empty groups.json entry.
        if (!entry.concept && v?.concept) entry.concept = v.concept;
        const meta = groupMeta.get(tableId);
        if (!entry.universe && meta?.universe) entry.universe = meta.universe;
      }
      entry.releases.add(src.release);
      entry.endpoints.add(src.endpoint);
      if (!entry.variables.has(varId)) {
        entry.variables.set(varId, {
          label: v?.label || "",
          predicateType: v?.predicateType || null,
        });
      }
      varCount++;
    }

    console.log(`  loaded ${src.release}/${src.kind}: ${groupsArr.length} groups, ${varCount} variable rows`);
  }

  return tableMap;
}

// ── Build chunk text ────────────────────────────────────────────────────────
function buildChunkText(entry) {
  const lines = [];
  const concept = entry.concept || "(no concept published)";
  lines.push(`Table ${entry.tableId} (${entry.kindLabel}) — ${concept}.`);
  if (entry.universe) lines.push(`Universe: ${entry.universe}.`);

  const releases = Array.from(entry.releases).sort()
    .map(r => RELEASE_BLURBS[r] || r);
  lines.push(`Released in: ${releases.join("; ")}.`);

  const endpoints = Array.from(entry.endpoints).sort()
    .map(e => `api.census.gov/data/{year}/${e}`);
  lines.push(`API endpoints: ${endpoints.join(", ")}.`);

  const vars = Array.from(entry.variables.entries())
    .sort(([a], [b]) => a.localeCompare(b));
  const total = vars.length;
  const shown = vars.slice(0, MAX_VARS_INLINE);
  const overflow = total - shown.length;

  lines.push(overflow > 0
    ? `Variables (${shown.length} of ${total}):`
    : `Variables (${total}):`);
  for (const [varId, v] of shown) {
    const t = v.predicateType ? ` [${v.predicateType}]` : "";
    lines.push(`  ${varId}${t} — ${formatLabel(v.label)}`);
  }
  if (overflow > 0) lines.push(`  (plus ${overflow} more variables — see groups.json)`);

  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nIndexing ACS tables for year ${YEAR}\n`);

  const tableMap = await buildCatalog();
  if (tableMap.size === 0) {
    console.error(`\nNo tables loaded from ${RAW_DIR}. Run: npm run fetch:acs-tables\n`);
    process.exit(1);
  }
  console.log(`\nMerged catalog: ${tableMap.size} (kind, table) entries`);

  // Per-kind doc metadata so the index has a docs[] roll-up similar to docs/index.json.
  const docMap = new Map();
  for (const k of TABLE_KINDS) {
    docMap.set(k.kind, {
      id: `acs-tables-${k.kind}-${YEAR}`,
      title: `ACS ${k.label} Catalog (${YEAR})`,
      kind: "table-catalog",
      table_kind: k.kind,
      description: `Auto-generated table catalog for the ${k.label} endpoint of the ACS ${YEAR} vintage.`,
      url: null,
      year: Number(YEAR),
      table_count: 0,
      chunk_count: 0,
      has_pdf: false,
      total_pages: null,
    });
  }

  // Build chunks (deterministic order)
  const chunks = [];
  const entries = Array.from(tableMap.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.tableId.localeCompare(b.tableId);
  });

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const docId = `acs-tables-${e.kind}-${YEAR}`;
    chunks.push({
      id: `${docId}__${e.tableId}`,
      doc_id: docId,
      page: null,
      chunk_index_within_page: i,
      global_index: i,
      text: buildChunkText(e),
      // Structured side-channel for downstream lookups (e.g. exact-id queries)
      table: {
        tableId: e.tableId,
        kind: e.kind,
        kindLabel: e.kindLabel,
        concept: e.concept,
        universe: e.universe,
        releases: Array.from(e.releases).sort(),
        endpoints: Array.from(e.endpoints).sort(),
        variableCount: e.variables.size,
        variables: Array.from(e.variables.entries()).map(([id, v]) => ({
          id,
          label: formatLabel(v.label),
          predicateType: v.predicateType,
        })),
      },
    });
    const doc = docMap.get(e.kind);
    if (doc) {
      doc.table_count += 1;
      doc.chunk_count += 1;
    }
  }

  // BM25 prep — same algorithm/shape as docs/index.json
  console.log(`\nTokenizing ${chunks.length} table chunks…`);
  const df = new Map();
  let totalLen = 0;
  for (const c of chunks) {
    const tokens = tokenize(c.text);
    const tf = Object.create(null);
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    for (const t of Object.keys(tf)) df.set(t, (df.get(t) || 0) + 1);
    totalLen += tokens.length;
    c.tf = tf;
    c.len = tokens.length;
  }
  const N = chunks.length;
  const avgdl = N > 0 ? totalLen / N : 0;
  const dfObj = Object.create(null);
  for (const [t, n] of df) dfObj[t] = n;

  console.log(`  Distinct terms: ${df.size.toLocaleString()}`);
  console.log(`  Avg chunk length (tokens): ${avgdl.toFixed(1)}`);

  const docs = Array.from(docMap.values()).filter(d => d.chunk_count > 0);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify({
    meta: {
      created_at: new Date().toISOString(),
      search_kind: "bm25",
      year: Number(YEAR),
      total_chunks: N,
      total_docs: docs.length,
      vocab_size: df.size,
      avg_chunk_tokens: avgdl,
    },
    docs,
    chunks,
    df: dfObj,
    avgdl,
    N,
  }));

  const sizeMB = ((await readFile(OUT_PATH)).byteLength / 1_000_000).toFixed(1);
  console.log(`\nWrote ${OUT_PATH} (${sizeMB} MB)\n`);
  console.log("Summary by endpoint:");
  for (const d of docs) {
    console.log(`  ${d.table_kind.padEnd(10)} ${d.table_count.toString().padStart(5)} tables`);
  }
  console.log();
}

main().catch(err => {
  console.error("\nIndexer failed:");
  console.error(err);
  process.exit(1);
});
