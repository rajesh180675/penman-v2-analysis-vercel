/**
 * StackedAreaChart — composition over time (revenue mix, asset allocation,
 * NOA composition). Recharts-based with token palette + INR formatting.
 */
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { CHART_PALETTE, fmtINR, fmtINRFull, TOOLTIP_STYLE } from "./chartUtils";

export interface StackedAreaSeries {
  key: string;
  label: string;
  color?: string | undefined;
}

interface StackedAreaChartProps {
  /** Rows: one per period, each with `period` + one numeric key per series */
  data: Record<string, string | number | null>[];
  series: StackedAreaSeries[];
  /** Values are already in the display unit — formatter for axis */
  formatValue?: ((v: number) => string) | undefined;
  formatTooltip?: ((v: number) => string) | undefined;
  /** 0–1: render as percent-of-total stack */
  percent?: boolean | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

export function StackedAreaChart({
  data,
  series,
  formatValue = fmtINR,
  formatTooltip = fmtINRFull,
  percent = false,
  height = 280,
  className = "",
}: StackedAreaChartProps) {
  if (data.length === 0 || series.length === 0) {
    return <div className={`wb-chart-empty ${className}`} style={{ height }}>No data</div>;
  }
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer debounce={50} width="100%" height="100%">
        <AreaChart data={data} stackOffset={percent ? "expand" : "none"} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={percent ? (v: number) => `${Math.round(v * 100)}%` : (v: number) => formatValue(v)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => [
              percent && typeof value === "number"
                ? `${(value * 100).toFixed(1)}%`
                : typeof value === "number"
                  ? formatTooltip(value)
                  : value ?? "—",
              series.find((s) => s.key === String(name))?.label ?? String(name),
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => series.find((s) => s.key === v)?.label ?? v} />
          {series.map((s, i) => {
            const color = s.color ?? CHART_PALETTE[i % CHART_PALETTE.length] ?? "#6366f1";
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId="stack"
                stroke={color}
                fill={color}
                fillOpacity={0.65}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
