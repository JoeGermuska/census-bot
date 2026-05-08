// pages/index.js — Home
import Head from "next/head";
import Link from "next/link";
import SiteLayout from "../components/SiteLayout";
import ShimmerText from "../components/ShimmerText";
import landing from "../styles/Landing.module.css";

const QUICK_LOOKUP_CHIPS = [
  { slug: "income", label: "Median Income" },
  { slug: "rent", label: "Rent" },
  { slug: "population", label: "Population" },
  { slug: "poverty", label: "Poverty" },
  { slug: "age", label: "Age" },
  { slug: "employment", label: "Employment" },
  { slug: "education", label: "Education" },
  { slug: "housing", label: "Housing" },
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
              <h1 className={landing.title}>
                <ShimmerText>CensusBot</ShimmerText>
              </h1>
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
                      {chip.label}
                    </Link>
                  ))}
                </div>
                <div className={landing.quickstartFoot}>
                  <span>Browse all 37 ACS metrics</span>
                  <Link href="/explore">All metrics →</Link>
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
