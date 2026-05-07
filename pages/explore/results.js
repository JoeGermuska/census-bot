// pages/explore/results.js — Step 3: run queries and display results
import { useEffect, useMemo, useState } from "react";
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
} from "../../lib/censusConstants";

// Plain-English bottom-line summary for a trend result
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

// Per-metric icons (color is unified to the purple accent across all metrics)
function getMetricMeta(metricLabel) {
  const l = (metricLabel || "").toLowerCase();
  const color = "var(--accent)";
  if (l.includes("income") || l.includes("per capita")) return { color, icon: "💰" };
  if (l.includes("population")) return { color, icon: "👥" };
  if (l.includes("home value") || l.includes("housing value")) return { color, icon: "🏠" };
  if (l.includes("rent")) return { color, icon: "🏢" };
  if (l.includes("housing unit")) return { color, icon: "🏘️" };
  if (l.includes("poverty")) return { color, icon: "📊" };
  if (l.includes("unemployment")) return { color, icon: "📉" };
  if (l.includes("employment")) return { color, icon: "📈" };
  if (l.includes("age")) return { color, icon: "📅" };
  if (l.includes("commute") || l.includes("travel")) return { color, icon: "🚇" };
  if (l.includes("bachelor") || l.includes("education")) return { color, icon: "🎓" };
  return { color, icon: "📌" };
}

