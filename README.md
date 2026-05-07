# CensusBot — ACS Data Explorer

Ask natural-language questions about U.S. Census data, powered by the **ACS 5-Year Estimates** (2022).

---

## Example Queries

- `median income in Evanston, Illinois`
- `population in Texas`
- `median rent in Seattle, Washington`
- `median home value in Boston, Massachusetts`
- `poverty rate in Chicago, Illinois`
- `commute time in Austin, Texas`

## Developing

This app uses two outside services for which you'll need API keys. Copy `.env.local.sample` to `.env.local` and fill in the following:

```
# https://platform.claude.com/settings/keys
ANTHROPIC_API_KEY='sk-ant-.....'
# https://api.census.gov/data/key_signup.html
CENSUS_API_KEY='....'
```

Then, in the repository root,
```
npm install
npm run dev
```
