// components/TrendChart.js
// V5 — DENSE DATA-JOURNALISM
// Direction: every value labeled, integrated lede, range chips for window
// adjustment, vertical + horizontal grid, hover-as-affordance.
// Type: serif display (Merriweather with Georgia fallback) + system sans body.
// Color: the existing CensusBot palette (var(--accent), var(--text), etc.).
//
// Methodology / series-redesign banners are NOT rendered here — they sit
// outside the chart in the parent (chat bubble) so the graph stays clean.

import { useEffect, useMemo, useRef, useState } from "react";
import { buildCensusProfileUrl } from "../lib/censusConstants";
import { usePlaceGeoid } from "../lib/usePlaceGeoid";

// ── Series colors ─────────────────────────────────────────────────────────────
// Single-series mode uses the first slot. Multi-series cycles through.
const SERIES_COLORS_LIGHT = ["#1a4480", "#2378c3", "#5b8ec5", "#7aa7d9", "#143664"];
const SERIES_COLORS_DARK  = ["#60b4ff", "#89cfff", "#3d9be8", "#a8d8ff", "#2378c3"];

// ── Formatters ────────────────────────────────────────────────────────────────
function formatValueForMetric(rawValue, metric) {
  if (!Number.isFinite(rawValue)) return "N/A";
  if (/income|rent|value/i.test(metric)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }).format(rawValue);
  }
  if (/rate|percent|poverty|unemployment|employment|bachelor|education/i.test(metric)) {
    return `${rawValue.toFixed(1)}%`;
  }
  if (/age/i.test(metric)) return `${rawValue.toFixed(1)} yrs`;
  if (/commute|travel|minute/i.test(metric)) return `${rawValue.toFixed(1)} min`;
  return new Intl.NumberFormat("en-US").format(Math.round(rawValue));
}

function formatYTick(rawValue, metric, step = null) {
  if (!Number.isFinite(rawValue)) return "";
  // Pick decimal precision so adjacent ticks remain distinct. When the
  // step between ticks is sub-thousand (e.g. $250), rounding to integer
  // thousands collapses $2,250 → "$2k" and $2,500 → "$3k" — same-looking
  // labels for different ticks. Heuristic: if step is ≥ 1000, no decimal;
  // if step is 100..999, one decimal; if step is < 100, two decimals.
  const decimalsForStep = (s) => {
    if (s == null) return 0;
    if (s >= 1000) return 0;
    if (s >= 100) return 1;
    return 2;
  };
  const isCurrency = /income|rent|value/i.test(metric);
  const isPercent = /rate|percent|poverty|unemployment|employment|bachelor|education/i.test(metric);

  if (isCurrency) {
    if (rawValue >= 1_000_000) return `$${(rawValue / 1_000_000).toFixed(1)}M`;
    if (rawValue >= 1000) {
      const decimals = decimalsForStep(step);
      return `$${(rawValue / 1000).toFixed(decimals)}k`;
    }
    return `$${rawValue}`;
  }
  if (isPercent) {
    if (step != null && step < 1) return `${rawValue.toFixed(1)}%`;
    return `${Math.round(rawValue)}%`;
  }
  if (rawValue >= 1_000_000) return `${(rawValue / 1_000_000).toFixed(1)}M`;
  if (rawValue >= 1000) {
    const decimals = decimalsForStep(step);
    return `${(rawValue / 1000).toFixed(decimals)}k`;
  }
  return String(Math.round(rawValue));
}

function pctChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(from) < 1) return null;
  return ((to - from) / from) * 100;
}

function formatPct(pct, { digits = 1 } = {}) {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

// ── ACS jargon tooltip ────────────────────────────────────────────────────────
function ACSTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", verticalAlign: "middle", marginLeft: 4 }}>
      <button
        type="button"
        aria-label="What is ACS 5-Year Estimates?"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: 13, height: 13, borderRadius: "50%",
          border: "1px solid var(--chart-muted)",
          background: "transparent", color: "var(--chart-muted)",
          fontSize: 8, fontWeight: 700, lineHeight: 1, cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          padding: 0,
        }}
      >?</button>
      {open && (
        <span role="tooltip" style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)",
          background: "var(--chart-tooltip-bg)",
          border: "1px solid rgba(77,184,255,0.22)",
          borderRadius: 6, padding: "6px 10px", fontSize: 11, lineHeight: 1.5,
          color: "var(--chart-tick)", whiteSpace: "normal", width: 220,
          zIndex: 30, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          pointerEvents: "none",
        }}>
          A rolling average of survey data collected over 5 years, providing higher reliability for smaller areas.
        </span>
      )}
    </span>
  );
}

