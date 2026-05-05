// components/TrendChart.js
import { useEffect, useRef, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import styles from "../styles/Home.module.css";

const SERIES_COLORS = ["#4db8ff", "#a855f7", "#66ffcc", "#f97316", "#ec4899"];

function formatValueForMetric(rawValue, metric) {
  if (!Number.isFinite(rawValue)) return "N/A";
  if (/income|rent|value/i.test(metric)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }).format(rawValue);
  }
  if (/rate|percent|poverty|unemployment|employment|bachelor|education/i.test(metric)) {
    return `${rawValue.toFixed(2)}%`;
  }
  if (/age/i.test(metric)) return `${rawValue.toFixed(1)} yrs`;
  if (/commute|travel|minute/i.test(metric)) return `${rawValue.toFixed(1)} min`;
  return new Intl.NumberFormat("en-US").format(Math.round(rawValue));
}

// ── Plain-English "Bottom Line" summary ──────────────────────────────────────
function buildSummary(series, metric) {
  if (!series.length) return null;
  const pts = series[0].points.filter(p => p.numericValue != null && Number.isFinite(p.numericValue));
  if (pts.length < 2) return null;

  const first = pts[0];
  const last  = pts[pts.length - 1];
  const change = last.numericValue - first.numericValue;

  if (Math.abs(change) < 0.0001 * Math.abs(first.numericValue)) {
    return `${metric} remained stable at ${formatValueForMetric(last.numericValue, metric)} from ${first.year} to ${last.year}.`;
  }

  const direction = change > 0 ? "increased" : "decreased";
  const pctAbs = Math.abs(((change / first.numericValue) * 100)).toFixed(1);
  const sign   = change > 0 ? "+" : "";
  const firstFmt = formatValueForMetric(first.numericValue, metric);
  const lastFmt  = formatValueForMetric(last.numericValue, metric);

  return `${metric} ${direction} from ${firstFmt} in ${first.year} to ${lastFmt} in ${last.year} (${sign}${pctAbs}%).`;
}

// ── ACS jargon tooltip ────────────────────────────────────────────────────────
function ACSTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", verticalAlign: "middle", marginLeft: 5 }}>
      <button
        type="button"
        aria-label="What is ACS 5-Year Estimates?"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: 15, height: 15,
          borderRadius: "50%",
          border: "1px solid var(--chart-muted)",
          background: "transparent",
          color: "var(--chart-muted)",
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--chart-tooltip-bg)",
            border: "1px solid rgba(77,184,255,0.22)",
            borderRadius: 8,
            padding: "7px 11px",
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--chart-tick)",
            whiteSpace: "normal",
            width: 220,
            zIndex: 30,
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            pointerEvents: "none",
          }}
        >
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
  const url  = URL.createObjectURL(blob);
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
  const svgUrl  = URL.createObjectURL(svgBlob);

  const rect = svg.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");

  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = bgColor || "#12172b";
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

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--chart-tooltip-bg)",
      border: "1px solid rgba(77,184,255,0.25)",
      borderRadius: 10,
      padding: "10px 14px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
      fontSize: 13,
    }}>
      <div style={{
        color: "var(--chart-muted)", marginBottom: 6,
        fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
      }}>
        {label}
      </div>
      {payload.map((entry, i) => (
        <div key={i} style={{ color: entry.color, fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>
          {payload.length > 1 && (
            <span style={{ color: "var(--chart-muted)", fontWeight: 500, fontSize: 11 }}>
              {entry.name}:{" "}
            </span>
          )}
          {formatValueForMetric(entry.value, metric)}
        </div>
      ))}
    </div>
  );
}

function normalizeSeries(data) {
  if (Array.isArray(data.series) && data.series.length > 0) return data.series;
  if (Array.isArray(data.points)) return [{ label: data.location || "Series", points: data.points }];
  return [];
}

function pivotSeriesToRows(series) {
  const yearMap = new Map();
  series.forEach((s) => {
    s.points.forEach((p) => {
      if (p.numericValue === null || p.numericValue === undefined) return;
      const row = yearMap.get(p.year) || { year: p.year };
      row[s.label] = p.numericValue;
      yearMap.set(p.year, row);
    });
  });
  return Array.from(yearMap.values()).sort((a, b) => a.year - b.year);
}

