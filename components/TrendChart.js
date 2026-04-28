// components/TrendChart.js
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import homeStyles from "../styles/Home.module.css";

const SERIES_COLORS = ["var(--accent)", "#4db8ff", "#9d8cff", "#46c39c", "#f1a26d"];

function formatValueForMetric(rawValue, metric) {
  if (!Number.isFinite(rawValue)) return "N/A";
  if (/income|rent|value/i.test(metric)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(rawValue);
  }
  if (/rate|percent|poverty/i.test(metric)) return `${rawValue.toFixed(2)}%`;
  if (/age/i.test(metric)) return `${rawValue.toFixed(0)} years`;
  if (/commute|travel time|minute/i.test(metric)) return `${rawValue.toFixed(0)} minutes`;
  return new Intl.NumberFormat("en-US").format(rawValue);
}

function CustomTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;

  return (
    <div style={{
      background: "var(--chart-tooltip-bg)",
      border: "1px solid var(--chart-tooltip-border)",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 13,
    }}>
      <div style={{ color: "var(--chart-muted)", marginBottom: 4 }}>{label}</div>
      {payload.map((entry, i) => (
        <div key={i} style={{ color: entry.color, fontWeight: 600 }}>
          {payload.length > 1 ? `${entry.name}: ` : ""}
          {formatValueForMetric(entry.value, metric)}
        </div>
      ))}
      <div style={{ color: "var(--chart-faint)", fontSize: 11, marginTop: 2 }}>{metric}</div>
    </div>
  );
}

// Convert input to series[] regardless of legacy {points} or new {series} shape
function normalizeSeries(data) {
  if (Array.isArray(data.series) && data.series.length > 0) return data.series;
  if (Array.isArray(data.points)) {
    return [{ label: data.location || "Series", points: data.points }];
  }
  return [];
}

// Pivot series into rows: [{year, [seriesLabel]: numericValue}]
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

export default function TrendChart({ data, expanded = false }) {
  if (!data) return null;

  const { metric, location, source } = data;
  const series = normalizeSeries(data);
  const rows = pivotSeriesToRows(series);
  const chartHeight = expanded ? 420 : 200;
  const isMulti = series.length > 1;

  return (
    <div
      className={`${homeStyles.trendCard} ${expanded ? homeStyles.trendCardExpanded : homeStyles.trendCardBody}`}
      style={{
        background: "var(--chart-surface)",
        marginTop: expanded ? 0 : 16,
      }}
    >
      <div style={{
        fontSize: 11,
        letterSpacing: "0.12em",
        color: "var(--green)",
        fontWeight: 600,
        marginBottom: 4,
        textShadow: "var(--metric-label-glow)",
      }}>
        {metric.toUpperCase()} OVER TIME
      </div>

      <div style={{ color: "var(--chart-muted)", fontSize: 13, marginBottom: 20 }}>
        📍 {location}
      </div>

      {rows.length === 0 ? (
        <div style={{ color: "var(--chart-empty)", fontSize: 14 }}>No trend data available.</div>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis
              dataKey="year"
              tick={{ fill: "var(--chart-tick)", fontSize: 12 }}
              axisLine={{ stroke: "var(--chart-axis)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--chart-tick)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={60}
              tickFormatter={v =>
                v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
              }
            />
            <Tooltip content={<CustomTooltip metric={metric} />} />
            {isMulti && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />}
            {series.map((s, i) => {
              const color = SERIES_COLORS[i % SERIES_COLORS.length];
              return (
                <Line
                  key={s.label}
                  type="monotone"
                  dataKey={s.label}
                  name={s.label}
                  stroke={color}
                  strokeWidth={2.5}
                  dot={{ fill: color, r: 4, strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: color }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}

      <div style={{ color: "var(--chart-source)", fontSize: 11, marginTop: 16 }}>{source}</div>
    </div>
  );
}
