// scripts/fetch-acs-tables.mjs — download variables.json + groups.json for
// every ACS endpoint (4 kinds × 2 releases × 1 year).
// Run: npm run fetch:acs-tables [-- --year=2024] [--force]
//
// Output: docs/raw/tables/<year>/<release>__<kind>__variables.json
//         docs/raw/tables/<year>/<release>__<kind>__groups.json
//
// Idempotent: skips files that already exist. --force re-downloads.
// Tolerant of 404s (e.g. cprofile may not exist for older years).

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceList } from "./acs-table-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const force = args.includes("--force");
const yearArg = args.find(a => a.startsWith("--year="))?.split("=")[1];
const YEAR = yearArg || "2024";
const OUT_DIR = resolve(PROJECT_ROOT, "docs/raw/tables", YEAR);

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function downloadJson(url, outPath) {
  if (!force && (await exists(outPath))) return { skipped: true };
  const res = await fetch(url, {
    headers: { "User-Agent": "CensusBot-RAG-indexer/1.0 (research)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  // Parse-then-stringify to validate well-formed JSON before writing.
  const parsed = JSON.parse(text);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(parsed));
  return { skipped: false, bytes: text.length };
}

async function main() {
  const sources = buildSourceList(YEAR);
  console.log(`\nFetching ACS table catalogs for year ${YEAR}`);
  console.log(`Targets: ${sources.length} endpoints (${sources.length * 2} files) → ${OUT_DIR}\n`);

  let totalBytes = 0;
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const src of sources) {
    const tasks = [
      { url: src.variablesUrl, kind: "variables" },
      { url: src.groupsUrl,    kind: "groups" },
    ];
    for (const t of tasks) {
      const out = resolve(OUT_DIR, `${src.release}__${src.kind}__${t.kind}.json`);
      process.stdout.write(`  ${src.release}/${src.kind}/${t.kind} … `);
      try {
        const r = await downloadJson(t.url, out);
        if (r.skipped) {
          skipCount++;
          process.stdout.write("skip (exists)\n");
        } else {
          okCount++;
          totalBytes += r.bytes;
          process.stdout.write(`${(r.bytes / 1_000_000).toFixed(1)} MB\n`);
        }
      } catch (err) {
        failCount++;
        process.stdout.write(`FAIL — ${err.message}\n`);
      }
    }
  }

  console.log(`\nDone. ok=${okCount} skip=${skipCount} fail=${failCount}, ${(totalBytes / 1_000_000).toFixed(1)} MB downloaded.`);
  console.log(`Next: npm run index:tables\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
