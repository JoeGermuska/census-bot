// pages/explore/index.js — Step 1: choose metrics (multi-select)
import { useState, useCallback, useMemo, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import SiteLayout from "../../components/SiteLayout";
import ex from "../../styles/Explore.module.css";
import {
  QUERY_TYPES,
  EXPLORE_METRICS_STORAGE_KEY,
  EXPLORE_LOCATION_STORAGE_KEY,
} from "../../lib/censusConstants";

// Maps homepage chip slugs (?m=<slug>) to QUERY_TYPES entries.
const SLUG_TO_METRIC = {
  income: "median income",
  rent: "median rent",
  population: "population",
  poverty: "poverty rate",
  age: "median age",
  employment: "unemployment rate",
  education: "median household income",
  housing: "median home value",
};

export default function ExploreMetrics() {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set());
  const targetProgress = 33;
  const fromProgress = useMemo(() => {
    const raw = router.query.from;
    const val = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(val) ? val : 0;
  }, [router.query.from]);
  const [progressWidth, setProgressWidth] = useState(fromProgress);
  const shouldRestore = useMemo(() => {
    const raw = router.query.restore;
    return (Array.isArray(raw) ? raw[0] : raw) === "1";
  }, [router.query.restore]);
  const presetMetric = useMemo(() => {
    const raw = router.query.m;
    const slug = Array.isArray(raw) ? raw[0] : raw;
    if (!slug) return null;
    return SLUG_TO_METRIC[slug] || null;
  }, [router.query.m]);

  const toggle = useCallback(metric => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  }, []);

  useEffect(() => {
    setProgressWidth(fromProgress);
    const id = requestAnimationFrame(() => setProgressWidth(targetProgress));
    return () => cancelAnimationFrame(id);
  }, [fromProgress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (shouldRestore) {
        const raw = sessionStorage.getItem(EXPLORE_METRICS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) setSelected(new Set(parsed));
      } else {
        sessionStorage.removeItem(EXPLORE_METRICS_STORAGE_KEY);
        sessionStorage.removeItem(EXPLORE_LOCATION_STORAGE_KEY);
        setSelected(presetMetric ? new Set([presetMetric]) : new Set());
      }
    } catch {
      setSelected(presetMetric ? new Set([presetMetric]) : new Set());
    }
  }, [shouldRestore, presetMetric]);

  function handleNext() {
    const list = [...selected];
    if (list.length === 0) return;
    try {
      sessionStorage.setItem(EXPLORE_METRICS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
    router.push({ pathname: "/explore/location", query: { from: targetProgress } });
  }

  return (
    <>
      <Head>
        <title>CensusBot — Explore (metrics)</title>
        <meta name="description" content="Select ACS metrics to explore." />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <div className={ex.wizardPage}>
          <h1 className={ex.pageTitle}>Quick Lookup</h1>

          <div className={ex.progressBlock}>
            <div className={ex.progressRow}>
              <span>Step 1 of 3</span>
              <span className={ex.progressPct}>33% Complete</span>
            </div>
            <div className={ex.progressTrack}>
              <div className={ex.progressFill} style={{ width: `${progressWidth}%` }} />
            </div>
          </div>

          <div className={ex.card}>
            <p className={ex.question}>
              Which information would you like to see?
            </p>
            <p className={ex.questionSub}>Select all that apply. ({selected.size}/10 selected)</p>
            <div className={ex.choiceList}>
              {QUERY_TYPES.map(metric => {
                const on = selected.has(metric);
                return (
                  <button
                    key={metric}
                    type="button"
                    className={`${ex.choice} ${on ? ex.choiceSelected : ""}`}
                    onClick={() => toggle(metric)}
                    aria-pressed={on}
                  >
                    <span className={ex.choiceCheck} aria-hidden="true">
                      {on ? "✓" : "+"}
                    </span>
                    {metric}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={ex.footerNav} style={{ justifyContent: "flex-end" }}>
            <button
              type="button"
              className={ex.btnPrimary}
              disabled={selected.size === 0}
              onClick={handleNext}
            >
              Next →
            </button>
          </div>
        </div>
      </SiteLayout>
    </>
  );
}
