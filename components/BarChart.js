// components/BarChart.js
// Categorical bar chart for ACS variable breakdowns (race, language at home,
// household type, etc.). Same visual language as TrendChart: serif title,
// dense data labels, light gridlines, source-rich footer.
//
// Methodology / series-redesign banners are NOT rendered here — they sit
// OUTSIDE the chart in the parent (chat bubble), same pattern as TrendChart.
//
// Payload contract (from /api/chat's runBreakdownTool):
//   {
//     type: "bar_chart",
//     metric: string,                        // e.g. "Race"
//     location: string,                      // e.g. "Irvine, California"
//     unit: "number" | "currency" | "percent" | ...,
//     bars: [{
//       label: string,                       // e.g. "Asian Alone"
//       value: number,
//       moe?: number | null,
//       variableId?: string,
//       tableId?: string,
//     }],
//     source: string,                        // e.g. "U.S. Census Bureau ACS 2020-2024"
//     totalLabel?: string,                   // optional: line under title (e.g. "Total: 307,670")
//     sortDescending?: boolean,              // default true
//   }

import { useEffect, useRef, useState } from "react";
import { buildCensusProfileUrl } from "../lib/censusConstants";
import { usePlaceGeoid } from "../lib/usePlaceGeoid";

const BAR_COLOR_LIGHT = "#1a4480";
const BAR_COLOR_DARK  = "#60b4ff";

function formatValueForUnit(rawValue, unit) {
  if (!Number.isFinite(rawValue)) return "N/A";
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(rawValue);
    case "percent":
      return `${rawValue.toFixed(1)}%`;
    case "years":
      return `${rawValue.toFixed(1)} yrs`;
    case "minutes":
      return `${rawValue.toFixed(1)} min`;
    case "number":
    default:
      return new Intl.NumberFormat("en-US").format(Math.round(rawValue));
  }
}

