// scripts/derive-acs-alternatives.mjs — auto-generate alternative-variable
// pairings from Census variables.json metadata. Run AFTER fetch:acs-tables.
//
//   npm run derive:alternatives
//
// Output: lib/acsAlternatives.json — { variableId: [{ id, label, table, concept, reason }] }
//
// Two derivation rules:
//   Rule A (cross-table leaf match):
//     Variables with the same `label` leaf but in different tables are
//     alternative measures of the same concept. E.g. B02001_005E "Asian alone"
//     pairs with B03002_006E "Not Hispanic or Latino: Asian alone".
//
//   Rule B (universe-variant concept match):
//     Variables in different tables whose tokenized concepts overlap ≥70%
//     and share a "median/mean" prefix are universe variants. E.g. Median
//     Household Income / Median Family Income / Per Capita Income.
//
// Reason text is built from the path-token diff against a small library of
// recognized qualifiers (~15 entries). No hand-written variable pairings.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const yearArg = args.find(a => a.startsWith("--year="))?.split("=")[1];
const YEAR = yearArg || "2024";
const RAW_DIR = resolve(PROJECT_ROOT, "docs/raw/tables", YEAR);
const OUT_PATH = resolve(PROJECT_ROOT, "lib/acsAlternatives.json");

// Cap alternatives per source variable. Most cases need 1–3; >5 is noise.
const MAX_ALTS_PER_VARIABLE = 5;

// ── Load detailed-table variables (the B/C tables — where most data lives) ──
// Restricted to ACS 5-year because that's the dataset the runtime queries
// against by default. Including ACS-1-only tables (e.g. B02003) creates
// chip alternatives that silently fail when clicked.
async function loadDetailedVariables() {
  const files = await readdir(RAW_DIR);
  const detailedVarFiles = files.filter(
    f => f.startsWith("acs5__") && f.endsWith("__detailed__variables.json")
  );
  if (detailedVarFiles.length === 0) {
    throw new Error(`No ACS5 detailed variables files found in ${RAW_DIR}. Run: npm run fetch:acs-tables`);
  }

  // Load groups.json for the universe field — variables.json only has label /
  // concept / group; the human-readable universe (e.g. "Population in
  // households for whom poverty status is determined") only lives in groups.
  const groupsFiles = files.filter(
    f => f.startsWith("acs5__") && f.endsWith("__detailed__groups.json")
  );
  const universeByGroup = new Map();
  for (const file of groupsFiles) {
    const json = JSON.parse(await readFile(resolve(RAW_DIR, file), "utf8"));
    for (const grp of json.groups || []) {
      // Census API has a typo in the JSON: the field is "universe " (with
      // trailing space) in some endpoints. Try both.
      const u = grp["universe"] || grp["universe "] || "";
      if (grp.name) universeByGroup.set(grp.name, String(u).trim());
    }
  }

  const map = new Map(); // id → { id, label, concept, group, universe, leaf, pathTokens, conceptTokens, releases }

  for (const file of detailedVarFiles) {
    const release = file.split("__")[0]; // "acs5" or "acs1"
    const json = JSON.parse(await readFile(resolve(RAW_DIR, file), "utf8"));
    const vars = json.variables || {};
    for (const id of Object.keys(vars)) {
      // Estimates only (skip _M margins, _MA, _EA annotations).
      if (!/[BC]\d+_\d+E$/.test(id)) continue;
      const v = vars[id];
      const label = v?.label || "";
      const concept = v?.concept || "";
      const group = v?.group || "";
      // Skip variables without a normal table-group (rare API artifacts).
      if (!/^[BC]\d+/.test(group)) continue;

      // Existing entry from another release just adds to releases.
      if (map.has(id)) {
        map.get(id).releases.add(release);
        continue;
      }
      const pathTokens = label
        .split("!!")
        .map(s => s.trim().replace(/:$/, "").trim().toLowerCase())
        .filter(Boolean);
      const leaf = pathTokens[pathTokens.length - 1] || "";
      const conceptTokens = tokenize(concept);
      const universe = universeByGroup.get(group) || "";
      map.set(id, {
        id,
        label,
        concept,
        group,
        universe,
        leaf,
        pathTokens,
        conceptTokens,
        releases: new Set([release]),
      });
    }
  }
  return map;
}

const STOPWORDS = new Set([
  "a","an","and","any","are","as","at","be","by","for","from","in","is","it",
  "of","on","or","the","to","with","not","a","an","past","12","months","years",
  "one","two","three","four","five","over","under","by",
]);

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

