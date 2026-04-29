// components/TrendChart.js
import { useEffect, useState } from "react";
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

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!data) return null;

  const { metric, location, source } = data;
  const series = normalizeSeries(data);
  const rows = pivotSeriesToRows(series);
  const isMulti = series.length > 1;
  const chartHeight = expanded ? 380 : inline ? 180 : 220;

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

  return (
    <div
      className={inline ? "" : `${styles.trendCard} ${expanded ? styles.trendCardExpanded : styles.trendCardBody}`}
      style={wrapperStyle}
    >
      {/* Header — only shown in card (non-inline) mode */}
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
              📈 TREND
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
            📍 {location}
          </div>
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
      )}

      {!inline && (
        <div style={{
          color: "var(--chart-source)", fontSize: 11,
          marginTop: 16, borderTop: "1px solid var(--chart-grid)", paddingTop: 12,
        }}>
          {source}
        </div>
      )}
    </div>
  );
}
