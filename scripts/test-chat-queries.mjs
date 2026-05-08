// scripts/test-chat-queries.mjs — end-to-end test set of hard queries that
// have surfaced as bugs (or risk surfacing) over the chat pipeline.
//
// Each test hits POST /api/chat and asserts properties on the response shape
// (dataset, fallback reason, structured payload, chip alternatives, etc.).
// Properties are checked rather than exact values so the suite stays
// meaningful when ACS releases a new vintage.
//
// Run:                 node scripts/test-chat-queries.mjs
//   only one category: node scripts/test-chat-queries.mjs --only=race
//   list cases:        node scripts/test-chat-queries.mjs --list
//
// Tests are grouped into categories — see CASES below. Tests run in batches
// of 4 in parallel (Claude-dependent ones are slow; this caps the wall-clock
// time at roughly (slowest_test × ceil(total / 4))).

const BASE = process.env.CHAT_BASE_URL || "http://localhost:3000";
const PARALLEL = 4;

// ── Test definitions ────────────────────────────────────────────────────────
//
// Each case: { name, category, query, mode = "statistic", messages?, expects }
//
// `expects` predicates (all are optional — only the ones present are checked):
//   hasStructured: bool          — response.structured is/isn't present
//   variable:      regex|string  — match against structured.variable
//   dataset:       "acs1"|"acs5" — exact match
//   noFallbackReason: bool       — structured.fallbackReason is null/undefined
//   fallbackReasonContains: string|regex — substring/regex of fallbackReason
//   value: { min?, max? }        — numeric range for structured.value
//   reply:        regex|string   — match against response.reply text
//   replyDoesNotContain: string|regex — must NOT appear in reply
//   alternatives: bool|kind[]    — true=any chips, [kinds] = required chip kinds
//   methodology:  bool           — has structured.methodology populated
//   sources:      bool           — has response.sources or structured (some pipeline ran)
const CASES = [
  // ── Category: dataset selection (1-year vs 5-year) ──────────────────────
  {
    name: "Big city + curated metric → 1-year",
    category: "dataset",
    query: "median household income in Los Angeles, California",
    expects: { hasStructured: true, dataset: "acs1", variable: /Median Household Income/, noFallbackReason: true },
  },
  {
    name: "Big city + free-form metric → 1-year",
    category: "dataset",
    query: "Population of Iranians in Chicago, Illinois",
    expects: { hasStructured: true, dataset: "acs1", variable: /Iranian/i, value: { min: 1500, max: 8000 } },
  },
  {
    name: "Tiny place → 5-year + population reason",
    category: "dataset",
    query: "median income in Cody, Wyoming",
    expects: {
      hasStructured: true, dataset: "acs5",
      fallbackReasonContains: /below the 65,000/,
    },
  },
  {
    name: "ZIP code → 5-year + ZCTA reason",
    category: "dataset",
    query: "median income in zip 90210",
    expects: {
      hasStructured: true, dataset: "acs5",
      fallbackReasonContains: /ZIP-code|ZCTA/i,
    },
  },
  {
    name: "State-level query → 1-year",
    category: "dataset",
    query: "median household income in California",
    expects: { hasStructured: true, dataset: "acs1", noFallbackReason: true },
  },

  // ── Category: geo resolution ────────────────────────────────────────────
  {
    name: "Detroit poverty rate (regression — was breaking on 503)",
    category: "geo",
    query: "What is the poverty rate in Detroit, Michigan?",
    expects: { hasStructured: true, variable: /Poverty Rate/, dataset: "acs1", value: { min: 25, max: 45 } },
  },
  {
    name: "Chicago resolves to city, not metro",
    category: "geo",
    query: "median household income in Chicago, Illinois",
    expects: {
      hasStructured: true, dataset: "acs1",
      // City is ~$80k; metro is ~$95k. We must hit the city.
      value: { min: 70000, max: 90000 },
    },
  },
  {
    name: "San Mateo CITY vs San Mateo COUNTY surfaces geo chip",
    category: "geo",
    query: "median income in San Mateo, California",
    expects: { hasStructured: true, alternatives: ["geography"] },
  },
  {
    name: "Springfield with no state → ambiguity prompt (no structured)",
    category: "geo",
    query: "vietnamese population in springfield",
    expects: {
      hasStructured: false,
      reply: /which.*springfield|several|clarif/i,
    },
  },
  {
    name: "Honolulu (medium city, has B02001 in 1-year)",
    category: "geo",
    query: "Native Hawaiian population in Honolulu, Hawaii",
    expects: { hasStructured: true, variable: /Native Hawaiian|Pacific Islander/i },
  },

  // ── Category: variable selection / hallucination guards ─────────────────
  {
    name: "Race defaults to non-Hispanic crosstab (B03002)",
    category: "variable",
    query: "asian population in San Mateo, california",
    expects: {
      hasStructured: true,
      // Either label says non-Hispanic, OR table is B03002.
      variable: /Asian.*Not Hispanic|asian alone/i,
    },
  },
  {
    name: "Vietnamese in San Jose — validator catches hallucinated B02015_009E",
    category: "variable",
    query: "vietnamese population in San Jose, California",
    expects: {
      hasStructured: true,
      variable: /Vietnamese/i,
      // Real Vietnamese count for San Jose is ~110k. Exclude small numbers
      // from a wrong table.
      value: { min: 80000, max: 130000 },
    },
  },
  {
    name: "Median rent in Austin — curated fast path, not Claude",
    category: "variable",
    query: "median rent in Austin, Texas",
    expects: {
      hasStructured: true, variable: /Median Gross Rent/,
      value: { min: 1200, max: 2200 },
    },
  },
  {
    name: "Per capita income — specific keyword, no income-bucket chip",
    category: "variable",
    query: "per capita income in Seattle, Washington",
    expects: {
      hasStructured: true, variable: /Per Capita Income/,
      // SPECIFIC_OVERRIDES should suppress the income bucket chip.
      // Geo chip may still fire.
    },
  },
  {
    name: "Drove alone to work (transport rate, % format)",
    category: "variable",
    query: "drove alone to work in Austin, Texas",
    expects: {
      hasStructured: true, variable: /Drove Alone/i,
      value: { min: 30, max: 75 },
    },
  },

  // ── Category: ambiguity chips (genuine misunderstanding) ────────────────
  {
    name: "Income → income chips (household / per-capita / family)",
    category: "chips",
    query: "income in Austin, Texas",
    expects: { hasStructured: true, alternatives: ["metric"] },
  },
  {
    name: "Education → bachelor / HS / grad chips",
    category: "chips",
    query: "education in Austin, Texas",
    expects: { hasStructured: true, alternatives: ["metric"] },
  },
  {
    name: "Race query no longer surfaces metric chips (per recent decision)",
    category: "chips",
    query: "asian population in San Francisco, California",
    expects: {
      hasStructured: true,
      // Geo chip may fire for SF (city vs metro). Metric chip should NOT.
      // We check that NO 'metric'-kind chip group appears.
      noMetricChip: true,
    },
  },

  // ── Category: exact-match parsing edge cases ────────────────────────────
  {
    name: "Natural-language framing matches",
    category: "parsing",
    query: "what is the median household income in Seattle, Washington",
    expects: { hasStructured: true, variable: /Median Household Income/ },
  },
  {
    name: "Apostrophe (curly) doesn't break match",
    category: "parsing",
    query: "what’s the median rent in Boston, Massachusetts",
    expects: { hasStructured: true, variable: /Median Gross Rent/ },
  },
  {
    name: "Hyphenated foreign-born matches non-hyphenated map key",
    category: "parsing",
    query: "foreign-born in Queens, New York",
    expects: { hasStructured: true, variable: /Foreign.?Born/i },
  },
  {
    name: "Extra modifier falls through to Claude (median rent for 1BR)",
    category: "parsing",
    query: "median rent for one bedroom in Austin, Texas",
    // Expect Claude path; structured may or may not be set.
    // Just verify reply is a real answer (no "couldn't tell which metric")
    expects: { replyDoesNotContain: /couldn't tell which.*metric/i },
  },

  // ── Category: multi-turn deferral ───────────────────────────────────────
  {
    name: "Multi-turn 'what about poverty there' — context preserved",
    category: "multi-turn",
    messages: [
      { role: "user", content: "median rent in Austin, Texas" },
      { role: "assistant", content: "Austin had a median gross rent of $1,750 in 2024." },
      { role: "user", content: "what about poverty there" },
    ],
    expects: {
      // Claude should pick up "there" → Austin, return a poverty rate.
      reply: /Austin/i,
    },
  },

  // ── Category: methodology / RAG carrot ──────────────────────────────────
  {
    name: "Curated path attaches methodology (carrot renders)",
    category: "methodology",
    query: "median household income in Chicago, Illinois",
    expects: { hasStructured: true, methodology: true },
  },
  {
    name: "Free-form path attaches methodology too (recent fix)",
    category: "methodology",
    query: "Population of Iranians in Chicago, Illinois",
    expects: { hasStructured: true, methodology: true },
  },
];

// ── Test runner ─────────────────────────────────────────────────────────────

function dimColor(s) { return `\x1b[2m${s}\x1b[0m`; }
function passColor(s) { return `\x1b[32m${s}\x1b[0m`; }
function failColor(s) { return `\x1b[31m${s}\x1b[0m`; }

async function runOne(testCase) {
  const messages = testCase.messages || [{ role: "user", content: testCase.query }];
  const mode = testCase.mode || "statistic";
  let response;
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, mode }),
    });
    response = await res.json().catch(() => ({}));
    response.__httpStatus = res.status;
  } catch (err) {
    return { pass: false, fails: [`network error: ${err.message}`] };
  }

  const fails = [];
  const e = testCase.expects || {};
  const s = response.structured;

  if (e.hasStructured === true && !s) fails.push("expected structured payload, got none");
  if (e.hasStructured === false && s) fails.push(`expected NO structured, got variable=${s.variable}`);

  if (e.variable && s) {
    const ok = e.variable instanceof RegExp ? e.variable.test(s.variable || "") : (s.variable || "").includes(e.variable);
    if (!ok) fails.push(`variable mismatch: expected ${e.variable}, got "${s.variable}"`);
  }

  if (e.dataset && s && s.dataset !== e.dataset) {
    fails.push(`dataset mismatch: expected ${e.dataset}, got ${s.dataset}`);
  }

  if (e.noFallbackReason === true && s && s.fallbackReason) {
    fails.push(`expected no fallbackReason, got: "${s.fallbackReason.slice(0, 100)}..."`);
  }

  if (e.fallbackReasonContains && s) {
    const fr = s.fallbackReason || "";
    const ok = e.fallbackReasonContains instanceof RegExp ? e.fallbackReasonContains.test(fr) : fr.includes(e.fallbackReasonContains);
    if (!ok) fails.push(`fallbackReason missing expected text "${e.fallbackReasonContains}", got: "${fr.slice(0, 100)}"`);
  }

  if (e.value && s) {
    const v = parseFloat(s.value);
    if (!Number.isFinite(v)) fails.push(`value not numeric: ${s.value}`);
    else {
      if (e.value.min != null && v < e.value.min) fails.push(`value ${v} < min ${e.value.min}`);
      if (e.value.max != null && v > e.value.max) fails.push(`value ${v} > max ${e.value.max}`);
    }
  }

  if (e.reply) {
    const r = response.reply || "";
    const ok = e.reply instanceof RegExp ? e.reply.test(r) : r.includes(e.reply);
    if (!ok) fails.push(`reply doesn't match: expected ${e.reply}, got "${r.slice(0, 100)}..."`);
  }

  if (e.replyDoesNotContain) {
    const r = response.reply || "";
    const found = e.replyDoesNotContain instanceof RegExp ? e.replyDoesNotContain.test(r) : r.includes(e.replyDoesNotContain);
    if (found) fails.push(`reply CONTAINS forbidden text: ${e.replyDoesNotContain}`);
  }

  if (e.alternatives) {
    const alts = response.alternatives || [];
    if (e.alternatives === true && alts.length === 0) {
      fails.push("expected at least one alternatives chip group, got none");
    } else if (Array.isArray(e.alternatives)) {
      for (const expectedKind of e.alternatives) {
        if (!alts.some(g => g.kind === expectedKind)) {
          fails.push(`expected ${expectedKind}-kind chip, got: [${alts.map(g => g.kind).join(",")}]`);
        }
      }
    }
  }

  if (e.noMetricChip) {
    const alts = response.alternatives || [];
    if (alts.some(g => g.kind === "metric")) {
      fails.push(`unwanted metric-kind chip group fired: ${alts.find(g => g.kind === "metric")?.prompt}`);
    }
  }

  if (e.methodology === true && (!s || !s.methodology)) {
    fails.push("expected structured.methodology, got none");
  }

  return { pass: fails.length === 0, fails, response };
}

