// Shared CensusBot query types and state → city lists

// Bump this when the Census Bureau releases a new ACS 5-year dataset.
export const CURRENT_ACS_YEAR = "2022";

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

export const STATES_CITIES = {
  Alabama: ["Birmingham", "Huntsville", "Mobile", "Montgomery", "Tuscaloosa"],
  Alaska: ["Anchorage", "Fairbanks", "Juneau", "Sitka", "Wasilla"],
  Arizona: ["Chandler", "Gilbert", "Glendale", "Mesa", "Phoenix", "Scottsdale", "Tempe", "Tucson"],
  Arkansas: ["Fayetteville", "Fort Smith", "Jonesboro", "Little Rock", "Springdale"],
  California: ["Fresno", "Long Beach", "Los Angeles", "Oakland", "Sacramento", "San Diego", "San Francisco", "San Jose", "Santa Ana", "Anaheim"],
  Colorado: ["Aurora", "Boulder", "Colorado Springs", "Denver", "Fort Collins", "Lakewood"],
  Connecticut: ["Bridgeport", "Hartford", "New Haven", "Stamford", "Waterbury"],
  Delaware: ["Dover", "Newark", "Wilmington"],
  Florida: ["Cape Coral", "Fort Lauderdale", "Jacksonville", "Miami", "Orlando", "St. Petersburg", "Tampa"],
  Georgia: ["Athens", "Atlanta", "Augusta", "Columbus", "Savannah"],
  Hawaii: ["Hilo", "Honolulu", "Kailua", "Kapolei", "Pearl City"],
  Idaho: ["Boise", "Caldwell", "Idaho Falls", "Meridian", "Nampa"],
  Illinois: ["Aurora", "Chicago", "Evanston", "Joliet", "Naperville", "Peoria", "Rockford", "Springfield"],
  Indiana: ["Evansville", "Fort Wayne", "Indianapolis", "South Bend"],
  Iowa: ["Cedar Rapids", "Davenport", "Des Moines", "Iowa City", "Sioux City"],
  Kansas: ["Kansas City", "Olathe", "Overland Park", "Topeka", "Wichita"],
  Kentucky: ["Bowling Green", "Covington", "Lexington", "Louisville", "Owensboro"],
  Louisiana: ["Baton Rouge", "Lafayette", "New Orleans", "Shreveport"],
  Maine: ["Auburn", "Augusta", "Bangor", "Portland"],
  Maryland: ["Annapolis", "Baltimore", "Frederick", "Gaithersburg", "Rockville"],
  Massachusetts: ["Boston", "Cambridge", "Lowell", "Springfield", "Worcester"],
  Michigan: ["Ann Arbor", "Detroit", "Flint", "Grand Rapids", "Lansing", "Sterling Heights", "Warren"],
  Minnesota: ["Bloomington", "Duluth", "Minneapolis", "Rochester", "Saint Paul"],
  Mississippi: ["Biloxi", "Gulfport", "Hattiesburg", "Jackson", "Southaven"],
  Missouri: ["Columbia", "Independence", "Kansas City", "Springfield", "St. Louis"],
  Montana: ["Billings", "Great Falls", "Helena", "Missoula"],
  Nebraska: ["Bellevue", "Lincoln", "Omaha"],
  Nevada: ["Henderson", "Las Vegas", "North Las Vegas", "Reno", "Sparks"],
  "New Hampshire": ["Concord", "Dover", "Manchester", "Nashua"],
  "New Jersey": ["Elizabeth", "Jersey City", "Newark", "Paterson", "Trenton"],
  "New Mexico": ["Albuquerque", "Las Cruces", "Rio Rancho", "Roswell", "Santa Fe"],
  "New York": ["Albany", "Buffalo", "New York City", "Rochester", "Syracuse", "Yonkers"],
  "North Carolina": ["Charlotte", "Durham", "Fayetteville", "Greensboro", "Raleigh", "Winston-Salem"],
  "North Dakota": ["Bismarck", "Fargo", "Grand Forks", "Minot"],
  Ohio: ["Akron", "Cincinnati", "Cleveland", "Columbus", "Dayton", "Toledo"],
  Oklahoma: ["Broken Arrow", "Norman", "Oklahoma City", "Tulsa"],
  Oregon: ["Eugene", "Gresham", "Hillsboro", "Portland", "Salem"],
  Pennsylvania: ["Allentown", "Erie", "Philadelphia", "Pittsburgh", "Reading"],
  "Rhode Island": ["Cranston", "Pawtucket", "Providence", "Warwick", "Woonsocket"],
  "South Carolina": ["Charleston", "Columbia", "Greenville", "Mount Pleasant", "North Charleston"],
  "South Dakota": ["Aberdeen", "Rapid City", "Sioux Falls"],
  Tennessee: ["Chattanooga", "Clarksville", "Knoxville", "Memphis", "Nashville"],
  Texas: ["Arlington", "Austin", "Corpus Christi", "Dallas", "El Paso", "Fort Worth", "Houston", "Laredo", "Lubbock", "San Antonio"],
  Utah: ["Ogden", "Orem", "Provo", "Salt Lake City", "West Valley City"],
  Vermont: ["Burlington", "Essex Junction", "Montpelier", "Rutland"],
  Virginia: ["Alexandria", "Arlington", "Chesapeake", "Norfolk", "Richmond", "Virginia Beach"],
  Washington: ["Bellevue", "Seattle", "Spokane", "Tacoma", "Vancouver"],
  "West Virginia": ["Charleston", "Huntington", "Morgantown", "Parkersburg"],
  Wisconsin: ["Green Bay", "Kenosha", "Madison", "Milwaukee", "Racine"],
  Wyoming: ["Casper", "Cheyenne", "Gillette", "Laramie"],
};

export const STATE_NAMES = Object.keys(STATES_CITIES).sort();

export const EXPLORE_METRICS_STORAGE_KEY = "census-bot-explore-metrics";
export const EXPLORE_LOCATION_STORAGE_KEY = "census-bot-explore-location";

/** Natural-language query for city + state (city required). */
export function buildCityStateQuery(metric, city, state) {
  return `${metric} in ${city}, ${state}`;
}
