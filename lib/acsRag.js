// lib/acsRag.js — BM25 keyword search over the indexed ACS docs.
//
// Loads docs/index.json once per cold start. No external API calls — search
// is pure local ranking over pre-tokenized chunks. ~1–10 ms per query at ~1k chunks.
//
// Scoring: standard BM25 with k1=1.2, b=0.75.

import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const INDEX_PATH = resolve(process.cwd(), "docs/index.json");
const BM25_K1 = 1.2;
const BM25_B = 0.75;

let _indexPromise = null;

async function _loadIndex() {
  try {
    await access(INDEX_PATH);
  } catch {
    throw new Error(
      `ACS index not found at ${INDEX_PATH}. Run: npm run fetch:acs-docs && npm run index`
    );
  }
  const raw = await readFile(INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw);

  const chunkById = new Map();
  const docById = new Map();
  for (const d of parsed.docs) docById.set(d.id, d);
  for (const c of parsed.chunks) chunkById.set(c.id, c);

  return {
    meta: parsed.meta,
    docs: parsed.docs,
    docById,
    chunks: parsed.chunks,
    chunkById,
    df: parsed.df || {},
    avgdl: parsed.avgdl || 0,
    N: parsed.N || parsed.chunks.length,
  };
}

export function getIndex() {
  if (!_indexPromise) _indexPromise = _loadIndex();
  return _indexPromise;
}

// ── Tokenizer (must mirror scripts/index-acs-docs.mjs:tokenize) ──────────────
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

function tokenizeQuery(text) {
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

// ── BM25 scoring ────────────────────────────────────────────────────────────
function bm25Score(queryTerms, chunk, df, N, avgdl) {
  let score = 0;
  for (const term of queryTerms) {
    const n = df[term];
    if (!n) continue; // term doesn't appear in any document — contributes 0
    const tf = chunk.tf?.[term] || 0;
    if (tf === 0) continue;
    // BM25 IDF (standard variant): log((N - n + 0.5) / (n + 0.5) + 1)
    const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
    const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.len / (avgdl || 1)));
    score += idf * (tf * (BM25_K1 + 1)) / (denom || 1);
  }
  return score;
}

/**
 * Search the ACS document index with BM25.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.topK=5]            max results to return
 * @param {number} [opts.scoreThreshold=0]  drop results below this BM25 score
 * @returns {Promise<{results: Array, total_chunks: number}>}
 */
export async function searchAcsDocs(query, { topK = 5, scoreThreshold = 0 } = {}) {
  const trimmed = (query || "").trim();
  if (!trimmed) return { results: [], total_chunks: 0 };

  const idx = await getIndex();
  const queryTerms = tokenizeQuery(trimmed);
  if (queryTerms.length === 0) return { results: [], total_chunks: idx.N };

  // Dedup query terms — BM25 over a term repeated in the query just multiplies
  // its weight, which is rarely what you want for search.
  const uniqueTerms = Array.from(new Set(queryTerms));

  const ranked = []; // ascending min-heap surrogate (small K, simple sort)
  for (let i = 0; i < idx.chunks.length; i += 1) {
    const score = bm25Score(uniqueTerms, idx.chunks[i], idx.df, idx.N, idx.avgdl);
    if (score <= scoreThreshold) continue;
    if (ranked.length < topK) {
      ranked.push({ i, score });
      ranked.sort((a, b) => a.score - b.score);
    } else if (score > ranked[0].score) {
      ranked[0] = { i, score };
      ranked.sort((a, b) => a.score - b.score);
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  const results = ranked.map(({ i, score }) => {
    const c = idx.chunks[i];
    const doc = idx.docById.get(c.doc_id) || {};
    return {
      chunk_id: c.id,
      doc_id: c.doc_id,
      doc_title: doc.title || c.doc_id,
      doc_kind: doc.kind || "unknown",
      doc_url: doc.url || null,
      has_pdf: !!doc.has_pdf,
      page: c.page,
      text: c.text,
      score,
    };
  });

  return { results, total_chunks: idx.N };
}

/**
 * Look up a single chunk plus its immediate neighbors in the same doc.
 * Used by /learn/passage/[chunkId] to render context around the focal chunk.
 */
export async function getPassageWithContext(chunkId) {
  const idx = await getIndex();
  const focal = idx.chunkById.get(chunkId);
  if (!focal) return null;

  const sameDoc = idx.chunks.filter(c => c.doc_id === focal.doc_id);
  sameDoc.sort((a, b) => {
    const pa = a.page == null ? 0 : a.page;
    const pb = b.page == null ? 0 : b.page;
    if (pa !== pb) return pa - pb;
    return a.chunk_index_within_page - b.chunk_index_within_page;
  });
  const pos = sameDoc.findIndex(c => c.id === chunkId);
  const prev = pos > 0 ? sameDoc[pos - 1] : null;
  const next = pos < sameDoc.length - 1 ? sameDoc[pos + 1] : null;

  const doc = idx.docById.get(focal.doc_id) || {};
  return {
    doc: { id: focal.doc_id, title: doc.title, kind: doc.kind, url: doc.url, has_pdf: !!doc.has_pdf },
    focal: { chunk_id: focal.id, page: focal.page, text: focal.text },
    prev: prev ? { chunk_id: prev.id, page: prev.page, text: prev.text } : null,
    next: next ? { chunk_id: next.id, page: next.page, text: next.text } : null,
  };
}

export async function getDocList() {
  const idx = await getIndex();
  return idx.docs.map(d => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    description: d.description,
    has_pdf: !!d.has_pdf,
    url: d.url,
    chunk_count: d.chunk_count,
    total_pages: d.total_pages,
  }));
}
