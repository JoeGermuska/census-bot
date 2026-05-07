// pages/api/chat.js
// Server-side Claude chatbot endpoint with Census API tool use.
// ANTHROPIC_API_KEY is read from .env.local — never exposed to the browser.

import Anthropic from "@anthropic-ai/sdk";
import { parseQuery, parseVariableOnly, formatValue, detectAmbiguousMetric, STATE_FIPS } from "../../lib/censusTranslator";
import { fetchCensusValue, fetchCensusValueWithFallback } from "../../lib/censusApi";
import { QUERY_TYPES, CURRENT_ACS_YEAR } from "../../lib/censusConstants";
import { computeRateIfNeeded, getRateDenominator } from "../../lib/censusRates";
import { validateValue } from "../../lib/validateCensusData";
import { findGeoCandidates, findZctaByZip, extractGeoPhrase, describeCandidate, geoParamsFromCandidate, candidateLabel } from "../../lib/geoCandidates";
import { searchAcsDocs } from "../../lib/acsRag";
import { buildNuanceBanners, buildMethodologyQuery } from "../../lib/acsNuances";
import fs from "fs";
import path from "path";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const LOOP_TIMEOUT_MS = 25_000; // 25s total budget for the agentic loop
// Warn if system prompt exceeds this many chars (~30k tokens ≈ 120k chars)
const SYSTEM_PROMPT_WARN_CHARS = 80_000;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Skill loader — cached at module level so files are only read once per cold start ──
const SKILLS_DIR = path.join(process.cwd(), "skills");

const _skillCache = new Map();

function readSkillCached(filePath) {
  if (_skillCache.has(filePath)) return _skillCache.get(filePath);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    _skillCache.set(filePath, content);
    return content;
  } catch {
    _skillCache.set(filePath, ""); // cache miss so we don't retry on every request
    return "";
  }
}

// Always-on skills — loaded on every request
const ALWAYS_ON_FILES = [
  path.join(SKILLS_DIR, "acs-general", "ACS_SKILL.md"),
  path.join(SKILLS_DIR, "humanize", "Humanize_SKILL.md"),
];

function loadAlwaysOnSkills() {
  return ALWAYS_ON_FILES.map(readSkillCached).filter(Boolean);
}

// Conditional skills — loaded only when the message matches keywords
const CONDITIONAL_SKILLS = [
  {
    file: path.join(SKILLS_DIR, "acs-data-interpreter", "SKILL.md"),
    keywords: ["interpret", "margin of error", "moe", "sentinel", "inflation", "adjust", "percent", "rate", "burden", "cpi", "universe", "mean", "median", "average", "unreliable", "suppressed"],
  },
  {
    file: path.join(SKILLS_DIR, "acs-geography", "SKILL.md"),
    keywords: ["county", "tract", "zip", "zcta", "metro", "cbsa", "fips", "geography", "place", "state", "nation", "nationwide", "region"],
  },
  {
    file: path.join(SKILLS_DIR, "acs-table-selector", "SKILL.md"),
    keywords: ["table", "variable", "b19013", "b25064", "b25070", "b07", "which table", "what table", "acs table", "dataset"],
  },
  {
    file: path.join(SKILLS_DIR, "acs-housing-migration", "SKILL.md"),
    keywords: ["migrat", "mov", "california", "left", "relocat", "out-migrant", "housing cost", "afford", "rent burden", "where people"],
  },
  {
    file: path.join(SKILLS_DIR, "acs-api-builder", "SKILL.md"),
    keywords: ["api", "url", "endpoint", "fetch", "request", "query string", "build", "construct", "http"],
  },
  {
    file: path.join(SKILLS_DIR, "acs-variable-definitions", "SKILL.md"),
    keywords: ["rate", "percent", "poverty", "unemployment", "unemployed", "commute", "travel time", "education", "bachelor"],
  },
  {
    file: path.join(SKILLS_DIR, "acs-temporal-caveats", "SKILL.md"),
    keywords: ["trend", "over time", "change", "since", "compared to", "grew", "growth", "decline", "increase", "decrease", "historical", "year", "years", "2010", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "boundary", "annex", "tract", "zcta", "zip", "metro area", "cbsa", "before and after", "pre-covid", "post-covid", "race", "multiracial"],
  },
];

function loadConditionalSkills(userMessage) {
  const lower = userMessage.toLowerCase();
  const loaded = [];
  for (const skill of CONDITIONAL_SKILLS) {
    if (skill.keywords.some(kw => lower.includes(kw))) {
      const content = readSkillCached(skill.file);
      if (content) loaded.push(content);
    }
  }
  return loaded;
}

// Tool definition — Claude calls this to look up live Census data
const CENSUS_TOOL = {
  name: "lookup_census_data",
  description:
    "Look up a live U.S. Census ACS statistic for a specific city and state. " +
    "Use this whenever the user asks for a specific metric about a real place. " +
    `Available metrics: ${QUERY_TYPES.join(", ")}.`,
  input_schema: {
    type: "object",
    properties: {
      metric: {
        type: "string",
        enum: QUERY_TYPES,
        description: `The data metric to look up. Must be one of: ${QUERY_TYPES.join(", ")}.`,
      },
      city: {
        type: "string",
        description: "The city name, e.g. 'Chicago'.",
      },
      state: {
        type: "string",
        description: "The full state name, e.g. 'Illinois'.",
      },
    },
    required: ["metric", "city", "state"],
  },
};

const TREND_TOOL = {
  name: "get_census_trend",
  description: "Fetch multi-year Census ACS time series data for a city/state. Use for graphs or trends.",
  input_schema: {
    type: "object",
    properties: {
      city: { type: "string" },
      state: { type: "string" },
      metric: { type: "string" },
      startYear: { type: "number" },
      endYear: { type: "number" },
    },
    required: ["city", "state", "startYear", "endYear"],
  },
};

