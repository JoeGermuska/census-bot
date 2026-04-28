# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server on localhost:3000
npm run build    # production build
npm run start    # serve production build
npm run lint     # ESLint via next lint
```

There are no tests in this project.

## Environment variables

Two keys are required in `.env.local`:
- `ANTHROPIC_API_KEY` — used server-side in `pages/api/chat.js` to call Claude
- `CENSUS_API_KEY` — used server-side to query `api.census.gov`

Neither key is ever sent to the browser.

## Architecture

**Next.js 14 app (Pages Router).** All data fetching happens server-side in API routes; the browser only calls `/api/*`.

### Pages
| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/chat` | Claude-powered chatbot with three modes (Learn, Find Statistic, Create Visualization) |
| `/explore` | Three-step wizard: pick metrics → pick location → view results |
| `/about` | Static about page |

### API routes (`pages/api/`)
- **`/api/chat`** — Main chatbot endpoint. Runs an agentic loop (up to 5 iterations, 25s timeout) using Claude `claude-haiku-4-5`. Handles two tools: `lookup_census_data` (single-year stat) and `get_census_trend` (multi-year series). Supports three modes passed in the request body: `learn`, `statistic`, `visualize`.
- **`/api/query`** — Direct Census lookup without Claude. Parses a natural-language query string and returns a structured result.
- **`/api/trend`** — Fetches a metric for a city/state across a year range. Called by the chat route internally (not the browser) when Claude invokes the trend tool.

### Skills system (`skills/`)
Markdown files injected into the Claude system prompt at runtime. Two are always loaded; the rest are conditionally loaded based on keyword matching in the user's message:
- **Always on:** `acs-general/ACS_SKILL.md`, `humanize/Humanize_SKILL.md`
- **Conditional:** `acs-data-interpreter`, `acs-geography`, `acs-table-selector`, `acs-housing-migration`, `acs-api-builder`, `acs-temporal-caveats`
- **Mode-specific:** `learn`, `statistic`, `visualize` modes each pull a fixed subset of skills

Skills are cached at module load time (`_skillCache` Map) so files are only read once per cold start.

### Data layer (`lib/`)
- **`censusTranslator.js`** — Parses natural-language queries into Census variable IDs + geo parameters (`parseQuery`), and formats raw values (`formatValue`). Contains `VARIABLE_MAP` mapping keyword phrases to ACS variable objects.
- **`censusApi.js`** — Fetches from `api.census.gov/data/{year}/acs/acs5`. Three functions: `fetchCensusValue` (single place/year), `fetchCensusOverTime` (fixed 2018–2022 window), `fetchCensusVariable` (used by trend route, with in-memory caching by `year:variable:city:state`).
- **`censusConstants.js`** — `QUERY_TYPES` (the supported metric names), `STATES_CITIES` (cities per state for the explore wizard), `STATE_NAMES`, and `sessionStorage` key constants.

### Chart flow
When Claude calls the `get_census_trend` tool, `/api/trend` returns `[{ year, numericValue }]` data points. The chat route wraps this in a `{ type: "trend_chart", metric, location, points, source }` JSON payload, which the browser detects and renders via the `TrendChart` component (Recharts). Chart errors return `{ type: "error", message }`.

### Explore wizard
Three pages under `pages/explore/`: metrics selection → location selection → results. State is passed between steps via `sessionStorage` (keys from `censusConstants.js`) and `router.query.from` for animated progress bar transitions.
