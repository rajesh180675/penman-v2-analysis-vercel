/**
 * GroupedBarChart — side-by-side bars for 2–4 series across periods or peers
 * (ROCE vs peers, margin by unit, quality dimensions over time).
 * Recharts-based, token palette, INR/percent formatting.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { CHART_PALETTE, fmtINR, fmtINRFull, TOOLTIP_STYLE } from "./chartUtils";

export interface GroupedBarSeries {
  key: string;
  label: string;
  color?: string | undefined;
}

interface GroupedBarChartProps {
  /** Rows: one per category, each with `period` + one numeric key per series */
  data: Record<string, string | number | null>[];
  series: GroupedBarSeries[];
  formatValue?: ((v: number) => string) | undefined;
  formatTooltip?: ((v: number) => string) | undefined;
  /** Horizontal reference (e.g. sector median) */
  referenceValue?: number | undefined;
  referenceLabel?: string | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

export function GroupedBarChart({
  data,
  series,
  formatValue = fmtINR,
  formatTooltip = fmtINRFull,
  referenceValue,
  referenceLabel,
  height = 280,
  className = "",
}: GroupedBarChartProps) {
  if (data.length === 0 || series.length === 0) {
    return <div className={`wb-chart-empty ${className}`} style={{ height }}>No data</div>;
  }
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer debounce={50} width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={2}>
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
          {referenceValue != null && (
            <ReferenceLine
              y={referenceValue}
              stroke="var(--color-text-3)"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              {...(referenceLabel
                ? { label: { value: referenceLabel, fontSize: 10, fill: "var(--color-text-3)", position: "insideTopRight" } }
                : {})}
            />
          )}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={s.color ?? CHART_PALETTE[i % CHART_PALETTE.length] ?? "#6366f1"}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
