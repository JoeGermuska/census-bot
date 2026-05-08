// scripts/index-acs-docs.mjs — chunk + tokenize ACS docs, write docs/index.json.
// Run: npm run index    (after npm run fetch:acs-docs)
//
// Inputs:  docs/raw/pdfs/<id>.pdf, docs/raw/html/<id>.html
// Output:  docs/index.json — { meta, docs, chunks, df, avgdl, N }
//
// Pure local: no API calls, no API keys. Search is BM25 over tokenized chunks.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "unpdf";
import * as cheerio from "cheerio";
import { PDF_SOURCES, HTML_SOURCES } from "./acs-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const PDFS_DIR = resolve(PROJECT_ROOT, "docs/raw/pdfs");
const HTML_DIR = resolve(PROJECT_ROOT, "docs/raw/html");
const OUT_PATH = resolve(PROJECT_ROOT, "docs/index.json");

// ── Tunables ────────────────────────────────────────────────────────────────
const TARGET_TOKENS = 600;            // target chunk size
const OVERLAP_TOKENS = 80;            // overlap between adjacent chunks
const APPROX_CHARS_PER_TOKEN = 4;     // rough sizing heuristic

// ── Tokenizer ───────────────────────────────────────────────────────────────
// Split on non-alphanumerics, lowercase, drop stopwords, light suffix stem.
// Keeps alphanumeric tokens like "B19013", "ZCTA", "5-year" → "5year" (joined).
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
  // Very light suffix stripper — covers the obvious morphology that
  // would otherwise miss matches between query and document.
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y";
  if (token.endsWith("sses")) return token.slice(0, -2);     // e.g. "addresses" → "address"
  if (token.endsWith("ses") && token.length > 4) return token.slice(0, -1); // "tenses" → "tense"
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);  // "houses" → "hous"
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  return token;
}

export function tokenize(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  // Split on anything that isn't a-z, 0-9, or hyphen (preserve hyphens inside words).
  // After splitting, strip leading/trailing hyphens.
  const raw = lower.split(/[^a-z0-9-]+/g);
  const out = [];
  for (let t of raw) {
    if (!t) continue;
    t = t.replace(/^-+|-+$/g, "");
    if (!t || t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    // For hyphenated tokens, also include the joined form ("5-year" → "5year") for robustness.
    out.push(stem(t));
    if (t.includes("-")) {
      const joined = t.replace(/-/g, "");
      if (joined.length >= 2 && !STOPWORDS.has(joined)) out.push(stem(joined));
    }
  }
  return out;
}

// ── Chunking ────────────────────────────────────────────────────────────────
function chunkText(text, { targetTokens = TARGET_TOKENS, overlapTokens = OVERLAP_TOKENS } = {}) {
  const targetChars = targetTokens * APPROX_CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * APPROX_CHARS_PER_TOKEN;

  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/­/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";

  function flush() {
    if (!buf.trim()) return;
    chunks.push(buf.trim());
    if (overlapChars > 0 && buf.length > overlapChars) buf = buf.slice(-overlapChars);
    else buf = "";
  }

  for (const para of paragraphs) {
    if (para.length > targetChars * 1.4) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sent of sentences) {
        if ((buf + "\n\n" + sent).length > targetChars && buf) flush();
        buf = buf ? `${buf} ${sent}` : sent;
      }
      if (buf.length >= targetChars * 0.7) flush();
    } else {
      if ((buf + "\n\n" + para).length > targetChars && buf) flush();
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  flush();

  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (last.length < overlapChars * 1.2) chunks.pop();
  }
  return chunks;
}

// ── Source readers ──────────────────────────────────────────────────────────
async function exists(path) { try { await access(path); return true; } catch { return false; } }

// Strip page-number / running-header noise that PDF text extractors prepend
// or append to a page's text. A standalone 1-4 digit number at the very start
// or end of the page is treated as a header/footer artifact. Real body prose
// almost never begins or ends with a bare integer.
function stripPageNoise(pageText) {
  return String(pageText || "")
    .replace(/^\s*\d{1,4}\s+/, "")
    .replace(/\s+\d{1,4}\s*$/, "")
    .trim();
}