// ── Reason templates: path-token diffs → human-readable explanation ──
// Each entry: { match: token-set the alternative ADDS, reason: explanation }
// Order matters: earlier patterns win.
// Each template fires when its `match` token-set is fully present on one side
// of the path-token diff. `reason` reads when the alt ADDS the qualifier;
// `inverseReason` reads when the alt DROPS it (i.e., source has it, alt doesn't).
const REASON_TEMPLATES = [
  {
    match: new Set(["not", "hispanic", "latino"]),
    reason: "Excludes people who also identify as Hispanic or Latino",
    inverseReason: "Includes people who also identify as Hispanic or Latino",
  },
  {
    match: new Set(["hispanic", "latino"]),
    reason: "Limited to people who identify as Hispanic or Latino",
    inverseReason: "Excludes people who identify as Hispanic or Latino",
  },
  {
    match: new Set(["family", "households"]),
    reason: "Restricted to family households (excludes single-person and unrelated-roommate households)",
    inverseReason: "Includes all households, not just family households",
  },
  {
    match: new Set(["family"]),
    reason: "Restricted to family units",
    inverseReason: "Includes all units, not just family units",
  },
  {
    match: new Set(["nonfamily", "households"]),
    reason: "Limited to non-family households",
    inverseReason: "Includes family households as well",
  },
  {
    match: new Set(["owner", "occupied"]),
    reason: "Owner-occupied housing units only",
    inverseReason: "Includes renter-occupied housing as well",
  },
  {
    match: new Set(["renter", "occupied"]),
    reason: "Renter-occupied housing units only",
    inverseReason: "Includes owner-occupied housing as well",
  },
  {
    match: new Set(["male"]),
    reason: "Limited to males",
    inverseReason: "Includes both sexes",
  },
  {
    match: new Set(["female"]),
    reason: "Limited to females",
    inverseReason: "Includes both sexes",
  },
  {
    match: new Set(["foreign", "born"]),
    reason: "Limited to foreign-born population",
    inverseReason: "Includes native-born population as well",
  },
  {
    match: new Set(["native", "born"]),
    reason: "Limited to native-born population",
    inverseReason: "Includes foreign-born population as well",
  },
  {
    match: new Set(["urban"]),
    reason: "Limited to urban areas",
    inverseReason: "Includes rural areas as well",
  },
  {
    match: new Set(["rural"]),
    reason: "Limited to rural areas",
    inverseReason: "Includes urban areas as well",
  },
];

// Tokenize for path-diff matching — keeps "not" and other negations that are
// dropped by the broader concept-matching tokenizer, since the presence or
// absence of "not" flips the meaning of a qualifier.
function pathDiffTokens(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(t => t.length >= 2 && t !== "or" && t !== "the" && t !== "of" && t !== "in");
}

function reasonFromPathDiff(sourcePath, altPath) {
  const sourceSet = new Set(sourcePath);
  const altSet = new Set(altPath);
  const addedByAlt = new Set([...altSet].filter(t => !sourceSet.has(t)));
  const droppedFromSource = new Set([...sourceSet].filter(t => !altSet.has(t)));

  const addedTokens = [...addedByAlt].flatMap(p => pathDiffTokens(p));
  const droppedTokens = [...droppedFromSource].flatMap(p => pathDiffTokens(p));

  // Try templates against alt's added tokens first.
  for (const tpl of REASON_TEMPLATES) {
    const allMatch = [...tpl.match].every(t => addedTokens.includes(t));
    if (allMatch) return tpl.reason;
  }
  // Inverse — source has a qualifier that alt drops. Each template carries an
  // explicit `inverseReason` so wording reads naturally in both directions.
  for (const tpl of REASON_TEMPLATES) {
    const allMatch = [...tpl.match].every(t => droppedTokens.includes(t));
    if (allMatch && tpl.inverseReason) return tpl.inverseReason;
  }
  if (addedTokens.length > 0) return `Different breakdown: includes "${addedTokens.slice(0, 4).join(" ")}"`;
  if (droppedTokens.length > 0) return `Different breakdown: drops "${droppedTokens.slice(0, 4).join(" ")}"`;
  return "Alternative breakdown of the same metric";
}

// ── Rule A: cross-table leaf match ──
// Group variables by leaf. Within each group, every cross-table pair is an alternative.
function ruleACrossTableLeaf(allVars) {
  const byLeaf = new Map();
  for (const v of allVars.values()) {
    if (!v.leaf) continue;
    if (!byLeaf.has(v.leaf)) byLeaf.set(v.leaf, []);
    byLeaf.get(v.leaf).push(v);
  }

  const altMap = new Map(); // id → [{ id, reason }]
  for (const [, vars] of byLeaf) {
    if (vars.length < 2) continue;
    for (const src of vars) {
      const list = [];
      for (const alt of vars) {
        if (alt.id === src.id) continue;
        if (alt.group === src.group) continue;
        list.push({
          id: alt.id,
          reason: reasonFromPathDiff(src.pathTokens, alt.pathTokens),
        });
      }
      if (list.length === 0) continue;
      const existing = altMap.get(src.id) || [];
      altMap.set(src.id, [...existing, ...list]);
    }
  }
  return altMap;
}

