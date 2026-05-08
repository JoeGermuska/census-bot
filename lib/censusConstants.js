// Shared CensusBot query types and state → city lists

// Bump this when the Census Bureau releases a new ACS 5-year dataset.
// Releases happen every December; "2024" = the 2020–2024 5-year ACS.
export const CURRENT_ACS_YEAR = "2024";

export const QUERY_TYPES = [
  "median income",
  "population",
  "median rent",
  "median home value",
  "poverty rate",
  "median age",
  "unemployment rate",
  "commute time",
  "median household income",
  "per capita income",
  "median family income",
  "median earnings",
  "gini index",
  "asian population",
  "black population",
  "white population",
  "hispanic population",
  "native american population",
  "pacific islander population",
  "multiracial population",
  "associate's degree",
  "bachelor's degree",
  "master's degree",
  "graduate degree",
  "vacancy rate",
  "homeownership rate",
  "rent burden",
  "drove alone to work",
  "carpooled to work",
  "used public transportation",
  "walked to work",
  "bicycled to work",
  "worked from home",
  "foreign-born population",
  "naturalized citizens",
  "non-citizens",
  "veterans",
];

// Full list of U.S. states (DC/territories excluded). Cities are no longer
// hardcoded — see /api/places for the dynamic, complete list per state.
export const STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

export const EXPLORE_METRICS_STORAGE_KEY = "census-bot-explore-metrics";
export const EXPLORE_LOCATION_STORAGE_KEY = "census-bot-explore-location";

/** Natural-language query for city + state (city required). */
export function buildCityStateQuery(metric, city, state) {
  return `${metric} in ${city}, ${state}`;
}

// Maps metric keywords → Census profile section anchors.
const METRIC_ANCHORS = [
  [/population|median age/i,                        "populations-and-people"],
  [/income|poverty|per capita/i,                    "income-and-poverty"],
  [/bachelor|education/i,                           "education"],
  [/employment|unemployment/i,                      "employment"],
  [/rent|home value|housing/i,                      "housing"],
  [/health|insurance|coverage/i,                    "health"],
  [/household|families|living/i,                    "families-and-living-arrangements"],
  [/race|hispanic|latino|ethnicity/i,               "race-and-ethnicity"],
  [/commute|travel time/i,                          "commute"],
];

function metricToAnchor(metric) {
  for (const [re, anchor] of METRIC_ANCHORS) {
    if (re.test(metric)) return anchor;
  }
  return "";
}

/**
 * Builds a Census Bureau place profile URL.
 * Pass the GEOID (from usePlaceGeoid hook) for a precise profile link;
 * omit it to fall back to a Census profile search URL.
 */
export function buildCensusProfileUrl(city, state, metric, geoid) {
  const anchor = metricToAnchor(metric || "");
  const anchorSuffix = anchor ? `#${anchor}` : "";

  if (geoid) {
    const citySlug = city.trim().replace(/\s+/g, "_");
    const stateSlug = state.trim().replace(/\s+/g, "_");
    return `https://data.census.gov/profile/${citySlug}_city,_${stateSlug}?g=160XX00US${geoid}${anchorSuffix}`;
  }

  // Fallback while geoid is still loading
  const q = encodeURIComponent(`${city} city, ${state}`);
  return `https://data.census.gov/profile?q=${q}${anchorSuffix}`;
}