async function readPdf(src) {
  const path = resolve(PDFS_DIR, `${src.id}.pdf`);
  if (!await exists(path)) throw new Error(`Missing PDF: ${path}. Run: npm run fetch:acs-docs`);
  const buf = await readFile(path);
  const { totalPages, text } = await extractText(new Uint8Array(buf));
  const out = [];
  for (let pageIdx = 0; pageIdx < text.length; pageIdx += 1) {
    const pageText = stripPageNoise(text[pageIdx] || "");
    if (!pageText) continue;
    const pieces = chunkText(pageText);
    for (let i = 0; i < pieces.length; i += 1) {
      out.push({
        doc_id: src.id,
        page: pageIdx + 1,
        chunk_index_within_page: i,
        text: pieces[i],
      });
    }
  }
  return { chunks: out, totalPages };
}

async function readHtml(src) {
  const path = resolve(HTML_DIR, `${src.id}.html`);
  if (!await exists(path)) throw new Error(`Missing HTML: ${path}. Run: npm run fetch:acs-docs`);
  const html = await readFile(path, "utf8");
  const $ = cheerio.load(html);
  $("nav, header, footer, script, style, noscript, .uscb-sub-nav, .uscb-breadcrumb, .uscb-share-section").remove();
  const root = $("main").length ? $("main") : $("body");
  const text = root.text().replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n\n").trim();
  const pieces = chunkText(text);
  return {
    chunks: pieces.map((t, i) => ({
      doc_id: src.id,
      page: null,
      chunk_index_within_page: i,
      text: t,
    })),
    totalPages: 1,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\nReading source docs and chunking…\n");
  const docMeta = [];
  const allChunks = [];

  for (const src of PDF_SOURCES) {
    process.stdout.write(`  [pdf]  ${src.id} … `);
    try {
      const { chunks, totalPages } = await readPdf(src);
      docMeta.push({ ...src, total_pages: totalPages, chunk_count: chunks.length, has_pdf: true });
      allChunks.push(...chunks);
      process.stdout.write(`${chunks.length} chunks (${totalPages} pages)\n`);
    } catch (err) {
      process.stdout.write(`SKIP — ${err.message}\n`);
    }
  }

  for (const src of HTML_SOURCES) {
    process.stdout.write(`  [html] ${src.id} … `);
    try {
      const { chunks } = await readHtml(src);
      docMeta.push({ ...src, total_pages: null, chunk_count: chunks.length, has_pdf: false });
      allChunks.push(...chunks);
      process.stdout.write(`${chunks.length} chunks\n`);
    } catch (err) {
      process.stdout.write(`SKIP — ${err.message}\n`);
    }
  }

  for (let i = 0; i < allChunks.length; i += 1) {
    const c = allChunks[i];
    const pageTag = c.page == null ? "html" : `p${c.page}`;
    c.id = `${c.doc_id}__${pageTag}__${c.chunk_index_within_page}`;
    c.global_index = i;
  }

  console.log(`\nTotal chunks: ${allChunks.length}`);
  console.log("\nTokenizing for BM25…");

  // Per-chunk: token counts (TF) and total length.
  // Global: document frequency per term (DF).
  const df = new Map();
  let totalLen = 0;

  const chunksOut = allChunks.map(c => {
    const tokens = tokenize(c.text);
    const tf = Object.create(null);
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    for (const t of Object.keys(tf)) df.set(t, (df.get(t) || 0) + 1);
    totalLen += tokens.length;
    return {
      id: c.id,
      doc_id: c.doc_id,
      page: c.page,
      chunk_index_within_page: c.chunk_index_within_page,
      global_index: c.global_index,
      text: c.text,
      tf,
      len: tokens.length,
    };
  });

  const N = chunksOut.length;
  const avgdl = N > 0 ? totalLen / N : 0;
  // Convert df Map to plain object for JSON.
  const dfObj = Object.create(null);
  for (const [term, count] of df) dfObj[term] = count;

  console.log(`  Distinct terms: ${df.size.toLocaleString()}`);
  console.log(`  Avg chunk length (tokens): ${avgdl.toFixed(1)}`);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify({
    meta: {
      created_at: new Date().toISOString(),
      search_kind: "bm25",
      total_chunks: N,
      total_docs: docMeta.length,
      vocab_size: df.size,
      avg_chunk_tokens: avgdl,
    },
    docs: docMeta,
    chunks: chunksOut,
    df: dfObj,
    avgdl,
    N,
  }));

  const sizeMB = ((await readFile(OUT_PATH)).byteLength / 1_000_000).toFixed(1);
  console.log(`\nWrote ${OUT_PATH} (${sizeMB} MB)\n`);
}

main().catch(err => {
  console.error("\nIndexer failed:");
  console.error(err);
  process.exit(1);
});
