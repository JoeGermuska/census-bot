// scripts/fetch-acs-docs.mjs — download ACS PDFs and crawl "why we ask" HTML pages.
// Run: npm run fetch:acs-docs
//
// Outputs:
//   acs-data/raw/pdfs/<id>.pdf
//   acs-data/raw/html/<id>.html
//
// Idempotent: skips files that already exist. Pass --force to re-download.

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDF_SOURCES, HTML_SOURCES } from "./acs-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const PDFS_DIR = resolve(PROJECT_ROOT, "acs-data/raw/pdfs");
const HTML_DIR = resolve(PROJECT_ROOT, "acs-data/raw/html");

const force = process.argv.includes("--force");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadOne(url, outPath, label) {
  if (!force && (await exists(outPath))) {
    console.log(`  skip ${label} (exists)`);
    return { skipped: true };
  }
  const res = await fetch(url, {
    headers: {
      "User-Agent": "CensusBot-RAG-indexer/1.0 (research; built with claude-opus-4-7)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
  return { skipped: false, bytes: buf.length };
}

async function main() {
  await mkdir(PDFS_DIR, { recursive: true });
  await mkdir(HTML_DIR, { recursive: true });

  console.log(`\nFetching ${PDF_SOURCES.length} PDFs into ${PDFS_DIR}\n`);
  let totalBytes = 0;
  for (const src of PDF_SOURCES) {
    const out = resolve(PDFS_DIR, `${src.id}.pdf`);
    process.stdout.write(`  ${src.id} … `);
    try {
      const r = await downloadOne(src.url, out, src.id);
      if (r.skipped) {
        process.stdout.write("skip\n");
      } else {
        totalBytes += r.bytes;
        process.stdout.write(`${(r.bytes / 1_000_000).toFixed(1)} MB\n`);
      }
    } catch (err) {
      process.stdout.write(`FAIL — ${err.message}\n`);
    }
  }

  console.log(`\nFetching ${HTML_SOURCES.length} HTML pages into ${HTML_DIR}\n`);
  for (const src of HTML_SOURCES) {
    const out = resolve(HTML_DIR, `${src.id}.html`);
    process.stdout.write(`  ${src.id} … `);
    try {
      const r = await downloadOne(src.url, out, src.id);
      if (r.skipped) {
        process.stdout.write("skip\n");
      } else {
        totalBytes += r.bytes;
        process.stdout.write(`${(r.bytes / 1_000).toFixed(0)} KB\n`);
      }
    } catch (err) {
      process.stdout.write(`FAIL — ${err.message}\n`);
    }
  }

  console.log(`\nDone. New downloads: ${(totalBytes / 1_000_000).toFixed(1)} MB total.`);
  console.log(`Next: npm run index\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
