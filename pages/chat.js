// pages/chat.js — Ask Question: Claude-powered Census chatbot
import { Fragment, useState, useRef, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import SiteLayout from "../components/SiteLayout";
import TrendChart from "../components/TrendChart";
import ChatInputBox from "../components/ChatInputBox";
import styles from "../styles/Chat.module.css";
import { buildCensusProfileUrl } from "../lib/censusConstants";
import { usePlaceGeoid } from "../lib/usePlaceGeoid";

const MAX_EXCHANGES = 10;

// ── Modes ────────────────────────────────────────────────────────────────────
function IconBook() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  );
}
function IconSearch() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
function IconBarChart() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
      <line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  );
}

const MODES = [
  {
    id: "learn",
    label: "Learn about ACS",
    Icon: IconBook,
    description: "Understand what ACS data is, how it works, and what it covers.",
    placeholder: "What is the American Community Survey?",
    suggestions: [
      "What does ACS 5-year data mean?",
      "What's the difference between ACS and the Census?",
      "How reliable is ACS data for small cities?",
      "What kind of data does ACS track?",
    ],
  },
  {
    id: "statistic",
    label: "Find a Statistic",
    Icon: IconSearch,
    description: "Look up live Census data for any U.S. city.",
    placeholder: "What's the median rent in Chicago, Illinois?",
    suggestions: [
      "Median household income in Seattle, Washington?",
      "What is the poverty rate in Detroit, Michigan?",
      "Compare population of Austin and Dallas, Texas.",
      "Unemployment rate in Miami, Florida?",
    ],
  },
  {
    id: "visualize",
    label: "Create Visualization",
    Icon: IconBarChart,
    description: "Get chart suggestions and data breakdowns for visual storytelling.",
    placeholder: "Show rent trends for California cities…",
    suggestions: [
      "How should I visualize income inequality in Texas?",
      "Best chart type for comparing rent across 5 cities?",
      "Help me plan a visualization of poverty trends.",
      "What data would I need for a migration map?",
    ],
  },
];

// ── Markdown renderer ────────────────────────────────────────────────────────
function parseInline(text) {
  // Parse **bold**, *italic*, and `code` inline
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className={styles.inlineCode}>{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

function renderMarkdown(text) {
  const lines = text.split("\n");
  const elements = [];
  let tableRows = [];
  let inTable = false;

  function flushTable() {
    if (tableRows.length === 0) return;
    const headerCells = tableRows[0];
    // Skip separator row (row 1 if it's all dashes)
    const bodyStart = tableRows.length > 1 && tableRows[1].every(c => /^[-:|]+$/.test(c.trim())) ? 2 : 1;
    const bodyRows = tableRows.slice(bodyStart);

    elements.push(
      <div key={`tbl-${elements.length}`} className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>{headerCells.map((c, i) => <th key={i}>{parseInline(c.trim())}</th>)}</tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri}>{row.map((c, ci) => <td key={ci}>{parseInline(c.trim())}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
  }

  lines.forEach((line, li) => {
    const trimmed = line.trim();

    // Table row detection: | col | col |
    if (/^\|(.+\|)+$/.test(trimmed)) {
      const cells = trimmed.split("|").slice(1, -1);
      tableRows.push(cells);
      inTable = true;
      return;
    } else if (inTable) {
      flushTable();
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      elements.push(<hr key={li} style={{ border: "none", borderTop: "1px solid var(--border)", margin: "0.5rem 0" }} />);
      return;
    }

    // Headers
    const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      elements.push(
        <div key={li} className={styles[`h${level}`] || styles.h3}>
          {parseInline(headerMatch[2])}
        </div>
      );
      return;
    }

    // Bullet list items: - or * or numbered (1.)
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)/);
    if (bulletMatch) {
      elements.push(
        <div key={li} className={styles.listItem}>
          <span className={styles.bullet}>•</span>
          <span>{parseInline(bulletMatch[1])}</span>
        </div>
      );
      return;
    }

    // Empty line
    if (trimmed === "") {
      elements.push(<div key={li} style={{ height: "0.35rem" }} />);
      return;
    }

    // Normal line
    elements.push(
      <span key={li} style={{ display: "block" }}>
        {parseInline(line)}
      </span>
    );
  });

  // Flush any remaining table
  if (inTable) flushTable();

  return elements;
}

function safeParse(content) {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Format a structured numeric value the same way the API does, so the big
// stat card matches what the bot says.
function formatStatValue(raw, unit) {
  const num = parseFloat(raw);
  if (!Number.isFinite(num) || num < 0) return "—";
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
    case "percent":
      return `${parseFloat(num.toFixed(3))}%`;
    case "years":
      return `${parseFloat(num.toFixed(3))} yrs`;
    case "minutes":
      return `${parseFloat(num.toFixed(3))} min`;
    case "index":
      return num.toFixed(3);
    case "number":
    default:
      return new Intl.NumberFormat("en-US").format(Math.round(num));
  }
}

// ── Source link ───────────────────────────────────────────────────────────────
function SourceFooter({ source, metric, place }) {
  const commaIdx = (place || "").indexOf(",");
  const city  = commaIdx > -1 ? place.slice(0, commaIdx).trim() : place || "";
  const state = commaIdx > -1 ? place.slice(commaIdx + 1).trim() : "";
  const geoid = usePlaceGeoid(city, state);
  return (
    <a
      href={buildCensusProfileUrl(city, state, metric, geoid)}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.statCardSource}
    >
      {source}
    </a>
  );
}