// RAG search over the indexed ACS source documents. Used when the user asks
// about ACS concepts, methodology, definitions, MOEs, table contents, etc.
const ACS_DOCS_TOOL = {
  name: "search_acs_docs",
  description:
    "Search the indexed corpus of official ACS documentation (Census Bureau handbooks, " +
    "the Design and Methodology Report, the Subject Definitions, and the 'Why we ask " +
    "each question' topic pages). Use this whenever the user asks ABOUT the ACS itself " +
    "— what a concept means, how a number is computed, how MOEs work, what a table " +
    "covers, what counts as a household, why the survey asks a given question, " +
    "differences between 1-year and 5-year estimates, etc. Do NOT use it for fetching " +
    "specific numbers about a place — use lookup_census_data or get_census_trend for that.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural-language search query — what to look up in the docs.",
      },
      top_k: {
        type: "number",
        description: "Max passages to return. Defaults to 5; cap at 8.",
      },
    },
    required: ["query"],
  },
};

const TREND_ROUTE_KEYWORDS = [
  "trend",
  "over time",
  "change",
  "graph",
  "chart",
  "visualization",
  "historical",
  "compare",
  "comparison",
  "since",
  "increase",
  "decrease",
];

const BASE_SYSTEM_PROMPT = `You are a knowledgeable U.S. Census data assistant built into CensusBot.
You help users understand American Community Survey (ACS) data — income, rent, population, poverty rates, employment, age, and commute times for U.S. cities.

You have access to a live Census data lookup tool. Use it proactively when a user asks about specific metrics for a city/state — don't describe what you could look up, just call the tool and return the real number.

Available metrics: ${QUERY_TYPES.join(", ")}.

CRITICAL TOOL RULES:
- You MUST use lookup_census_data ONLY for single-year statistics.
- If the user requests ANY of the following:
  - trends
  - changes over time
  - graphs
  - historical comparisons
  - multi-year analysis
  YOU MUST NOT attempt to answer using single-year data.
  Instead, you MUST explicitly say:
  "This requires time-series data. I will use the trend tool."
- NEVER suggest Census API URLs, variables, tables, or methodology unless it comes directly from tool output.
- NEVER guess ACS tables or variables.
- NEVER describe how to fetch data externally.

CRITICAL VISUALIZATION OUTPUT RULES:
- For graph/chart/trend/change-over-time/historical-comparison/visualization requests, you MUST call get_census_trend.
- For comparisons (e.g. "compare Austin and Dallas"), call get_census_trend ONCE PER CITY in parallel — the server combines them into a multi-line chart automatically.
- The server constructs the final chart JSON from tool results. Your job is only to make the right tool calls; do not hand-author chart JSON.
- Do NOT include any explanation text with chart JSON.
- Do NOT output CSV.
- Do NOT output markdown tables.
- Do NOT suggest external tools.
- Do NOT describe graphing steps.
- Do NOT mention Recharts, Excel, or Sheets.
- Do NOT output raw Census variable IDs unless explicitly asked.

If no tool data is available:
- DO NOT guess datasets
- DO NOT suggest tables (B17001, etc.)
- DO NOT construct API URLs
- For chart/trend requests, respond ONLY:
  {"type":"error","message":"Unable to generate chart data."}
- For non-chart requests, respond:
  "I don’t have time-series Census access for that request yet."

DOCUMENTATION QUESTIONS (concepts, methodology, definitions):
When the user asks about WHAT something means, HOW the ACS measures it, MOEs,
1-year vs 5-year differences, what a table covers, who is included in a
universe, etc. — call search_acs_docs FIRST, then answer using the returned
passages.

When citing search_acs_docs results, do this exactly:
- Weave numbered markers like [1], [2] into prose right after the claim they support.
- The numbers MUST match the 'index' field on each passage you used.
- After your prose, on a new line, write the literal token "Sources:" followed
  by one line per cited source in this exact format:
    [N] <chunk_id>
  where chunk_id is the 'chunk_id' field from the tool result. Example:
    Sources:
    [1] subject-definitions__p41__0
    [2] handbook-general__p18__2
- Do NOT include the doc title or page number on the Sources lines — the UI
  resolves those from chunk_id. Just "[N] chunk_id".
- Only cite passages you actually used. Don't pad with unused results.
- If search_acs_docs returns an error or zero passages, answer from general
  knowledge without citations and don't fabricate a Sources block.

Formatting rules (strictly follow these):
- This is a chat UI. Never use --- dividers, ## headers, or ### headers.
- Use **bold** only for key numbers or metric names. No bold mid-sentence for decoration.
- Use plain line breaks between points. Short bullet lists are fine for multiple items.
- Keep responses tight: 2–4 sentences max for single-metric answers. No preamble, no sign-off.
- Lead with the number, then one sentence of context if useful. That's it.
- Don't make up numbers — always use the tool for specific statistics.
- If a metric or location isn't supported, say so in one sentence and suggest the closest option.
- If a tool call returns an error, do NOT retry it. Respond exactly: "I don’t have time-series Census access for that request yet."`;

// ── Mode-specific skill routing ─────────────────────────────────────────────
const MODE_SKILLS = {
  learn: [
    // Educational mode: general ACS knowledge, data interpretation
    path.join(SKILLS_DIR, "acs-data-interpreter", "SKILL.md"),
    path.join(SKILLS_DIR, "acs-table-selector", "SKILL.md"),
  ],
  statistic: [
    // Data lookup mode: geography, interpretation, conditional by keywords
    path.join(SKILLS_DIR, "acs-data-interpreter", "SKILL.md"),
    path.join(SKILLS_DIR, "acs-geography", "SKILL.md"),
  ],
  visualize: [
    // Visualization mode: data interpretation + table selection + react chart contract
    path.join(SKILLS_DIR, "acs-react-chart", "SKILL.md"),
    path.join(SKILLS_DIR, "acs-data-interpreter", "SKILL.md"),
    path.join(SKILLS_DIR, "acs-geography", "SKILL.md"),
    path.join(SKILLS_DIR, "acs-temporal-caveats", "SKILL.md"),
  ],
};

const MODE_PROMPTS = {
  learn: `\nMode: LEARN. The user wants to understand ACS data concepts. Focus on clear explanations. Use the tool only if they ask about a specific place. Prefer plain-language teaching over raw numbers.`,
  statistic: `\nMode: FIND STATISTIC. The user wants a specific number. Use the lookup tool immediately when they provide a metric and place. Only report data returned by tools. Never add ACS table IDs, variable IDs, URL instructions, or methodology unless explicitly present in tool output.`,
  visualize: `\nMode: VISUALIZATION. The user wants chart/visualization help. For multi-year or trend requests, call the trend tool and return chart-ready data. Never provide external API instructions, ACS table guesses, or variable guesses.`,
};

