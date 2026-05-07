// pages/api/acs-search.js — search endpoint for the /learn UI.
// POST { query, topK? } → { results, total_chunks }
// GET  ?action=docs    → { docs: [...] }     (used to render the doc directory)

import { searchAcsDocs, getDocList } from "../../lib/acsRag";

export default async function handler(req, res) {
  try {
    if (req.method === "GET" && req.query.action === "docs") {
      const docs = await getDocList();
      return res.status(200).json({ docs });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const topK = Number.isFinite(body.topK) ? Math.min(20, Math.max(1, body.topK)) : 5;

    if (!query) {
      return res.status(400).json({ error: "Missing or empty 'query'." });
    }

    const out = await searchAcsDocs(query, { topK });
    return res.status(200).json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Distinguish missing-index error so the UI can show a sensible message.
    const missingIndex = /index not found/i.test(msg);
    return res.status(missingIndex ? 503 : 500).json({
      error: msg,
      code: missingIndex ? "INDEX_NOT_BUILT" : "INTERNAL",
    });
  }
}
