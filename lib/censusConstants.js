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

// 7-digit Census place GEOIDs keyed by "city|state" (lowercase).
// Format: {stateFIPS(2)}{placeFIPS(5)}
const PLACE_GEOID = {
  "chicago|illinois":           "1714000",
  "new york city|new york":     "3651000",
  "new york|new york":          "3651000",
  "los angeles|california":     "0644000",
  "houston|texas":              "4835000",
  "phoenix|arizona":            "0455000",
  "philadelphia|pennsylvania":  "4260000",
  "san antonio|texas":          "4865000",
  "san diego|california":       "0666000",
  "dallas|texas":               "4819000",
  "san jose|california":        "0668000",
  "austin|texas":               "4805000",
  "jacksonville|florida":       "1235000",
  "san francisco|california":   "0667000",
  "columbus|ohio":              "3918000",
  "charlotte|north carolina":   "3712000",
  "indianapolis|indiana":       "1836003",
  "seattle|washington":         "5363000",
  "denver|colorado":            "0820000",
  "boston|massachusetts":       "2507000",
  "nashville|tennessee":        "4752006",
  "baltimore|maryland":         "2404000",
  "louisville|kentucky":        "2148006",
  "portland|oregon":            "4159000",
  "las vegas|nevada":           "3240000",
  "memphis|tennessee":          "4748000",
  "atlanta|georgia":            "1304000",
  "miami|florida":              "1245000",
  "minneapolis|minnesota":      "2743000",
  "tucson|arizona":             "0477000",
  "fresno|california":          "0627000",
  "sacramento|california":      "0664000",
  "mesa|arizona":               "0446000",
  "kansas city|missouri":       "2938000",
  "omaha|nebraska":             "3137000",
  "raleigh|north carolina":     "3755000",
  "cleveland|ohio":             "3916000",
  "pittsburgh|pennsylvania":    "4261000",
  "evanston|illinois":          "1725727",
};

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
 * Builds a Census Bureau place profile URL for the given city, state, and metric.
 * Falls back to a search URL if the city isn't in PLACE_GEOID.
 */
export function buildCensusProfileUrl(city, state, metric) {
  const key = `${city.toLowerCase()}|${state.toLowerCase()}`;
  const geoid = PLACE_GEOID[key];
  const anchor = metricToAnchor(metric || "");
  const anchorSuffix = anchor ? `#${anchor}` : "";

  if (geoid) {
    const citySlug = city.replace(/\s+/g, "_");
    const stateSlug = state.replace(/\s+/g, "_");
    return `https://data.census.gov/profile/${citySlug}_city,_${stateSlug}?g=160XX00US${geoid}${anchorSuffix}`;
  }

  // Fallback: Census profile search
  const q = encodeURIComponent(`${city} city, ${state}`);
  return `https://data.census.gov/profile?q=${q}${anchorSuffix}`;
}