function buildSystemPrompt(userMessage, mode, forceTrendRouting = false) {
  const alwaysOn = loadAlwaysOnSkills();

  // Load mode-specific skills
  const modeFiles = MODE_SKILLS[mode] || MODE_SKILLS.statistic;
  const modeSkills = modeFiles.map(readSkillCached).filter(Boolean);

  // Also load keyword-conditional skills
  const conditional = loadConditionalSkills(userMessage);

  // Deduplicate (mode skills may overlap with conditional)
  const allSkills = [...new Set([...modeSkills, ...conditional])];

  const parts = [BASE_SYSTEM_PROMPT + (MODE_PROMPTS[mode] || "")];
  if (forceTrendRouting) {
    parts.push(
      "User request requires time-series analysis.\n" +
      "You MUST use the /api/trend endpoint via tool routing.\n" +
      "Do not attempt single-year lookup."
    );
  }
  if (alwaysOn.length > 0) parts.push("---\n" + alwaysOn.join("\n\n---\n"));
  if (allSkills.length > 0) parts.push("---\n" + allSkills.join("\n\n---\n"));
  const prompt = parts.join("\n\n");

  if (prompt.length > SYSTEM_PROMPT_WARN_CHARS) {
    console.warn(
      `[chat] System prompt is large (${prompt.length} chars / ~${Math.round(prompt.length / 4)} tokens). ` +
      "Consider trimming skills to avoid hitting context limits."
    );
  }

  return prompt;
}

// Run the ACS documentation search tool. Returns either a passages array or
// an error object — both are valid Claude tool_result payloads.
async function runAcsDocsTool(toolInput) {
  const query = typeof toolInput?.query === "string" ? toolInput.query.trim() : "";
  const topK = Number.isFinite(toolInput?.top_k)
    ? Math.min(8, Math.max(1, toolInput.top_k))
    : 5;
  if (!query) return { error: "search_acs_docs: missing 'query'." };
  try {
    const { results } = await searchAcsDocs(query, { topK });
    if (results.length === 0) {
      return { passages: [], note: "No matching passages found in the indexed ACS docs." };
    }
    // Return a compact form Claude can cite. Truncate text to keep tool_result tokens reasonable.
    return {
      passages: results.map((r, i) => ({
        index: i + 1, // 1-based — matches the [N] citation form
        chunk_id: r.chunk_id,
        doc_title: r.doc_title,
        doc_kind: r.doc_kind,
        page: r.page,
        text: r.text.length > 1200 ? r.text.slice(0, 1200) + "…" : r.text,
        score: Number(r.score.toFixed(3)),
      })),
    };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/index not found/i.test(msg)) {
      return { error: "ACS docs index has not been built yet. Answer from general knowledge without citations." };
    }
    return { error: `search_acs_docs failed: ${msg}` };
  }
}

async function runCensusTool(toolInput) {
  const { metric, city, state } = toolInput;
  const query = `${metric} in ${city}, ${state}`;

  const censusApiKey = process.env.CENSUS_API_KEY;
  if (!censusApiKey) {
    return { error: "Census API key not configured on server." };
  }

  try {
    const parsed = parseQuery(query);
    if (parsed.error) return { error: parsed.error };

    const { variable, geoParams, locationLabel } = parsed;
    const rawValue = await fetchCensusValue(variable.id, geoParams, censusApiKey);

    const rateResult = await computeRateIfNeeded(variable.id, rawValue, geoParams, censusApiKey);
    const formattedValue = rateResult
      ? formatValue(rateResult.value, rateResult.format)
      : formatValue(rawValue, variable.format);

    return {
      metric: variable.label,
      value: formattedValue,
      location: locationLabel,
      source: `ACS 5-Year Estimates (${CURRENT_ACS_YEAR}), U.S. Census Bureau`,
    };
  } catch (err) {
    // Ensure the error message is always a plain string — avoids JSON.stringify issues
    return { error: String(err?.message || "Failed to fetch Census data.") };
  }
}

function needsTrendRouting(text) {
  const lower = String(text || "").toLowerCase();
  return TREND_ROUTE_KEYWORDS.some((kw) => lower.includes(kw));
}

async function runTrendTool(req, toolInput) {
  const { city, state, metric, startYear, endYear } = toolInput || {};

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const baseUrl = host ? `${proto}://${host}` : "http://localhost:3000";

  try {
    const response = await fetch(`${baseUrl}/api/trend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city, state, metric, startYear, endYear }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { error: data?.error || "Trend endpoint returned an error." };
    }

    if (!Array.isArray(data)) {
      return { error: "Trend endpoint returned invalid response format." };
    }

    return data;
  } catch (err) {
    return { error: String(err?.message || "Failed to fetch trend data.") };
  }
}

function getLatestUserMessage(messages) {
  return messages
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .slice(-1)[0]?.content || "";
}

function toTitleCase(text) {
  return String(text || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function inferTrendMetricLabel(userMessage) {
  const text = String(userMessage || "").trim();
  if (!text) return "Trend";

  const parsed = parseQuery(text);
  if (!parsed?.error && parsed.variable?.label) {
    return parsed.variable.label;
  }

  const lower = text.toLowerCase();
  const keywordMatch = QUERY_TYPES.find((metric) => lower.includes(metric.toLowerCase()));
  if (keywordMatch) {
    return toTitleCase(keywordMatch);
  }

  return "Trend";
}

function buildTrendChartPayload(trendSeries, metricLabel) {
  // trendSeries: [{ label, points: [{year, numericValue}] }]
  const allYears = trendSeries.flatMap((s) => s.points.map((p) => p.year));
  const yearRange = allYears.length
    ? `${Math.min(...allYears)}–${Math.max(...allYears)}`
    : "";

  return {
    type: "trend_chart",
    chartType: trendSeries.length > 1 ? "multi_line" : "line",
    metric: metricLabel || "Trend",
    location: trendSeries.map((s) => s.label).join(" vs "),
    series: trendSeries.map((s) => ({
      label: s.label,
      points: s.points.map((p) => ({
        year: Number(p.year),
        numericValue: Number(p.numericValue),
      })),
    })),
    source: yearRange
      ? `U.S. Census Bureau ACS 5-Year Estimates (${yearRange})`
      : "U.S. Census Bureau ACS 5-Year Estimates",
  };
}

function chartErrorPayload() {
  return {
    type: "error",
    message: "Unable to generate chart data.",
  };
}

// ── Statistic mode fast path (no agentic loop) ──────────────────────────────

const PERCENT_VARIABLES = new Set([
  "B17001_002E", "B23025_005E", "B08136_001E",
  "B15003_022E", "B15003_017E", "B15003_025E",
  "B23025_004E", "B23025_002E",
]);

function needsVerification(numericValue, variableId, validationFailed) {
  return numericValue > 1_000_000 || validationFailed || PERCENT_VARIABLES.has(variableId);
}

function buildDeterministicSentence(place, variable, numericValue, format, year) {
  const formatted = formatValue(numericValue, format);
  return `${place} had a ${variable.toLowerCase()} of ${formatted} in ${year}.`;
}

// "B19013_001E" → "B19013"
function tableIdOf(variableId) {
  return String(variableId || "").split("_")[0];
}

// Build the source-link payload for a given primary variable. Includes the
// denominator's table when it differs from the numerator's (e.g. mean commute,
// where B08136 / B08303 come from two different tables).
function buildSourceTables(variableId) {
  const tables = new Set([tableIdOf(variableId)]);
  const denom = getRateDenominator(variableId);
  if (denom) tables.add(tableIdOf(denom));
  return Array.from(tables).map((tableId) => ({
    tableId,
    url: `https://censusreporter.org/tables/${tableId}/`,
  }));
}