function formatXTick(rawValue, unit, step) {
  if (!Number.isFinite(rawValue)) return "";
  const decimals = step == null ? 0 : (step >= 1000 ? 0 : step >= 100 ? 1 : 2);
  switch (unit) {
    case "currency":
      if (rawValue >= 1_000_000) return `$${(rawValue / 1_000_000).toFixed(1)}M`;
      if (rawValue >= 1000) return `$${(rawValue / 1000).toFixed(decimals)}k`;
      return `$${Math.round(rawValue)}`;
    case "percent":
      return step != null && step < 1 ? `${rawValue.toFixed(1)}%` : `${Math.round(rawValue)}%`;
    case "number":
    default:
      if (rawValue >= 1_000_000) return `${(rawValue / 1_000_000).toFixed(1)}M`;
      if (rawValue >= 1000) return `${(rawValue / 1000).toFixed(decimals)}k`;
      return String(Math.round(rawValue));
  }
}

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
function downloadCSV(bars, metric, location) {
  const headers = ["Category", "Value"];
  const rows = bars.map((b) => [b.label, b.value]);
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
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
    canvas.toBlob((blob) => {
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = `${metric}_${location}.png`.replace(/[\s/\\]/g, "_");
      a.click();
      URL.revokeObjectURL(u);
    }, "image/png");
    URL.revokeObjectURL(svgUrl);
  };
  img.src = svgUrl;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BarChart({ data, expanded = false, inline = false }) {
  const [visible, setVisible] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);
  const containerRef = useRef(null);

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

  if (!data) return null;
  const {
    metric, location, unit = "number", bars: rawBars = [], source,
    totalLabel, sortDescending = true,
    year, dataset, mixedDatasets,
  } = data;

  // Filter null / non-finite values, then sort.
  const cleanBars = rawBars
    .filter((b) => b && Number.isFinite(b.value))
    .map((b) => ({ ...b }));
  const sortedBars = sortDescending
    ? [...cleanBars].sort((a, b) => b.value - a.value)
    : cleanBars;

  const locationComma = (location || "").indexOf(",");
  const locationCity = locationComma > -1 ? location.slice(0, locationComma).trim() : location || "";
  const locationState = locationComma > -1 ? location.slice(locationComma + 1).trim() : "";
  const geoid = usePlaceGeoid(locationCity, locationState);

  const BAR_COLOR = isDark ? BAR_COLOR_DARK : BAR_COLOR_LIGHT;

  // Total (for share-of context line).
  const total = sortedBars.reduce((acc, b) => acc + b.value, 0);

  // ── SVG geometry ───────────────────────────────────────────────────────────
  const W = 760;
  const ROW_HEIGHT = 28;
  const PT = 24;
  const PB = 32;
  const PL = 180;     // room for left-aligned category labels
  const PR = 76;      // room for right-aligned value labels
  const H = PT + PB + sortedBars.length * ROW_HEIGHT;

  const dataMax = sortedBars.length > 0 ? Math.max(...sortedBars.map((b) => b.value)) : 1;
  const dataMin = 0;
  // Pad right so the longest bar's value label has room.
  const xMax = dataMax * 1.05;
  const xs = (v) => PL + ((v - dataMin) / (xMax - dataMin || 1)) * (W - PL - PR);

  const xStep = niceStep((xMax - dataMin) / 4);
  const xTicks = [];
  let t = 0;
  while (t <= xMax && xTicks.length < 6) {
    xTicks.push(t);
    t += xStep;
  }

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
    <div style={wrapperStyle} ref={containerRef}>
      {/* Title */}
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
          {metric}{location ? ` · ${location}` : ""}
        </div>
      )}

      {/* Lede — methodology line is derived from the actual dataset that
          produced each bar. Stat tools prefer 1-year for places ≥65k pop;
          BarChart's payload carries `dataset` ("acs1" | "acs5") and
          `mixedDatasets` so the wording stays honest instead of always
          claiming "5-year". */}
      {!inline && (
        <p style={{
          fontSize: 13, lineHeight: 1.55, color: "var(--chart-tick)",
          margin: "0 0 14px", maxWidth: 640,
        }}>
          {totalLabel ? <strong style={{ color: "var(--text)" }}>{totalLabel}</strong> : null}
          {totalLabel ? " · " : null}
          {sortedBars.length} categor{sortedBars.length === 1 ? "y" : "ies"}
          {sortDescending ? ", sorted by value." : "."}
          {unit === "percent" ? " Values are percentages." : ""}
          {" "}{(() => {
            if (mixedDatasets) {
              return "Estimates mix 1-year and 5-year ACS vintages — see per-bar sources below for the exact dataset of each.";
            }
            if (dataset === "acs1" && year) {
              return `Estimates from the ${year} 1-year ACS sample.`;
            }
            if (dataset === "acs5" && year) {
              return `Estimates from the ${year - 4}–${year} 5-year ACS rolling sample.`;
            }
            // Fallback (shouldn't fire in practice — payload always carries
            // dataset+year — but degrade gracefully on older payloads).
            return "Estimates from the ACS.";
          })()}
        </p>
      )}

      {/* Chart */}
      {sortedBars.length === 0 ? (
        <div style={{ color: "var(--chart-empty)", fontSize: 14, padding: "2rem 0", textAlign: "center" }}>
          No breakdown data available.
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* X-axis gridlines + tick labels (top) */}
            {xTicks.map((tick) => (
              <g key={`x-${tick}`}>
                <line x1={xs(tick)} x2={xs(tick)} y1={PT} y2={H - PB}
                      stroke="var(--text)" strokeOpacity="0.08"/>
                <text x={xs(tick)} y={PT - 8}
                      textAnchor="middle" fontSize="10" fill="var(--chart-muted)"
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatXTick(tick, unit, xStep)}
                </text>
              </g>
            ))}

            {/* Zero baseline */}
            <line x1={PL} x2={PL} y1={PT} y2={H - PB}
                  stroke="var(--text)" strokeOpacity="0.18"/>

            {/* Bars + labels */}
            {sortedBars.map((b, i) => {
              const y = PT + i * ROW_HEIGHT + 4;
              const barH = ROW_HEIGHT - 8;
              const x0 = PL;
              const x1 = xs(b.value);
              const isHover = hoverIdx === i;
              return (
                <g key={`bar-${i}`}
                   onMouseEnter={() => setHoverIdx(i)}
                   style={{ cursor: "default" }}>
                  {/* Hit row (full width) for hover affordance */}
                  <rect x={0} y={y - 4} width={W} height={ROW_HEIGHT}
                        fill="transparent"/>
                  {/* Category label (left of zero) */}
                  <text x={PL - 10} y={y + barH / 2}
                        textAnchor="end" dominantBaseline="middle"
                        fontSize="11"
                        fill={isHover ? "var(--text)" : "var(--chart-tick)"}
                        fontWeight={isHover ? 600 : 500}>
                    {b.label}
                  </text>
                  {/* The bar */}
                  <rect x={x0} y={y} width={Math.max(0, x1 - x0)} height={barH}
                        fill={BAR_COLOR}
                        opacity={isHover ? 1 : 0.85}
                        rx="2"/>
                  {/* Value label (right of bar) */}
                  <text x={x1 + 6} y={y + barH / 2}
                        textAnchor="start" dominantBaseline="middle"
                        fontSize="11" fontWeight={700}
                        fill={isHover ? BAR_COLOR : "var(--text)"}
                        style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatValueForUnit(b.value, unit)}
                    {unit === "number" && total > 0 && (
                      <tspan dx={6} fontSize="9" fontWeight={500} fill="var(--chart-muted)">
                        ({((b.value / total) * 100).toFixed(1)}%)
                      </tspan>
                    )}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Source-rich footer */}
      {!inline && (
        <div style={{
          marginTop: 14, paddingTop: 10,
          borderTop: "1px solid var(--chart-grid)",
          fontSize: 11, lineHeight: 1.5, color: "var(--chart-muted)",
          display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start",
        }}>
          <div>
            <strong style={{ color: "var(--chart-tick)" }}>Source:</strong>{" "}
            <a
              href={buildCensusProfileUrl(locationCity, locationState, metric, geoid)}
              target="_blank" rel="noopener noreferrer"
              style={{ color: "var(--accent)" }}
            >
              {source}
            </a>
            <ACSTooltip />
            {location && <>. Geography: {location}.</>}
            {" "}Estimates are nominal (not inflation-adjusted).
          </div>
          {sortedBars.length > 0 && (
            <div style={{ display: "inline-flex", gap: 6, fontSize: 10, fontWeight: 600 }}>
              <button
                type="button"
                onClick={() => downloadCSV(sortedBars, metric, location)}
                style={{
                  color: "var(--chart-tick)", padding: "3px 8px",
                  border: "1px solid var(--chart-grid)", borderRadius: 3,
                  background: "transparent", cursor: "pointer",
                }}>CSV</button>
              <button
                type="button"
                onClick={() => downloadPNG(containerRef, metric, location, getBgColor())}
                style={{
                  color: "var(--chart-tick)", padding: "3px 8px",
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