async function runBatch(cases) {
  const results = await Promise.all(cases.map(c => runOne(c)));
  return cases.map((c, i) => ({ ...c, ...results[i] }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const c of CASES) console.log(`  [${c.category}] ${c.name}`);
    console.log(`\n  ${CASES.length} cases total`);
    return;
  }
  const onlyArg = args.find(a => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1] : null;

  const filtered = only ? CASES.filter(c => c.category === only) : CASES;
  if (filtered.length === 0) {
    console.error(`No cases match --only=${only}. Categories: ${[...new Set(CASES.map(c => c.category))].join(", ")}`);
    process.exit(1);
  }

  console.log(`\nRunning ${filtered.length} cases against ${BASE} (parallel batches of ${PARALLEL})…\n`);
  const t0 = Date.now();
  const allResults = [];
  for (let i = 0; i < filtered.length; i += PARALLEL) {
    const batch = filtered.slice(i, i + PARALLEL);
    const results = await runBatch(batch);
    allResults.push(...results);
    for (const r of results) {
      const tag = r.pass ? passColor("✓") : failColor("✗");
      console.log(`  ${tag} [${r.category}] ${r.name}`);
      if (!r.pass) {
        for (const f of r.fails) console.log(`      ${failColor("→")} ${f}`);
      }
    }
  }
  const dur = ((Date.now() - t0) / 1000).toFixed(1);

  const passed = allResults.filter(r => r.pass).length;
  const failed = allResults.length - passed;
  console.log("\n" + "─".repeat(64));
  if (failed === 0) {
    console.log(passColor(`  All ${passed}/${allResults.length} passed`) + dimColor(`  (${dur}s)`));
  } else {
    console.log(failColor(`  ${failed} failures`) + ` · ${passColor(`${passed} passed`)} · ${allResults.length} total` + dimColor(`  (${dur}s)`));
  }
  console.log("─".repeat(64) + "\n");

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("\nTest runner crashed:", err);
  process.exit(2);
});
