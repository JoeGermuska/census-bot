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
