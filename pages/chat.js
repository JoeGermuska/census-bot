// pages/chat.js — Ask Question: Claude-powered Census chatbot
import { useState, useRef, useEffect } from "react";
import Head from "next/head";
import SiteLayout from "../components/SiteLayout";
import TrendChart from "../components/TrendChart";
import ChatInputBox from "../components/ChatInputBox";
import styles from "../styles/Chat.module.css";

const MAX_EXCHANGES = 10;

// ── Modes ────────────────────────────────────────────────────────────────────
const MODES = [
  {
    id: "learn",
    label: "Learn about ACS",
    icon: "",
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
    icon: "",
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
    icon: "",
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

// ── Component ────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [mode, setMode] = useState(null); // null = show mode picker
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedChartIndex, setExpandedChartIndex] = useState(null);
  const [minimizedCharts, setMinimizedCharts] = useState({});
  const listRef = useRef(null);
  const textareaRef = useRef(null);

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
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <h1 className={styles.title}>Ask a Question</h1>
              <p className={styles.subtitle}>
                {activeMode ? activeMode.description : "Choose how you want to explore Census data."}
              </p>
            </div>
            {(mode !== null) && (
              <button type="button" className={styles.clearBtn} onClick={clearChat}>
                ← Start over
              </button>
            )}
          </div>

          {/* Mode picker — shown when no mode selected */}
          {mode === null ? (
            <div className={styles.modePicker}>
              <p className={styles.modePickerLabel}>What would you like to do?</p>
              <div className={styles.modeGrid}>
                {MODES.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    className={styles.modeCard}
                    onClick={() => selectMode(m.id)}
                  >
                    {m.icon && <span className={styles.modeIcon}>{m.icon}</span>}
                    <span className={styles.modeLabel}>{m.label}</span>
                    <span className={styles.modeDesc}>{m.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Active mode badge */}
              <div className={styles.modeBadge}>
                <span>{activeMode.icon}</span>
                <span>{activeMode.label}</span>
              </div>

              {/* Limit notice */}
              <div className={styles.limitNotice}>
                Conversations limited to 10 exchanges. Click <strong>Start over</strong> to reset.
              </div>

              {/* Message list / suggestions */}
              {messages.length === 0 && !loading ? (
                <div className={styles.emptyState}>
                  <p className={styles.emptyText}>{activeMode.description}</p>
                  <div className={styles.suggestions}>
                    {activeMode.suggestions.map(s => (
                      <button key={s} type="button" className={styles.suggestion} onClick={() => sendMessage(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
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
                            ) : (
                              renderMarkdown(msg.content)
                            )
                          ) : (
                            msg.content
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
                {atLimit ? (
                  <div className={styles.limitReached}>
                    Conversation limit reached. Click <strong>Start over</strong> to begin a new chat.
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
              </div>
            </>
          )}
        </div>
      </SiteLayout>
    </>
  );
}
