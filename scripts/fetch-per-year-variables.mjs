// scripts/fetch-per-year-variables.mjs
// Download variables.json for each ACS 5-Year Detailed Tables vintage in
// the supported window so we can build a per-year variable existence index.
//
// Run: npm run fetch:per-year-vars
//      npm run fetch:per-year-vars -- --years=2018-2024
//      npm run fetch:per-year-vars -- --years=2014,2018,2022 --force
//
// Output: acs-data/raw/per-year-variables/<year>__acs5__detailed.json
//
// Why we only do ACS5 detailed: that's what /api/trend's fetchCensusVariable
// hits (dataset=acs/acs5). 5-year coverage starts at 2009 but trend.js's
// MIN_YEAR is also 2009, so 2014–CURRENT_ACS_YEAR is the practical window.
// Add --years to extend if needed.

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const force = args.includes("--force");
const yearsArg = args.find((a) => a.startsWith("--years="))?.split("=")[1];

// Default window: 2014 through 2024. Extend by passing --years=YYYY-YYYY
// or --years=2018,2020,2022 etc.
const DEFAULT_START = 2014;
const DEFAULT_END = 2024;

function parseYears(spec) {
  if (!spec) return rangeYears(DEFAULT_START, DEFAULT_END);
  if (spec.includes("-")) {
    const [a, b] = spec.split("-").map((n) => Number(n));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) {
      throw new Error(`Invalid --years range: "${spec}"`);
    }
    return rangeYears(a, b);
  }
  return spec.split(",").map((n) => Number(n.trim())).filter(Number.isFinite);
}

function rangeYears(start, end) {
  const out = [];
  for (let y = start; y <= end; y += 1) out.push(y);
  return out;
}

const YEARS = parseYears(yearsArg);
const OUT_DIR = resolve(PROJECT_ROOT, "acs-data/raw/per-year-variables");

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
  // Validate JSON before writing — Census occasionally returns HTML error
  // pages that would otherwise corrupt our index.
  JSON.parse(text);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text);
  return { skipped: false, bytes: text.length };
}

async function main() {
  console.log(`\nFetching ACS5 Detailed Tables variables.json for ${YEARS.length} year(s)`);
  console.log(`Years: ${YEARS.join(", ")}`);
  console.log(`Output: ${OUT_DIR}\n`);

  let totalBytes = 0;
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const year of YEARS) {
    const url = `https://api.census.gov/data/${year}/acs/acs5/variables.json`;
    const out = resolve(OUT_DIR, `${year}__acs5__detailed.json`);
    process.stdout.write(`  ${year} … `);
    try {
      const r = await downloadJson(url, out);
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

  console.log(
    `\nDone. ok=${okCount} skip=${skipCount} fail=${failCount}, ` +
    `${(totalBytes / 1_000_000).toFixed(1)} MB downloaded.`
  );
  console.log(`Next: npm run index:per-year-vars\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
