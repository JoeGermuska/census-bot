// scripts/index-per-year-variables.mjs
// Compress the raw per-year variables.json files into a single index:
//   { years: { "2014": { "B01001_001E": "leaf_label", ... }, ... } }
//
// We store the LEAF label (the last !! component of the full hierarchical
// label) so the trend pipeline can map a user's intended concept to the
// right variable_id per vintage. This is required because Census table
// redesigns (e.g. B02015 in 2022) shuffle variable IDs across vintages —
// "Vietnamese" was B02015_022E in 2015–2021 and B02015_019E in 2022–2024.
//
// Two consumer paths in lib/acsTablesRag.js:
//   variableExistsInYear(id, year)             — pre-flight existence check
//   findEquivalentVariableInYear(table, id, y) — label-based remap for
//                                                 redesigned-table queries
//
// Output: acs-data/per-year-variables.json (~5-8 MB).
//
// Run: npm run index:per-year-vars

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const RAW_DIR = resolve(PROJECT_ROOT, "acs-data/raw/per-year-variables");
const OUT_PATH = resolve(PROJECT_ROOT, "acs-data/per-year-variables.json");

// Match files like "2024__acs5__detailed.json"
const FILE_RE = /^(\d{4})__acs5__detailed\.json$/;

async function main() {
  let files;
  try {
    files = await readdir(RAW_DIR);
  } catch (err) {
    console.error(
      `Couldn't read ${RAW_DIR}. Run 'npm run fetch:per-year-vars' first.\n${err.message}`
    );
    process.exit(1);
  }

  const matches = files
    .map((f) => ({ file: f, m: FILE_RE.exec(f) }))
    .filter((x) => x.m);

  if (matches.length === 0) {
    console.error(`No files matching ${FILE_RE} in ${RAW_DIR}`);
    process.exit(1);
  }

  const years = {};

  for (const { file, m } of matches) {
    const year = m[1];
    process.stdout.write(`  ${year} … `);
    const text = await readFile(resolve(RAW_DIR, file), "utf8");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      process.stdout.write(`FAIL — invalid JSON: ${err.message}\n`);
      continue;
    }
    // variables.json shape: { variables: { "B01001_001E": {label, concept, ...}, ... } }
    const vars = parsed?.variables;
    if (!vars || typeof vars !== "object") {
      process.stdout.write(`FAIL — no variables map\n`);
      continue;
    }
    // Filter to genuine ACS estimate variables (B/C/S/DP/CP prefixes with the
    // _NNNE numeric-suffix convention). Excludes "for", "in", and other
    // non-variable keys that variables.json sometimes carries. Store the
    // leaf label (last "!!" component, colon-stripped) — that's enough to
    // match concepts across vintages without bloating the index with the
    // full hierarchical labels.
    const out = {};
    for (const id of Object.keys(vars)) {
      if (!/^[A-Z]+\d+_\d+[A-Z]?$/.test(id)) continue;
      const fullLabel = String(vars[id]?.label || "");
      const leaf = fullLabel.split("!!").pop().replace(/:$/, "").trim();
      out[id] = leaf;
    }
    years[year] = out;
    process.stdout.write(`${Object.keys(out).length} variables\n`);
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const payload = {
    builtAt: new Date().toISOString(),
    years,
  };
  await writeFile(OUT_PATH, JSON.stringify(payload));

  // Report total size + per-year counts.
  const totalIds = Object.values(years).reduce((sum, arr) => sum + arr.length, 0);
  const sizeBytes = (await readFile(OUT_PATH)).length;
  console.log(
    `\nDone. ${Object.keys(years).length} year(s), ${totalIds.toLocaleString()} total ` +
    `variable entries, ${(sizeBytes / 1_000_000).toFixed(2)} MB → ${OUT_PATH}\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
