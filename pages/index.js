// pages/index.js — Home
import Head from "next/head";
import Link from "next/link";
import SiteLayout from "../components/SiteLayout";
import landing from "../styles/Landing.module.css";

const S = { width:16, height:16, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:2, strokeLinecap:"round", strokeLinejoin:"round", "aria-hidden":true };

function IcoDollar()   { return <svg {...S}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>; }
function IcoKey()      { return <svg {...S}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>; }
function IcoPeople()   { return <svg {...S}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function IcoTrend()    { return <svg {...S}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>; }
function IcoCalendar() { return <svg {...S}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }
function IcoBrief()    { return <svg {...S}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>; }
function IcoGrad()     { return <svg {...S}><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>; }
function IcoHouse()    { return <svg {...S}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>; }

const QUICK_LOOKUP_CHIPS = [
  { slug: "income",     label: "Median Income", Icon: IcoDollar },
  { slug: "rent",       label: "Rent",          Icon: IcoKey },
  { slug: "population", label: "Population",    Icon: IcoPeople },
  { slug: "poverty",    label: "Poverty",       Icon: IcoTrend },
  { slug: "age",        label: "Age",           Icon: IcoCalendar },
  { slug: "employment", label: "Employment",    Icon: IcoBrief },
  { slug: "education",  label: "Education",     Icon: IcoGrad },
  { slug: "housing",    label: "Housing",       Icon: IcoHouse },
];

export default function Home() {
  return (
    <>
      <Head>
        <title>CensusBot — Home</title>
        <meta name="description" content="Explore US Census ACS data with a guided flow." />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <div className={landing.pageWrapper}>
          <div className={landing.pageContent}>
            <section className={landing.hero}>
              <h1 className={landing.title}>CensusBot</h1>
              <p className={landing.leadStrong}>
                Ask questions about U.S. community data in plain English.
              </p>
              <p className={landing.lead}>
                Explore information from the American Community Survey (ACS). Choose a place,
                view key statistics, and track changes over time.
              </p>
            </section>

            <div className={landing.homeActions}>
              <section className={landing.quickstart}>
                <div className={landing.eyebrow}>Quick Lookup</div>
                <h2 className={landing.quickstartTitle}>What do you want to know about?</h2>
                <p className={landing.quickstartSub}>
                  Pick a metric to begin, or pick up where you left off.
                </p>
                <div className={landing.chipRow}>
                  {QUICK_LOOKUP_CHIPS.map(chip => (
                    <Link
                      key={chip.slug}
                      href={`/explore?m=${chip.slug}`}
                      className={landing.chip}
                    >
                      <chip.Icon />
                      {chip.label}
                    </Link>
                  ))}
                </div>
                <div className={landing.quickstartFoot}>
                  <span>Browse all 37 ACS metrics</span>
                  <Link href="/explore" className={landing.allMetricsBtn}>All metrics →</Link>
                </div>
              </section>

              <Link className={landing.secondary} href="/chat">
                <div className={landing.secondaryRow}>
                  <div>
                    <div className={landing.secondaryTitle}>Ask a question</div>
                    <div className={landing.secondarySub}>
                      Type a question in plain English, like &ldquo;What&apos;s the median rent in Austin?&rdquo;
                      Or ask for charts and visualizations.
                    </div>
                  </div>
                  <div className={landing.secondaryArrow} aria-hidden>→</div>
                </div>
              </Link>

              <Link className={landing.secondary} href="/learn">
                <div className={landing.secondaryRow}>
                  <div>
                    <div className={landing.secondaryTitle}>Learn more about ACS data</div>
                    <div className={landing.secondarySub}>
                      Where the numbers come from, how to read them, and what the 5-year estimates mean.
                    </div>
                  </div>
                  <div className={landing.secondaryArrow} aria-hidden>→</div>
                </div>
              </Link>
            </div>

            <footer className={landing.footerNote}>
              Data Source: U.S. Census Bureau, American Community Survey (1-Year and 5-Year Estimates, 2024)
            </footer>
          </div>
        </div>
      </SiteLayout>
    </>
  );
}
