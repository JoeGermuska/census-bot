// pages/api/geo-candidates.js
// Returns geography candidates matching a name, across place / county /
// county subdivision / CBSA / urban area. Used by the chatbot clarification
// flow to ask the user which scope they meant.

import { findGeoCandidates, findZctaByZip, describeCandidate } from "../../lib/geoCandidates";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const name = String(req.query.name || "").trim();
  const state = req.query.state ? String(req.query.state) : null;
  const zip = req.query.zip ? String(req.query.zip) : null;

  if (zip) {
    try {
      const z = await findZctaByZip(zip);
      if (!z) return res.status(404).json({ error: `No ZCTA found for ZIP ${zip}` });
      return res.status(200).json({ candidates: [{ ...z, ...describeCandidate(z) }] });
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || "ZCTA lookup failed") });
    }
  }

  if (!name) return res.status(400).json({ error: "Missing required query param: name (or zip)." });

  try {
    const candidates = await findGeoCandidates(name, { stateName: state });
    return res.status(200).json({
      candidates: candidates.map((c) => ({ ...c, ...describeCandidate(c) })),
      count: candidates.length,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || "Geo lookup failed") });
  }
}
