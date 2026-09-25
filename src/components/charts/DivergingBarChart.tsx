/**
 * DivergingBarChart — horizontal bars split at zero (surplus/deficit,
 * accrual vs cash, period deltas). Recharts stacked-bar trick on a
 * zero-centered X axis.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { fmtINR, fmtINRFull, TOOLTIP_STYLE } from "./chartUtils";

export interface DivergingEntry {
  label: string;
  value: number;
}

interface DivergingBarChartProps {
  entries: DivergingEntry[];
  formatValue?: ((v: number) => string) | undefined;
  formatTooltip?: ((v: number) => string) | undefined;
  positiveColor?: string | undefined;
  negativeColor?: string | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

export function DivergingBarChart({
  entries,
  formatValue = fmtINR,
  formatTooltip = fmtINRFull,
  positiveColor = "var(--color-fin-positive)",
  negativeColor = "var(--color-fin-negative)",
  height,
  className = "",
}: DivergingBarChartProps) {
  if (entries.length === 0) {
    return <div className={`wb-chart-empty ${className}`} style={{ height: height ?? 200 }}>No data</div>;
  }
  const h = height ?? Math.max(160, entries.length * 34 + 40);
  return (
    <div className={className} style={{ height: h }}>
      <ResponsiveContainer debounce={50} width="100%" height="100%">
        <BarChart data={entries} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }} stackOffset="sign">
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatValue(v)} />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={110} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [typeof value === "number" ? formatTooltip(value) : value ?? "—", ""]} />
          <ReferenceLine x={0} stroke="var(--color-border-strong)" strokeWidth={1.5} />
          <Bar dataKey="value" stackId="d" isAnimationActive={false} radius={[3, 3, 3, 3]} maxBarSize={18}>
            {entries.map((e, i) => (
              <Cell key={i} fill={e.value >= 0 ? positiveColor : negativeColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
