// pages/api/chat.js
// Server-side Claude chatbot endpoint with Census API tool use.
// ANTHROPIC_API_KEY is read from .env.local — never exposed to the browser.

import Anthropic from "@anthropic-ai/sdk";
import { parseQuery, formatValue } from "../../lib/censusTranslator";
import { fetchCensusValue } from "../../lib/censusApi";
import { QUERY_TYPES } from "../../lib/censusConstants";
import fs from "fs";
import path from "path";

const MODEL = "claude-haiku-4-5";
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
- For graph/chart/trend/change-over-time/historical-comparison/visualization requests, output ONLY JSON in this exact shape:
  {
    "type": "trend_chart",
    "metric": string,
    "location": string,
    "points": [{ "year": number, "numericValue": number }],
    "source": string
  }
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
    // Visualization mode: data interpretation + table selection for chart planning
    path.join(SKILLS_DIR, "acs-data-interpreter", "SKILL.md"),
    path.join(SKILLS_DIR, "acs-table-selector", "SKILL.md"),
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
  const visualizationRequest = needsTrendRouting(userMessage) || mode === "visualize";
  const alwaysOn = loadAlwaysOnSkills();

  // Load mode-specific skills
  const modeFiles = MODE_SKILLS[mode] || MODE_SKILLS.statistic;
  const modeSkills = modeFiles.map(readSkillCached).filter(Boolean);

  // Also load keyword-conditional skills
  const conditional = visualizationRequest ? [] : loadConditionalSkills(userMessage);

  // Deduplicate (mode skills may overlap with conditional)
  const allSkills = visualizationRequest ? [] : [...new Set([...modeSkills, ...conditional])];

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
    const formattedValue = formatValue(rawValue, variable.format);

    return {
      metric: variable.label,
      value: formattedValue,
      location: locationLabel,
      source: "ACS 5-Year Estimates (2022), U.S. Census Bureau",
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

function buildTrendChartPayload(trendPoints, city, state, metricLabel) {
  return {
    type: "trend_chart",
    metric: metricLabel || "Trend",
    location: `${city}, ${state}`,
    points: trendPoints.map((point) => ({
      year: Number(point.year),
      numericValue: Number(point.numericValue),
    })),
    source: "U.S. Census Bureau ACS 5-Year Estimates",
  };
}

function chartErrorPayload() {
  return {
    type: "error",
    message: "Unable to generate chart data.",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages, mode } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No messages provided." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server configuration error: missing Anthropic API key." });
  }

  try {
    let currentMessages = messages;
    let finalReply = null;
    let trendChartPayload = null;
    const loopDeadline = Date.now() + LOOP_TIMEOUT_MS;
    const initialUserMsg = getLatestUserMessage(messages);
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
        tools: [CENSUS_TOOL, TREND_TOOL],
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
                trendChartPayload = buildTrendChartPayload(
                  result,
                  String(block.input?.city || "").trim(),
                  String(block.input?.state || "").trim(),
                  inferTrendMetricLabel(latestPrompt)
                );
              }
            } else if (block.name === CENSUS_TOOL.name) {
              result = await runCensusTool(block.input);
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

    if (!finalReply && !trendChartPayload) {
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
      if (trendChartPayload) {
        return res.status(200).json({ reply: JSON.stringify(trendChartPayload) });
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