function CardSpinner() {
  return (
    <span style={{
      display: "inline-block",
      width: 13, height: 13,
      border: "2px solid var(--border)",
      borderTopColor: "var(--accent)",
      borderRadius: "50%",
      animation: "spin 0.6s linear infinite",
      verticalAlign: "middle",
    }} />
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
    if (!city || !stateName) {
      router.replace("/explore/location");
      return;
    }
    try {
      const raw = sessionStorage.getItem(EXPLORE_METRICS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        router.replace("/explore");
        return;
      }
      setMetrics(parsed);
      setReady(true);
    } catch {
      router.replace("/explore");
    }
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
            const res = await fetch("/api/query", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query }),
            });
            const data = await res.json();
            if (!res.ok) return { query, metric, error: data.error || "Request failed" };
            return { query, metric, result: data };
          } catch {
            return { query, metric, error: "Network error — check your connection." };
          }
        }),
      );

      if (!cancelled) {
        setResults(entries);
        setLoading(false);
      }
    }

    runQueries();
    return () => { cancelled = true; };
  }, [ready, metrics, city, stateName]);

  async function handleTrend(query, metricLabel) {
    setTrendLoadingKey(query);
    try {
      const res = await fetch("/api/trend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city,
          state: stateName,
          metric: metricLabel,
          query,
          startYear: TREND_START_YEAR,
          endYear: TREND_END_YEAR,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTrendByQuery(prev => ({ ...prev, [query]: { error: data.error || "Trend failed" } }));
      } else {
        const chartData = {
          type: "trend_chart",
          metric: metricLabel || "Trend",
          location: `${city}, ${stateName}`,
          points: Array.isArray(data)
            ? data.map(p => ({ year: Number(p.year), numericValue: Number(p.numericValue) }))
            : [],
          source: "U.S. Census Bureau ACS 5-Year Estimates",
        };
        setTrendByQuery(prev => ({ ...prev, [query]: chartData }));
        setShowTrendMap(prev => ({ ...prev, [query]: true }));
      }
    } catch {
      setTrendByQuery(prev => ({ ...prev, [query]: { error: "Network error" } }));
    } finally {
      setTrendLoadingKey(null);
    }
  }

  function toggleTrend(query, metricLabel) {
    const trend = trendByQuery[query];
    if (!trend) {
      handleTrend(query, metricLabel);
    } else {
      setShowTrendMap(prev => ({ ...prev, [query]: !prev[query] }));
    }
  }

  if (!ready) {
    return (
      <>
        <Head>
          <title>CensusBot — Explore</title>
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <SiteLayout>
          <p className={ex.hint} style={{ marginTop: "3rem" }}>Loading…</p>
        </SiteLayout>
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
                    sessionStorage.setItem(
                      EXPLORE_LOCATION_STORAGE_KEY,
                      JSON.stringify({ state: stateName, city }),
                    );
                  } catch { /* ignore */ }
                  router.push({
                    pathname: "/explore/location",
                    query: { from: targetProgress, state: stateName, city, restore: 1 },
                  });
                }}
              >
                ← Back
              </button>
              <button
                type="button"
                className={ex.btnPrimary}
                disabled={loading}
                onClick={() => {
                  try {
                    sessionStorage.removeItem(EXPLORE_METRICS_STORAGE_KEY);
                    sessionStorage.removeItem(EXPLORE_LOCATION_STORAGE_KEY);
                  } catch { /* ignore */ }
                  router.push({ pathname: "/explore", query: { from: 0 } });
                }}
              >
                {loading ? <span className={ex.spinner} /> : "Restart"}
              </button>
            </div>
          </div>

          {/* Screen-reader live region */}
          <div role="status" aria-live="polite" aria-atomic="true" className={ex.srOnly}>
            {loading
              ? `Fetching results for ${city}, ${stateName}…`
              : results.length > 0
              ? `${results.length} result${results.length > 1 ? "s" : ""} ready.`
              : ""}
          </div>

          <section className={ex.resultsSection} aria-label="Query results">
            <h2 className={ex.resultsTitle}>Results</h2>
            {loading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1.5rem" }}>
                {Array.from({ length: metrics.length || 3 }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      height: 180,
                      borderRadius: 20,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      opacity: 0.5 + (i * 0.15),
                      animation: "pulse 1.4s ease-in-out infinite",
                      animationDelay: `${i * 120}ms`,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className={ex.resultGrid}>
                {results.map((row, index) => {
                  if (row.error) {
                    return (
                      <div
                        key={row.query}
                        className={homeStyles.error}
                        style={{
                          borderRadius: 14,
                          animation: `cardReveal 0.5s cubic-bezier(0.22,1,0.36,1) both`,
                          animationDelay: `${index * 70}ms`,
                        }}
                      >
                        <span className={homeStyles.errorIcon}>⚠</span>
                        <div>
                          <strong>{row.metric}</strong>: {row.error}
                        </div>
                      </div>
                    );
                  }

                  const { result } = row;
                  const { color } = getMetricMeta(result.metric);
                  const trend = trendByQuery[row.query];
                  const trendBusy = trendLoadingKey === row.query;
                  const chartVisible = showTrendMap[row.query] && trend && !trend.error;
                  const hasTrendError = trend?.error != null;

                  return (
                    <div
                      key={row.query}
                      className={ex.statCard}
                      style={{
                        "--card-accent": color,
                        animationDelay: `${index * 70}ms`,
                      }}
                    >
                      {/* Metric label */}
                      <div className={ex.statMeta}>
                        <span className={ex.statLabel}>{result.metric}</span>
                      </div>

                      {/* Main value */}
                      <div className={ex.statValue}>{result.value}</div>

                      {/* Location */}
                      <div className={ex.statLocation}>{result.location}</div>

                      {/* Divider + chart toggle */}
                      <div className={ex.statDivider} />
                      <button
                        type="button"
                        className={`${ex.statChartBtn}${chartVisible ? ` ${ex.statChartBtnActive}` : ""}`}
                        disabled={trendBusy}
                        onClick={() => toggleTrend(row.query, result.metric)}
                        aria-expanded={chartVisible}
                      >
                        {trendBusy
                          ? <><CardSpinner /> Loading chart…</>
                          : chartVisible
                            ? "↑ Hide Chart"
                            : "↓ Show Trend"}
                      </button>

                      {/* Inline chart + bottom-line summary */}
                      {chartVisible && (
                        <div className={ex.inlineChart}>
                          <TrendChart data={trend} inline />
                          {(() => {
                            const summary = buildTrendSummary(trend.points, result.metric);
                            return summary ? (
                              <p className={ex.trendSummary}>{summary}</p>
                            ) : null;
                          })()}
                        </div>
                      )}

                      {/* Trend error */}
                      {hasTrendError && (
                        <p className={ex.hint} style={{ color: "var(--error)", marginTop: 8 }}>
                          {typeof trend.error === "string" ? trend.error : "Could not load trend."}
                        </p>
                      )}

                      {/* Source */}
                      <div className={ex.statSource}>{result.source}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </SiteLayout>
    </>
  );
}
