// lib/usePlaceGeoid.js
// Fetches Census place GEOID for a city+state with module-level caching.
import { useState, useEffect } from "react";

const cache = new Map();

export function usePlaceGeoid(city, state) {
  const key = `${(city || "").toLowerCase()}|${(state || "").toLowerCase()}`;
  const [geoid, setGeoid] = useState(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!city || !state) return;
    if (cache.has(key)) {
      setGeoid(cache.get(key));
      return;
    }
    fetch(`/api/place-geoid?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.geoid) {
          cache.set(key, data.geoid);
          setGeoid(data.geoid);
        }
      })
      .catch(() => {});
  }, [key, city, state]);

  return geoid;
}
