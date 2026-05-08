// lib/censusTranslator.js

// Tokens stripped before exact-match comparison so natural-language framing
// ("what is the median rent in Austin") matches the bare keyword ("median rent").
// Question shapers + articles + prepositions + soft verbs only — never content words.
const MATCH_STOPWORDS = new Set([
  "a", "an", "and", "any", "are", "be", "by", "do", "does", "for", "from",
  "give", "has", "have", "i", "in", "is", "it", "like", "look", "looking",
  "me", "my", "of", "or", "our", "show", "tell", "the", "this", "to", "us",
  "want", "we", "what", "whats", "with", "would", "you", "your",
  "current", "currently", "latest", "now",
  // Question-shape verbs and soft prepositions that came up in edge-case tests.
  "about", "see", "find", "check", "know", "learn", "search", "get", "got",
]);

// Tokenizer:
//  - splits on any non-alphanumeric (so hyphens become separators —
//    "foreign-born" tokenizes the same as "foreign born")
//  - drops single-character residuals like the trailing "s" left by an
//    apostrophe-s contraction (e.g. "what's" → ["what", "s"] → drop "s")
//  - drops the stopwords above
function tokenizeForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(t => t.length >= 2 && !MATCH_STOPWORDS.has(t));
}

// Strip the location half of the query so we only tokenize the metric phrase.
// "what is the median rent in austin" → "what is the median rent" → [median, rent]
function metricPhraseTokens(query) {
  const q = String(query || "").toLowerCase().trim();
  const inIdx = q.indexOf(" in ");
  const phrase = inIdx === -1 ? q : q.slice(0, inIdx).trim();
  return tokenizeForMatch(phrase);
}

// Ambiguous keywords → candidate ACS variables. When a user query matches one
// of these (and didn't already specify a more precise term), the chatbot asks
// the user to pick instead of silently defaulting to the first match.
export const AMBIGUOUS_METRICS = {
  income: [
    {
      id: "B19013_001E",
      label: "Median Household Income",
      table: "B19013",
      format: "currency",
      description: "Middle value of total income for all households (any size).",
    },
    {
      id: "B19301_001E",
      label: "Per Capita Income",
      table: "B19301",
      format: "currency",
      description: "Average income per person, including children.",
    },
    {
      id: "B19113_001E",
      label: "Median Family Income",
      table: "B19113",
      format: "currency",
      description: "Middle value of income for households with related people only.",
    },
  ],
  education: [
    {
      id: "B15003_022E",
      label: "Bachelor's Degree Attainment Rate",
      table: "B15003",
      format: "percent",
      description: "Share of adults 25+ whose highest degree is a bachelor's.",
    },
    {
      id: "B15003_017E",
      label: "High School Graduation Rate",
      table: "B15003",
      format: "percent",
      description: "Share of adults 25+ with at least a high school diploma.",
    },
    {
      id: "B15003_025E",
      label: "Graduate or Professional Degree Rate",
      table: "B15003",
      format: "percent",
      description: "Share of adults 25+ with a master's, professional, or doctorate.",
    },
  ],
  employment: [
    {
      id: "B23025_004E",
      label: "Employment Rate",
      table: "B23025",
      format: "percent",
      description: "Share of the civilian labor force that is currently employed.",
    },
    {
      id: "B23025_005E",
      label: "Unemployment Rate",
      table: "B23025",
      format: "percent",
      description: "Share of the civilian labor force that is currently unemployed.",
    },
    {
      id: "B23025_002E",
      label: "Labor Force Participation Rate",
      table: "B23025",
      format: "percent",
      description: "Share of adults 16+ who are employed or actively job-seeking.",
    },
  ],
  housing: [
    {
      id: "B25077_001E",
      label: "Median Home Value",
      table: "B25077",
      format: "currency",
      description: "Middle value of owner-occupied homes.",
    },
    {
      id: "B25064_001E",
      label: "Median Gross Rent",
      table: "B25064",
      format: "currency",
      description: "Middle monthly rent including utilities.",
    },
    {
      id: "B25001_001E",
      label: "Total Housing Units",
      table: "B25001",
      format: "number",
      description: "Total count of housing units (occupied + vacant).",
    },
  ],
  // Race / ethnicity buckets intentionally absent — the chat surface only
  // shows ambiguity chips when there's a GENUINE risk the user misread the
  // stat (income variants, education levels, etc.). Race resolution defaults
  // to the non-Hispanic crosstab (B03002) and lives in VARIABLE_MAP below.
};

