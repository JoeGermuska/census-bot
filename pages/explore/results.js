// pages/explore/results.js — Step 3: run queries and display results
import { useEffect, useMemo, useState, useRef } from "react";
import { usePlaceGeoid } from "../../lib/usePlaceGeoid";
import Head from "next/head";
import { useRouter } from "next/router";
import SiteLayout from "../../components/SiteLayout";
import TrendChart from "../../components/TrendChart";
import ex from "../../styles/Explore.module.css";
import homeStyles from "../../styles/Home.module.css";
import {
  EXPLORE_METRICS_STORAGE_KEY,
  EXPLORE_LOCATION_STORAGE_KEY,
  buildCityStateQuery,
  CURRENT_ACS_YEAR,
  buildCensusProfileUrl,
} from "../../lib/censusConstants";

function buildTrendSummary(points, metric) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const valid = points.filter(p => p.numericValue != null && Number.isFinite(p.numericValue));
  if (valid.length < 2) return null;
  const first = valid[0];
  const last  = valid[valid.length - 1];
  const change = last.numericValue - first.numericValue;
  if (Math.abs(change) < 0.0001 * Math.abs(first.numericValue)) {
    return `${metric} was stable from ${first.year} to ${last.year}.`;
  }
  const dir  = change > 0 ? "increased" : "decreased";
  const pct  = Math.abs(((change / first.numericValue) * 100)).toFixed(1);
  const sign = change > 0 ? "+" : "";
  const fmt  = v => {
    if (!Number.isFinite(v)) return "N/A";
    if (/income|rent|value/i.test(metric))
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
    if (/rate|percent|poverty|unemployment|employment|bachelor|education/i.test(metric)) return `${v.toFixed(2)}%`;
    if (/age/i.test(metric)) return `${v.toFixed(1)} yrs`;
    return new Intl.NumberFormat("en-US").format(Math.round(v));
  };
  return `${metric} ${dir} from ${fmt(first.numericValue)} (${first.year}) to ${fmt(last.numericValue)} (${last.year}) — ${sign}${pct}%.`;
}

function getMetricMeta(metricLabel) {
  const l = (metricLabel || "").toLowerCase();
  const color = "var(--accent)";
  if (l.includes("income") || l.includes("per capita")) return { color };
  if (l.includes("population")) return { color };
  if (l.includes("home value") || l.includes("housing value")) return { color };
  if (l.includes("rent")) return { color };
  if (l.includes("poverty")) return { color };
  if (l.includes("unemployment")) return { color };
  if (l.includes("age")) return { color };
  if (l.includes("commute") || l.includes("travel")) return { color };
  return { color };
}

function ExternalLinkIcon() {
  return (
    <svg
      width="10" height="10" viewBox="0 0 12 12"
      fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: "inline", marginLeft: 4, verticalAlign: "middle", flexShrink: 0, opacity: 0.7 }}
    >
      <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7" />
      <path d="M8 1h3m0 0v3m0-3L5.5 6.5" />
    </svg>
  );
}

function SourceFooter({ source, metric, city, stateName }) {
  const geoid = usePlaceGeoid(city, stateName);
  return (
    <a
      href={buildCensusProfileUrl(city, stateName, metric, geoid)}
      target="_blank" rel="noopener noreferrer"
      className={ex.statSource}
      style={{ textDecoration: "underline", textUnderlineOffset: 2, display: "inline-flex", alignItems: "center" }}
    >
      {source}<ExternalLinkIcon />
    </a>
  );
}

function CardSpinner() {
  return (
    <span style={{
      display: "inline-block", width: 13, height: 13,
      border: "2px solid var(--border)", borderTopColor: "var(--accent)",
      borderRadius: "50%", animation: "spin 0.6s linear infinite", verticalAlign: "middle",
    }} />
  );
}

