// pages/learn.js — searchable doc library over the indexed ACS corpus.
import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import SiteLayout from "../components/SiteLayout";
import landing from "../styles/Landing.module.css";

const SEARCH_DEBOUNCE_MS = 250;

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={landing.searchIcon}
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ResultCard({ result }) {
  return (
    <Link
      href={`/learn/passage/${encodeURIComponent(result.chunk_id)}`}
      className={landing.resultCard}
    >
      <div className={landing.resultMeta}>
        <span className={landing.resultDocTitle}>{result.doc_title}</span>
        {result.page != null && <span className={landing.resultPage}>p.{result.page}</span>}
        <span className={landing.resultScore}>score {result.score.toFixed(2)}</span>
      </div>
      <div className={landing.resultText}>{result.text}</div>
      <span className={landing.resultOpen}>Open in source →</span>
    </Link>
  );
}

function DocRow({ doc }) {
  return (
    <Link
      href={doc.has_pdf ? `/docs/${doc.id}.pdf` : doc.url}
      target={doc.has_pdf ? "_blank" : undefined}
      rel={doc.has_pdf ? "noopener noreferrer" : undefined}
      className={landing.docRow}
    >
      <span className={landing.docKind}>{doc.kind}</span>
      <span>
        <span className={landing.docTitle}>{doc.title}</span>
        <span className={landing.docDesc}>{doc.description}</span>
      </span>
    </Link>
  );
}

export default function Learn() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [docs, setDocs] = useState([]);
  const [docsError, setDocsError] = useState(null);
  const reqIdRef = useRef(0);

  // Load doc directory on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/acs-search?action=docs")
      .then(async r => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
        if (!cancelled) setDocs(json.docs || []);
      })
      .catch(err => {
        if (!cancelled) setDocsError(err.message);
      });
    return () => { cancelled = true; };
  }, []);

  // Debounced search.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }
    const id = ++reqIdRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/acs-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, topK: 6 }),
        });
        const json = await res.json().catch(() => ({}));
        if (id !== reqIdRef.current) return; // a newer query has already fired
        if (!res.ok) {
          const indexMissing = json.code === "INDEX_NOT_BUILT";
          setError(
            indexMissing
              ? "The ACS document index hasn't been built yet. Run npm run fetch:acs-docs && npm run index."
              : json.error || `HTTP ${res.status}`
          );
          setResults([]);
        } else {
          setResults(json.results || []);
        }
        setSearched(true);
      } catch (err) {
        if (id !== reqIdRef.current) return;
        setError(err.message);
        setResults([]);
        setSearched(true);
      } finally {
        if (id === reqIdRef.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <>
      <Head>
        <title>CensusBot — Learn About ACS Data</title>
        <meta
          name="description"
          content="Search the official Census Bureau ACS handbooks, methodology, and subject definitions."
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <header className={landing.aboutHero}>
          <h1 className={`${landing.title} ${landing.aboutTitle}`}>
            <span className={landing.titleGradient}>Learn About ACS Data</span>
          </h1>
          <p className={landing.lead}>
            Search the Census Bureau&apos;s own handbooks, methodology report,
            and subject definitions.
          </p>
        </header>

        <div className={landing.learnPage}>
          <section className={landing.searchCard}>
            <div className={landing.searchInputWrap}>
              <SearchIcon />
              <input
                className={landing.searchInput}
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search ACS docs…  (e.g. “what is a household”, “margin of error”)"
                autoFocus
                aria-label="Search ACS documents"
              />
            </div>
          </section>

          {error && <div className={landing.errorBox}>{error}</div>}

          {searched && !error && (
            <section>
              <div className={landing.resultsLabel}>
                {loading ? "Searching…" : `Results (${results.length})`}
              </div>
              {results.length === 0 && !loading ? (
                <div className={landing.emptyResults}>
                  No matching passages. Try different words or a broader concept.
                </div>
              ) : (
                <div className={landing.resultList}>
                  {results.map(r => <ResultCard key={r.chunk_id} result={r} />)}
                </div>
              )}
            </section>
          )}

          <section className={landing.docDirectory}>
            <div className={landing.docDirectoryTitle}>All documents</div>
            <div className={landing.docDirectorySub}>
              {docs.length > 0
                ? `${docs.length} indexed sources from the U.S. Census Bureau.`
                : docsError
                  ? `Couldn't load the doc list: ${docsError}`
                  : "Loading…"}
            </div>
            <div className={landing.docList}>
              {docs.map(d => <DocRow key={d.id} doc={d} />)}
            </div>
          </section>
        </div>
      </SiteLayout>
    </>
  );
}