// inline=true: render chart only (no card frame) for embedding inside a parent card
export default function TrendChart({ data, expanded = false, inline = false }) {
  const [visible, setVisible] = useState(false);
  const chartContainerRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!data) return null;

  const { metric, location, source } = data;
  const series = normalizeSeries(data);
  const rows = pivotSeriesToRows(series);
  const isMulti = series.length > 1;
  const chartHeight = expanded ? 380 : inline ? 240 : 220;
  const summary = buildSummary(series, metric);
  const startYear = rows.length > 0 ? rows[0].year : null;
  const endYear   = rows.length > 0 ? rows[rows.length - 1].year : null;

  const wrapperStyle = inline
    ? {
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
      }
    : {
        background: "var(--chart-surface)",
        marginTop: expanded ? 0 : 16,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(14px)",
        transition: "opacity 0.5s ease, transform 0.5s ease",
      };

  // Detect current bg color for PNG export
  function getBgColor() {
    return document.documentElement.getAttribute("data-theme") === "light"
      ? "#ffffff" : "#12172b";
  }

  return (
    <div
      className={inline ? "" : `${styles.trendCard} ${expanded ? styles.trendCardExpanded : styles.trendCardBody}`}
      style={wrapperStyle}
    >
      {/* Header — card (non-inline) mode only */}
      {!inline && (
        <div style={{
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: "1rem", marginBottom: 20,
        }}>
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "rgba(77,184,255,0.1)",
              border: "1px solid rgba(77,184,255,0.22)",
              borderRadius: 6, padding: "3px 9px",
              fontSize: 9, fontWeight: 800, letterSpacing: "0.14em",
              color: "var(--accent)", marginBottom: 8,
            }}>
              TREND
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, color: "var(--text)",
              letterSpacing: "-0.01em", lineHeight: 1.3,
            }}>
              {metric}
            </div>
          </div>
          <div style={{
            color: "var(--chart-muted)", fontSize: 11,
            textAlign: "right", paddingTop: 2, flexShrink: 0,
          }}>
            {location}
          </div>
        </div>
      )}

      {/* Inline mode: chart title label replacing the summary */}
      {inline && startYear && endYear && (
        <div style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
          color: "var(--chart-muted)",
          marginBottom: 10,
        }}>
          {metric} ({startYear}–{endYear})
        </div>
      )}

      {/* Non-inline mode: plain-English summary above chart */}
      {!inline && summary && (
        <div style={{
          background: "rgba(77,184,255,0.07)",
          border: "1px solid rgba(77,184,255,0.18)",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--chart-tick)",
          marginBottom: 14,
        }}>
          {summary}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{
          color: "var(--chart-empty)", fontSize: 14,
          padding: "2rem 0", textAlign: "center",
        }}>
          No trend data available.
        </div>
      ) : (
        <div ref={chartContainerRef}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <AreaChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                {series.map((_, i) => {
                  const color = SERIES_COLORS[i % SERIES_COLORS.length];
                  return (
                    <linearGradient key={`grad-${i}`} id={`chartGrad-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.01} />
                    </linearGradient>
                  );
                })}
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
                vertical={false}
              />

              <XAxis
                dataKey="year"
                ticks={rows.map(r => r.year)}
                tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                dy={8}
              />

              <YAxis
                tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={58}
                tickFormatter={v => {
                  if (/rate|percent|poverty|unemployment|employment|bachelor|education/i.test(metric)) return `${v}%`;
                  if (/commute|travel|minute/i.test(metric)) return `${v}m`;
                  if (/age/i.test(metric)) return `${v}yr`;
                  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                  if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
                  return v;
                }}
              />

              <Tooltip content={<CustomTooltip metric={metric} />} />
              {isMulti && (
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 12, color: "var(--chart-muted)" }}
                />
              )}

              {series.map((s, i) => {
                const color = SERIES_COLORS[i % SERIES_COLORS.length];
                return (
                  <Area
                    key={s.label}
                    type="monotone"
                    dataKey={s.label}
                    name={s.label}
                    stroke={color}
                    strokeWidth={2.5}
                    fill={`url(#chartGrad-${i})`}
                    dot={{ fill: color, r: 3.5, strokeWidth: 0 }}
                    activeDot={{
                      r: 6, fill: color,
                      strokeWidth: 2, stroke: "var(--chart-surface)",
                    }}
                    connectNulls
                    animationDuration={1200}
                    animationEasing="ease-out"
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Footer: source + ACS tooltip + download buttons */}
      {!inline && (
        <div style={{
          marginTop: 16, borderTop: "1px solid var(--chart-grid)", paddingTop: 12,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: "0.5rem",
        }}>
          <span style={{ color: "var(--chart-source)", fontSize: 11 }}>
            {source}
            <ACSTooltip />
          </span>
          {rows.length > 0 && (
            <span style={{ display: "inline-flex", gap: "0.45rem" }}>
              <button
                type="button"
                onClick={() => downloadCSV(series, metric, location)}
                style={{
                  padding: "3px 9px",
                  borderRadius: 6,
                  border: "1px solid var(--chart-grid)",
                  background: "transparent",
                  color: "var(--chart-muted)",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--chart-grid)"; e.currentTarget.style.color = "var(--chart-muted)"; }}
              >
                ↓ CSV
              </button>
              <button
                type="button"
                onClick={() => downloadPNG(chartContainerRef, metric, location, getBgColor())}
                style={{
                  padding: "3px 9px",
                  borderRadius: 6,
                  border: "1px solid var(--chart-grid)",
                  background: "transparent",
                  color: "var(--chart-muted)",
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--chart-grid)"; e.currentTarget.style.color = "var(--chart-muted)"; }}
              >
                ↓ PNG
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
