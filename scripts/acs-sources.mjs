// scripts/acs-sources.mjs — canonical list of ACS source documents to index.
// Each entry: { id, title, kind, description, url }
// id is used in URLs and as the stable doc identifier in the index.

export const PDF_SOURCES = [
  {
    id: "handbook-general",
    title: "Understanding and Using ACS Data — What All Data Users Need to Know",
    kind: "handbook",
    description: "The Bureau's general-audience handbook. Best starting point.",
    url: "https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_general_handbook_2020.pdf",
  },
  {
    id: "handbook-journalists",
    title: "Understanding and Using ACS Data — A Handbook for Journalists",
    kind: "handbook",
    description: "Guidance written for journalists and newsroom data desks.",
    url: "https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_journalist_handbook_2020.pdf",
  },
  {
    id: "handbook-state-local",
    title: "Understanding and Using ACS Data — A Handbook for State and Local Agencies",
    kind: "handbook",
    description: "How state, county, and city agencies use ACS data.",
    url: "https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_state_local_handbook_2020.pdf",
  },
  {
    id: "handbook-federal",
    title: "Understanding and Using ACS Data — A Handbook for Federal Agencies",
    kind: "handbook",
    description: "ACS use cases and constraints for federal-government data users.",
    url: "https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_federal_handbook_2020.pdf",
  },
  {
    id: "handbook-congress",
    title: "Understanding and Using ACS Data — A Handbook for Congress",
    kind: "handbook",
    description: "Congressional-district-focused guidance.",
    url: "https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_congress_handbook_2020.pdf",
  },
  {
    id: "handbook-rural",
    title: "Understanding and Using ACS Data — A Handbook for Rural Communities",
    kind: "handbook",
    description: "Reading ACS data for small and rural geographies.",
    url: "https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_rural_handbook_2020.pdf",
  },
  {
    id: "handbook-researchers",
    title: "Understanding and Using ACS Data — A Handbook for Academic Researchers",
    kind: "handbook",
    description: "Methodological depth aimed at academic users.",
    url: "https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_researchers_handbook_2020.pdf",
  },
  {
    id: "handbook-aian",
    title: "Understanding and Using ACS Data — A Handbook for AIAN Populations",
    kind: "handbook",
    description: "Working with ACS data on American Indian and Alaska Native populations.",
    url: "https://www.census.gov/content/dam/Census/library/publications/2021/acs/acs_aian_handbook_2021.pdf",
  },
  {
    id: "design-methodology",
    title: "American Community Survey Design and Methodology Report (2024)",
    kind: "methodology",
    description: "The technical methodology reference — sampling, weighting, MOEs, edits, imputation.",
    url: "https://www2.census.gov/programs-surveys/acs/methodology/design_and_methodology/2024/acs_design_methodology_report_2024.pdf",
  },
  {
    id: "subject-definitions",
    title: "American Community Survey 2022 Subject Definitions",
    kind: "definitions",
    description: "Canonical definitions of every concept the ACS measures.",
    url: "https://www2.census.gov/programs-surveys/acs/tech_docs/subject_definitions/2022_ACSSubjectDefinitions.pdf",
  },
];

// "Why we ask each question" — short topic pages explaining each ACS question.
// URL list mirrors the official index at
// https://www.census.gov/acs/www/about/why-we-ask-each-question/
export const HTML_SOURCES = [
  { id: "why-acreage", title: "Why we ask: Acreage and agricultural sales", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/acreage/" },
  { id: "why-age", title: "Why we ask: Age", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/age/" },
  { id: "why-ancestry", title: "Why we ask: Ancestry", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/ancestry/" },
  { id: "why-citizenship", title: "Why we ask: Citizenship", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/citizenship/" },
  { id: "why-commuting", title: "Why we ask: Commuting", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/commuting/" },
  { id: "why-computer", title: "Why we ask: Computer and internet use", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/computer/" },
  { id: "why-disability", title: "Why we ask: Disability", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/disability/" },
  { id: "why-education", title: "Why we ask: Education", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/education/" },
  { id: "why-employment", title: "Why we ask: Employment status", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/employment/" },
  { id: "why-ethnicity", title: "Why we ask: Hispanic or Latino origin (ethnicity)", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/ethnicity/" },
  { id: "why-fertility", title: "Why we ask: Fertility", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/fertility/" },
  { id: "why-food-stamps", title: "Why we ask: Food stamps / SNAP", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/food-stamps/" },
  { id: "why-grandparents", title: "Why we ask: Grandparents as caregivers", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/grandparents/" },
  { id: "why-health", title: "Why we ask: Health insurance", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/health/" },
  { id: "why-heating", title: "Why we ask: House heating fuel", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/heating/" },
  { id: "why-housing", title: "Why we ask: Housing", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/housing/" },
  { id: "why-income", title: "Why we ask: Income and earnings", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/income/" },
  { id: "why-language", title: "Why we ask: Language", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/language/" },
  { id: "why-marital", title: "Why we ask: Marital history and status", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/marital/" },
  { id: "why-migration", title: "Why we ask: Migration / residence one year ago", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/migration/" },
  { id: "why-name", title: "Why we ask: Name", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/name/" },
  { id: "why-ownership", title: "Why we ask: Ownership / housing tenure", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/ownership/" },
  { id: "why-plumbing", title: "Why we ask: Plumbing facilities", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/plumbing/" },
  { id: "why-race", title: "Why we ask: Race", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/race/" },
  { id: "why-relationship", title: "Why we ask: Relationship to householder", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/relationship/" },
  { id: "why-rooms", title: "Why we ask: Rooms and bedrooms", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/rooms/" },
  { id: "why-school", title: "Why we ask: School enrollment", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/school/" },
  { id: "why-sex", title: "Why we ask: Sex", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/sex/" },
  { id: "why-vehicles", title: "Why we ask: Vehicles available", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/vehicles/" },
  { id: "why-veterans", title: "Why we ask: Veteran status and military service", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/veterans/" },
  { id: "why-work", title: "Why we ask: Work status / weeks worked", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/work/" },
  { id: "why-year-built", title: "Why we ask: Year structure built", url: "https://www.census.gov/acs/www/about/why-we-ask-each-question/year-built/" },
];
