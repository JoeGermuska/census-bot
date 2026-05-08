// scripts/test-moe.mjs — sanity-check MOE fetch + derived-rate MOE math
// against the live Census API.
//
// Run: node scripts/test-moe.mjs
//
// Self-contained: doesn't import lib/* (those use Next-resolved bare paths
// that plain Node can't resolve). Inlines the formulas under test so this
// script is truly testing the same math that ships in production.

import { readFile } from "node:fs/promises";

async function loadKey() {
  try {
    const env = await readFile(".env.local", "utf8");
    const m = env.match(/^CENSUS_API_KEY=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const KEY = await loadKey();
if (!KEY) {
  console.error("ERROR: CENSUS_API_KEY not found in .env.local");
  process.exit(1);
}

// ── Inlined copies of the production math (must match lib/censusRates.js + lib/validateCensusData.js) ──
function computeRateMOE({ numerator, numeratorMOE, denominator, denominatorMOE, scale, kind }) {
  const X = Number(denominator);
  const Y = Number(numerator);
  const mY = Number(numeratorMOE);
  const mX = Number(denominatorMOE);
  if (!Number.isFinite(X) || X <= 0) return null;
  if (!Number.isFinite(Y) || !Number.isFinite(mY) || !Number.isFinite(mX)) return null;
  if (mY < 0 || mX < 0) return null;

  const ratio = Y / X;
  let moe;
  if (kind === "proportion") {
    const inside = mY * mY - ratio * ratio * mX * mX;
    moe = inside >= 0
      ? (1 / X) * Math.sqrt(inside)
      : (1 / X) * Math.sqrt(mY * mY + ratio * ratio * mX * mX);
  } else {
    moe = (1 / X) * Math.sqrt(mY * mY + ratio * ratio * mX * mX);
  }
  return moe * scale;
}

const SENTINEL_REASONS = {
  "-666666666": "Estimate not available or not applicable for this geography",
  "-555555555": "Estimate suppressed for disclosure protection",
  "-333333333": "Median is at or above the top of the top-coded range",
  "-222222222": "Median couldn't be computed (too few sample cases)",
  "-888888888": "Estimate is not applicable",
  "-999999999": "Estimate could not be computed",
};
function sentinelReason(value) {
  return SENTINEL_REASONS[String(Number(value))] || null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function fetchVar(year, dataset, vars, geo, geoIn = null) {
  const params = new URLSearchParams({
    get: `NAME,${vars.join(",")}`,
    for: geo,
    key: KEY,
  });
  if (geoIn) params.set("in", geoIn);
  const url = `https://api.census.gov/data/${year}/${dataset}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length < 2) throw new Error("No rows");
  const header = data[0];
  const row = data[1];
  return Object.fromEntries(vars.map(v => [v, row[header.indexOf(v)]]));
}

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, detail) {
  console.log(`  FAIL  ${label}\n        ${detail}`);
  process.exitCode = 1;
}

// ── Test 1: companion-variable fetch returns both E and M ───────────────────
console.log("\n[1] Median rent + MOE for California (state)");
try {
  const r = await fetchVar(2024, "acs/acs5", ["B25064_001E", "B25064_001M"], "state:06");
  console.log(`      B25064_001E=${r.B25064_001E}, B25064_001M=${r.B25064_001M}`);
  if (Number(r.B25064_001E) > 0 && Number(r.B25064_001M) > 0) {
    pass("Census API returned both estimate and MOE in one call");
  } else {
    fail("Bad shape", JSON.stringify(r));
  }
} catch (e) { fail("Fetch failed", e.message); }

// ── Test 2: proportion formula (synthetic) ──────────────────────────────────
console.log("\n[2] Proportion MOE formula (synthetic)");
{
  // Y=10, mY=2, X=100, mX=5 → P=0.10
  // MOE_P = (1/100)·√(4 − 0.01·25) = (1/100)·√3.75 ≈ 0.01936
  // Scaled by 100 → ≈ 1.9365
  const got = computeRateMOE({ numerator: 10, numeratorMOE: 2, denominator: 100, denominatorMOE: 5, scale: 100, kind: "proportion" });
  const expected = 1.9365;
  if (Math.abs(got - expected) < 0.01) pass(`MOE_P=${got.toFixed(4)} (expected ≈${expected})`);
  else fail("Off by more than 0.01", `got=${got} expected=${expected}`);
}

// ── Test 3: ratio formula (synthetic) ───────────────────────────────────────
console.log("\n[3] Ratio MOE formula (synthetic)");
{
  // Y=200, mY=10, X=100, mX=5 → R=2
  // MOE_R = (1/100)·√(100 + 4·25) = (1/100)·√200 ≈ 0.1414
  const got = computeRateMOE({ numerator: 200, numeratorMOE: 10, denominator: 100, denominatorMOE: 5, scale: 1, kind: "ratio" });
  const expected = 0.1414;
  if (Math.abs(got - expected) < 0.001) pass(`MOE_R=${got.toFixed(4)} (expected ≈${expected})`);
  else fail("Off by more than 0.001", `got=${got} expected=${expected}`);
}

// ── Test 4: negative-radicand fallback (synthetic) ──────────────────────────
console.log("\n[4] Proportion fallback when radicand < 0 (synthetic)");
{
  // mX large enough that mY² - P²·mX² < 0 — code should fall back to ratio formula
  // and still return a finite positive number.
  const got = computeRateMOE({ numerator: 50, numeratorMOE: 1, denominator: 100, denominatorMOE: 50, scale: 100, kind: "proportion" });
  if (got != null && Number.isFinite(got) && got > 0) pass(`Fallback returned ${got.toFixed(4)} (finite, non-NaN)`);
  else fail("Did not fall back cleanly", `got=${got}`);
}

// ── Test 5: end-to-end unemployment rate for Texas ──────────────────────────
console.log("\n[5] End-to-end: unemployment rate MOE for Texas (proportion)");
try {
  const r = await fetchVar(2024, "acs/acs5", ["B23025_005E", "B23025_005M", "B23025_003E", "B23025_003M"], "state:48");
  const num = Number(r.B23025_005E);
  const numMOE = Number(r.B23025_005M);
  const den = Number(r.B23025_003E);
  const denMOE = Number(r.B23025_003M);
  const rate = (num / den) * 100;
  const moePP = computeRateMOE({ numerator: num, numeratorMOE: numMOE, denominator: den, denominatorMOE: denMOE, scale: 100, kind: "proportion" });
  console.log(`      unemployed=${num} (±${numMOE}), labor force=${den} (±${denMOE})`);
  console.log(`      unemployment rate ≈ ${rate.toFixed(3)}%  (±${moePP.toFixed(3)} pp)`);
  if (rate > 0 && rate < 20 && moePP > 0 && moePP < 2) {
    pass("Rate and MOE in plausible state-level range");
  } else {
    fail("Out of plausible range", `rate=${rate}, moe=${moePP}`);
  }
} catch (e) { fail("Fetch failed", e.message); }

// ── Test 6: end-to-end mean commute time (ratio) for California ─────────────
console.log("\n[6] End-to-end: mean commute MOE for California (ratio)");
try {
  const r = await fetchVar(2024, "acs/acs5", ["B08136_001E", "B08136_001M", "B08303_001E", "B08303_001M"], "state:06");
  const num = Number(r.B08136_001E);
  const numMOE = Number(r.B08136_001M);
  const den = Number(r.B08303_001E);
  const denMOE = Number(r.B08303_001M);
  const mean = num / den;
  const moeMin = computeRateMOE({ numerator: num, numeratorMOE: numMOE, denominator: den, denominatorMOE: denMOE, scale: 1, kind: "ratio" });
  console.log(`      aggregate min=${num} (±${numMOE}), workers=${den} (±${denMOE})`);
  console.log(`      mean commute ≈ ${mean.toFixed(2)} min  (±${moeMin.toFixed(2)} min)`);
  if (mean > 10 && mean < 60 && moeMin > 0 && moeMin < 5) {
    pass("Mean commute and MOE in plausible state-level range");
  } else {
    fail("Out of plausible range", `mean=${mean}, moe=${moeMin}`);
  }
} catch (e) { fail("Fetch failed", e.message); }

// ── Test 7: sentinel mapping ────────────────────────────────────────────────
console.log("\n[7] Sentinel reason lookup");
{
  const cases = [
    ["-666666666", "Estimate not available or not applicable for this geography"],
    ["-555555555", "Estimate suppressed for disclosure protection"],
    ["-333333333", "Median is at or above the top of the top-coded range"],
    ["-222222222", "Median couldn't be computed (too few sample cases)"],
    ["1847",       null], // not a sentinel
  ];
  let ok = true;
  for (const [val, expected] of cases) {
    const got = sentinelReason(val);
    if (got !== expected) { ok = false; fail(`sentinelReason(${val})`, `got=${got} expected=${expected}`); }
  }
  if (ok) pass("All four standard sentinels + non-sentinel passthrough");
}

console.log("\nDone.");