// Friendly label for the dataset used: "ACS 2024 1-Year Estimates" or
// "ACS 2020–2024 5-Year Estimates".
function buildSourceLabel(dataset, year) {
  const yr = Number(year);
  if (dataset === "acs1") return `ACS ${yr} 1-Year Estimates`;
  return `ACS ${yr - 4}–${yr} 5-Year Estimates`;
}

// Census API path for a dataset key, mapped from our short name.
function datasetPath(dataset) {
  return dataset === "acs1" ? "acs/acs1" : "acs/acs5";
}

// Minimum BM25 score for a RAG passage to be considered "good enough" to
// surface as the variable's methodology citation. Below this, we skip rather
// than include a weak match that would confuse the user.
const RAG_METHODOLOGY_MIN_SCORE = 1.0;
const RAG_METHODOLOGY_MAX_CHARS = 600;

// Truncate at a sentence boundary near the budget so the snippet doesn't
// end mid-thought.
function truncateAtSentence(text, maxChars) {
  const s = String(text || "");
  if (s.length <= maxChars) return s;
  const window = s.slice(0, maxChars);
  const lastDot = window.lastIndexOf(". ");
  if (lastDot > maxChars * 0.6) return window.slice(0, lastDot + 1);
  return window.replace(/\s+\S*$/, "") + "…";
}

// Augment a structured stat payload with deterministic nuance banners and
// (best-effort) a RAG-fetched methodology passage. Mutates and returns
// `structured` for convenience. Never throws — RAG failures degrade silently.
async function attachNuancesAndMethodology(structured, variableId) {
  if (!structured) return structured;
  // Make sure the raw variableId is present so banner rules can read it.
  if (variableId && !structured.variableId) structured.variableId = variableId;

  structured.nuances = buildNuanceBanners(structured);

  try {
    const query = buildMethodologyQuery(variableId, structured.variable);
    const { results } = await searchAcsDocs(query, { topK: 1 });
    const top = results?.[0];
    if (top && top.score >= RAG_METHODOLOGY_MIN_SCORE) {
      structured.methodology = {
        text: truncateAtSentence(top.text, RAG_METHODOLOGY_MAX_CHARS),
        doc_title: top.doc_title,
        doc_url: top.doc_url,
        page: top.page,
        chunk_id: top.chunk_id,
      };
    }
  } catch {
    // RAG miss → no methodology block, banners still render.
  }

  return structured;
}

// True when the user's geo phrase looks like a "zip NNNNN" reference
// (so we should give a ZIP-specific message rather than the general one).
function isZipQuirk(geoPhrase) {
  if (!geoPhrase?.name) return false;
  return /^(zip|zcta)\s+\d{5}$/i.test(geoPhrase.name.trim()) ||
         /^\d{5}$/.test(geoPhrase.name.trim());
}

// Friendly prompt shown when a user's location doesn't match any ACS geography.
function buildAcsQuirkPrompt(geoPhrase) {
  if (isZipQuirk(geoPhrase)) {
    const zip = (geoPhrase.name.match(/\d{5}/) || [])[0] || geoPhrase.name;
    return [
      `**ZIP ${zip}** isn't published as a ZCTA in ACS data.`,
      ``,
      `This usually happens for ZIPs that are single-organization codes (P.O. boxes or company-internal mail like GE's 12345 in Schenectady). The Census Bureau only tabulates residential ZCTAs.`,
      ``,
      `Try a residential ZIP nearby, or use the city or county name instead.`,
    ].join("\n");
  }
  const where = geoPhrase.state ? `${geoPhrase.name}, ${geoPhrase.state}` : geoPhrase.name;
  const stateClause = geoPhrase.state || "<state>";
  return [
    `I couldn't find ACS data for **"${where}"**.`,
    ``,
    `The Census Bureau publishes ACS data for:`,
    `- Cities or towns — try **"${geoPhrase.name}, ${stateClause}"**`,
    `- Counties — try **"${geoPhrase.name} County, ${stateClause}"**`,
    `- Metro areas — try **"${geoPhrase.name} metro"**`,
    `- ZIP codes — try **"in zip 12345"**`,
    `- States — try just the state name`,
    ``,
    `Reword your question with one of those formats and I'll try again.`,
  ].join("\n");
}

// Prompt shown when the user mentioned a place ACS knows but a metric ACS doesn't.
function buildMetricNotRecognizedPrompt() {
  return [
    `I couldn't tell which ACS metric you're asking about.`,
    ``,
    `Supported metrics: population, median household income, per capita income, median family income, median rent, median home value, total housing units, median age, mean travel time, poverty rate, unemployment rate, employment rate, labor force participation, bachelor's degree, high school graduation rate, graduate degree.`,
    ``,
    `Try rephrasing with one of those.`,
  ].join("\n");
}

