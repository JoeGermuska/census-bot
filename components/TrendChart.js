// components/TrendChart.js
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import homeStyles from "../styles/Home.module.css";

function CustomTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  const rawValue = point?.numericValue;
  const hasValue = Number.isFinite(rawValue);

  let displayValue = "N/A";
  if (hasValue) {
    if (/income|rent|value/i.test(metric)) {
      displayValue = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(rawValue);
    } else if (/rate|percent|poverty/i.test(metric)) {
      displayValue = `${rawValue.toFixed(2)}%`;
    } else if (/age/i.test(metric)) {
      displayValue = `${rawValue.toFixed(0)} years`;
    } else if (/commute|travel time|minute/i.test(metric)) {
      displayValue = `${rawValue.toFixed(0)} minutes`;
    } else {
      displayValue = new Intl.NumberFormat("en-US").format(rawValue);
    }
  }

  return (
    <div style={{
      background: "var(--chart-tooltip-bg)",
      border: "1px solid var(--chart-tooltip-border)",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 13,
    }}>
      <div style={{ color: "var(--chart-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ color: "var(--text)", fontWeight: 600 }}>
        {displayValue}
      </div>
      <div style={{ color: "var(--chart-faint)", fontSize: 11, marginTop: 2 }}>{metric}</div>
    </div>
  );
}

export default function TrendChart({ data, expanded = false }) {
  if (!data) return null;

  const { metric, location, points, source } = data;
  const validPoints = points.filter(p => p.numericValue !== null);
  const chartHeight = expanded ? 420 : 200;

  return (
    <div
      className={homeStyles.trendCard}
      style={{
        background: "var(--chart-surface)",
        padding: expanded ? "30px 34px" : "24px 28px",
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

      {validPoints.length === 0 ? (
        <div style={{ color: "var(--chart-empty)", fontSize: 14 }}>No trend data available.</div>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <LineChart data={validPoints} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
            <Line
              type="monotone"
              dataKey="numericValue"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={{ fill: "var(--accent)", r: 4, strokeWidth: 0 }}
              activeDot={{ r: 6, fill: "var(--accent)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      <div style={{ color: "var(--chart-source)", fontSize: 11, marginTop: 16 }}>{source}</div>
    </div>
  );
}