// Triggers: if the query contains one of these AND no more specific keyword,
// surface the picker. Race/ethnicity buckets were removed when the derivation
// engine replaced hand-written pairings.
export const AMBIGUOUS_KEYWORD_TRIGGERS = {
  income: ["income"],
  education: ["education", "educated", "degree", "school"],
  employment: ["employment", "employed"],
  housing: ["housing"],
};

// More specific keywords that, when present, mean the user already disambiguated
// — skip the picker. These must be checked BEFORE the trigger keywords above.
const SPECIFIC_OVERRIDES = [
  "median household income", "household income",
  "per capita income",
  "family income", "median earnings",
  "bachelor", "graduate", "high school", "associate", "master", "doctorate", "professional school",
  "unemployment", "unemployed",
  "labor force",
  "median home value", "home value", "housing value",
  "median rent", "gross rent", "rent",
  "housing units", "vacancy rate", "homeownership", "renter-occupied",
  "rent burden",
  "alone, not hispanic", "any ethnicity",
  "drove alone", "carpool", "public transit", "public transportation",
  "walked to work", "bicycled", "worked from home",
  "foreign born", "foreign-born", "naturalized", "non-citizen",
  "gini", "veteran",
];

export function detectAmbiguousMetric(query) {
  const q = String(query || "").toLowerCase();
  if (SPECIFIC_OVERRIDES.some((kw) => q.includes(kw))) return null;

  for (const [bucket, triggers] of Object.entries(AMBIGUOUS_KEYWORD_TRIGGERS)) {
    if (triggers.some((kw) => q.includes(kw))) {
      return { bucket, options: AMBIGUOUS_METRICS[bucket] };
    }
  }
  return null;
}