async function verifySentence(numericValue, sentence) {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 10,
      system: `Reply "yes" or "no" only.`,
      messages: [{
        role: "user",
        content: `Value: ${numericValue}\nSentence: "${sentence}"\nDoes the sentence accurately reflect the value?`,
      }],
    });
    const text = response.content.find(b => b.type === "text")?.text?.trim().toLowerCase() || "yes";
    return text.startsWith("yes");
  } catch {
    return true; // assume ok on failure — don't block response
  }
}

// Direct lookup when the user has an explicit geo (picked or auto-defaulted).
// Bypasses parseQuery's geo logic — uses FIPS codes from the candidate object directly.
// Returns { reply, structured } | { error } | null (null = caller should fall back).
async function performPickedLookup({ pickedGeo, pickedMetric, userMsg }) {
  const censusApiKey = process.env.CENSUS_API_KEY;
  if (!censusApiKey) {
    return { error: "Server configuration error: missing Census API key." };
  }

  // Resolve the metric: prefer pickedMetric, else parse from userMsg.
  // Use parseVariableOnly so we don't reject the message just because the
  // geo phrase isn't a city/state (e.g. ZCTA queries: "in zip 90210").
  let variable;
  if (pickedMetric?.variableId && pickedMetric?.label && pickedMetric?.format) {
    variable = {
      id: pickedMetric.variableId,
      label: pickedMetric.label,
      format: pickedMetric.format,
    };
  } else {
    const v = parseVariableOnly(userMsg);
    if (!v) return null; // no recognizable metric — fall through
    variable = v;
  }

  // Resolve the geo: prefer pickedGeo, else fall through
  let geoParams, locationLabel;
  if (pickedGeo) {
    geoParams = geoParamsFromCandidate(pickedGeo);
    if (!geoParams) return null;
    locationLabel = candidateLabel(pickedGeo);
  } else {
    const parsed = parseQuery(userMsg);
    if (parsed.error || !parsed.geoParams) return null;
    geoParams = parsed.geoParams;
    locationLabel = parsed.locationLabel;
  }

  let fetchResult;
  try {
    fetchResult = await fetchCensusValueWithFallback(variable.id, geoParams, censusApiKey, {
      year: CURRENT_ACS_YEAR,
      population: typeof pickedGeo?.population === "number" ? pickedGeo.population : null,
      geoType: pickedGeo?.geoType || null,
    });
  } catch (err) {
    return { error: String(err?.message || "Failed to fetch Census data.") };
  }

  const rawValue = fetchResult.value;
  const dataset = fetchResult.dataset;

  let numericValue = rawValue;
  let format = variable.format;
  try {
    const rateResult = await computeRateIfNeeded(variable.id, rawValue, geoParams, censusApiKey, {
      year: CURRENT_ACS_YEAR,
      dataset: datasetPath(dataset),
    });
    if (rateResult) {
      numericValue = rateResult.value;
      format = rateResult.format;
    }
  } catch {
    // Rate computation failure is non-fatal — use raw value
  }

  const formatted = formatValue(numericValue, format);
  const sourceLabel = buildSourceLabel(dataset, CURRENT_ACS_YEAR);
  const sentence = `${locationLabel} had a ${variable.label.toLowerCase()} of ${formatted} in ${CURRENT_ACS_YEAR}.`;

  return {
    reply: sentence,
    structured: {
      value: numericValue,
      variable: variable.label,
      place: locationLabel,
      year: Number(CURRENT_ACS_YEAR),
      unit: format,
      geoType: pickedGeo?.geoType || "place",
      dataset,
      source: sourceLabel,
      tables: buildSourceTables(variable.id),
    },
  };
}

// Equality check for two geo candidates so we can exclude the active pick from chips.
function sameCandidate(a, b) {
  if (!a || !b || a.geoType !== b.geoType) return false;
  switch (a.geoType) {
    case "place":              return a.placeFips === b.placeFips && a.stateFips === b.stateFips;
    case "county":             return a.countyFips === b.countyFips && a.stateFips === b.stateFips;
    case "county_subdivision": return a.cousubFips === b.cousubFips && a.stateFips === b.stateFips;
    case "cbsa":               return a.cbsaFips === b.cbsaFips;
    case "urban_area":         return a.uaFips === b.uaFips;
    case "zcta":               return a.name === b.name;
    case "state":              return a.stateFips === b.stateFips;
    default: return false;
  }
}

// County-style suffixes that the user might type but that aren't part of
// the bare county name in Census data (e.g. "Cook County" → "Cook").
const COUNTY_LIKE_SUFFIX_RE = /\s+(county|parish|census area)$/i;

// Detect ambiguity in the query without halting — returns defaults + raw data so
// the caller can both run the best-guess lookup AND surface the other interpretations
// as clickable alternatives.
async function detectAlternatives(userMsg, { skipMetricCheck = false } = {}) {
  const out = { metric: null, geo: null };

  const ambiguous = skipMetricCheck ? null : detectAmbiguousMetric(userMsg);
  if (ambiguous) {
    const defaultOpt = ambiguous.options[0];
    out.metric = {
      bucket: ambiguous.bucket,
      allOptions: ambiguous.options,
      defaultMetric: {
        variableId: defaultOpt.id,
        label: defaultOpt.label,
        table: defaultOpt.table,
        format: defaultOpt.format,
      },
    };
  }

  // ── ZCTA shortcut: user gave a 5-digit ZIP with a zip/zcta keyword ──
  const zipMatch = String(userMsg || "").match(/\b(\d{5})\b/);
  if (zipMatch && /\b(zip|zcta)\b/i.test(userMsg)) {
    const zcta = await findZctaByZip(zipMatch[1]).catch(() => null);
    if (zcta) {
      out.geo = {
        name: zipMatch[1],
        stateName: null,
        candidates: [zcta],
        types: new Set(["zcta"]),
        defaultGeo: zcta,
      };
      return out;
    }
  }

  const geo = extractGeoPhrase(userMsg);
  if (!geo?.name) return out;

  const lowerName = geo.name.toLowerCase();
  // State-only query → handled by parseQuery directly, no candidates needed
  if (geo.state == null && STATE_FIPS[lowerName]) return out;

  // Try the literal name first; if that misses AND the name has a county-like
  // suffix ("Cook County"), retry with the suffix stripped so we hit the
  // county fetcher's bare names.
  let candidates = await findGeoCandidates(geo.name, { stateName: geo.state || null }).catch(() => null);
  let userTypedCountySuffix = false;
  if (COUNTY_LIKE_SUFFIX_RE.test(geo.name)) {
    userTypedCountySuffix = true;
    if (!candidates || candidates.length === 0) {
      const stripped = geo.name.replace(COUNTY_LIKE_SUFFIX_RE, "").trim();
      candidates = await findGeoCandidates(stripped, { stateName: geo.state || null }).catch(() => null);
    }
  }

  // Use any candidates we found — even a single one. parseQuery's place_filter
  // path doesn't catch CDPs whose Census name has a prefix (e.g. "Urban Honolulu"),
  // so preferring geoCandidates whenever it returns ≥1 hit makes more queries land.
  if (candidates && candidates.length > 0) {
    // When the user explicitly typed "X County", prefer the county candidate
    // over any same-name place (Maricopa County, AZ vs. Maricopa city, AZ).
    let defaultGeo = candidates[0];
    if (userTypedCountySuffix) {
      const county = candidates.find((c) => c.geoType === "county");
      if (county) defaultGeo = county;
    }
    out.geo = {
      name: geo.name,
      stateName: geo.state,
      candidates,
      types: new Set(candidates.map((c) => c.geoType)),
      defaultGeo,
    };
  }

  return out;
}

