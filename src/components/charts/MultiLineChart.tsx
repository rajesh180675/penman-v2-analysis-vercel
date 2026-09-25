/**
 * MultiLineChart — 2–6 series trend lines over periods with consistent token
 * colors, INR/percent formatting, and optional reference band (target range).
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { CHART_PALETTE, TOOLTIP_STYLE } from "./chartUtils";

export interface LineSeriesDef {
  key: string;
  label: string;
  color?: string | undefined;
  dashed?: boolean | undefined;
}

interface MultiLineChartProps {
  data: Record<string, string | number | null>[];
  series: LineSeriesDef[];
  formatValue?: ((v: number) => string) | undefined;
  formatTooltip?: ((v: number) => string) | undefined;
  /** Shaded target band, e.g. { from: 0.15, to: 0.25, label: "target" } */
  referenceBand?: { from: number; to: number; label?: string | undefined } | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const defaultFmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });

export function MultiLineChart({
  data,
  series,
  formatValue = defaultFmt,
  formatTooltip = defaultFmt,
  referenceBand,
  height = 280,
  className = "",
}: MultiLineChartProps) {
  if (data.length === 0 || series.length === 0) {
    return <div className={`wb-chart-empty ${className}`} style={{ height }}>No data</div>;
  }
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer debounce={50} width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatValue(v)} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => [
              typeof value === "number" ? formatTooltip(value) : value ?? "—",
              series.find((s) => s.key === String(name))?.label ?? String(name),
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => series.find((s) => s.key === v)?.label ?? v} />
          {referenceBand && (
            <ReferenceArea
              y1={referenceBand.from}
              y2={referenceBand.to}
              fill="var(--color-fin-positive)"
              fillOpacity={0.08}
              stroke="var(--color-fin-positive)"
              strokeOpacity={0.3}
              strokeDasharray="4 4"
              {...(referenceBand.label ? { label: { value: referenceBand.label, fontSize: 10, fill: "var(--color-text-3)" } } : {})}
            />
          )}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color ?? CHART_PALETTE[i % CHART_PALETTE.length] ?? "#6366f1"}
              strokeWidth={2}
              {...(s.dashed ? { strokeDasharray: "5 4" } : {})}
              dot={{ r: 2.5, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
