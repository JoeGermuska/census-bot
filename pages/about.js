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
        </header>

        <section className={`${landing.sectionCard} ${landing.sectionCardOverview}`}>
          <h2 className={`${landing.sectionHeading} ${landing.sectionHeadingOverview}`}>Overview</h2>
          <p className={landing.sectionBody}>
            CensusBot is an independent project that makes data from the American Community
            Survey (ACS) easier to access and interpret. It translates everyday questions
            about U.S. communities into structured queries against the U.S. Census Bureau&rsquo;s
            public data, and presents the results with clear context, margins of error, and
            optional visualizations. CensusBot is unaffiliated with the U.S. Census Bureau.
          </p>
          <p className={`${landing.sectionBody} ${landing.sectionBodySpaced}`}>
            The site supports three primary workflows:
          </p>
          <ul className={landing.bulletList}>
            <li>Selecting a metric and location through a guided lookup wizard.</li>
            <li>Asking free-form questions in plain English and receiving cited results.</li>
            <li>Tracking how a metric has changed over time with charts and trend summaries.</li>
          </ul>
          <p className={`${landing.sectionBody} ${landing.sectionBodySpaced}`}>
            CensusBot is intended to help journalists, students, researchers, and the
            general public quickly find and contextualize community-level statistics
            without needing to navigate the Census Bureau&rsquo;s underlying variable tables.
          </p>
        </section>

        <section className={`${landing.sectionCard} ${landing.sectionCardTech}`}>
          <h2 className={`${landing.sectionHeading} ${landing.sectionHeadingTech}`}>Tech Stack</h2>
          <p className={landing.sectionBody}>
            CensusBot is a Next.js application that fetches data server-side from the U.S.
            Census Bureau and uses Anthropic&rsquo;s Claude models to interpret natural-language
            questions. All data requests are made on the server, and no API keys are exposed
            to the browser.
          </p>
          <div className={`${landing.techGrid} ${landing.sectionBodySpaced}`}>
            <div className={landing.techCol}>
              <h3>Frontend</h3>
              <ul>
                <li>Next.js (Pages Router)</li>
                <li>React</li>
                <li>Recharts for visualizations</li>
              </ul>
            </div>
            <div className={landing.techCol}>
              <h3>Design</h3>
              <ul>
                <li>Light and dark themes</li>
                <li>Responsive, accessible layout</li>
                <li>High-contrast accent colors</li>
              </ul>
            </div>
            <div className={landing.techCol}>
              <h3>Data &amp; AI</h3>
              <ul>
                <li>U.S. Census Bureau ACS API</li>
                <li>Server-side query routing</li>
                <li>Anthropic Claude for language understanding</li>
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