export const VARIABLE_MAP = {
  // ── Population ────────────────────────────────────────────────────────────
  "population":                { id: "B01003_001E", label: "Total Population",                       format: "number" },
  "total population":          { id: "B01003_001E", label: "Total Population",                       format: "number" },
  "how many people":           { id: "B01003_001E", label: "Total Population",                       format: "number" },
  "residents":                 { id: "B01003_001E", label: "Total Population",                       format: "number" },

  // ── Race & ethnicity (default to non-Hispanic crosstab; B02001 alternate via AMBIGUOUS_METRICS) ──
  "asian":                     { id: "B03002_006E", label: "Asian Alone, Not Hispanic",              format: "number" },
  "asian population":          { id: "B03002_006E", label: "Asian Alone, Not Hispanic",              format: "number" },
  "non-hispanic asian":        { id: "B03002_006E", label: "Asian Alone, Not Hispanic",              format: "number" },
  "asian alone":               { id: "B02001_005E", label: "Asian Alone (Any Ethnicity)",            format: "number" },
  "black":                     { id: "B03002_004E", label: "Black or African American Alone, Not Hispanic", format: "number" },
  "black population":          { id: "B03002_004E", label: "Black or African American Alone, Not Hispanic", format: "number" },
  "african american":          { id: "B03002_004E", label: "Black or African American Alone, Not Hispanic", format: "number" },
  "non-hispanic black":        { id: "B03002_004E", label: "Black or African American Alone, Not Hispanic", format: "number" },
  "black alone":               { id: "B02001_003E", label: "Black or African American Alone (Any Ethnicity)", format: "number" },
  "white":                     { id: "B03002_003E", label: "White Alone, Not Hispanic",              format: "number" },
  "white population":          { id: "B03002_003E", label: "White Alone, Not Hispanic",              format: "number" },
  "non-hispanic white":        { id: "B03002_003E", label: "White Alone, Not Hispanic",              format: "number" },
  "white alone":               { id: "B02001_002E", label: "White Alone (Any Ethnicity)",            format: "number" },
  "hispanic":                  { id: "B03002_012E", label: "Hispanic or Latino",                     format: "number" },
  "latino":                    { id: "B03002_012E", label: "Hispanic or Latino",                     format: "number" },
  "hispanic population":       { id: "B03002_012E", label: "Hispanic or Latino",                     format: "number" },
  "latino population":         { id: "B03002_012E", label: "Hispanic or Latino",                     format: "number" },
  "hispanic or latino":        { id: "B03002_012E", label: "Hispanic or Latino",                     format: "number" },
  "native american":           { id: "B03002_005E", label: "American Indian and Alaska Native Alone, Not Hispanic", format: "number" },
  "american indian":           { id: "B03002_005E", label: "American Indian and Alaska Native Alone, Not Hispanic", format: "number" },
  "aian":                      { id: "B03002_005E", label: "American Indian and Alaska Native Alone, Not Hispanic", format: "number" },
  "pacific islander":          { id: "B03002_007E", label: "Native Hawaiian and Other Pacific Islander Alone, Not Hispanic", format: "number" },
  "native hawaiian":           { id: "B03002_007E", label: "Native Hawaiian and Other Pacific Islander Alone, Not Hispanic", format: "number" },
  "two or more races":         { id: "B03002_009E", label: "Two or More Races, Not Hispanic",        format: "number" },
  "multiracial":               { id: "B03002_009E", label: "Two or More Races, Not Hispanic",        format: "number" },

  // ── Income & earnings ────────────────────────────────────────────────────
  "income":                    { id: "B19013_001E", label: "Median Household Income",                format: "currency" },
  "median income":             { id: "B19013_001E", label: "Median Household Income",                format: "currency" },
  "household income":          { id: "B19013_001E", label: "Median Household Income",                format: "currency" },
  "median household income":   { id: "B19013_001E", label: "Median Household Income",                format: "currency" },
  "per capita income":         { id: "B19301_001E", label: "Per Capita Income",                      format: "currency" },
  "median family income":      { id: "B19113_001E", label: "Median Family Income",                   format: "currency" },
  "family income":             { id: "B19113_001E", label: "Median Family Income",                   format: "currency" },
  "median earnings":           { id: "B20002_001E", label: "Median Earnings",                        format: "currency" },
  "earnings":                  { id: "B20002_001E", label: "Median Earnings",                        format: "currency" },
  "gini index":                { id: "B19083_001E", label: "Gini Index of Income Inequality",        format: "index" },
  "income inequality":         { id: "B19083_001E", label: "Gini Index of Income Inequality",        format: "index" },

  // ── Poverty / employment / age / commute ─────────────────────────────────
  "poverty":                   { id: "B17001_002E", label: "Poverty Rate",                           format: "percent" },
  "poverty rate":              { id: "B17001_002E", label: "Poverty Rate",                           format: "percent" },
  "below poverty":             { id: "B17001_002E", label: "Poverty Rate",                           format: "percent" },
  "unemployment":              { id: "B23025_005E", label: "Unemployment Rate",                      format: "percent" },
  "unemployed":                { id: "B23025_005E", label: "Unemployment Rate",                      format: "percent" },
  "unemployment rate":         { id: "B23025_005E", label: "Unemployment Rate",                      format: "percent" },
  "employed":                  { id: "B23025_004E", label: "Employment Rate",                        format: "percent" },
  "employment":                { id: "B23025_004E", label: "Employment Rate",                        format: "percent" },
  "labor force participation": { id: "B23025_002E", label: "Labor Force Participation Rate",         format: "percent" },
  "median age":                { id: "B01002_001E", label: "Median Age",                             format: "years" },
  "age":                       { id: "B01002_001E", label: "Median Age",                             format: "years" },
  "commute time":              { id: "B08136_001E", label: "Mean Travel Time to Work",               format: "minutes" },
  "travel time":               { id: "B08136_001E", label: "Mean Travel Time to Work",               format: "minutes" },

  // ── Housing ──────────────────────────────────────────────────────────────
  "median home value":         { id: "B25077_001E", label: "Median Home Value",                      format: "currency" },
  "home value":                { id: "B25077_001E", label: "Median Home Value",                      format: "currency" },
  "housing value":             { id: "B25077_001E", label: "Median Home Value",                      format: "currency" },
  "median rent":               { id: "B25064_001E", label: "Median Gross Rent",                      format: "currency" },
  "rent":                      { id: "B25064_001E", label: "Median Gross Rent",                      format: "currency" },
  "gross rent":                { id: "B25064_001E", label: "Median Gross Rent",                      format: "currency" },
  "housing units":             { id: "B25001_001E", label: "Total Housing Units",                    format: "number" },
  "vacancy rate":              { id: "B25002_003E", label: "Vacancy Rate",                           format: "percent" },
  "vacant housing":            { id: "B25002_003E", label: "Vacancy Rate",                           format: "percent" },
  "homeownership rate":        { id: "B25003_002E", label: "Homeownership Rate",                     format: "percent" },
  "homeownership":             { id: "B25003_002E", label: "Homeownership Rate",                     format: "percent" },
  "owner-occupied rate":       { id: "B25003_002E", label: "Homeownership Rate",                     format: "percent" },
  "renter-occupied rate":      { id: "B25003_003E", label: "Renter-Occupied Rate",                   format: "percent" },
  "rent burden":               { id: "B25071_001E", label: "Median Gross Rent as % of Household Income", format: "percent" },
  "median rent burden":        { id: "B25071_001E", label: "Median Gross Rent as % of Household Income", format: "percent" },

  // ── Education (extending existing) ───────────────────────────────────────
  "bachelor's degree":         { id: "B15003_022E", label: "Bachelor's Degree Attainment Rate",      format: "percent" },
  "college educated":          { id: "B15003_022E", label: "Bachelor's Degree Attainment Rate",      format: "percent" },
  "education":                 { id: "B15003_022E", label: "Bachelor's Degree Attainment Rate",      format: "percent" },
  "high school graduation":    { id: "B15003_017E", label: "High School Graduation Rate",            format: "percent" },
  "high school graduation rate": { id: "B15003_017E", label: "High School Graduation Rate",          format: "percent" },
  "associate's degree":        { id: "B15003_021E", label: "Associate's Degree Attainment Rate",     format: "percent" },
  "associate degree":          { id: "B15003_021E", label: "Associate's Degree Attainment Rate",     format: "percent" },
  "master's degree":           { id: "B15003_023E", label: "Master's Degree Attainment Rate",        format: "percent" },
  "professional school degree": { id: "B15003_024E", label: "Professional School Degree Attainment Rate", format: "percent" },
  "doctorate":                 { id: "B15003_025E", label: "Graduate or Professional Degree Rate",   format: "percent" },
  "doctoral degree":           { id: "B15003_025E", label: "Graduate or Professional Degree Rate",   format: "percent" },
  "graduate or professional degree": { id: "B15003_025E", label: "Graduate or Professional Degree Rate", format: "percent" },
  "graduate degree":           { id: "B15003_025E", label: "Graduate or Professional Degree Rate",   format: "percent" },

  // ── Transportation (means of travel to work — all rates) ─────────────────
  "drove alone":               { id: "B08301_003E", label: "Drove Alone to Work",                    format: "percent" },
  "drove alone to work":       { id: "B08301_003E", label: "Drove Alone to Work",                    format: "percent" },
  "carpool":                   { id: "B08301_004E", label: "Carpooled to Work",                      format: "percent" },
  "carpooled":                 { id: "B08301_004E", label: "Carpooled to Work",                      format: "percent" },
  "public transit":            { id: "B08301_010E", label: "Used Public Transportation to Work",     format: "percent" },
  "public transportation":     { id: "B08301_010E", label: "Used Public Transportation to Work",     format: "percent" },
  "bicycled to work":          { id: "B08301_018E", label: "Bicycled to Work",                       format: "percent" },
  "bike commute":              { id: "B08301_018E", label: "Bicycled to Work",                       format: "percent" },
  "walked to work":            { id: "B08301_019E", label: "Walked to Work",                         format: "percent" },
  "walking commute":           { id: "B08301_019E", label: "Walked to Work",                         format: "percent" },
  "worked from home":          { id: "B08301_021E", label: "Worked from Home",                       format: "percent" },
  "work from home":            { id: "B08301_021E", label: "Worked from Home",                       format: "percent" },
  "remote work":               { id: "B08301_021E", label: "Worked from Home",                       format: "percent" },

  // ── Foreign-born / citizenship / veterans ────────────────────────────────
  "foreign born":              { id: "B05002_013E", label: "Foreign-Born Population",                format: "number" },
  "foreign-born":              { id: "B05002_013E", label: "Foreign-Born Population",                format: "number" },
  "foreign-born population":   { id: "B05002_013E", label: "Foreign-Born Population",                format: "number" },
  "naturalized":               { id: "B05001_005E", label: "Naturalized U.S. Citizens",              format: "number" },
  "naturalized citizen":       { id: "B05001_005E", label: "Naturalized U.S. Citizens",              format: "number" },
  "naturalized citizens":      { id: "B05001_005E", label: "Naturalized U.S. Citizens",              format: "number" },
  "non-citizen":               { id: "B05001_006E", label: "Non-Citizens",                           format: "number" },
  "non-citizens":              { id: "B05001_006E", label: "Non-Citizens",                           format: "number" },
  "not a citizen":             { id: "B05001_006E", label: "Non-Citizens",                           format: "number" },
  "veterans":                  { id: "B21001_002E", label: "Veterans",                               format: "number" },
  "veteran population":        { id: "B21001_002E", label: "Veterans",                               format: "number" },

  // ── Additional aliases for grouped Quick Lookup keys ─────────────────────
  "native american population":  { id: "B03002_005E", label: "American Indian & Alaska Native",      format: "number" },
  "pacific islander population": { id: "B03002_007E", label: "Pacific Islander Population",          format: "number" },
  "carpooled to work":           { id: "B08301_004E", label: "Carpooled to Work",                    format: "percent" },
  "used public transportation":  { id: "B08301_010E", label: "Used Public Transportation",           format: "percent" },
};

