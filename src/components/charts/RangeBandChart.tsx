/**
 * RangeBandChart — historical min–max range band with median line and current
 * marker (valuation multiples range, margin corridor over cycles). Pure
 * Recharts Area stack hack: invisible base + visible band.
 */
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { CHART_COLORS, TOOLTIP_STYLE } from "./chartUtils";

export interface RangePoint {
  period: string;
  low: number;
  high: number;
  median: number;
}

interface RangeBandChartProps {
  data: RangePoint[];
  /** Current value marker (dot at last period). */
  currentValue?: number | undefined;
  formatValue?: ((v: number) => string) | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const defaultFmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });

export function RangeBandChart({
  data,
  currentValue,
  formatValue = defaultFmt,
  height = 260,
  className = "",
}: RangeBandChartProps) {
  if (data.length === 0) {
    return <div className={`wb-chart-empty ${className}`} style={{ height }}>No data</div>;
  }
  const rows = data.map((d) => ({ ...d, base: d.low, band: d.high - d.low }));
  const last = data[data.length - 1]!;
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer debounce={50} width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => formatValue(v)} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => [typeof value === "number" ? formatValue(value) : value ?? "—", name === "band" ? "high-low" : String(name)]}
            labelFormatter={(label) => String(label)}
          />
          <Area dataKey="base" stackId="range" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" />
          <Area
            dataKey="band"
            stackId="range"
            stroke="none"
            fill={CHART_COLORS.primary}
            fillOpacity={0.18}
            isAnimationActive={false}
            legendType="none"
            name="range"
          />
          <Line
            type="monotone"
            dataKey="median"
            stroke={CHART_COLORS.primary}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0 }}
            isAnimationActive={false}
            name="median"
          />
          {currentValue != null && (
            <ReferenceDot
              x={last.period}
              y={currentValue}
              r={5}
              fill={CHART_COLORS.highlight}
              stroke="#fff"
              strokeWidth={1.5}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