// ── Rule B: universe-variant concept match ──
// Variables in different tables sharing similar concepts (≥70% token overlap)
// and similar position in their tables. Captures e.g. household/family/per-capita income.
function ruleBUniverseVariants(allVars) {
  // Index by table → variables, used to compare positional siblings.
  // To avoid an O(N²) scan over 28k variables, we group by the FIRST concept
  // token (after stopwords) — which acts like a coarse semantic bucket.
  const byFirstToken = new Map();
  for (const v of allVars.values()) {
    const firstToken = v.conceptTokens[0];
    if (!firstToken) continue;
    if (!byFirstToken.has(firstToken)) byFirstToken.set(firstToken, []);
    byFirstToken.get(firstToken).push(v);
  }

  const altMap = new Map();
  for (const [, group] of byFirstToken) {
    if (group.length < 2) continue;
    for (const src of group) {
      const list = [];
      for (const alt of group) {
        if (alt.id === src.id) continue;
        if (alt.group === src.group) continue;
        // Concept-token overlap must be ≥70%.
        const overlap = alt.conceptTokens.filter(t => src.conceptTokens.includes(t)).length;
        const denom = Math.max(src.conceptTokens.length, alt.conceptTokens.length);
        if (denom === 0 || overlap / denom < 0.7) continue;
        // Same path depth (positional siblings within their tables).
        if (alt.pathTokens.length !== src.pathTokens.length) continue;
        list.push({
          id: alt.id,
          reason: alt.concept !== src.concept
            ? `Same metric, different universe: ${alt.concept}`
            : "Alternative breakdown",
        });
      }
      if (list.length === 0) continue;
      const existing = altMap.get(src.id) || [];
      altMap.set(src.id, [...existing, ...list]);
    }
  }
  return altMap;
}

// ── Merge + dedupe + cap ──
function mergeAlts(...maps) {
  const out = new Map();
  for (const m of maps) {
    for (const [id, alts] of m) {
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(...alts);
    }
  }
  // Dedupe by alt.id, then cap.
  for (const [id, alts] of out) {
    const seen = new Set();
    const deduped = [];
    for (const a of alts) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      deduped.push(a);
    }
    out.set(id, deduped.slice(0, MAX_ALTS_PER_VARIABLE));
  }
  return out;
}

async function main() {
  console.log(`\nLoading detailed-table variables from ${RAW_DIR}…`);
  const allVars = await loadDetailedVariables();
  console.log(`  ${allVars.size.toLocaleString()} estimate variables loaded\n`);

  console.log("Applying Rule A (cross-table leaf match)…");
  const altsA = ruleACrossTableLeaf(allVars);
  console.log(`  ${altsA.size.toLocaleString()} variables get cross-table alternatives\n`);

  console.log("Applying Rule B (universe-variant concept match)…");
  const altsB = ruleBUniverseVariants(allVars);
  console.log(`  ${altsB.size.toLocaleString()} variables get universe-variant alternatives\n`);

  const merged = mergeAlts(altsA, altsB);
  console.log(`Merged: ${merged.size.toLocaleString()} variables have at least one alternative.\n`);

  // Convert Map → plain object for JSON output.
  const out = {};
  for (const [id, alts] of merged) out[id] = alts;

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify({
    meta: {
      created_at: new Date().toISOString(),
      year: Number(YEAR),
      max_alts_per_variable: MAX_ALTS_PER_VARIABLE,
      total_variables_with_alts: merged.size,
      total_estimate_variables: allVars.size,
    },
    alternatives: out,
  }));

  const sizeMB = ((await readFile(OUT_PATH)).byteLength / 1_000_000).toFixed(1);
  console.log(`Wrote ${OUT_PATH} (${sizeMB} MB)\n`);

  // Spot checks (resolve labels from the in-memory metadata since the output now stores only id+reason)
  console.log("Spot checks:");
  for (const id of ["B03002_006E", "B02001_005E", "B19013_001E", "B25064_001E", "B08301_003E"]) {
    const alts = out[id] || [];
    const srcLabel = allVars.get(id)?.label || "?";
    console.log(`  ${id} (${srcLabel}): ${alts.length} alts`);
    for (const a of alts.slice(0, 3)) {
      const altLabel = (allVars.get(a.id)?.label || "?").replace(/!!/g, " → ").split(" → ").slice(-2).join(" → ");
      console.log(`    → ${a.id}  "${altLabel}"  — ${a.reason}`);
    }
  }
}

main().catch(err => {
  console.error("\nDerivation failed:");
  console.error(err);
  process.exit(1);
});