// Strip a leading "[Picked X]" marker from a query so chip values don't stack
// the marker across compounding clicks.
function stripPickedPrefix(msg) {
  return String(msg || "").replace(/^\s*\[Picked [^\]]+\]\s*/i, "");
}

// Build a chip payload for metric alternatives, excluding the currently active pick.
// Each chip's meta carries previously-resolved picks so they compound across clicks.
function buildMetricAltPayload(metricAmb, userMsg, activeMetricId, extraMeta = {}) {
  const others = metricAmb.allOptions.filter((o) => o.id !== activeMetricId);
  if (others.length === 0) return null;
  const cleanMsg = stripPickedPrefix(userMsg);
  return {
    kind: "metric",
    prompt: `Did you mean a different "${metricAmb.bucket}" measure?`,
    options: others.map((opt) => ({
      label: opt.label,
      sublabel: `${opt.description} (Table ${opt.table})`,
      value: `${opt.label.toLowerCase()} ${cleanMsg.replace(new RegExp(`\\b${metricAmb.bucket}\\b`, "i"), "").trim()}`.replace(/\s+/g, " "),
      meta: {
        ...extraMeta,
        pickedMetric: {
          variableId: opt.id,
          label: opt.label,
          table: opt.table,
          format: opt.format,
        },
      },
    })),
    originalQuery: userMsg,
  };
}

// Build a chip payload for geo alternatives, excluding the currently active pick.
function buildGeoAltPayload(geoAmb, userMsg, activeGeo, extraMeta = {}) {
  const others = geoAmb.candidates.filter((c) => !sameCandidate(c, activeGeo)).slice(0, 8);
  if (others.length === 0) return null;
  const useIcon = geoAmb.types.size > 1;
  const cleanMsg = stripPickedPrefix(userMsg);
  const prompt = geoAmb.stateName == null
    ? `Did you mean a different "${geoAmb.name}"?`
    : geoAmb.types.size > 1
      ? `Did you mean a different scope for "${geoAmb.name}"?`
      : `Did you mean a different "${geoAmb.name}" in ${geoAmb.stateName}?`;
  return {
    kind: "geography",
    prompt,
    options: others.map((c) => {
      const d = describeCandidate(c);
      return {
        label: useIcon && d.icon ? `${d.icon} ${d.label}` : d.label,
        sublabel: d.sublabel,
        value: `[Picked ${candidateLabel(c)}] ${cleanMsg}`,
        meta: { ...extraMeta, pickedGeo: c },
      };
    }),
    originalQuery: userMsg,
  };
}

