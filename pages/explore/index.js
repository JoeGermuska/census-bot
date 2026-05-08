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

// SVG icons — stroke style matching the nav icons
const S = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

function IconIncome()     { return <svg {...S}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>; }
function IconPopulation() { return <svg {...S}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function IconRent()       { return <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>; }
function IconHomeValue()  { return <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="1" x2="12" y2="5"/><path d="M10 17h4"/><path d="M12 15v4"/></svg>; }
function IconPoverty()    { return <svg {...S}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>; }
function IconAge()        { return <svg {...S}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>; }
function IconUnemployment() { return <svg {...S}><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>; }
function IconCommute()    { return <svg {...S}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconHouseholdIncome() { return <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 16h6"/><path d="M12 13v6"/></svg>; }
function IconPerCapita()  { return <svg {...S}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="12" y1="1" x2="12" y2="4"/></svg>; }

const METRIC_ICONS = {
  "median income":           IconIncome,
  "population":              IconPopulation,
  "median rent":             IconRent,
  "median home value":       IconHomeValue,
  "poverty rate":            IconPoverty,
  "median age":              IconAge,
  "unemployment rate":       IconUnemployment,
  "commute time":            IconCommute,
  "median household income": IconHouseholdIncome,
  "per capita income":       IconPerCapita,
};

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
                    <span className={ex.choiceIcon}>
                      {(() => { const Icon = METRIC_ICONS[metric]; return Icon ? <Icon /> : null; })()}
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
              className={`${ex.btnPrimary}${selected.size > 0 ? ` ${ex.btnPrimaryActive}` : ""}`}
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
