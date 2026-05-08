// scripts/test-parse-variable.mjs — exhaustive unit tests for the exact-match
// parseVariableOnly() function. Run: node scripts/test-parse-variable.mjs
//
// Tests are grouped by category. Each row is [query, expectedVariableId|null, note].
// expectedVariableId === null means the query SHOULD fall through to Claude.

import { parseVariableOnly } from "../lib/censusTranslator.js";

const CASES = [
  // ── Group 1: bare metric, no location ─────────────────────────────────────
  ["population",                                   "B01003_001E", "bare keyword"],
  ["median rent",                                  "B25064_001E", "bare keyword (multi-word)"],
  ["asian population",                             "B03002_006E", "bare race query"],
  ["",                                             null,          "empty string"],
  ["   ",                                          null,          "only whitespace"],
  ["???",                                          null,          "punctuation only"],

  // ── Group 2: natural-language framing (stopword stripping) ────────────────
  ["what is the population in austin",             "B01003_001E", "what-is-the framing"],
  ["what's the median rent in chicago",            "B25064_001E", "contracted what's"],
  ["show me the median rent in austin",            "B25064_001E", "show-me framing"],
  ["tell me about poverty in detroit",             "B17001_002E", "tell-me-about framing"],
  ["i would like to see the population in seattle","B01003_001E", "verbose framing"],
  ["give me the median income in nashville",       "B19013_001E", "give-me framing"],

  // ── Group 3: capitalization & whitespace normalization ────────────────────
  ["MEDIAN RENT in Austin",                        "B25064_001E", "all caps metric"],
  ["Median Rent in Austin",                        "B25064_001E", "title case"],
  ["  median   rent   in austin  ",                "B25064_001E", "extra whitespace"],
  ["MEDIAN RENT IN AUSTIN",                        "B25064_001E", "all caps everything"],

  // ── Group 4: token-order independence (set-equality semantics) ────────────
  ["rent median in austin",                        "B25064_001E", "reversed order"],
  ["income median household in austin",            "B19013_001E", "scrambled compound"],
  ["alone asian in san mateo",                     "B02001_005E", "scrambled 'asian alone'"],

  // ── Group 5: race / ethnicity ─────────────────────────────────────────────
  ["asian in san mateo",                           "B03002_006E", "race alone"],
  ["asian population in san mateo",                "B03002_006E", "race + 'population'"],
  ["non-hispanic asian in san mateo",              "B03002_006E", "explicit non-hispanic"],
  ["asian alone in san mateo",                     "B02001_005E", "any-ethnicity variant"],
  ["black population in oakland",                  "B03002_004E", "black"],
  ["african american in oakland",                  "B03002_004E", "african american alias"],
  ["white population in dallas",                   "B03002_003E", "white"],
  ["hispanic in los angeles",                      "B03002_012E", "hispanic"],
  ["latino population in los angeles",             "B03002_012E", "latino alias"],
  ["native american in tulsa",                     "B03002_005E", "native american"],
  ["pacific islander in honolulu",                 "B03002_007E", "NHPI"],
  ["multiracial in seattle",                       "B03002_009E", "two or more races"],

  // ── Group 6: queries that MUST fall through (extra modifier) ──────────────
  ["asian population growth in san mateo",         null, "extra word 'growth'"],
  ["asian household income in san mateo",          null, "extra word 'household'"],
  ["young asian population in san mateo",          null, "extra word 'young'"],
  ["population density in detroit",                null, "extra word 'density'"],
  ["median rent for one bedroom in austin",        null, "extra '_one bedroom_'"],
  ["non-hispanic asian children in san mateo",     null, "extra word 'children'"],
  ["renter occupied housing units in dallas",      null, "untracked specific phrase"],

  // ── Group 7: "in" appearing inside the metric phrase ──────────────────────
  ["median income in the past 12 months",          "B19013_001E", "'in' inside long-form metric (geo half is bogus, fast path will fail later)"],

  // ── Group 8: queries with no location at all ──────────────────────────────
  ["median rent",                                  "B25064_001E", "no ' in ' separator"],
  ["asian alone",                                  "B02001_005E", "race alone, no geo"],

  // ── Group 9: stopword-only or empty content ──────────────────────────────
  ["what is in austin",                            null, "no content tokens"],
  ["the in chicago",                               null, "stopwords only"],
  ["in austin",                                    null, "starts with ' in '"],
  ["show me in dallas",                            null, "stopwords-only metric phrase"],

  // ── Group 10: transportation modes ────────────────────────────────────────
  ["drove alone to work in austin",                "B08301_003E", "drive alone"],
  ["carpool in austin",                            "B08301_004E", "carpool"],
  ["public transit in new york",                   "B08301_010E", "public transit"],
  ["public transportation in new york",            "B08301_010E", "synonym"],
  ["walked to work in boston",                     "B08301_019E", "walking"],
  ["bicycled to work in portland",                 "B08301_018E", "biking"],
  ["worked from home in seattle",                  "B08301_021E", "WFH"],
  ["work from home in seattle",                    "B08301_021E", "WFH alt phrasing"],

  // ── Group 11: housing ─────────────────────────────────────────────────────
  ["vacancy rate in detroit",                      "B25002_003E", "vacancy"],
  ["homeownership rate in chicago",                "B25003_002E", "ownership"],
  ["homeownership in chicago",                     "B25003_002E", "ownership short"],
  ["rent burden in los angeles",                   "B25071_001E", "rent burden"],
  ["median home value in san francisco",           "B25077_001E", "home value"],

  // ── Group 12: education levels ────────────────────────────────────────────
  ["bachelor's degree in austin",                  "B15003_022E", "bachelor's apostrophe"],
  ["master's degree in austin",                    "B15003_023E", "master's apostrophe"],
  ["associate's degree in austin",                 "B15003_021E", "associate's"],
  ["doctorate in austin",                          "B15003_025E", "doctorate"],
  ["high school graduation in detroit",            "B15003_017E", "HS grad"],

  // ── Group 13: foreign-born / citizenship / vets ───────────────────────────
  ["foreign-born in queens",                       "B05002_013E", "hyphenated"],
  ["foreign born population in queens",            "B05002_013E", "no hyphen, 'population' keyword"],
  ["naturalized citizen in queens",                "B05001_005E", "naturalized"],
  ["non-citizen in los angeles",                   "B05001_006E", "non-citizen"],
  ["veterans in austin",                           "B21001_002E", "veterans plural"],
  ["veteran population in austin",                 "B21001_002E", "veteran population alias"],

  // ── Group 14: long-tail / boundary ────────────────────────────────────────
  ["gini index in san francisco",                  "B19083_001E", "gini"],
  ["income inequality in san francisco",           "B19083_001E", "gini synonym"],
  ["median earnings in austin",                    "B20002_001E", "earnings"],
  ["earnings in austin",                           "B20002_001E", "earnings alone"],

  // ── Group 15: longer-keyword-wins precedence ──────────────────────────────
  ["median household income in austin",            "B19013_001E", "specific income variant"],
  ["per capita income in austin",                  "B19301_001E", "per capita"],
  ["family income in austin",                      "B19113_001E", "family income"],
  ["median family income in austin",               "B19113_001E", "median family income"],

  // ── Group 16: Unicode punctuation & typography ────────────────────────────
  ["what’s the median rent in austin",        "B25064_001E", "curly apostrophe (right single quote)"],
  ["it’s the population in austin",           "B01003_001E", "curly apostrophe in 'it's'"],
  ["median rent — in austin",                 "B25064_001E", "em dash between metric and ' in '"],
  ["median rent – austin",                    null,          "en dash separator (no ' in ' boundary present)"],

  // ── Group 17: trailing / leading punctuation ──────────────────────────────
  ["median rent in austin?",                       "B25064_001E", "trailing question mark on location"],
  ["MEDIAN RENT IN AUSTIN!",                       "B25064_001E", "trailing exclamation"],
  ["what is the median rent in austin.",           "B25064_001E", "trailing period"],
  ["...median rent in austin",                     "B25064_001E", "leading ellipsis"],
  ["...median rent in austin...",                  "B25064_001E", "wrapping ellipses"],

  // ── Group 18: incomplete / malformed location ─────────────────────────────
  ["median rent in",                               "B25064_001E", "no location after 'in' (parser handles geo-fail downstream)"],
  ["median rent in ",                              "B25064_001E", "trailing space after 'in'"],
  ["median rent in   ",                            "B25064_001E", "trailing whitespace"],

  // ── Group 19: numbers / dates / quantifiers in metric ─────────────────────
  ["2024 population in austin",                    null,          "year prefix turns it into multi-token (no '2024 population' key)"],
  ["population 2024 in austin",                    null,          "year suffix in metric"],
  ["top 10 median income in austin",               null,          "extra modifiers"],
  ["approximate median rent in austin",            null,          "untracked qualifier 'approximate'"],

  // ── Group 20: plurals / morphology limits ─────────────────────────────────
  ["populations in detroit",                       null,          "plural of 'population' — morphology not handled"],
  ["renters in austin",                            null,          "plural form not in map"],
  ["incomes in chicago",                           null,          "plural of 'income' not in map"],
  ["asian populations in san mateo",               null,          "plural 'populations' breaks match"],

  // ── Group 21: queries Claude should clearly handle (long-tail topics) ─────
  ["language spoken at home in queens",            null,          "ACS topic not in curated list"],
  ["children under 18 in detroit",                 null,          "demographic slice not in curated list"],
  ["households with food stamps in detroit",       null,          "SNAP/food stamps not in curated list"],
  ["households without internet in jackson",       null,          "internet access not in curated list"],

  // ── Group 22: garbage / abusive input ─────────────────────────────────────
  ["asdfqwer in austin",                           null,          "random gibberish metric"],
  ["!@#$%^&*() in austin",                         null,          "punctuation noise"],
  ["a a a a in austin",                            null,          "stopword-only metric phrase"],
  ["in in in in austin",                           null,          "all-stopword phrase"],
  ["...",                                          null,          "punctuation only"],
  ["x",                                            null,          "single-letter input"],

  // ── Group 23: mixed-case race entries ─────────────────────────────────────
  ["Asian Alone in San Mateo",                     "B02001_005E", "title case 'Asian Alone'"],
  ["NON-HISPANIC ASIAN in San Mateo",              "B03002_006E", "all-caps non-hispanic asian"],
  ["African American in Detroit",                  "B03002_004E", "title case african american"],
  ["NATIVE AMERICAN in Tulsa",                     "B03002_005E", "all-caps native american"],

  // ── Group 24: ambiguity between bare race keyword and "<race> alone" ──────
  ["asian in san mateo",                           "B03002_006E", "bare 'asian' → non-Hispanic default"],
  ["asian alone in san mateo",                     "B02001_005E", "explicit 'asian alone' → any-ethnicity variant"],
  ["white in dallas",                              "B03002_003E", "bare 'white' → non-Hispanic default"],
  ["white alone in dallas",                        "B02001_002E", "explicit 'white alone' → any-ethnicity variant"],
];

let pass = 0, fail = 0;
const failures = [];

for (const [q, expectedId, note] of CASES) {
  const r = parseVariableOnly(q);
  const got = r?.id ?? null;
  const ok = got === expectedId;
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push({ q, expected: expectedId, got: r ? `${r.id} (${r.label})` : "null", note });
  }
}

const banner = (s) => `\n${"━".repeat(64)}\n${s}\n${"━".repeat(64)}`;
console.log(banner(`parseVariableOnly: ${pass}/${pass + fail} passed`));

if (failures.length > 0) {
  console.log(`\nFAILURES:\n`);
  for (const f of failures) {
    console.log(`  query:    ${JSON.stringify(f.q)}`);
    console.log(`  note:     ${f.note}`);
    console.log(`  expected: ${f.expected ?? "null (fall-through)"}`);
    console.log(`  got:      ${f.got}`);
    console.log("");
  }
  process.exit(1);
}

console.log(`\nAll edge cases pass.\n`);
