// lib/censusTranslator.js

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
};

// Triggers: if the query contains one of these AND no more specific keyword,
// surface the picker.
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
  "family income",
  "bachelor", "graduate", "high school",
  "unemployment", "unemployed",
  "labor force",
  "median home value", "home value", "housing value",
  "median rent", "gross rent", "rent",
  "housing units",
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
  "median income":        { id: "B19013_001E", label: "Median Household Income",   format: "currency" },
  "household income":     { id: "B19013_001E", label: "Median Household Income",   format: "currency" },
  "income":               { id: "B19013_001E", label: "Median Household Income",   format: "currency" },
  "per capita income":    { id: "B19301_001E", label: "Per Capita Income",          format: "currency" },
  "population":           { id: "B01003_001E", label: "Total Population",           format: "number" },
  "total population":     { id: "B01003_001E", label: "Total Population",           format: "number" },
  "how many people":      { id: "B01003_001E", label: "Total Population",           format: "number" },
  "residents":            { id: "B01003_001E", label: "Total Population",           format: "number" },
  "median home value":    { id: "B25077_001E", label: "Median Home Value",          format: "currency" },
  "home value":           { id: "B25077_001E", label: "Median Home Value",          format: "currency" },
  "housing value":        { id: "B25077_001E", label: "Median Home Value",          format: "currency" },
  "median rent":          { id: "B25064_001E", label: "Median Gross Rent",          format: "currency" },
  "rent":                 { id: "B25064_001E", label: "Median Gross Rent",          format: "currency" },
  "gross rent":           { id: "B25064_001E", label: "Median Gross Rent",          format: "currency" },
  "housing units":        { id: "B25001_001E", label: "Total Housing Units",        format: "number" },
  "bachelor's degree":    { id: "B15003_022E", label: "Bachelor's Degree Attainment Rate", format: "percent" },
  "college educated":     { id: "B15003_022E", label: "Bachelor's Degree Attainment Rate", format: "percent" },
  "education":            { id: "B15003_022E", label: "Bachelor's Degree Attainment Rate", format: "percent" },
  "poverty":              { id: "B17001_002E", label: "Poverty Rate",               format: "percent" },
  "poverty rate":         { id: "B17001_002E", label: "Poverty Rate",               format: "percent" },
  "below poverty":        { id: "B17001_002E", label: "Poverty Rate",               format: "percent" },
  "unemployment":         { id: "B23025_005E", label: "Unemployment Rate",          format: "percent" },
  "unemployed":           { id: "B23025_005E", label: "Unemployment Rate",          format: "percent" },
  "employed":             { id: "B23025_004E", label: "Employment Rate",            format: "percent" },
  "employment":           { id: "B23025_004E", label: "Employment Rate",            format: "percent" },
  "median age":           { id: "B01002_001E", label: "Median Age",                 format: "years" },
  "age":                  { id: "B01002_001E", label: "Median Age",                 format: "years" },
  "commute time":         { id: "B08136_001E", label: "Mean Travel Time to Work",   format: "minutes" },
  "travel time":          { id: "B08136_001E", label: "Mean Travel Time to Work",   format: "minutes" },
  "unemployment rate":    { id: "B23025_005E", label: "Unemployment Rate",          format: "percent" },
  "median household income": { id: "B19013_001E", label: "Median Household Income", format: "currency" },
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
  "al":"01","ak":"02","az":"04","ar":"05","ca":"06","co":"08","ct":"09","de":"10",
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

export function parseQuery(query) {
  const q = query.toLowerCase().trim();

  // Match longest keyword first so "per capita income" wins over "income" and
  // "median rent" wins over "rent". Object insertion order alone isn't reliable
  // for this — sorting by length is.
  const sortedEntries = Object.entries(VARIABLE_MAP).sort(([a], [b]) => b.length - a.length);
  let variable = null;
  for (const [keyword, varData] of sortedEntries) {
    if (q.includes(keyword)) {
      variable = varData;
      break;
    }
  }
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
      return `${parseFloat(num.toFixed(3))} minutes`;
    default:
      return String(num);
  }
}