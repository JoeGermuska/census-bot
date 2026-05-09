// lib/acsTableChanges.js
//
// Hand-curated catalog of documented ACS table-level changes. Census
// publishes "Table and Geography Changes" pages each release year, but the
// formatting is irregular (PDF / inline HTML / footnotes), making automated
// scraping fragile. This file is the pragmatic alternative: a small,
// reviewable JSON-shaped record keyed by table id, listing the years a
// table was redesigned and a one-line description of what changed.
//
// Used by:
//   • The trend pipeline's concept-shift detection (lib/sourcing.js +
//     pages/api/trend.js) — when a series spans a documented redesign year,
//     the warning becomes specific ("table redesigned in 2022, sub-category
//     definitions changed") instead of generic ("values jumped 50×").
//   • Source-trail nuances — when a stat or trend cites a redesigned table,
//     a banner cites the redesign so users reading historical context know
//     to compare cautiously.
//
// SOURCING POLICY: Every entry MUST cite the Census Bureau publication or
// announcement. Don't add entries from blog posts, news, or memory. When a
// new redesign is documented, add a record here and link the source.
//
// Sources:
//   • https://www.census.gov/programs-surveys/acs/technical-documentation/table-and-geography-changes.html
//   • Year-specific "What's New" pages on census.gov

/**
 * @typedef {Object} TableChange
 * @property {number} year         The first ACS vintage in which the change is published.
 * @property {string} kind         "redesign" | "added" | "removed" | "subcategories_changed"
 * @property {string} summary      One-line description of what changed.
 * @property {string} source       URL or Census reference where the change is documented.
 * @property {string=} successor   Successor table id when the table was renamed/replaced.
 */

/**
 * Map of table id → array of TableChange records (in chronological order).
 * Keep this list grep-able and reviewable. When in doubt, leave it out —
 * a missing entry produces a generic "values jumped" warning, which is
 * already useful; an incorrect entry citing a fake redesign year is worse.
 */
const TABLE_CHANGES = {
  // B02015 (Asian Alone by Selected Groups) and B02018 (Asian Alone or in Any
  // Combination by Selected Groups) were restructured in 2022 to expand the
  // detailed Asian categories. Pre-2022 IDs map to a different sub-category
  // ordering — this is why B02015_019E goes from ~280 to ~110,000 between
  // 2021 and 2022 in San Jose: it now means "Vietnamese" but previously
  // referred to a much smaller "Other East Asian" group.
  B02015: [
    {
      year: 2022,
      kind: "redesign",
      summary:
        "Asian Alone by Selected Groups: detailed sub-category list expanded; " +
        "variable IDs were reordered. Pre-2022 IDs do not map to the same sub-groups " +
        "as post-2022 IDs — historical comparisons require the Census comparison notes.",
      source:
        "https://www.census.gov/programs-surveys/acs/technical-documentation/user-notes.html",
    },
  ],
  B02018: [
    {
      year: 2022,
      kind: "redesign",
      summary:
        "Asian Alone or in Combination by Selected Groups: companion table to B02015, " +
        "redesigned in 2022 with the same sub-category expansion. Pre-/post-2022 IDs " +
        "are not directly comparable.",
      source:
        "https://www.census.gov/programs-surveys/acs/technical-documentation/user-notes.html",
    },
  ],

  // B02016 / B02019 — analogous Native Hawaiian / Pacific Islander tables
  // were redesigned in the same 2022 release.
  B02016: [
    {
      year: 2022,
      kind: "redesign",
      summary:
        "Native Hawaiian and Other Pacific Islander Alone by Selected Groups: " +
        "redesigned in 2022 alongside B02015/B02018. Sub-categories expanded.",
      source:
        "https://www.census.gov/programs-surveys/acs/technical-documentation/user-notes.html",
    },
  ],
  B02019: [
    {
      year: 2022,
      kind: "redesign",
      summary:
        "NHPI Alone or in Combination by Selected Groups: redesigned in 2022.",
      source:
        "https://www.census.gov/programs-surveys/acs/technical-documentation/user-notes.html",
    },
  ],

  // B05007 — origin/destination flow table reformatted in the 2022 ACS
  // release with a different state-code ordering.
  B05007: [
    {
      year: 2022,
      kind: "subcategories_changed",
      summary:
        "Place of Birth / Region of Origin breakdowns reorganized in 2022; " +
        "country-group orderings shifted within the table.",
      source:
        "https://www.census.gov/programs-surveys/acs/technical-documentation/user-notes.html",
    },
  ],
};

// "B19013_001E" → "B19013"
function tableIdFromVariable(variableId) {
  return String(variableId || "").split("_")[0].toUpperCase();
}

/**
 * Check whether a table is documented as redesigned at any point. Returns
 * the array of TableChange records in chronological order, or null if no
 * entry exists for this table.
 */
export function getTableChanges(tableIdOrVariableId) {
  const id = String(tableIdOrVariableId || "").toUpperCase();
  if (!id) return null;
  // Caller may pass either a bare table id ("B02015") or a variable id
  // ("B02015_019E"). Strip to the bare table either way.
  const tableId = id.includes("_") ? tableIdFromVariable(id) : id;
  const changes = TABLE_CHANGES[tableId];
  if (!Array.isArray(changes) || changes.length === 0) return null;
  return changes;
}

/**
 * If a year range [startYear, endYear] crosses a documented redesign, return
 * the most relevant TableChange record (the one whose `year` falls in the
 * range). Returns null when no documented change applies.
 *
 * Used by the trend pipeline to upgrade the generic "values jumped" warning
 * into a specific "table redesigned in YYYY" warning when applicable.
 */
export function findRedesignInRange(tableIdOrVariableId, startYear, endYear) {
  const changes = getTableChanges(tableIdOrVariableId);
  if (!changes) return null;
  const start = Number(startYear);
  const end = Number(endYear);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  // Only flag changes that fall WITHIN the range — a 2022 redesign matters
  // when the user queries 2018–2024 but is irrelevant for 2022–2024 alone
  // (no boundary to cross).
  return changes.find((c) => c.year > start && c.year <= end) || null;
}

/**
 * Convenience helper: format a TableChange record as a one-line nuance
 * banner suitable for the source-trail.
 */
export function formatTableChangeBanner(change) {
  if (!change) return null;
  return {
    severity: "warning",
    title: `Table redesigned in ${change.year}`,
    body: change.summary,
    sourceUrl: change.source,
  };
}