async function handleStatisticModeFastPath(req, res, userMsg, mode, opts = {}) {
  const censusApiKey = process.env.CENSUS_API_KEY;
  if (!censusApiKey) {
    return res.status(500).json({ error: "Server configuration error: missing Census API key." });
  }

  const { pickedGeo = null, pickedMetric = null } = opts;
  const skipMetricCheck = !!pickedMetric;

  // Detect ambiguity but DO NOT halt — we'll always run the best-guess lookup
  // and surface the other interpretations as clickable alternatives.
  const ambiguity = await detectAlternatives(userMsg, { skipMetricCheck });

  // Effective picks: user's pick wins; otherwise fall back to the auto-default.
  const activeMetric = pickedMetric || ambiguity.metric?.defaultMetric || null;
  const activeGeo = pickedGeo || ambiguity.geo?.defaultGeo || null;

  // Build alternative chips for axes the user hasn't already explicitly picked.
  // Each chip carries the OTHER active pick in its meta so picks compound across clicks.
  const alternatives = [];
  if (ambiguity.metric && !pickedMetric) {
    const extraMeta = activeGeo ? { pickedGeo: activeGeo } : {};
    const p = buildMetricAltPayload(ambiguity.metric, userMsg, activeMetric?.variableId, extraMeta);
    if (p) alternatives.push(p);
  }
  if (ambiguity.geo && !pickedGeo) {
    const extraMeta = activeMetric ? { pickedMetric: activeMetric } : {};
    const p = buildGeoAltPayload(ambiguity.geo, userMsg, activeGeo, extraMeta);
    if (p) alternatives.push(p);
  }
  const altsField = alternatives.length > 0 ? { alternatives } : {};

  // Up-front metric check: if no metric can be resolved (no pick, no ambiguity
  // default, no VARIABLE_MAP match), surface a metric-not-recognized prompt
  // instead of falling through to a geo-quirk message that points at the wrong
  // problem (or to the agentic loop, which can hallucinate).
  const metricResolved = !!(activeMetric || parseVariableOnly(userMsg));
  if (!metricResolved) {
    return res.status(200).json({
      reply: buildMetricNotRecognizedPrompt(),
      ...altsField,
    });
  }

  // Path 1: trend routing — runs first when the user explicitly wants a time-series.
  // Only fires when parseQuery resolves the geo (otherwise we can't query the trend API).
  if (needsTrendRouting(userMsg)) {
    const parsed = parseQuery(userMsg);
    const metricLabel = inferTrendMetricLabel(userMsg);

    if (!parsed.error && parsed.locationLabel) {
      const parts = parsed.locationLabel.split(",").map(s => s.trim());
      const city = parts[0];
      const state = parts[1];

      if (city && state) {
        const endYear = Number(CURRENT_ACS_YEAR);
        const trendResult = await runTrendTool(req, {
          city,
          state,
          metric: metricLabel,
          startYear: endYear - 4,
          endYear,
        });

        if (Array.isArray(trendResult)) {
          const series = [{
            label: parsed.locationLabel,
            points: trendResult
              .filter(p => p.numericValue != null)
              .map(p => ({ year: Number(p.year), numericValue: Number(p.numericValue) })),
          }];
          const payload = buildTrendChartPayload(series, metricLabel);
          const warnings = trendResult.filter(p => p.warning).map(p => `${p.year}: ${p.warning}`);
          return res.status(200).json({
            reply: JSON.stringify(payload),
            ...(warnings.length > 0 ? { warnings } : {}),
            ...altsField,
          });
        }
      }
    }
    // Trend routing couldn't proceed — try the explicit-geo or standard path below.
  }

  // Path 2: explicit geo (from pickedGeo or default candidate) → FIPS-based lookup.
  if (activeGeo) {
    const result = await performPickedLookup({ pickedGeo: activeGeo, pickedMetric: activeMetric, userMsg });
    if (result?.reply) {
      // Surface population from the picked candidate so banners can tailor
      // the small-place 5-year wording.
      if (result.structured && typeof activeGeo.population === "number") {
        result.structured.population = activeGeo.population;
      }
      const variableId = result.structured?.variableId
        || activeMetric?.variableId
        || parseVariableOnly(userMsg)?.id;
      await attachNuancesAndMethodology(result.structured, variableId);
      return res.status(200).json({ ...result, ...altsField });
    }
    if (result?.error) {
      return res.status(200).json({ reply: null, error: result.error, warning: true });
    }
    // result === null → couldn't resolve metric/geo, fall through
  }

  // Path 3: standard parseQuery → fetch.
  const parsed = parseQuery(userMsg);
  if (parsed.error) {
    // If the user mentioned an "in <name>" but neither parseQuery nor the
    // geoCandidates search resolved it, that's an ACS-quirk case — give a
    // helpful prompt instead of falling through to the agentic loop (which
    // can hallucinate without a real lookup).
    const geoPhrase = extractGeoPhrase(userMsg);
    if (geoPhrase?.name) {
      return res.status(200).json({
        reply: buildAcsQuirkPrompt(geoPhrase, userMsg),
        ...altsField,
      });
    }
    return null; // truly off-topic — let the agentic loop respond
  }

  // If user picked a metric, override parseQuery's variable.
  const variable = activeMetric
    ? { id: activeMetric.variableId, label: activeMetric.label, format: activeMetric.format }
    : parsed.variable;
  const { geoParams, locationLabel } = parsed;

  let fetchResult;
  try {
    fetchResult = await fetchCensusValueWithFallback(variable.id, geoParams, censusApiKey, {
      year: CURRENT_ACS_YEAR,
    });
  } catch (err) {
    const errMsg = String(err?.message || "Failed to fetch Census data.");
    // "Couldn't find X in Census place data" means the user-typed place name
    // didn't match anything in ACS. Show the quirk prompt instead of a raw error.
    if (/Couldn't find/i.test(errMsg)) {
      const geoPhrase = extractGeoPhrase(userMsg);
      if (geoPhrase?.name) {
        return res.status(200).json({
          reply: buildAcsQuirkPrompt(geoPhrase, userMsg),
          ...altsField,
        });
      }
    }
    return res.status(200).json({ reply: null, error: errMsg, warning: true });
  }

  let rawValue = fetchResult.value;
  let dataset = fetchResult.dataset;

  let validationFailed = false;
  const firstValidation = validateValue(variable.id, rawValue);
  if (!firstValidation.ok) {
    validationFailed = true;
    try {
      const retry = await fetchCensusValueWithFallback(variable.id, geoParams, censusApiKey, {
        year: CURRENT_ACS_YEAR,
      });
      const retryValidation = validateValue(variable.id, retry.value);
      if (!retryValidation.ok) {
        return res.status(200).json({
          reply: null,
          error: `Unable to retrieve validated data: ${retryValidation.reason}`,
          warning: true,
        });
      }
      rawValue = retry.value;
      dataset = retry.dataset;
      validationFailed = false;
    } catch (retryErr) {
      return res.status(200).json({ reply: null, error: String(retryErr?.message || "Retry failed."), warning: true });
    }
  }

  let numericValue = rawValue;
  let format = variable.format;
  try {
    const rateResult = await computeRateIfNeeded(variable.id, rawValue, geoParams, censusApiKey, {
      year: CURRENT_ACS_YEAR,
      dataset: datasetPath(dataset),
    });
    if (rateResult) {
      numericValue = rateResult.value;
      format = rateResult.format;
    }
  } catch {
    // Rate computation failure is non-fatal — use raw value
  }

  const warnings = [];
  if (validationFailed) warnings.push("Data required a retry — treat with caution.");

  let sentence = buildDeterministicSentence(locationLabel, variable.label, numericValue, format, CURRENT_ACS_YEAR);

  if (needsVerification(numericValue, variable.id, validationFailed)) {
    const verified = await verifySentence(numericValue, sentence);
    if (!verified) {
      sentence = buildDeterministicSentence(locationLabel, variable.label, numericValue, format, CURRENT_ACS_YEAR);
    }
  }

  const structured = {
    value: numericValue,
    variable: variable.label,
    place: locationLabel,
    year: Number(CURRENT_ACS_YEAR),
    unit: format,
    dataset,
    source: buildSourceLabel(dataset, CURRENT_ACS_YEAR),
    tables: buildSourceTables(variable.id),
  };
  await attachNuancesAndMethodology(structured, variable.id);

  return res.status(200).json({
    reply: sentence,
    structured,
    warnings,
    validated: !validationFailed,
    ...altsField,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages, mode, pickedGeo, pickedMetric } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No messages provided." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server configuration error: missing Anthropic API key." });
  }

  try {
    const initialUserMsg = getLatestUserMessage(messages);

    // Statistic mode: deterministic fast path. Always returns a best-guess
    // result (auto-defaulting on ambiguity) plus an `alternatives` payload
    // listing the other interpretations the user can click. Falls through to
    // the agentic loop only when parseQuery can't resolve the query at all.
    if (mode === "statistic") {
      const fastPathResult = await handleStatisticModeFastPath(req, res, initialUserMsg, mode, {
        pickedGeo,
        pickedMetric,
      });
      if (fastPathResult !== null) return fastPathResult;
    }

    let currentMessages = messages;
    let finalReply = null;
    const trendSeries = []; // collected across tool calls for multi-line comparisons
    const loopDeadline = Date.now() + LOOP_TIMEOUT_MS;
    const visualizationRequest = needsTrendRouting(initialUserMsg) || mode === "visualize";

    for (let i = 0; i < 5; i++) {
      // Enforce total loop timeout
      const remaining = loopDeadline - Date.now();
      if (remaining <= 0) {
        return res.status(504).json({ error: "Request timed out. Try a simpler question." });
      }

      const latestUserMsg = getLatestUserMessage(currentMessages);
      const forceTrendRouting = needsTrendRouting(latestUserMsg) || mode === "visualize";

      const systemPrompt = buildSystemPrompt(latestUserMsg, mode, forceTrendRouting);

      // Race the Claude call against the remaining timeout budget
      const responsePromise = client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: [CENSUS_TOOL, TREND_TOOL, ACS_DOCS_TOOL],
        messages: currentMessages,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out. Try a simpler question.")), remaining)
      );

      const response = await Promise.race([responsePromise, timeoutPromise]);

      console.log(`[chat] loop iteration ${i}, stop_reason=${response.stop_reason}, content_types=${response.content.map(b => b.type).join(",")}`);

      if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
        const textBlock = response.content.find(b => b.type === "text");
        finalReply = textBlock ? textBlock.text : null;
        if (!finalReply && response.stop_reason === "max_tokens") {
          finalReply = "Response was cut off — try asking a more specific question.";
        }
        break;
      }

      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(b => b.type === "tool_use");

        const toolResults = await Promise.all(
          toolUseBlocks.map(async (block) => {
            let result;
            if (block.name === TREND_TOOL.name) {
              const latestPrompt = getLatestUserMessage(currentMessages);
              const inferredMetric = inferTrendMetricLabel(latestPrompt);
              result = await runTrendTool(req, {
                ...block.input,
                metric: block.input?.metric || inferredMetric,
              });
              if (Array.isArray(result)) {
                const city = String(block.input?.city || "").trim();
                const state = String(block.input?.state || "").trim();
                trendSeries.push({
                  label: [city, state].filter(Boolean).join(", ") || "Series",
                  points: result.map((p) => ({
                    year: Number(p.year),
                    numericValue: Number(p.numericValue),
                  })),
                });
              }
            } else if (block.name === CENSUS_TOOL.name) {
              result = await runCensusTool(block.input);
            } else if (block.name === ACS_DOCS_TOOL.name) {
              result = await runAcsDocsTool(block.input);
            } else {
              result = { error: `Unsupported tool: ${block.name}` };
            }
            // Safely serialize — catch any unexpected stringify failure
            let content;
            try {
              content = JSON.stringify(result);
            } catch {
              content = JSON.stringify({ error: "Failed to serialize tool result." });
            }
            return {
              type: "tool_result",
              tool_use_id: block.id,
              content,
            };
          })
        );

        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: response.content },
          { role: "user", content: toolResults },
        ];
        continue;
      }

      // Unexpected stop reason — bail out gracefully
      console.warn("[chat] Unexpected stop_reason:", response.stop_reason);
      break;
    }

    if (!finalReply && trendSeries.length === 0) {
      // Loop exhausted without a text reply — likely repeated tool failures.
      // Make one final call with no tools so Claude must write a text response.
      console.warn("[chat] Loop exhausted without text reply — retrying with no tools.");
      try {
        const latestUserMsg = getLatestUserMessage(currentMessages);
        const fallbackResponse = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: buildSystemPrompt(latestUserMsg, mode, needsTrendRouting(latestUserMsg)) +
            '\n\nNote: live data lookup is unavailable. Respond exactly: "I don’t have time-series Census access for that request yet."',
          messages,  // use original messages, not the tool-augmented ones
        });
        const textBlock = fallbackResponse.content.find(b => b.type === "text");
        finalReply = textBlock?.text || "I wasn't able to retrieve that data right now. Please try again.";
      } catch (fallbackErr) {
        console.error("[chat] Fallback call failed:", fallbackErr);
        finalReply = "I wasn't able to retrieve that data right now. Please try again.";
      }
    }

    if (visualizationRequest) {
      if (trendSeries.length > 0) {
        const metricLabel = inferTrendMetricLabel(initialUserMsg);
        const payload = buildTrendChartPayload(trendSeries, metricLabel);
        return res.status(200).json({ reply: JSON.stringify(payload) });
      }
      return res.status(200).json({ reply: JSON.stringify(chartErrorPayload()) });
    }

    // For statistic mode, parse structured sections from the reply
    if (mode === "statistic" && finalReply) {
      const methMatch = finalReply.match(/\[methodology\]\s*([\s\S]*?)(?=\[caveats\]|$)/);
      const cavMatch = finalReply.match(/\[caveats\]\s*([\s\S]*)$/);

      if (methMatch || cavMatch) {
        // Strip markers from the main reply
        const answer = finalReply.replace(/\[methodology\][\s\S]*$/, "").trim();
        const methodology = methMatch ? methMatch[1].trim() : null;
        const caveats = cavMatch ? cavMatch[1].trim() : null;
        return res.status(200).json({ reply: answer, methodology, caveats });
      }
    }

    return res.status(200).json({ reply: finalReply });
  } catch (err) {
    console.error("[chat] API error:", err);
    const message = err?.message || "Internal server error.";
    const status = message.includes("timed out") ? 504 : 500;
    return res.status(status).json({ error: message });
  }
}