export const STATE_FIPS = {
  "alabama": "01", "alaska": "02", "arizona": "04", "arkansas": "05",
  "california": "06", "colorado": "08", "connecticut": "09", "delaware": "10",
  "florida": "12", "georgia": "13", "hawaii": "15", "idaho": "16",
  "illinois": "17", "indiana": "18", "iowa": "19", "kansas": "20",
  "kentucky": "21", "louisiana": "22", "maine": "23", "maryland": "24",
  "massachusetts": "25", "michigan": "26", "minnesota": "27", "mississippi": "28",
  "missouri": "29", "montana": "30", "nebraska": "31", "nevada": "32",
  "new hampshire": "33", "new jersey": "34", "new mexico": "35", "new york": "36",
  "north carolina": "37", "north dakota": "38", "ohio": "39", "oklahoma": "40",
  "oregon": "41", "pennsylvania": "42", "rhode island": "44", "south carolina": "45",
  "south dakota": "46", "tennessee": "47", "texas": "48", "utah": "49",
  "vermont": "50", "virginia": "51", "washington": "53", "west virginia": "54",
  "wisconsin": "55", "wyoming": "56",
  "district of columbia": "11", "washington dc": "11", "washington d.c.": "11",
  "al":"01","ak":"02","az":"04","ar":"05","ca":"06","co":"08","ct":"09","de":"10","dc":"11",
  "fl":"12","ga":"13","hi":"15","id":"16","il":"17","in":"18","ia":"19","ks":"20",
  "ky":"21","la":"22","me":"23","md":"24","ma":"25","mi":"26","mn":"27","ms":"28",
  "mo":"29","mt":"30","ne":"31","nv":"32","nh":"33","nj":"34","nm":"35","ny":"36",
  "nc":"37","nd":"38","oh":"39","ok":"40","or":"41","pa":"42","ri":"44","sc":"45",
  "sd":"46","tn":"47","tx":"48","ut":"49","vt":"50","va":"51","wa":"53","wv":"54",
  "wi":"55","wy":"56",
};

