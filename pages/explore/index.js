// pages/explore/index.js — Step 1: choose metrics (multi-select, grouped)
import { useState, useCallback, useMemo, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import SiteLayout from "../../components/SiteLayout";
import ex from "../../styles/Explore.module.css";
import {
  EXPLORE_METRICS_STORAGE_KEY,
  EXPLORE_LOCATION_STORAGE_KEY,
} from "../../lib/censusConstants";

// ── SVG icon components (stroke style, matching nav icons) ───────────────────
const S = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

// Demographics
function IconPeople()       { return <svg {...S}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function IconCalendar()     { return <svg {...S}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }
function IconGlobe()        { return <svg {...S}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>; }
function IconStar()         { return <svg {...S}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }
function IconUserX()        { return <svg {...S}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>; }
function IconShield()       { return <svg {...S}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }

// Income & Economics
function IconDollar()       { return <svg {...S}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>; }
function IconHouseIncome()  { return <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9.5" y1="14.5" x2="14.5" y2="14.5"/></svg>; }
function IconUsers()        { return <svg {...S}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function IconPersonDollar() { return <svg {...S}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="12" y1="1" x2="12" y2="4"/></svg>; }
function IconBriefcase()    { return <svg {...S}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>; }
function IconBarChart()     { return <svg {...S}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>; }
function IconTrendDown()    { return <svg {...S}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>; }
function IconScales()       { return <svg {...S}><line x1="12" y1="3" x2="12" y2="21"/><path d="M3 9l9-7 9 7"/><path d="M3 15h6a3 3 0 0 0 0-6H3l3 6z"/><path d="M21 15h-6a3 3 0 0 1 0-6h6l-3 6z"/></svg>; }

// Education
function IconGradCap()      { return <svg {...S}><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>; }
function IconBook()         { return <svg {...S}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>; }
function IconBookOpen()     { return <svg {...S}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>; }
function IconAward()        { return <svg {...S}><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>; }

// Housing
function IconKey()          { return <svg {...S}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>; }
function IconHouse()        { return <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>; }
function IconHouseEmpty()   { return <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/><line x1="12" y1="12" x2="12" y2="22" strokeDasharray="2 2"/></svg>; }
function IconHouseCheck()   { return <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 12 11 14 15 10"/></svg>; }
function IconPercent()      { return <svg {...S}><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>; }

// Race & Ethnicity
function IconFlag()         { return <svg {...S}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>; }

// Transportation
function IconClock()        { return <svg {...S}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconCar()          { return <svg {...S}><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>; }
function IconCarpool()      { return <svg {...S}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><rect x="13" y="14" width="8" height="7" rx="1"/><circle cx="15.5" cy="21.5" r="1.5"/><circle cx="19.5" cy="21.5" r="1.5"/></svg>; }
function IconBus()          { return <svg {...S}><rect x="2" y="3" width="20" height="16" rx="2"/><path d="M2 11h20"/><path d="M7 19v2"/><path d="M17 19v2"/><circle cx="7" cy="15" r="1"/><circle cx="17" cy="15" r="1"/></svg>; }
function IconWalk()         { return <svg {...S}><circle cx="12" cy="4" r="2"/><path d="M9 20l1-6 2 3 2-3 1 6"/><path d="M6.5 10.5c1.5-1 3.5-2 5.5-2s3.5.7 4.5 2"/><path d="M8.5 18.5L7 22"/><path d="M15.5 18.5L17 22"/></svg>; }
function IconBike()         { return <svg {...S}><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>; }
function IconLaptop()       { return <svg {...S}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>; }

// ── Metric groups ────────────────────────────────────────────────────────────
const METRIC_GROUPS = [
  {
    id: "demographics",
    label: "Demographics",
    metrics: [
      { key: "population",              label: "Population",               Icon: IconPeople },
      { key: "median age",              label: "Median Age",               Icon: IconCalendar },
      { key: "foreign-born population", label: "Foreign-Born Population",  Icon: IconGlobe },
      { key: "naturalized citizens",    label: "Naturalized Citizens",     Icon: IconStar },
      { key: "non-citizens",            label: "Non-Citizens",             Icon: IconUserX },
      { key: "veterans",                label: "Veterans",                 Icon: IconShield },
    ],
  },
  {
    id: "income",
    label: "Income & Economics",
    metrics: [
      { key: "median income",           label: "Median Income",            Icon: IconDollar },
      { key: "median household income", label: "Median Household Income",  Icon: IconHouseIncome },
      { key: "median family income",    label: "Median Family Income",     Icon: IconUsers },
      { key: "per capita income",       label: "Per Capita Income",        Icon: IconPersonDollar },
      { key: "median earnings",         label: "Median Earnings",          Icon: IconBriefcase },
      { key: "poverty rate",            label: "Poverty Rate",             Icon: IconBarChart },
      { key: "unemployment rate",       label: "Unemployment Rate",        Icon: IconTrendDown },
      { key: "gini index",              label: "Gini Index",               Icon: IconScales },
    ],
  },
  {
    id: "education",
    label: "Education",
    metrics: [
      { key: "associate's degree",      label: "Associate's Degree",       Icon: IconBook },
      { key: "bachelor's degree",       label: "Bachelor's Degree",        Icon: IconBookOpen },
      { key: "master's degree",         label: "Master's Degree",          Icon: IconGradCap },
      { key: "graduate degree",         label: "Graduate Degree",          Icon: IconAward },
    ],
  },
  {
    id: "housing",
    label: "Housing",
    metrics: [
      { key: "median rent",             label: "Median Rent",              Icon: IconKey },
      { key: "median home value",       label: "Median Home Value",        Icon: IconHouse },
      { key: "vacancy rate",            label: "Vacancy Rate",             Icon: IconHouseEmpty },
      { key: "homeownership rate",      label: "Homeownership Rate",       Icon: IconHouseCheck },
      { key: "rent burden",             label: "Rent Burden",              Icon: IconPercent },
    ],
  },
  {
    id: "race",
    label: "Race & Ethnicity",
    metrics: [
      { key: "asian population",            label: "Asian",                    Icon: IconFlag },
      { key: "black population",            label: "Black",                    Icon: IconFlag },
      { key: "white population",            label: "White",                    Icon: IconFlag },
      { key: "hispanic population",         label: "Hispanic or Latino",       Icon: IconFlag },
      { key: "native american population",  label: "Native American",          Icon: IconFlag },
      { key: "pacific islander population", label: "Pacific Islander",         Icon: IconFlag },
      { key: "multiracial",                 label: "Multiracial",              Icon: IconFlag },
    ],
  },
  {
    id: "transportation",
    label: "Transportation & Commute",
    metrics: [
      { key: "commute time",            label: "Commute Time",             Icon: IconClock },
      { key: "drove alone to work",     label: "Drove Alone",              Icon: IconCar },
      { key: "carpooled to work",       label: "Carpooled",                Icon: IconCarpool },
      { key: "used public transportation", label: "Public Transit",        Icon: IconBus },
      { key: "walked to work",          label: "Walked to Work",           Icon: IconWalk },
      { key: "bicycled to work",        label: "Bicycled to Work",         Icon: IconBike },
      { key: "worked from home",        label: "Worked from Home",         Icon: IconLaptop },
    ],
  },
];

// Flat list of all metric keys (for storage / restore compatibility)
const ALL_METRIC_KEYS = METRIC_GROUPS.flatMap(g => g.metrics.map(m => m.key));

// Maps homepage chip slugs (?m=<slug>) to metric keys
const SLUG_TO_METRIC = {
  income:     "median income",
  rent:       "median rent",
  population: "population",
  poverty:    "poverty rate",
  age:        "median age",
  employment: "unemployment rate",
  education:  "bachelor's degree",
  housing:    "median home value",
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
    return slug ? (SLUG_TO_METRIC[slug] || null) : null;
  }, [router.query.m]);

  const toggle = useCallback(key => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
    } catch { /* ignore */ }
    router.push({ pathname: "/explore/location", query: { from: targetProgress } });
  }

  const totalSelected = selected.size;

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
            <p className={ex.question}>Which information would you like to see?</p>
            <p className={ex.questionSub}>
              Select all that apply.{totalSelected > 0 ? ` (${totalSelected} selected)` : ""}
            </p>

            <div className={ex.metricGroups}>
              {METRIC_GROUPS.map(group => {
                const groupKeys = group.metrics.map(m => m.key);
                const groupSelected = groupKeys.filter(k => selected.has(k)).length;
                return (
                  <div key={group.id} className={ex.metricGroup}>
                    <div className={ex.metricGroupHeader}>
                      <span className={ex.metricGroupLabel}>{group.label}</span>
                      <span className={ex.metricGroupCount}>
                        {groupSelected}/{group.metrics.length}
                      </span>
                      <button
                        type="button"
                        className={`${ex.selectAllBtn} ${groupSelected > 0 ? ex.selectAllBtnActive : ""}`}
                        onClick={() => {
                          if (groupSelected > 0) {
                            setSelected(prev => { const n = new Set(prev); groupKeys.forEach(k => n.delete(k)); return n; });
                          } else {
                            setSelected(prev => { const n = new Set(prev); groupKeys.forEach(k => n.add(k)); return n; });
                          }
                        }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        {groupSelected > 0 ? "Deselect All" : "Select All"}
                      </button>
                    </div>
                    <div className={ex.choiceList}>
                      {group.metrics.map(({ key, label }) => {
                        const on = selected.has(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`${ex.choice} ${on ? ex.choiceSelected : ""}`}
                            onClick={() => toggle(key)}
                            aria-pressed={on}
                          >
                            {on && (
                              <span className={ex.choiceCheck} aria-hidden="true">✓</span>
                            )}
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
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

          <p className={ex.excludedNote}>
            Not included: health insurance coverage, disability status, language spoken at home,
            marital status and household composition, industry and occupation, computer and
            internet access, vehicles available, year structure built, and migration/mobility.
          </p>
        </div>
      </SiteLayout>
    </>
  );
}