// ── Stat card (big number + label + place) ──────────────────────────────────
// Rendered inside the assistant bubble whenever the response carries a
// `structured` payload from the deterministic fast path.
// Shared methodology panel body — same content rendered both inside StatCard's
// "More information" disclosure and inside each SourceTrail row's disclosure.
function MethodologyPanel({ tableInfo, moeMethodology, nuances, methodology }) {
  const hasContent =
    !!tableInfo || !!moeMethodology || (Array.isArray(nuances) && nuances.length > 0) || !!methodology;
  if (!hasContent) return null;
  return (
    <div className={styles.statCardMethBody}>
      {tableInfo && (
        <div className={styles.statCardMethPassage}>
          <div className={styles.statCardMethHeader}>
            Table {tableInfo.tableId} — {tableInfo.concept || tableInfo.kindLabel}
          </div>
          {tableInfo.universe && (
            <p className={styles.statCardMethText}>
              <strong>Universe:</strong> {tableInfo.universe}
            </p>
          )}
          {Array.isArray(tableInfo.releases) && tableInfo.releases.length > 0 && (
            <p className={styles.statCardMethText}>
              <strong>Released in:</strong>{" "}
              {tableInfo.releases.map(r => r === "acs5" ? "5-Year" : "1-Year").join(", ")}
            </p>
          )}
          <span className={styles.statCardMethCite}>
            — {tableInfo.catalogSource || "Local ACS table catalog"}
          </span>
        </div>
      )}
      {moeMethodology && (
        <div className={styles.statCardMethPassage}>
          <div className={styles.statCardMethHeader}>How the margin of error was calculated</div>
          <p className={styles.statCardMethText}>{moeMethodology.description}</p>
          {moeMethodology.formula && (
            <p className={styles.statCardMethText}>
              <code>{moeMethodology.formula}</code>
            </p>
          )}
          <span className={styles.statCardMethCite}>— {moeMethodology.sourceLabel}</span>
        </div>
      )}
      {Array.isArray(nuances) && nuances.length > 0 && (
        <ul className={styles.statCardNuanceList}>
          {nuances.map((n, i) => (
            <li key={i} className={styles.statCardNuanceItem}>
              <span className={styles.statCardNuanceMark} aria-hidden>⚠</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      {methodology && (
        <div className={styles.statCardMethPassage}>
          <p className={styles.statCardMethText}>{methodology.text}</p>
          {methodology.doc_url ? (
            <a
              href={methodology.doc_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.statCardMethCite}
            >
              — {methodology.doc_title}
              {methodology.page ? `, p. ${methodology.page}` : ""} ↗
            </a>
          ) : (
            <span className={styles.statCardMethCite}>
              — {methodology.doc_title}
              {methodology.page ? `, p. ${methodology.page}` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Compact source row — one per stat source captured during the agentic loop.
// Renders the place + variable + value summary, the source links, and a
// per-source "More information" disclosure that uses the same MethodologyPanel
// content as the StatCard's expanded body.
function SourceTrailRow({ source }) {
  const [open, setOpen] = useState(false);
  if (!source || source.kind !== "stat") return null;
  const value = formatStatValue(source.value, source.unit);
  const sourceLabel = source.source
    || `ACS ${source.year} ${source.dataset === "acs1" ? "1-Year" : "5-Year"} Estimates`;
  const tables = Array.isArray(source.tables) ? source.tables : [];
  const hasMethPanel =
    !!source.tableInfo || !!source.moeMethodology
    || (Array.isArray(source.nuances) && source.nuances.length > 0)
    || !!source.methodology;

  return (
    <div className={styles.sourceTrailRow}>
      <div className={styles.sourceTrailLine}>
        <strong>{source.place}</strong>
        {source.variable ? <> — {source.variable}: </> : ": "}
        <strong>{value}</strong>
        {source.moeFormatted && <span className={styles.sourceTrailMOE}> {source.moeFormatted}</span>}
      </div>
      <div className={styles.statCardSourceRow}>
        <div className={styles.statCardSources}>
          <span className={styles.statCardSourcesLabel}>Source:</span>
          <SourceFooter source={sourceLabel} metric={source.variable} place={source.place} />
          {tables.map((t, i) => (
            <Fragment key={t.tableId}>
              <span className={styles.statCardSep}>,</span>
              <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.statCardTableLink}
              >
                Table {t.tableId}
              </a>
            </Fragment>
          ))}
        </div>
        {hasMethPanel && (
          <button
            type="button"
            className={styles.statCardMethBtn}
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
          >
            {open ? "Hide more information ▲" : "More information ▼"}
          </button>
        )}
      </div>
      {hasMethPanel && open && (
        <div className={styles.statCardMethWrap}>
          <MethodologyPanel
            tableInfo={source.tableInfo}
            moeMethodology={source.moeMethodology}
            nuances={source.nuances}
            methodology={source.methodology}
          />
        </div>
      )}
    </div>
  );
}

// Sources trail — rendered below the prose bubble whenever Claude fetched
// data via the tool path. Universal: works for single stats, multi-place
// comparisons, and learn-mode answers that pulled data alongside docs.
function SourceTrail({ sources }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const statSources = sources.filter(s => s.kind === "stat");
  if (statSources.length === 0) return null;
  return (
    <div className={styles.sourceTrail}>
      <div className={styles.sourceTrailHeader}>
        Sources ({statSources.length})
      </div>
      {statSources.map((s, i) => (
        <SourceTrailRow key={i} source={s} />
      ))}
    </div>
  );
}

function StatCard({ structured }) {
  const [methOpen, setMethOpen] = useState(false);
  if (!structured) return null;
  const value = formatStatValue(structured.value, structured.unit);
  const sourceLabel = structured.source
    || `ACS ${structured.year} ${structured.dataset === "acs1" ? "1-Year" : "5-Year"} Estimates`;
  const tables = Array.isArray(structured.tables) ? structured.tables : [];
  const nuances = Array.isArray(structured.nuances) ? structured.nuances : [];
  const methodology = structured.methodology || null;
  const moeFormatted = structured.moeFormatted || null;
  const moeMethodology = structured.moeMethodology || null;
  const tableInfo = structured.tableInfo || null;
  const hasMethPanel = nuances.length > 0 || !!methodology || !!moeMethodology || !!tableInfo;

  // Title combines place and metric when both are known. Falls back gracefully
  // if either is missing — works for any metric/place combination, not specific
  // to income or Seattle.
  const title = structured.place && structured.variable
    ? `${structured.place}: ${structured.variable}`
    : (structured.variable || structured.place || "");

  return (
    <div className={styles.statCardChat}>
      <div className={styles.statCardTitle}>{title}</div>
      <div className={styles.statCardValue}>{value}</div>
      {moeFormatted && (
        <div className={styles.statCardMOE}>{moeFormatted} margin of error (90% CI)</div>
      )}
      {(sourceLabel || tables.length > 0 || hasMethPanel) && (
        <div className={styles.statCardSourceRow}>
          <div className={styles.statCardSources}>
            {(sourceLabel || tables.length > 0) && (
              <span className={styles.statCardSourcesLabel}>Source:</span>
            )}
            {sourceLabel && (
              <SourceFooter source={sourceLabel} metric={structured.variable} place={structured.place} />
            )}
            {tables.map((t, i) => (
              <Fragment key={t.tableId}>
                {(sourceLabel || i > 0) && <span className={styles.statCardSep}>,</span>}
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.statCardTableLink}
                >
                  Table {t.tableId}
                </a>
              </Fragment>
            ))}
          </div>
          {hasMethPanel && (
            <button
              type="button"
              className={styles.statCardMethBtn}
              onClick={() => setMethOpen(o => !o)}
              aria-expanded={methOpen}
            >
              {methOpen ? "Hide more information ▲" : "More information ▼"}
            </button>
          )}
        </div>
      )}
      {/* Why 5-year? — surfaced when 1-year couldn't deliver, so the user
          isn't left wondering why they got a less-current estimate. */}
      {structured.dataset === "acs5" && structured.fallbackReason && (
        <div className={styles.statCardFallback}>
          <strong>Why 5-Year?</strong> {structured.fallbackReason}
        </div>
      )}
      {hasMethPanel && methOpen && (
        <div className={styles.statCardMethWrap}>
          <MethodologyPanel
            tableInfo={tableInfo}
            moeMethodology={moeMethodology}
            nuances={nuances}
            methodology={methodology}
          />
        </div>
      )}
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function BotAvatar() {
  return <div className={`${styles.avatar} ${styles.avatarAssistant}`} aria-hidden>CB</div>;
}

function UserAvatar() {
  return (
    <div className={`${styles.avatar} ${styles.avatarUser}`} aria-hidden>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className={styles.typingRow}>
      <BotAvatar />
      <div className={styles.typingBubble}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </div>
    </div>
  );
}

// ── Alternatives block ──────────────────────────────────────────────────────
// Rendered below an assistant statistic answer when the original query was
// ambiguous. Each section lets the user re-run with a different interpretation.
function AlternativesBlock({ alternatives, onPick }) {
  if (!alternatives || alternatives.length === 0) return null;
  return (
    <div className={styles.alternativesWrap}>
      {alternatives.map((alt, sectionIdx) => (
        <div key={sectionIdx} className={styles.alternativesSection}>
          <p className={styles.alternativesPrompt}>{alt.prompt}</p>
          <div className={styles.alternativesOptions}>
            {alt.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                className={styles.alternativeChip}
                onClick={() => onPick(opt)}
              >
                <span className={styles.alternativeChipLabel}>{opt.label}</span>
                {opt.sublabel && (
                  <span className={styles.alternativeChipSublabel}>{opt.sublabel}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Clarification card (legacy halt-style picker; kept for safety) ──────────
function ClarificationCard({ data, onPick, picked }) {
  if (!data) return null;
  // Collapsed state — user already picked; show the choice as a small breadcrumb.
  if (picked) {
    return (
      <div className={styles.clarificationCollapsed}>
        <span className={styles.clarificationCollapsedCheck}>✓</span>
        <span>You picked: <strong>{picked}</strong></span>
      </div>
    );
  }
  return (
    <div className={styles.clarificationCard}>
      <p className={styles.clarificationPrompt}>{data.prompt}</p>
      <div className={styles.clarificationOptions}>
        {data.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            className={styles.clarificationChip}
            onClick={() => onPick(opt)}
          >
            <span className={styles.clarificationChipLabel}>{opt.label}</span>
            {opt.sublabel && (
              <span className={styles.clarificationChipSublabel}>{opt.sublabel}</span>
            )}
          </button>
        ))}
      </div>
      {data.allowFreeText && (
        <button
          type="button"
          className={styles.clarificationFreeText}
          onClick={() => onPick({ label: "None of these", value: "__free_text__" })}
        >
          None of these — let me retype
        </button>
      )}
    </div>
  );
}

// ── More Info (methodology + caveats) ────────────────────────────────────────
function MoreInfo({ methodology, caveats }) {
  const [open, setOpen] = useState(false);
  if (!methodology && !caveats) return null;

  return (
    <div className={styles.moreInfoWrap}>
      {methodology && (
        <p className={styles.methodology}>{methodology}</p>
      )}
      {caveats && (
        <>
          <button
            type="button"
            className={styles.moreInfoBtn}
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
          >
            {open ? "Hide details ▲" : "More info ▼"}
          </button>
          {open && (
            <div className={styles.caveatsBox}>
              {renderMarkdown(caveats)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── ACS docs citation parsing ────────────────────────────────────────────────
// Server prompts Claude to emit responses like:
//   ...prose with [1] markers...
//   Sources:
//   [1] subject-definitions__p41__0
//   [2] handbook-general__p18__2
// Split that into prose + a structured sources list. If no Sources block is
// present, returns { prose: text, sources: [] } unchanged.
function splitSources(text) {
  if (typeof text !== "string") return { prose: text, sources: [] };
  const m = text.match(/\n\s*Sources?:\s*\n([\s\S]+)$/i);
  if (!m) return { prose: text, sources: [] };
  const lines = m[1].split("\n").map(l => l.trim()).filter(Boolean);
  const sources = [];
  for (const line of lines) {
    const lm = line.match(/^\[(\d+)\]\s+([A-Za-z0-9_\-]+(?:__[A-Za-z0-9_\-]+)+)/);
    if (!lm) break; // stop at first non-source line — block ends here
    sources.push({ index: Number(lm[1]), chunk_id: lm[2] });
  }
  if (sources.length === 0) return { prose: text, sources: [] };
  return { prose: text.slice(0, m.index).trimEnd(), sources };
}

// Decode a chunk_id like "subject-definitions__p41__0" into { doc_id, page }.
// HTML chunks use "__html__" as the middle segment instead of a page.
function decodeChunkId(chunkId) {
  const m = String(chunkId || "").match(/^(.+?)__(p\d+|html)__\d+$/);
  if (!m) return { doc_id: chunkId, page: null };
  const doc_id = m[1];
  const page = m[2].startsWith("p") ? Number(m[2].slice(1)) : null;
  return { doc_id, page };
}

function SourcesBlock({ sources, docMap }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className={styles.sourcesBlock}>
      <div className={styles.sourcesLabel}>Sources</div>
      {sources.map(s => {
        const { doc_id, page } = decodeChunkId(s.chunk_id);
        const title = docMap.get(doc_id)?.title || doc_id;
        return (
          <div key={s.index} className={styles.sourceLine}>
            <span className={styles.sourceIndex}>[{s.index}]</span>
            <a
              href={`/learn/passage/${encodeURIComponent(s.chunk_id)}`}
              className={styles.sourceLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              {title}
              {page != null ? <span className={styles.sourcePage}> · p.{page}</span> : null}
            </a>
          </div>
        );
      })}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [mode, setMode] = useState(null); // null = show mode picker
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedChartIndex, setExpandedChartIndex] = useState(null);
  const [minimizedCharts, setMinimizedCharts] = useState({});
  // doc_id → { title, has_pdf } for resolving chunk-id citations to readable titles.
  // Loaded once on first ACS-cited message; index endpoint gracefully degrades if absent.
  const [docMap, setDocMap] = useState(() => new Map());
  const listRef = useRef(null);
  const textareaRef = useRef(null);

  // Read ?prefill=... — used by the metric-graph "Look this up in the bot"
  // button to jump directly into a partially-typed query.
  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    const raw = router.query.prefill;
    const prefill = Array.isArray(raw) ? raw[0] : raw;
    if (!prefill) return;
    setInput(prefill);
    if (mode === null) setMode("statistic");
    // Strip the param so a refresh doesn't keep re-prefilling.
    router.replace("/chat", undefined, { shallow: true });
    // Defer focus so the input has rendered.
    requestAnimationFrame(() => textareaRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  // Fetch the doc directory once — we need it to resolve chunk_id → title in citations.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/acs-search?action=docs")
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (cancelled || !json?.docs) return;
        const m = new Map();
        for (const d of json.docs) m.set(d.id, { title: d.title, has_pdf: d.has_pdf });
        setDocMap(m);
      })
      .catch(() => { /* index may not be built yet — citations will fall back to chunk_id */ });
    return () => { cancelled = true; };
  }, []);

  const atLimit = messages.length >= MAX_EXCHANGES * 2;
  const activeMode = MODES.find(m => m.id === mode);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    let latestChartIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.role !== "assistant") continue;
      const parsed = safeParse(msg.content);
      if (parsed?.type === "trend_chart") {
        latestChartIndex = i;
        break;
      }
    }

    if (latestChartIndex !== -1 && !minimizedCharts[latestChartIndex]) {
      setExpandedChartIndex(latestChartIndex);
    }
  }, [messages, minimizedCharts]);

  // pickedMeta: { pickedGeo?, pickedMetric?, displayLabel? } when user clicked a chip
  async function sendMessage(overrideText, pickedMeta = null) {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if (!text || loading || atLimit) return;

    const userMsg = { role: "user", content: text };
    const history = messages.slice(-(MAX_EXCHANGES * 2 - 1));
    const next = [...history, userMsg];

    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const body = {
        messages: next.map(m => ({ role: m.role, content: m.content })),
        mode: mode || "statistic",
      };
      if (pickedMeta?.pickedGeo) body.pickedGeo = pickedMeta.pickedGeo;
      if (pickedMeta?.pickedMetric) body.pickedMetric = pickedMeta.pickedMetric;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages(prev => [...prev, { role: "assistant", content: data.error || "Something went wrong.", error: true }]);
      } else {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: data.reply,
          methodology: data.methodology || null,
          caveats: data.caveats || null,
          alternatives: Array.isArray(data.alternatives) ? data.alternatives : null,
          structured: data.structured || null,
          sources: Array.isArray(data.sources) ? data.sources : null,
        }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Network error — check your connection.", error: true }]);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }

  // Click handler for an alternatives chip below a result. Hides the chips on
  // the now-stale message and re-runs the lookup with the chip's pick metadata.
  function handleAlternativePick(messageIndex, option) {
    setMessages(prev => prev.map((m, i) =>
      i === messageIndex ? { ...m, alternatives: null } : m
    ));
    sendMessage(option.value, option.meta || null);
  }

  // Click handler for clarification chips: collapse the card on the picked
  // message AND fire the next request with the chip's metadata.
  function handleClarificationPick(messageIndex, option) {
    if (option.value === "__free_text__") {
      // User wants to retype — collapse the card without sending a new message
      setMessages(prev => prev.map((m, i) =>
        i === messageIndex ? { ...m, pickedLabel: "(typed manually)" } : m
      ));
      setTimeout(() => textareaRef.current?.focus(), 50);
      return;
    }
    // Mark the card collapsed with the user's chosen label
    setMessages(prev => prev.map((m, i) =>
      i === messageIndex ? { ...m, pickedLabel: option.label } : m
    ));
    sendMessage(option.value, option.meta || null);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMode(null);
    setMessages([]);
    setInput("");
    setExpandedChartIndex(null);
    setMinimizedCharts({});
  }

  function selectMode(modeId) {
    setMode(modeId);
    setMessages([]);
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 100);
  }

  return (
    <>
      <Head>
        <title>CensusBot — Ask Question</title>
        <meta name="description" content="Ask plain-English questions about U.S. Census ACS data." />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <div className={styles.chatPage}>

          {/* Header */}
          <div className={`${styles.header} ${mode === null ? styles.headerCentered : ""}`}>
            <div className={`${styles.headerLeft} ${mode === null ? styles.headerLeftCentered : ""}`}>
              <h1 className={styles.title}>
                Ask a Question
                {activeMode && <span className={styles.modeInlineLabel}> — {activeMode.label}</span>}
              </h1>
              <p className={styles.subtitle}>
                {activeMode ? activeMode.description : "Choose how you want to explore Census data."}
              </p>
            </div>
            {(mode !== null) && (
              <button type="button" className={styles.clearBtn} onClick={clearChat}>
                ← New Chat
              </button>
            )}
          </div>

          {/* Mode picker — shown when no mode selected */}
          {mode === null ? (
            <div className={styles.modePicker}>
              <div className={styles.modeGrid}>
                {MODES.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    className={styles.modeCard}
                    onClick={() => selectMode(m.id)}
                  >
                    <span className={styles.modeIcon}><m.Icon /></span>
                    <span className={styles.modeLabel}>{m.label}</span>
                    <span className={styles.modeDesc}>{m.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.chatInner}>
              {/* Message list — or spacer when empty */}
              {messages.length === 0 && !loading ? (
                <div className={styles.emptyState} />
              ) : (
                <div className={styles.messageList} ref={listRef}>
                  {messages.map((msg, i) => {
                    const parsed = msg.role === "assistant" ? safeParse(msg.content) : null;
                    const isTrendChart = parsed?.type === "trend_chart";
                    const isChartError = parsed?.type === "error";
                    const isClarification = parsed?.type === "clarification";

                    return (
                      <div key={i} className={`${styles.messageRow} ${msg.role === "user" ? styles.messageRowUser : ""}`}>
                        {msg.role === "assistant" ? <BotAvatar /> : <UserAvatar />}
                        <div className={`${styles.bubble} ${
                          msg.role === "user"
                            ? styles.bubbleUser
                            : msg.error || isChartError
                            ? `${styles.bubbleAssistant} ${styles.bubbleError}`
                            : styles.bubbleAssistant
                        }`}>
                          {msg.role === "assistant" ? (
                            isTrendChart ? (
                              <TrendChart data={parsed} />
                            ) : isChartError ? (
                              parsed.message
                            ) : isClarification ? (
                              <ClarificationCard
                                data={parsed}
                                picked={msg.pickedLabel || null}
                                onPick={(opt) => handleClarificationPick(i, opt)}
                              />
                            ) : msg.structured ? (
                              <StatCard structured={msg.structured} />
                            ) : (() => {
                                const { prose, sources } = splitSources(msg.content);
                                return (
                                  <>
                                    {renderMarkdown(prose)}
                                    <SourcesBlock sources={sources} docMap={docMap} />
                                  </>
                                );
                              })()
                          ) : (
                            msg.content
                          )}
                          {msg.role === "assistant" && !isTrendChart && !isClarification && !msg.structured && Array.isArray(msg.sources) && msg.sources.length > 0 && (
                            <SourceTrail sources={msg.sources} />
                          )}
                          {msg.role === "assistant" && !isTrendChart && !isClarification && msg.alternatives && msg.alternatives.length > 0 && (
                            <AlternativesBlock
                              alternatives={msg.alternatives}
                              onPick={(opt) => handleAlternativePick(i, opt)}
                            />
                          )}
                          {msg.role === "assistant" && !isTrendChart && !isClarification && (msg.methodology || msg.caveats) && (
                            <MoreInfo methodology={msg.methodology} caveats={msg.caveats} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {loading && <TypingIndicator />}
                </div>
              )}

              {expandedChartIndex !== null &&
                (() => {
                  const chartMsg = messages[expandedChartIndex];
                  const parsed = chartMsg?.role === "assistant" ? safeParse(chartMsg.content) : null;
                  if (!parsed || parsed.type !== "trend_chart" || minimizedCharts[expandedChartIndex]) {
                    return null;
                  }

                  return (
                    <div className={styles.chartOverlay} role="dialog" aria-modal="true" aria-label="Expanded chart">
                      <div className={styles.chartOverlayInner}>
                        <TrendChart data={parsed} expanded />
                        <button
                          type="button"
                          className={styles.chartMinimizeBtn}
                          onClick={() => {
                            setMinimizedCharts((prev) => ({ ...prev, [expandedChartIndex]: true }));
                            setExpandedChartIndex(null);
                          }}
                        >
                          Hide Chart
                        </button>
                      </div>
                    </div>
                  );
                })()}

              {/* Screen-reader live region for loading state */}
              <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
                {loading ? "Fetching data, please wait…" : ""}
              </div>

              {/* Input area */}
              <div className={styles.inputArea}>
                {/* Suggestions — shown only when no messages yet */}
                {messages.length === 0 && !loading && (
                  <div className={styles.suggestions}>
                    {activeMode.suggestions.map(s => (
                      <button key={s} type="button" className={styles.suggestion} onClick={() => sendMessage(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {atLimit ? (
                  <div className={styles.limitReached}>
                    Conversation limit reached. Click <strong>New Chat</strong> to begin a new chat.
                  </div>
                ) : (
                  <ChatInputBox
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onSend={() => sendMessage()}
                    loading={loading}
                    disabled={atLimit}
                    placeholder={activeMode.placeholder}
                  />
                )}
                <div className={styles.msgCounter}>{Math.floor(messages.length / 2)} / {MAX_EXCHANGES} messages used</div>
              </div>
            </div>
          )}
        </div>
      </SiteLayout>
    </>
  );
}