const CITY_STATE_HINTS = {
  "evanston":      "illinois",
  "chicago":       "illinois",
  "new york city": "new york",
  "nyc":           "new york",
  "los angeles":   "california",
  "houston":       "texas",
  "phoenix":       "arizona",
  "philadelphia":  "pennsylvania",
  "san antonio":   "texas",
  "san diego":     "california",
  "dallas":        "texas",
  "san jose":      "california",
  "austin":        "texas",
  "jacksonville":  "florida",
  "san francisco": "california",
  "columbus":      "ohio",
  "charlotte":     "north carolina",
  "indianapolis":  "indiana",
  "seattle":       "washington",
  "denver":        "colorado",
  "boston":        "massachusetts",
  "nashville":     "tennessee",
  "baltimore":     "maryland",
  "louisville":    "kentucky",
  "portland":      "oregon",
  "las vegas":     "nevada",
  "memphis":       "tennessee",
  "atlanta":       "georgia",
  "miami":         "florida",
  "minneapolis":   "minnesota",
  "tucson":        "arizona",
  "fresno":        "california",
  "sacramento":    "california",
  "mesa":          "arizona",
  "kansas city":   "missouri",
  "omaha":         "nebraska",
  "raleigh":       "north carolina",
  "cleveland":     "ohio",
  "pittsburgh":    "pennsylvania",
};

