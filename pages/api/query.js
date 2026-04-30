// pages/api/query.js
// Serverless API route — runs on Vercel, never exposed to the browser.
// The Census API key lives ONLY here via environment variables.

import { parseQuery, formatValue } from "../../lib/censusTranslator";
import { fetchCensusValue } from "../../lib/censusApi";
import { computeRateIfNeeded } from "../../lib/censusRates";
import { CURRENT_ACS_YEAR } from "../../lib/censusConstants";
import { validateValue } from "../../lib/validateCensusData";

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query } = req.body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({ error: "Please provide a query." });
  }

  // Parse the natural language query
  const parsed = parseQuery(query);

  if (parsed.error) {
    return res.status(422).json({ error: parsed.error });
  }

  const { variable, geoParams, locationLabel } = parsed;

  // Grab the API key — server-side only, never sent to browser
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    console.error("CENSUS_API_KEY is not set");
    return res.status(500).json({ error: "Server configuration error: missing API key." });
  }

  try {
    let rawValue = await fetchCensusValue(variable.id, geoParams, apiKey);

    const firstValidation = validateValue(variable.id, rawValue);
    if (!firstValidation.ok) {
      try {
        const retryValue = await fetchCensusValue(variable.id, geoParams, apiKey);
        const retryValidation = validateValue(variable.id, retryValue);
        if (!retryValidation.ok) {
          return res.status(200).json({
            query,
            location: locationLabel,
            metric: variable.label,
            value: null,
            warning: retryValidation.reason,
            summary: `Data for ${variable.label.toLowerCase()} in ${locationLabel} could not be validated.`,
            source: `ACS 5-Year Estimates (${CURRENT_ACS_YEAR}), U.S. Census Bureau`,
          });
        }
        rawValue = retryValue;
      } catch (retryErr) {
        return res.status(500).json({ error: retryErr.message || "Failed to fetch Census data after retry." });
      }
    }

    const rateResult = await computeRateIfNeeded(variable.id, rawValue, geoParams, apiKey);
    const formattedValue = rateResult
      ? formatValue(rateResult.value, rateResult.format)
      : formatValue(rawValue, variable.format);

    return res.status(200).json({
      query,
      location: locationLabel,
      metric: variable.label,
      value: formattedValue,
      summary: `The ${variable.label.toLowerCase()} in ${locationLabel} is ${formattedValue}.`,
      source: `ACS 5-Year Estimates (${CURRENT_ACS_YEAR}), U.S. Census Bureau`,
    });
  } catch (err) {
    console.error("Census fetch error:", err.message);
    return res.status(500).json({
      error: err.message || "Failed to fetch data from Census API.",
    });
  }
}
