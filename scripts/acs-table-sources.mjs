// scripts/acs-table-sources.mjs — ACS variables.json + groups.json endpoints to fetch.
//
// Each ACS release (1-year, 5-year) publishes four table types at four
// distinct endpoints: Detailed Tables (B/C), Subject Tables (S),
// Data Profiles (DP), Comparison Profiles (CP). Each endpoint exposes:
//   /variables.json — every variable in every table at this endpoint
//   /groups.json    — table-level metadata (concept, universe)
//
// Together these eight endpoints give complete coverage of all published
// ACS tables for a given vintage.

export const TABLE_KINDS = [
  { kind: "detailed", path: "",          label: "Detailed Tables" },
  { kind: "subject",  path: "/subject",  label: "Subject Tables" },
  { kind: "profile",  path: "/profile",  label: "Data Profiles" },
  { kind: "cprofile", path: "/cprofile", label: "Comparison Profiles" },
];

export const RELEASES = [
  { release: "acs5", path: "acs/acs5", label: "ACS 5-Year" },
  { release: "acs1", path: "acs/acs1", label: "ACS 1-Year" },
];

export function buildSourceList(year) {
  const out = [];
  for (const r of RELEASES) {
    for (const k of TABLE_KINDS) {
      const base = `https://api.census.gov/data/${year}/${r.path}${k.path}`;
      out.push({
        id: `${r.release}-${k.kind}-${year}`,
        year: Number(year),
        release: r.release,
        releaseLabel: r.label,
        kind: k.kind,
        kindLabel: k.label,
        endpoint: `${r.path}${k.path}`,
        variablesUrl: `${base}/variables.json`,
        groupsUrl: `${base}/groups.json`,
      });
    }
  }
  return out;
}
