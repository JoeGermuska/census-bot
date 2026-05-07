// components/SiteLayout.js
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ThemeToggle from "./ThemeToggle";
import styles from "../styles/SiteLayout.module.css";

function NavIconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function NavIconInfo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function NavIconChat() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function NavIconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function SiteLayout({ children }) {
  const router = useRouter();
  const path = router.pathname;
  const [scrolled, setScrolled] = useState(false);

  const chatActive = path === "/chat" || path.startsWith("/chat/");

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const linkClass = href => {
    const active =
      href === "/"
        ? path === "/"
        : path === href || path.startsWith(`${href}/`);
    return `${styles.navLink} ${active ? styles.navLinkActive : ""}`;
  };

  return (
    <div className={styles.shell}>
      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ""}`}>
        <div className={styles.navLeft}>
          <Link href="/" className={styles.logoText}>
            CensusBot
          </Link>
        </div>
        <div className={styles.navTrailing}>
          <Link href="/" className={linkClass("/")}>
            <NavIconHome /> Home
          </Link>
          <Link href="/about" className={linkClass("/about")}>
            <NavIconInfo /> About
          </Link>
          <Link href="/explore" className={linkClass("/explore")}>
            <NavIconSearch /> Quick Lookup
          </Link>
          <Link
            href="/chat"
            className={`${styles.cta} ${chatActive ? styles.ctaActive : ""}`}
          >
            <NavIconChat />
            Ask Question
          </Link>
          <ThemeToggle />
        </div>
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