// ── Download helpers ──────────────────────────────────────────────────────────
function downloadCSV(series, metric, location) {
  const yearMap = new Map();
  series.forEach(s => {
    s.points.forEach(p => {
      const row = yearMap.get(p.year) || { year: p.year };
      row[s.label] = p.numericValue;
      yearMap.set(p.year, row);
    });
  });
  const rows = Array.from(yearMap.values()).sort((a, b) => a.year - b.year);
  const headers = ["Year", ...series.map(s => s.label)];
  const csv = [
    headers.join(","),
    ...rows.map(r => [r.year, ...series.map(s => r[s.label] ?? "")].join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${metric}_${location}.csv`.replace(/[\s/\\]/g, "_");
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPNG(containerRef, metric, location, bgColor) {
  const svg = containerRef.current?.querySelector("svg");
  if (!svg) return;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const rect = svg.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = bgColor || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${metric}_${location}.png`.replace(/[\s/\\]/g, "_");
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
    URL.revokeObjectURL(svgUrl);
  };
  img.src = svgUrl;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeSeries(data) {
  if (Array.isArray(data.series) && data.series.length > 0) return data.series;
  if (Array.isArray(data.points)) return [{ label: data.location || "Series", points: data.points }];
  return [];
}

// ── Main component ────────────────────────────────────────────────────────────
// inline=true : strip the title row (chart only) for embedding inside a parent card.
// expanded=true: larger chart (used in modal expand mode).
export default function TrendChart({ data, expanded = false, inline = false }) {
  const [visible, setVisible] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [hoverYear, setHoverYear] = useState(null);
  const chartContainerRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const update = () => setIsDark(document.documentElement.getAttribute("data-theme") === "dark");
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const SERIES_COLORS = isDark ? SERIES_COLORS_DARK : SERIES_COLORS_LIGHT;

  // Unify all years across series so range chips reflect the full available
  // window even in multi-series mode.
  const series = normalizeSeries(data || {});
  const allYears = useMemo(() => {
    const ys = new Set();
    series.forEach(s => s.points.forEach(p => ys.add(Number(p.year))));
    return Array.from(ys).sort((a, b) => a - b);
  }, [JSON.stringify(series.map(s => s.points.map(p => p.year)))]);

  // Default range = full available window. User can narrow via range chips.
  const [range, setRange] = useState(null);
  useEffect(() => {
    if (allYears.length > 0 && range === null) {
      setRange([allYears[0], allYears[allYears.length - 1]]);
    }
  }, [allYears, range]);

  const effectiveRange = range || (allYears.length > 0 ? [allYears[0], allYears[allYears.length - 1]] : null);

  if (!data) return null;

  // Filter each series to the active range; drop nulls.
  const visibleSeries = useMemo(() => {
    if (!effectiveRange) return [];
    const [lo, hi] = effectiveRange;
    return series.map(s => ({
      ...s,
      points: s.points
        .filter(p => p.year >= lo && p.year <= hi && p.numericValue != null && Number.isFinite(p.numericValue))
        .map(p => ({ year: Number(p.year), numericValue: Number(p.numericValue) }))
        .sort((a, b) => a.year - b.year),
    })).filter(s => s.points.length > 0);
  }, [series, effectiveRange?.[0], effectiveRange?.[1]]);

  const isMulti = visibleSeries.length > 1;
  const { metric, location, source } = data;
  const locationComma = (location || "").indexOf(",");
  const locationCity = locationComma > -1 ? location.slice(0, locationComma).trim() : location || "";
  const locationState = locationComma > -1 ? location.slice(locationComma + 1).trim() : "";
  const geoid = usePlaceGeoid(locationCity, locationState);

  // Lede: integrated subtitle that shows the delta + endpoints up front. For
  // multi-series we just say "Comparing N places" since one-line deltas
  // wouldn't fit. Single-series gets the rich V5 lede.
  const lede = useMemo(() => {
    if (visibleSeries.length === 0) return null;
    if (isMulti) {
      const labels = visibleSeries.map(s => s.label).join(" · ");
      const lo = effectiveRange[0], hi = effectiveRange[1];
      return { multi: true, labels, lo, hi };
    }
    const pts = visibleSeries[0].points;
    if (pts.length < 2) return null;
    const first = pts[0], last = pts[pts.length - 1];
    return {
      multi: false,
      first, last,
      delta: pctChange(first.numericValue, last.numericValue),
    };
  }, [visibleSeries, effectiveRange?.[0], effectiveRange?.[1]]);

  // ── SVG geometry ────────────────────────────────────────────────────────────
  const W = 760;
  const H = expanded ? 380 : 320;
  const PT = 36, PB = 44;
  // Wider left padding for Y-tick labels. Right padding widens for multi-
  // series to give room for the per-line end-of-line value labels (e.g.
  // "$2,997" rendered to the right of each line's last dot).
  const PL = 64;
  const PR = visibleSeries.length > 1 ? 96 : 36;

  // Y-axis: pick 3–4 round ticks based on min/max of visible data.
  const { yTicks, yStep, minV, maxV } = useMemo(() => {
    if (visibleSeries.length === 0) return { yTicks: [], yStep: null, minV: 0, maxV: 1 };
    const all = visibleSeries.flatMap(s => s.points.map(p => p.numericValue));
    const dataMin = Math.min(...all);
    const dataMax = Math.max(...all);
    // Pad headroom so labels above the line don't crash into the top edge.
    const padTop = (dataMax - dataMin) * 0.15 || dataMax * 0.15 || 1;
    const padBottom = (dataMax - dataMin) * 0.05 || 0;
    const lo = Math.max(0, dataMin - padBottom);
    const hi = dataMax + padTop;
    // Round ticks: aim for 3–4 nice round numbers.
    const span = hi - lo;
    const step = niceStep(span / 3);
    const ticks = [];
    let t = Math.ceil(lo / step) * step;
    while (t <= hi && ticks.length < 5) {
      ticks.push(t);
      t += step;
    }
    return { yTicks: ticks, yStep: step, minV: lo, maxV: hi };
  }, [visibleSeries]);

  function niceStep(roughStep) {
    const exp = Math.floor(Math.log10(Math.abs(roughStep) || 1));
    const base = Math.pow(10, exp);
    const norm = roughStep / base;
    let nice;
    if (norm < 1.5) nice = 1;
    else if (norm < 3) nice = 2;
    else if (norm < 7) nice = 5;
    else nice = 10;
    return nice * base;
  }

  // x positions are based on the FULL year range so multi-series with mismatched
  // years stay aligned on the same x-axis.
  const yearsInRange = useMemo(() => {
    if (!effectiveRange) return [];
    const [lo, hi] = effectiveRange;
    return allYears.filter(y => y >= lo && y <= hi);
  }, [allYears, effectiveRange?.[0], effectiveRange?.[1]]);

  const xs = (year) => {
    if (yearsInRange.length <= 1) return PL;
    const idx = yearsInRange.indexOf(year);
    return PL + (idx * (W - PL - PR)) / (yearsInRange.length - 1);
  };
  const ys = (v) => PT + ((maxV - v) / (maxV - minV || 1)) * (H - PT - PB);

  const wrapperStyle = {
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(8px)",
    transition: "opacity 0.5s ease, transform 0.5s ease",
    padding: inline ? 0 : "20px 24px",
    background: "var(--chart-surface, #ffffff)",
    color: "var(--text)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
  };

  function getBgColor() {
    return document.documentElement.getAttribute("data-theme") === "light"
      ? "#ffffff" : "#12172b";
  }

  return (
    <div style={wrapperStyle} ref={chartContainerRef}>
      {/* Title — serif, bold, joined with location. */}
      {!inline && (
        <h2 style={{
          fontFamily: '"Merriweather", Georgia, "Times New Roman", serif',
          fontWeight: 700,
          fontSize: expanded ? 24 : 20,
          lineHeight: 1.25,
          letterSpacing: "-0.012em",
          margin: "0 0 4px",
          color: "var(--text)",
        }}>
          {metric}{location ? ` · ${location}` : ""}
        </h2>
      )}
      {inline && (
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: "0.13em",
          textTransform: "uppercase", color: "var(--chart-muted)", marginBottom: 10,
        }}>
          {metric}{effectiveRange ? ` · ${effectiveRange[0]}–${effectiveRange[1]}` : ""}
        </div>
      )}

      {/* Lede — integrated subtitle with delta + ACS framing. */}
      {!inline && lede && lede.multi && (
        <p style={{
          fontSize: 13, lineHeight: 1.55, color: "var(--chart-tick)",
          margin: "0 0 14px", maxWidth: 640,
        }}>
          Comparing <strong style={{ color: "var(--text)" }}>{visibleSeries.length} places</strong>{" "}
          ({lede.labels}) from {lede.lo} to {lede.hi}. Annual estimates from the 5-year ACS rolling sample.
        </p>
      )}
      {!inline && lede && !lede.multi && (
        <p style={{
          fontSize: 13, lineHeight: 1.55, color: "var(--chart-tick)",
          margin: "0 0 14px", maxWidth: 640,
        }}>
          {lede.delta != null ? (
            <>
              <strong style={{ color: "var(--accent)" }}>
                {lede.delta >= 0 ? "Up" : "Down"} {formatPct(lede.delta, { digits: 1 })}
              </strong>
              {" "}from {formatValueForMetric(lede.first.numericValue, metric)} ({lede.first.year}) to{" "}
              {formatValueForMetric(lede.last.numericValue, metric)} ({lede.last.year}).
            </>
          ) : (
            <>
              {formatValueForMetric(lede.first.numericValue, metric)} ({lede.first.year}) to{" "}
              {formatValueForMetric(lede.last.numericValue, metric)} ({lede.last.year}).
            </>
          )}
          {" "}Annual estimates from the 5-year ACS rolling sample.
        </p>
      )}

      {/* Chart */}
      {visibleSeries.length === 0 ? (
        <div style={{ color: "var(--chart-empty)", fontSize: 14, padding: "2rem 0", textAlign: "center" }}>
          No trend data available.
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
            onMouseLeave={() => setHoverYear(null)}
          >
            {/* Vertical grid at every year (very faint). */}
            {yearsInRange.map(year => (
              <line key={`v-${year}`} x1={xs(year)} x2={xs(year)} y1={PT} y2={H - PB}
                    stroke="var(--text)" strokeOpacity="0.04"/>
            ))}

            {/* Horizontal Y reference lines + tick labels. */}
            {yTicks.map(t => (
              <g key={`y-${t}`}>
                <line x1={PL} x2={W - PR} y1={ys(t)} y2={ys(t)}
                      stroke="var(--text)" strokeOpacity="0.1"/>
                <text x={PL - 8} y={ys(t)} textAnchor="end" dominantBaseline="middle"
                      fontSize="10" fill="var(--chart-muted)"
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatYTick(t, metric, yStep)}
                </text>
              </g>
            ))}

            {/* Series lines */}
            {visibleSeries.map((s, sIdx) => {
              const color = SERIES_COLORS[sIdx % SERIES_COLORS.length];
              const linePath = s.points
                .map((p, i) => `${i === 0 ? "M" : "L"} ${xs(p.year).toFixed(1)} ${ys(p.numericValue).toFixed(1)}`)
                .join(" ");
              return (
                <g key={`line-${s.label}-${sIdx}`}>
                  <path d={linePath} fill="none" stroke={color} strokeWidth="1.75"
                        strokeLinejoin="round" strokeLinecap="round"/>
                  {/* Per-point dots + value labels (single-series only — multi gets too crowded) */}
                  {!isMulti && s.points.map((p, i) => {
                    const above = i % 2 === 0;
                    const x = xs(p.year), y = ys(p.numericValue);
                    const isHover = hoverYear === p.year;
                    const isFirst = i === 0;
                    const isLast = i === s.points.length - 1;
                    return (
                      <g key={`pt-${p.year}`}>
                        <circle cx={x} cy={y} r={isHover ? 4.5 : 3} fill={color}
                                stroke="var(--chart-surface, #fff)" strokeWidth="1.5"/>
                        <text x={x + (isFirst ? 4 : isLast ? -4 : 0)}
                              y={above ? y - 12 : y + 21}
                              textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                              fontSize="10" fontWeight={isHover ? 700 : 500}
                              fill={isHover ? "var(--text)" : "var(--chart-tick)"}
                              style={{ fontVariantNumeric: "tabular-nums" }}>
                          {formatValueForMetric(p.numericValue, metric)}
                        </text>
                      </g>
                    );
                  })}
                  {/* Multi-series: dot + end-of-line annotation at the last
                      point. Per-point labels are too crowded with multiple
                      overlapping lines, but the latest reading per series is
                      the most useful single annotation — surface it here. */}
                  {isMulti && s.points.length > 0 && (() => {
                    const last = s.points[s.points.length - 1];
                    const lx = xs(last.year);
                    const ly = ys(last.numericValue);
                    return (
                      <g key={`end-${sIdx}`}>
                        <circle cx={lx} cy={ly} r={3.5}
                                fill={color} stroke="var(--chart-surface, #fff)" strokeWidth="1.5"/>
                        <text x={lx + 6} y={ly}
                              textAnchor="start" dominantBaseline="middle"
                              fontSize="10" fontWeight={700}
                              fill={color}
                              style={{ fontVariantNumeric: "tabular-nums" }}>
                          {formatValueForMetric(last.numericValue, metric)}
                        </text>
                      </g>
                    );
                  })()}

                  {/* Multi-series hover labels: when the user is hovering on
                      a year, show each series' value at that year right next
                      to its dot. Skips the last point (which already has a
                      permanent end-of-line label) to avoid duplication. */}
                  {isMulti && hoverYear != null && (() => {
                    const lastYear = s.points[s.points.length - 1]?.year;
                    if (hoverYear === lastYear) return null;
                    const hoverPt = s.points.find(p => p.year === hoverYear);
                    if (!hoverPt) return null;
                    const hx = xs(hoverPt.year);
                    const hy = ys(hoverPt.numericValue);
                    return (
                      <g key={`hover-${sIdx}`}>
                        <circle cx={hx} cy={hy} r={4.5}
                                fill={color} stroke="var(--chart-surface, #fff)" strokeWidth="1.5"/>
                        <text x={hx} y={hy - 10}
                              textAnchor="middle" fontSize="10" fontWeight={700}
                              fill={color}
                              style={{ fontVariantNumeric: "tabular-nums" }}>
                          {formatValueForMetric(hoverPt.numericValue, metric)}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}

            {/* X-axis year labels — last year highlighted in single-series. */}
            {yearsInRange.map((year, i) => {
              const isLast = i === yearsInRange.length - 1;
              return (
                <text key={`x-${year}`} x={xs(year)} y={H - PB + 16}
                      textAnchor="middle" fontSize="10"
                      fill={(!isMulti && isLast) ? "var(--accent)" : "var(--chart-muted)"}
                      fontWeight={(!isMulti && isLast) ? 700 : 500}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                  {year}
                </text>
              );
            })}

            {/* Hit areas for hover — single + multi-series. Each year gets
                a transparent rect spanning the full chart height; mousing
                into it sets hoverYear which triggers per-series highlight.
                Width = year-to-year gap (denominator is N-1, not N) so the
                rects tile cleanly with no gaps where hover wouldn't fire. */}
            {yearsInRange.map(year => {
              const gap = yearsInRange.length > 1
                ? (W - PL - PR) / (yearsInRange.length - 1)
                : (W - PL - PR);
              return (
                <rect key={`hit-${year}`}
                      x={xs(year) - gap / 2}
                      y={PT - 6}
                      width={gap}
                      height={H - PT - PB + 12}
                      fill="transparent" style={{ cursor: "crosshair" }}
                      onMouseEnter={() => setHoverYear(year)}/>
              );
            })}

            {/* Hover marker — dashed vertical line. */}
            {hoverYear != null && (
              <line x1={xs(hoverYear)} x2={xs(hoverYear)} y1={PT} y2={H - PB}
                    stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3"
                    pointerEvents="none"/>
            )}
          </svg>

          {/* Multi-series legend (replaces per-point labels) */}
          {isMulti && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8,
              fontSize: 11, color: "var(--chart-muted)",
            }}>
              {visibleSeries.map((s, i) => (
                <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{
                    width: 18, height: 2, borderRadius: 1,
                    background: SERIES_COLORS[i % SERIES_COLORS.length],
                  }}/>
                  <span style={{ color: "var(--chart-tick)", fontWeight: 500 }}>{s.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Range chips — narrow the visible window without re-fetching. */}
      {!inline && allYears.length > 2 && (
        <div style={{
          marginTop: 14, padding: "8px 0",
          borderTop: "1px solid var(--chart-grid)",
          borderBottom: "1px solid var(--chart-grid)",
          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        }}>
          <span style={{
            fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
            color: "var(--chart-muted)", marginRight: 4, fontWeight: 600,
          }}>Window</span>
          {allYears.map(year => {
            const inRange = effectiveRange && year >= effectiveRange[0] && year <= effectiveRange[1];
            const isEdge = effectiveRange && (year === effectiveRange[0] || year === effectiveRange[1]);
            return (
              <button
                key={year}
                onClick={() => {
                  if (!effectiveRange) return;
                  const [lo, hi] = effectiveRange;
                  if (year === lo || year === hi) return;
                  if (year < lo) setRange([year, hi]);
                  else if (year > hi) setRange([lo, year]);
                  else {
                    // Inside range — move the closer edge to here.
                    const distLo = year - lo, distHi = hi - year;
                    if (distLo < distHi) setRange([year, hi]);
                    else setRange([lo, year]);
                  }
                }}
                style={{
                  padding: "3px 9px", border: "none",
                  background: isEdge ? "var(--accent)" : (inRange ? "rgba(35, 120, 195, 0.14)" : "transparent"),
                  color: isEdge ? "#fff" : (inRange ? "var(--accent)" : "var(--chart-muted)"),
                  fontSize: 10.5, fontWeight: isEdge ? 700 : 500,
                  cursor: "pointer", borderRadius: 3,
                  fontVariantNumeric: "tabular-nums",
                }}
              >{year}</button>
            );
          })}
        </div>
      )}

      {/* Source-rich footer */}
      {!inline && (
        <div style={{
          marginTop: 12, fontSize: 11, lineHeight: 1.5, color: "var(--chart-muted)",
          display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start",
        }}>
          <div>
            <strong style={{ color: "var(--chart-tick)" }}>Source:</strong>{" "}
            <a href={buildCensusProfileUrl(locationCity, locationState, metric, geoid)}
               target="_blank" rel="noopener noreferrer"
               style={{ color: "var(--accent)" }}>
              {source}
            </a>
            <ACSTooltip />
            {!isMulti && location && (
              <>. Geography: {location}.</>
            )}
            {" "}Estimates are nominal (not inflation-adjusted).
          </div>
          {visibleSeries.length > 0 && (
            <div style={{ display: "inline-flex", gap: 6, fontSize: 10, fontWeight: 600 }}>
              <button type="button" onClick={() => downloadCSV(visibleSeries, metric, location)}
                      style={{
                        color: "var(--chart-tick)", textDecoration: "none", padding: "3px 8px",
                        border: "1px solid var(--chart-grid)", borderRadius: 3,
                        background: "transparent", cursor: "pointer",
                      }}>CSV</button>
              <button type="button" onClick={() => downloadPNG(chartContainerRef, metric, location, getBgColor())}
                      style={{
                        color: "var(--chart-tick)", textDecoration: "none", padding: "3px 8px",
                        border: "1px solid var(--chart-grid)", borderRadius: 3,
                        background: "transparent", cursor: "pointer",
                      }}>PNG</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
