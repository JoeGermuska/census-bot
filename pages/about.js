// pages/about.js
import Head from "next/head";
import SiteLayout from "../components/SiteLayout";
import landing from "../styles/Landing.module.css";

export default function About() {
  return (
    <>
      <Head>
        <title>CensusBot — About</title>
        <meta name="description" content="About the CensusBot ACS explorer project." />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <SiteLayout>
        <header className={landing.aboutHero}>
          <h1 className={`${landing.title} ${landing.aboutTitle}`}>
            <span className={landing.titleGradient}>About CensusBot</span>
          </h1>
          <p className={landing.lead}>
            Explore U.S. community data with simple questions.
          </p>
        </header>

        <section className={`${landing.sectionCard} ${landing.sectionCardOverview}`}>
          <h2 className={`${landing.sectionHeading} ${landing.sectionHeadingOverview}`}>Overview</h2>
          <p className={landing.sectionBody}>CensusBot turns plain-English questions into Census data results.</p>
          <ul className={landing.bulletList}>
            <li>Pick a metric and location</li>
            <li>Get clear results and optional charts</li>
          </ul>
          <p className={`${landing.sectionBody} ${landing.sectionBodySpaced}`}>Use it to:</p>
          <ul className={landing.bulletList}>
            <li>Compare places</li>
            <li>Track changes over time</li>
            <li>Find relevant ACS fields</li>
          </ul>
        </section>

        <section className={`${landing.sectionCard} ${landing.sectionCardTech}`}>
          <h2 className={`${landing.sectionHeading} ${landing.sectionHeadingTech}`}>Tech Stack</h2>
          <div className={landing.techGrid}>
            <div className={landing.techCol}>
              <h3>Frontend</h3>
              <ul>
                <li>Next.js</li>
                <li>React</li>
              </ul>
            </div>
            <div className={landing.techCol}>
              <h3>Design</h3>
              <ul>
                <li>Light/Dark Modes</li>
                <li>High-Contrast Accents</li>
              </ul>
            </div>
            <div className={landing.techCol}>
              <h3>Data</h3>
              <ul>
                <li>Census Bureau API</li>
                <li>Server-Side API</li>
              </ul>
            </div>
          </div>
        </section>

        <section className={`${landing.sectionCard} ${landing.sectionCardTeam}`}>
          <h2 className={`${landing.sectionHeading} ${landing.sectionHeadingTeam}`}>Our Team</h2>
        </section>

        <section className={`${landing.sectionCard} ${landing.sectionCardCredits}`}>
          <h2 className={`${landing.sectionHeading} ${landing.sectionHeadingCredits}`}>Credits</h2>
          <p className={landing.creditsBuilt}>
            Built at{" "}
            <a
              href="https://studio.knightlab.com/projects/censusbot/"
              className={landing.creditsLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Knight Lab
            </a>
          </p>
        </section>
      </SiteLayout>
    </>
  );
}
