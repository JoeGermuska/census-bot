// pages/explore/location.js — Step 2: choose state + city
import { useState, useEffect, useMemo, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import SiteLayout from "../../components/SiteLayout";
import ex from "../../styles/Explore.module.css";
import homeStyles from "../../styles/Home.module.css";
import {
  EXPLORE_METRICS_STORAGE_KEY,
  STATE_NAMES,
} from "../../lib/censusConstants";

// ── Searchable city combobox ─────────────────────────────────────────────────
function CityCombobox({ cities, value, onChange, disabled, loading }) {
  const [query, setQuery]   = useState(value);
  const [open, setOpen]     = useState(false);
  const [cursor, setCursor] = useState(-1);
  const listRef  = useRef(null);
  const inputRef = useRef(null);

  // Sync query with external value changes (e.g. state reset)
  useEffect(() => { setQuery(value); }, [value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return cities;
    const q = query.toLowerCase();
    return cities.filter(c => c.toLowerCase().includes(q));
  }, [query, cities]);

  function select(city) {
    setQuery(city);
    onChange(city);
    setOpen(false);
    setCursor(-1);
  }

  function handleInput(e) {
    setQuery(e.target.value);
    onChange(""); // clear confirmed value while typing
    setOpen(true);
    setCursor(-1);
  }

  function handleKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "Escape") { setOpen(false); setCursor(-1); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    }
    if (e.key === "Enter" && cursor >= 0 && filtered[cursor]) {
      e.preventDefault();
      select(filtered[cursor]);
    }
  }

  // Scroll active item into view
  useEffect(() => {
    if (cursor < 0 || !listRef.current) return;
    const item = listRef.current.children[cursor];
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div className={ex.comboboxWrap}>
      <input
        ref={inputRef}
        id="explore-city"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="city-listbox"
        aria-haspopup="listbox"
        autoComplete="off"
        className={ex.comboboxInput}
        value={query}
        placeholder={
          disabled
            ? "Choose a state first"
            : loading
            ? "Loading places…"
            : "Type to search any place in this state…"
        }
        disabled={disabled || loading}
        onChange={handleInput}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && !disabled && (
        <ul
          id="city-listbox"
          role="listbox"
          aria-label="Cities"
          ref={listRef}
          className={ex.comboboxList}
        >
          {filtered.map((city, i) => (
            <li
              key={city}
              role="option"
              aria-selected={city === value}
              className={`${ex.comboboxItem}${i === cursor ? ` ${ex.comboboxItemActive}` : ""}${city === value ? ` ${ex.comboboxItemSelected}` : ""}`}
              onMouseDown={() => select(city)}
            >
              {city === value && <span className={ex.comboboxCheck} aria-hidden>✓</span>}
              {city}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && !disabled && (
        <div className={ex.comboboxEmpty}>No cities match "{query}"</div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ExploreLocation() {
  const router = useRouter();
  const targetProgress = 67;
  const fromProgress = useMemo(() => {
    const raw = router.query.from;
    const val = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(val) ? val : 33;
  }, [router.query.from]);
  const [ready, setReady]           = useState(false);
  const [stateName, setStateName]   = useState("");
  const [city, setCity]             = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState(null);
  const [progressWidth, setProgressWidth] = useState(fromProgress);
  const [places, setPlaces]         = useState([]); // [{ name, type, raw }]
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState(null);
  const placesCache = useRef(new Map()); // state name → places[]

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(EXPLORE_METRICS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        router.replace("/explore");
        return;
      }

      const qState = Array.isArray(router.query.state) ? router.query.state[0] : router.query.state;
      const qCity  = Array.isArray(router.query.city)  ? router.query.city[0]  : router.query.city;
      if (qState && STATE_NAMES.includes(qState)) {
        setStateName(qState);
        if (qCity) setCity(qCity); // validated against fetched places below
      }
    } catch {
      router.replace("/explore");
      return;
    }
    setReady(true);
  }, [router]);

  const cityNames = useMemo(() => places.map(p => p.name), [places]);

  // Fetch the full Census Places list for the chosen state.
  useEffect(() => {
    if (!stateName) {
      setPlaces([]);
      setPlacesError(null);
      return;
    }
    const cached = placesCache.current.get(stateName);
    if (cached) {
      setPlaces(cached);
      setPlacesError(null);
      return;
    }
    let cancelled = false;
    setPlacesLoading(true);
    setPlacesError(null);
    (async () => {
      try {
        const res = await fetch(`/api/places?state=${encodeURIComponent(stateName)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setPlacesError(data?.error || "Couldn't load places for this state.");
          setPlaces([]);
          return;
        }
        const list = Array.isArray(data.places) ? data.places : [];
        placesCache.current.set(stateName, list);
        setPlaces(list);
      } catch (err) {
        if (!cancelled) {
          setPlacesError("Network error loading places.");
          setPlaces([]);
        }
      } finally {
        if (!cancelled) setPlacesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stateName]);

  useEffect(() => {
    setProgressWidth(fromProgress);
    const id = requestAnimationFrame(() => setProgressWidth(targetProgress));
    return () => cancelAnimationFrame(id);
  }, [fromProgress]);

  const canContinue = !!(stateName && city);

  function viewResults() {
    if (!canContinue) {
      setFormError("Choose a state and a city. City is required.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    router.push({
      pathname: "/explore/results",
      query: { state: stateName, city, from: targetProgress },
    });
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
        <title>CensusBot — Explore (location)</title>
        <meta name="description" content="Choose state and city for ACS lookup." />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <div className={ex.wizardPage}>
          <h1 className={ex.pageTitle}>Explore Data</h1>

          <div className={ex.progressBlock}>
            <div className={ex.progressRow}>
              <span>Step 2 of 3</span>
              <span className={ex.progressPct}>67% Complete</span>
            </div>
            <div className={ex.progressTrack}>
              <div className={ex.progressFill} style={{ width: `${progressWidth}%` }} />
            </div>
          </div>

          <div className={ex.card}>
            <p className={ex.question}>Where do you want to look?</p>

            <div className={ex.fieldGroup}>
              <label className={ex.fieldLabel} htmlFor="explore-state">State</label>
              <select
                id="explore-state"
                className={ex.select}
                value={stateName}
                onChange={e => {
                  setStateName(e.target.value);
                  setCity("");
                  setFormError(null);
                }}
              >
                <option value="">Select state…</option>
                {STATE_NAMES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className={ex.fieldGroup}>
              <label className={ex.fieldLabel} htmlFor="explore-city">City</label>
              <CityCombobox
                cities={cityNames}
                value={city}
                disabled={!stateName}
                loading={placesLoading}
                onChange={val => {
                  setCity(val);
                  setFormError(null);
                }}
              />
              {placesError && (
                <p className={ex.hint} style={{ color: "var(--error)", marginTop: 6 }}>
                  {placesError}
                </p>
              )}
              {!placesError && stateName && !placesLoading && places.length > 0 && (
                <p className={ex.hint} style={{ marginTop: 6, opacity: 0.7 }}>
                  {places.length} places available — type any name to search.
                </p>
              )}
            </div>

            {formError && (
              <div className={homeStyles.error} style={{ marginTop: "1rem" }}>
                <span className={homeStyles.errorIcon}>⚠</span>
                {formError}
              </div>
            )}

            <div className={ex.footerNav} style={{ marginTop: "1.25rem", maxWidth: "none" }}>
              <Link href={{ pathname: "/explore", query: { from: targetProgress, restore: 1 } }} className={ex.btnBack}>
                ← Back
              </Link>
              <button
                type="button"
                className={ex.btnPrimary}
                disabled={submitting || !canContinue}
                onClick={viewResults}
              >
                {submitting ? <span className={ex.spinner} /> : "View Results"}
              </button>
            </div>
          </div>
        </div>
      </SiteLayout>
    </>
  );
}