// Resolve just the metric variable from a query (no geography parsing).
// Used when the geo comes in via pickedGeo and we only need the variable.
//
// Matching is EXACT on the metric phrase (everything before " in <location>")
// after stripping question shapers and articles. So:
//   "what is the median rent in Austin" → tokens [median, rent] → matches "median rent"
//   "asian population in San Mateo"     → tokens [asian, population] → matches "asian population"
//   "asian population growth in Austin" → tokens [asian, population, growth] → no match → fall through to Claude
//
// Returns null when no key's tokens are exactly equal to the query's content tokens.
// The caller (chat handler) treats null as "defer to Claude".
export function parseVariableOnly(query) {
  const queryTokens = metricPhraseTokens(query);
  if (queryTokens.length === 0) return null;
  const querySet = new Set(queryTokens);

  // Walk longest-keyword-first so a "median household income" entry is preferred
  // over "median income" when both could in principle match.
  const sortedEntries = Object.entries(VARIABLE_MAP).sort(([a], [b]) => b.length - a.length);
  for (const [keyword, varData] of sortedEntries) {
    const keywordTokens = tokenizeForMatch(keyword);
    if (keywordTokens.length === 0) continue;
    if (keywordTokens.length !== queryTokens.length) continue;
    let allMatch = true;
    for (const t of keywordTokens) {
      if (!querySet.has(t)) { allMatch = false; break; }
    }
    if (allMatch) return varData;
  }
  return null;
}

export function parseQuery(query) {
  const q = query.toLowerCase().trim();

  // Match longest keyword first so "per capita income" wins over "income" and
  // "median rent" wins over "rent". Object insertion order alone isn't reliable
  // for this — sorting by length is.
  const variable = parseVariableOnly(q);
  if (!variable) return { error: "I couldn't identify what data you're looking for. Try asking about income, population, rent, home value, poverty, employment, median age, or commute time." };

  const geoResult = extractGeography(q);
  if (geoResult.error) return { error: geoResult.error };

  return {
    variable,
    geoParams: geoResult.params,
    locationLabel: geoResult.label,
  };
}

function extractGeography(q) {
  // ── KEY FIX: split on " in " then on "," instead of using a lazy regex ──
  const inIdx = q.indexOf(" in ");
  if (inIdx === -1) {
    return { error: "I couldn't find a location in your query. Try something like 'median income in Evanston, Illinois' or 'population in Texas'." };
  }

  const locationPart = q.slice(inIdx + 4).trim(); // everything after " in "
  const commaIdx = locationPart.indexOf(",");

  let rawPlace, rawState;

  if (commaIdx !== -1) {
    // "little rock, arkansas"  →  city + state
    rawPlace = locationPart.slice(0, commaIdx).trim();
    rawState = locationPart.slice(commaIdx + 1).trim();
  } else {
    // "arkansas"  →  state only or ambiguous city
    rawPlace = locationPart.trim();
    rawState = null;
  }

  // State-only query (no comma, and rawPlace is a known state)
  if (!rawState && STATE_FIPS[rawPlace]) {
    return {
      params: { forGeo: `state:${STATE_FIPS[rawPlace]}` },
      label: capitalize(rawPlace),
    };
  }

  // City + state query
  let stateFips = null;
  let stateLabel = null;

  if (rawState && STATE_FIPS[rawState]) {
    stateFips = STATE_FIPS[rawState];
    stateLabel = capitalize(rawState);
  } else if (!rawState && CITY_STATE_HINTS[rawPlace]) {
    const hintState = CITY_STATE_HINTS[rawPlace];
    stateFips = STATE_FIPS[hintState];
    stateLabel = capitalize(hintState);
  }

  if (!stateFips) {
    return { error: `I couldn't determine the state for "${rawPlace}". Try adding the state, like "income in ${capitalize(rawPlace)}, Illinois".` };
  }

  return {
    params: {
      forGeo: `place:*`,
      inGeo: `state:${stateFips}`,
      placeFilter: rawPlace,
    },
    label: `${capitalize(rawPlace)}, ${stateLabel}`,
  };
}

function capitalize(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

export function formatValue(raw, format) {
  const num = parseFloat(raw);
  if (isNaN(num) || num < 0) return "Data not available";

  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
    case "number":
      return new Intl.NumberFormat("en-US").format(Math.round(num));
    case "percent":
      return `${parseFloat(num.toFixed(3))}%`;
    case "years":
      return `${parseFloat(num.toFixed(3))} years`;
    case "minutes":
      return `${parseFloat(num.toFixed(1))} mins`;
    case "index":
      return num.toFixed(3);
    default:
      return String(num);
  }
}