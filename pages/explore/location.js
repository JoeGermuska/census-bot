// pages/explore/location.js — Step 2: global place search
import { useState, useEffect, useMemo, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import SiteLayout from "../../components/SiteLayout";
import ex from "../../styles/Explore.module.css";
import homeStyles from "../../styles/Home.module.css";
import { EXPLORE_METRICS_STORAGE_KEY } from "../../lib/censusConstants";

// ── Global place search ──────────────────────────────────────────────────────
function GlobalPlaceSearch({ city, stateName, onSelect }) {
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
  const inputRef = useRef(null);

  function doSearch(q) {
    if (q.length < 2) { setResults([]); setOpen(false); setSearching(false); return; }
    setSearching(true);
    fetch(`/api/search-places?q=${encodeURIComponent(q)}&limit=15`)
      .then(r => r.json())
      .then(data => {
        if (data.indexing) {
          setIndexing(true);
          setResults([]);
          // Retry once index is built
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
    onSelect("", ""); // clear confirmed selection while typing
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
    <div className={ex.fieldGroup}>
      <label className={ex.fieldLabel} htmlFor="explore-place">Location</label>
      <div className={ex.searchInputRow}>
        <div className={ex.comboboxWrap} style={{ flex: 1 }}>
          <input
            ref={inputRef}
            id="explore-place"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="place-listbox"
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
              id="place-listbox"
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

        {/* Visible loading badge to the right of the input */}
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
      if (qState) setStateName(qState);
      if (qCity)  setCity(qCity);
    } catch {
      router.replace("/explore");
      return;
    }
    setReady(true);
  }, [router]);

  useEffect(() => {
    setProgressWidth(fromProgress);
    const id = requestAnimationFrame(() => setProgressWidth(targetProgress));
    return () => cancelAnimationFrame(id);
  }, [fromProgress]);

  const canContinue = !!(stateName && city);

  function viewResults() {
    if (!canContinue) { setFormError("Please select a location from the dropdown."); return; }
    setFormError(null);
    setSubmitting(true);
    router.push({ pathname: "/explore/results", query: { state: stateName, city, from: targetProgress } });
  }

  if (!ready) {
    return (
      <>
        <Head><title>CensusBot — Explore</title><link rel="icon" href="/favicon.ico" /></Head>
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
        <meta name="description" content="Search for a U.S. location to look up ACS data." />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <div className={ex.wizardPage}>
          <h1 className={ex.pageTitle}>Quick Lookup</h1>

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

            <GlobalPlaceSearch
              city={city}
              stateName={stateName}
              onSelect={(c, s) => { setCity(c); setStateName(s); setFormError(null); }}
            />

            {formError && (
              <div className={homeStyles.error} style={{ marginTop: "1rem" }}>
                <span className={homeStyles.errorIcon}>⚠</span>
                {formError}
              </div>
            )}

            <div className={ex.footerNav} style={{ marginTop: "1.25rem", maxWidth: "none" }}>
              <Link
                href={{ pathname: "/explore", query: { from: targetProgress, restore: 1 } }}
                className={ex.btnBack}
              >
                ← Back
              </Link>
              <button
                type="button"
                className={`${ex.btnPrimary}${canContinue ? ` ${ex.btnPrimaryActive}` : ""}`}
                disabled={submitting || !canContinue}
                onClick={viewResults}
              >
                {submitting ? <span className={ex.spinner} /> : "View Results →"}
              </button>
            </div>
          </div>
        </div>
      </SiteLayout>
    </>
  );
}
