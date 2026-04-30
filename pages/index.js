// pages/index.js — Home
import Head from "next/head";
import Link from "next/link";
import SiteLayout from "../components/SiteLayout";
import LightningIcon from "../components/LightningIcon";
import ShimmerText from "../components/ShimmerText";
import landing from "../styles/Landing.module.css";


// ── Shared card content ───────────────────────────────────────────────────
function IconChart() {
  return (
    <svg className={landing.featureIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 20V5" />
      <path d="M4 20H20" />
      <rect x="7" y="11" width="3" height="7" rx="1" />
      <rect x="12" y="8" width="3" height="10" rx="1" />
      <rect x="17" y="6" width="3" height="12" rx="1" />
    </svg>
  );
}
function IconPin() {
  return (
    <svg className={landing.featureIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 21C7 16.2 5 13.8 5 10.5A7 7 0 0 1 19 10.5C19 13.8 17 16.2 12 21Z" />
      <circle cx="12" cy="10.5" r="2.25" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg className={landing.featureIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M9 11C9 6.9 11.8 4 15 4C17.8 4 20 6.2 20 9" />
    </svg>
  );
}

const CARDS = [
  {
    href: "/explore",
    cardClass: `${landing.featureCard} ${landing.featureCardPurple}`,
    iconClass: `${landing.iconCircle} ${landing.iconPurple}`,
    aria: "Explore ACS Metrics",
    title: "ACS Metrics",
    body: "Explore key metrics like income, rent, population, poverty, age, and employment.",
    Icon: IconChart,
  },
  {
    href: "/chat",
    cardClass: `${landing.featureCard} ${landing.featureCardBlue}`,
    iconClass: `${landing.iconCircle} ${landing.iconBlue}`,
    aria: "Explore Places and Trends",
    title: "Places & Trends",
    body: "Focus on a city and state, and view interactive charts showing changes over the past five years.",
    Icon: IconPin,
  },
  {
    href: "/about",
    cardClass: `${landing.featureCard} ${landing.featureCardTeal}`,
    iconClass: `${landing.iconCircle} ${landing.iconTeal}`,
    aria: "Learn about Open Data",
    title: "Open Data",
    body: "All results use publicly available ACS 5-year estimates, with clear source information included.",
    Icon: IconLock,
  },
];

function FeatureCardContent({ card }) {
  return (
    <div className={landing.featureCardInner}>
      <div className={card.iconClass}>
        <card.Icon />
      </div>
      <h2 className={landing.featureTitle}>{card.title}</h2>
      <p className={landing.featureBody}>{card.body}</p>
    </div>
  );
}

// ── Per-card glow — bottom inset border + downward bloom ───────────────────
const CARD_GLOW = [
  "inset 0 -1px 0 rgba(168,85,247,0.55),  0 14px 36px -6px rgba(168,85,247,0.22)", // violet
  "inset 0 -1px 0 rgba(77,184,255,0.55),  0 14px 36px -6px rgba(77,184,255,0.22)", // cyan
  "inset 0 -1px 0 rgba(52,211,153,0.50),  0 14px 36px -6px rgba(52,211,153,0.18)", // teal
];

// ── Static grid — reduced-motion and SSR fallback ─────────────────────────
// Plain divs, no animation — immediately visible at full scale and color.

function StaticCardGrid() {
  return (
    <div className={landing.cardGrid}>
      {CARDS.map((card, i) => (
        <div
          key={card.href}
          style={{ height: "100%", borderRadius: "clamp(16px, 2vw, 20px)", boxShadow: CARD_GLOW[i] }}
        >
          <Link href={card.href} className={card.cardClass} aria-label={card.aria} style={{ height: "100%" }}>
            <FeatureCardContent card={card} />
          </Link>
        </div>
      ))}
    </div>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────
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

            <StaticCardGrid />

            <div className={landing.ctaRow}>
              <Link href="/explore" className={landing.ctaLarge}>
                <span className={landing.ctaLargeIcon}>
                  <LightningIcon size={34} />
                </span>
                <span className={landing.ctaLargeLabel}>Explore Data</span>
                <span className={landing.ctaLargeArrow} aria-hidden>→</span>
              </Link>
              <p className={landing.ctaSub}>See where the data takes you</p>
            </div>

            <footer className={landing.footerNote}>
              Data Source: U.S. Census Bureau, American Community Survey (5-Year Estimates)
            </footer>
          </div>
        </div>
      </SiteLayout>
    </>
  );
}
