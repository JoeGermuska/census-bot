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
} from "../../lib/censusConstants";

export default function ExploreResults() {
  const router = useRouter();
  const targetProgress = 100;
  const [ready, setReady] = useState(false);
  const [metrics, setMetrics] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [trendByQuery, setTrendByQuery] = useState({});
  const [trendLoadingKey, setTrendLoadingKey] = useState(null);
  const fromProgress = useMemo(() => {
    const raw = router.query.from;
    const val = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(val) ? val : 67;
  }, [router.query.from]);
  const [progressWidth, setProgressWidth] = useState(fromProgress);
  const TREND_END_YEAR = 2022;
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
            if (!res.ok) {
              return { query, metric, error: data.error || "Request failed" };
            }
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

    return () => {
      cancelled = true;
    };
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
            ? data.map((point) => ({
                year: Number(point.year),
                numericValue: Number(point.numericValue),
              }))
            : [],
          source: "U.S. Census Bureau ACS 5-Year Estimates",
        };
        setTrendByQuery(prev => ({ ...prev, [query]: chartData }));
      }
    } catch {
      setTrendByQuery(prev => ({ ...prev, [query]: { error: "Network error" } }));
    } finally {
      setTrendLoadingKey(null);
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
          <h1 className={ex.pageTitle}>Explore Data</h1>

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
                  } catch {
                    /* ignore */
                  }
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
                  } catch {
                    /* ignore */
                  }
                  router.push({ pathname: "/explore", query: { from: 0 } });
                }}
              >
                {loading ? <span className={ex.spinner} /> : "Restart"}
              </button>
            </div>
          </div>

          <section className={ex.resultsSection} aria-label="Query results">
            <h2 className={ex.resultsTitle}>Results</h2>
            {loading ? (
              <p className={ex.hint}>Loading results…</p>
            ) : (
              <div className={ex.resultStack}>
                {results.map(row => {
                  if (row.error) {
                    return (
                      <div key={row.query} className={homeStyles.error}>
                        <span className={homeStyles.errorIcon}>⚠</span>
                        <div>
                          <strong>{row.metric}</strong>
                          {": "}
                          {row.error}
                        </div>
                      </div>
                    );
                  }
                  const { result } = row;
                  const trend = trendByQuery[row.query];
                  const trendBusy = trendLoadingKey === row.query;

                  return (
                    <div key={row.query}>
                      <div
                        className={homeStyles.result}
                      >
                        <div className={homeStyles.resultLabel}>{result.metric}</div>
                        <div
                          className={homeStyles.resultValue}
                          style={{ textShadow: "var(--result-value-shadow)" }}
                        >
                          {result.value}
                        </div>
                        <div className={homeStyles.resultLocation}>📍 {result.location}</div>
                        <div className={homeStyles.resultSource}>{result.source}</div>
                      </div>
                      <button
                        type="button"
                        className={`${homeStyles.button} ${homeStyles.trendButton}`}
                        style={{ marginTop: 10 }}
                        disabled={trendBusy}
                        onClick={() => handleTrend(row.query, result.metric)}
                      >
                        {trendBusy ? <span className={homeStyles.spinner} /> : "📈 Show Chart"}
                      </button>
                      {trend && trend.error != null && (
                        <p className={ex.hint} style={{ color: "var(--error)" }}>
                          {typeof trend.error === "string" ? trend.error : "Could not load trend."}
                        </p>
                      )}
                      {trend && !trend.error && trend.points && (
                        <TrendChart data={trend} />
                      )}
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