// ── Shared place search (same UX as location.js) ─────────────────────────────
function PlaceSearch({ city, stateName, onSelect, label, inputId }) {
  const initialDisplay = city && stateName ? `${city}, ${stateName}` : "";
  const [query, setQuery] = useState(initialDisplay);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const debounceRef = useRef(null);
  const retryRef = useRef(null);
  const listRef = useRef(null);

  function doSearch(q) {
    if (q.length < 2) { setResults([]); setOpen(false); setSearching(false); return; }
    setSearching(true);
    fetch(`/api/search-places?q=${encodeURIComponent(q)}&limit=15`)
      .then(r => r.json())
      .then(data => {
        if (data.indexing) {
          setIndexing(true);
          setResults([]);
          retryRef.current = setTimeout(() => doSearch(q), 1800);
        } else {
          setIndexing(false);
          setResults(data.results || []);
          setOpen((data.results || []).length > 0);
        }
        setSearching(false);
      })
      .catch(() => { setResults([]); setSearching(false); });
  }

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    onSelect("", "");
    setCursor(-1);
    clearTimeout(debounceRef.current);
    clearTimeout(retryRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 240);
  }

  function select(place) {
    setQuery(place.display);
    onSelect(place.name, place.state);
    setOpen(false);
    setCursor(-1);
    setResults([]);
  }

  function handleKeyDown(e) {
    if (!open) { if (e.key === "ArrowDown") setOpen(true); return; }
    if (e.key === "Escape") { setOpen(false); setCursor(-1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && cursor >= 0 && results[cursor]) { e.preventDefault(); select(results[cursor]); }
  }

  useEffect(() => {
    if (cursor < 0 || !listRef.current) return;
    listRef.current.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  useEffect(() => () => { clearTimeout(debounceRef.current); clearTimeout(retryRef.current); }, []);

  const showLoading = searching || indexing;

  return (
    <div className={ex.fieldGroup} style={{ flex: 1 }}>
      {label && <label className={ex.fieldLabel} htmlFor={inputId}>{label}</label>}
      <div className={ex.searchInputRow}>
        <div className={ex.comboboxWrap} style={{ flex: 1 }}>
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${inputId}-listbox`}
            aria-haspopup="listbox"
            autoComplete="off"
            spellCheck={false}
            className={ex.comboboxInput}
            value={query}
            placeholder="Search for a location…"
            onChange={handleChange}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            onBlur={() => setTimeout(() => setOpen(false), 160)}
            onKeyDown={handleKeyDown}
          />
          {open && results.length > 0 && (
            <ul
              id={`${inputId}-listbox`}
              role="listbox"
              aria-label="Matching locations"
              ref={listRef}
              className={ex.comboboxList}
            >
              {results.map((place, i) => (
                <li
                  key={place.display}
                  role="option"
                  aria-selected={place.name === city && place.state === stateName}
                  className={`${ex.comboboxItem}${i === cursor ? ` ${ex.comboboxItemActive}` : ""}${place.name === city && place.state === stateName ? ` ${ex.comboboxItemSelected}` : ""}`}
                  onMouseDown={() => select(place)}
                >
                  {place.name === city && place.state === stateName && (
                    <span className={ex.comboboxCheck} aria-hidden>✓</span>
                  )}
                  <span className={ex.placeResultCity}>{place.name}</span>
                  <span className={ex.placeResultState}>{place.state}</span>
                </li>
              ))}
            </ul>
          )}
          {open && !searching && !indexing && results.length === 0 && query.length >= 2 && (
            <div className={ex.comboboxEmpty}>No locations match &ldquo;{query}&rdquo;</div>
          )}
        </div>

        {/* Visible loading indicator to the right of the input */}
        {showLoading && (
          <span className={ex.searchLoadingBadge} aria-live="polite">
            <span className={ex.searchLoadingSpinner} />
            Searching…
          </span>
        )}
      </div>
    </div>
  );
}

export default function ExploreResults() {
  const router = useRouter();
  const targetProgress = 100;
  const [ready, setReady] = useState(false);
  const [metrics, setMetrics] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [trendByQuery, setTrendByQuery] = useState({});
  const [trendLoadingKey, setTrendLoadingKey] = useState(null);
  const [showTrendMap, setShowTrendMap] = useState({});

  // Compare state
  const [showCompare, setShowCompare] = useState(false);
  const [cmpState, setCmpState] = useState("");
  const [cmpCity, setCmpCity] = useState("");
  const [cmpResults, setCmpResults] = useState([]);
  const [cmpLoading, setCmpLoading] = useState(false);

  const fromProgress = useMemo(() => {
    const raw = router.query.from;
    const val = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(val) ? val : 67;
  }, [router.query.from]);
  const [progressWidth, setProgressWidth] = useState(fromProgress);
  const TREND_END_YEAR = parseInt(CURRENT_ACS_YEAR, 10);
  const TREND_START_YEAR = TREND_END_YEAR - 9;

  const stateName = useMemo(() => {
    const raw = router.query.state;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [router.query.state]);

  const city = useMemo(() => {
    const raw = router.query.city;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [router.query.city]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!city || !stateName) { router.replace("/explore/location"); return; }
    try {
      const raw = sessionStorage.getItem(EXPLORE_METRICS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed) || parsed.length === 0) { router.replace("/explore"); return; }
      setMetrics(parsed);
      setReady(true);
    } catch { router.replace("/explore"); }
  }, [router, city, stateName]);

  useEffect(() => {
    setProgressWidth(fromProgress);
    const id = requestAnimationFrame(() => setProgressWidth(targetProgress));
    return () => cancelAnimationFrame(id);
  }, [fromProgress]);

  useEffect(() => {
    if (!ready || metrics.length === 0) return;
    let cancelled = false;
    async function runQueries() {
      setLoading(true);
      setResults([]);
      setTrendByQuery({});
      setShowTrendMap({});
      const entries = await Promise.all(
        metrics.map(async metric => {
          const query = buildCityStateQuery(metric, city, stateName);
          try {
            const res = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
            const data = await res.json();
            if (!res.ok) return { query, metric, error: data.error || "Request failed" };
            return { query, metric, result: data };
          } catch {
            return { query, metric, error: "Network error — check your connection." };
          }
        }),
      );
      if (!cancelled) { setResults(entries); setLoading(false); }
    }
    runQueries();
    return () => { cancelled = true; };
  }, [ready, metrics, city, stateName]);

  async function runCompare() {
    if (!cmpState || !cmpCity) return;
    setCmpLoading(true);
    const entries = await Promise.all(
      metrics.map(async metric => {
        const query = buildCityStateQuery(metric, cmpCity, cmpState);
        try {
          const res = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
          const data = await res.json();
          if (!res.ok) return { metric, error: data.error || "Failed" };
          return { metric, result: data };
        } catch { return { metric, error: "Network error" }; }
      }),
    );
    setCmpResults(entries);
    setCmpLoading(false);
  }

  async function handleTrend(query, metricLabel) {
    setTrendLoadingKey(query);
    try {
      const res = await fetch("/api/trend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, state: stateName, metric: metricLabel, query, startYear: TREND_START_YEAR, endYear: TREND_END_YEAR }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTrendByQuery(prev => ({ ...prev, [query]: { error: data.error || "Trend failed" } }));
      } else {
        const chartData = {
          type: "trend_chart", metric: metricLabel || "Trend",
          location: `${city}, ${stateName}`,
          points: Array.isArray(data) ? data.map(p => ({ year: Number(p.year), numericValue: Number(p.numericValue) })) : [],
          source: "U.S. Census Bureau ACS 5-Year Estimates",
        };
        setTrendByQuery(prev => ({ ...prev, [query]: chartData }));
        setShowTrendMap(prev => ({ ...prev, [query]: true }));
      }
    } catch {
      setTrendByQuery(prev => ({ ...prev, [query]: { error: "Network error" } }));
    } finally { setTrendLoadingKey(null); }
  }

  function toggleTrend(query, metricLabel) {
    const trend = trendByQuery[query];
    if (!trend) { handleTrend(query, metricLabel); }
    else { setShowTrendMap(prev => ({ ...prev, [query]: !prev[query] })); }
  }

  function restartLookup() {
    try {
      sessionStorage.removeItem(EXPLORE_METRICS_STORAGE_KEY);
      sessionStorage.removeItem(EXPLORE_LOCATION_STORAGE_KEY);
    } catch { /* ignore */ }
    router.push({ pathname: "/explore", query: { from: 0 } });
  }

  const canCompare = !!(cmpState && cmpCity);

  if (!ready) {
    return (
      <>
        <Head><title>CensusBot — Explore</title><link rel="icon" href="/favicon.ico" /></Head>
        <SiteLayout><p className={ex.hint} style={{ marginTop: "3rem" }}>Loading…</p></SiteLayout>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>CensusBot — Explore (results)</title>
        <meta name="description" content="View ACS query results and trends." />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <div className={ex.wizardPage}>
          <h1 className={ex.pageTitle}>Quick Lookup</h1>

          <div className={ex.progressBlock}>
            <div className={ex.progressRow}>
              <span>Step 3 of 3</span>
              <span className={ex.progressPct}>100% Complete</span>
            </div>
            <div className={ex.progressTrack}>
              <div className={ex.progressFill} style={{ width: `${progressWidth}%` }} />
            </div>
          </div>

          <div className={ex.card}>
            <p className={ex.question}>Results for {city}, {stateName}</p>
            <div className={ex.footerNav} style={{ marginTop: "2.25rem", maxWidth: "none" }}>
              <button
                type="button"
                className={ex.btnBack}
                onClick={() => {
                  try {
                    sessionStorage.setItem(EXPLORE_METRICS_STORAGE_KEY, JSON.stringify(metrics));
                    sessionStorage.setItem(EXPLORE_LOCATION_STORAGE_KEY, JSON.stringify({ state: stateName, city }));
                  } catch { /* ignore */ }
                  router.push({ pathname: "/explore/location", query: { from: targetProgress, state: stateName, city, restore: 1 } });
                }}
              >
                ← Back
              </button>
              <button type="button" className={ex.btnBack} disabled={loading} onClick={restartLookup}>
                ↺ New Lookup
              </button>
            </div>
          </div>

          <div role="status" aria-live="polite" aria-atomic="true" className={ex.srOnly}>
            {loading ? `Fetching results for ${city}, ${stateName}…` : results.length > 0 ? `${results.length} result${results.length > 1 ? "s" : ""} ready.` : ""}
          </div>

          <section className={ex.resultsSection} aria-label="Query results">
            <h2 className={ex.resultsTitle}>Results</h2>
            {loading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1.5rem" }}>
                {Array.from({ length: metrics.length || 3 }).map((_, i) => (
                  <div key={i} style={{ height: 180, borderRadius: 20, background: "var(--surface)", border: "1px solid var(--border)", opacity: 0.5 + (i * 0.15), animation: "pulse 1.4s ease-in-out infinite", animationDelay: `${i * 120}ms` }} />
                ))}
              </div>
            ) : (
              <div className={ex.resultGrid}>
                {results.map((row, index) => {
                  if (row.error) {
                    return (
                      <div key={row.query} className={homeStyles.error} style={{ borderRadius: 14, animation: `cardReveal 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${index * 70}ms` }}>
                        <span className={homeStyles.errorIcon}>⚠</span>
                        <div><strong>{row.metric}</strong>: {row.error}</div>
                      </div>
                    );
                  }

                  const { result } = row;
                  const { color } = getMetricMeta(result.metric);
                  const trend = trendByQuery[row.query];
                  const trendBusy = trendLoadingKey === row.query;
                  const chartVisible = showTrendMap[row.query] && trend && !trend.error;
                  const hasTrendError = trend?.error != null;
                  const cmpRow = cmpResults.find(r => r.metric === row.metric);
                  const hasCmp = cmpRow && !cmpRow.error;

                  return (
                    <div key={row.query} className={ex.statCard} style={{ "--card-accent": color, animationDelay: `${index * 70}ms` }}>
                      <div className={ex.statMeta}>
                        <span className={ex.statLabel}>{result.metric}</span>
                      </div>

                      <div className={ex.statValueRow}>
                        <div>
                          <div className={ex.statValue}>{result.value}</div>
                          <div className={ex.statLocation}>{result.location}</div>
                        </div>
                        {hasCmp && (
                          <div className={ex.cmpValueBlock}>
                            <div className={ex.cmpValue}>{cmpRow.result.value}</div>
                            <div className={ex.cmpLocation}>{cmpCity}, {cmpState}</div>
                          </div>
                        )}
                      </div>

                      <div className={ex.statDivider} />
                      <button
                        type="button"
                        className={`${ex.statChartBtn}${chartVisible ? ` ${ex.statChartBtnActive}` : ""}`}
                        disabled={trendBusy}
                        onClick={() => toggleTrend(row.query, result.metric)}
                        aria-expanded={chartVisible}
                      >
                        {trendBusy ? <><CardSpinner /> Loading chart…</> : chartVisible ? "↑ Hide Chart" : "↓ Show Trend"}
                      </button>

                      {chartVisible && (
                        <div className={ex.inlineChart}>
                          <TrendChart data={trend} inline />
                          {(() => {
                            const summary = buildTrendSummary(trend.points, result.metric);
                            return summary ? <p className={ex.trendSummary}>{summary}</p> : null;
                          })()}
                        </div>
                      )}
                      {hasTrendError && (
                        <p className={ex.hint} style={{ color: "var(--error)", marginTop: 8 }}>
                          {typeof trend.error === "string" ? trend.error : "Could not load trend."}
                        </p>
                      )}
                      <SourceFooter source={result.source} metric={result.metric} city={city} stateName={stateName} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Compare section ── */}
          {!loading && results.length > 0 && (
            <div className={ex.compareSection}>
              {!showCompare ? (
                <button type="button" className={ex.btnCompare} onClick={() => setShowCompare(true)}>
                  ＋ Compare With Another City
                </button>
              ) : (
                <div className={ex.compareCard}>
                  <p className={ex.compareTitle}>Compare with</p>
                  <PlaceSearch
                    city={cmpCity}
                    stateName={cmpState}
                    inputId="compare-place"
                    onSelect={(c, s) => { setCmpCity(c); setCmpState(s); setCmpResults([]); }}
                  />
                  <div className={ex.compareActions}>
                    <button
                      type="button"
                      className={ex.btnBack}
                      onClick={() => { setShowCompare(false); setCmpState(""); setCmpCity(""); setCmpResults([]); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={`${ex.btnPrimary}${canCompare ? ` ${ex.btnPrimaryActive}` : ""}`}
                      disabled={!canCompare || cmpLoading}
                      onClick={runCompare}
                    >
                      {cmpLoading ? <span className={ex.spinner} /> : "Compare →"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Bottom restart ── */}
          {!loading && results.length > 0 && (
            <div className={ex.bottomActions}>
              <button type="button" className={ex.btnStartNew} onClick={restartLookup}>
                ↺ Start a New Lookup
              </button>
            </div>
          )}
        </div>
      </SiteLayout>
    </>
  );
}
