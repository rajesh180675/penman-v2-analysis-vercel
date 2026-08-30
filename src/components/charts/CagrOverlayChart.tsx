/**
 * CagrOverlayChart — absolute value bars with a CAGR arrow annotation across
 * the window. The standard "revenue grew at X% CAGR" institutional visual.
 */
import { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { CHART_COLORS, fmtINR, fmtINRFull, TOOLTIP_STYLE } from "./chartUtils";

export interface CagrPoint {
  period: string;
  value: number;
}

interface CagrOverlayChartProps {
  data: CagrPoint[];
  formatValue?: ((v: number) => string) | undefined;
  formatTooltip?: ((v: number) => string) | undefined;
  /** Bar color; defaults to primary. CAGR overlay line uses highlight. */
  color?: string | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

export function CagrOverlayChart({
  data,
  formatValue = fmtINR,
  formatTooltip = fmtINRFull,
  color,
  height = 280,
  className = "",
}: CagrOverlayChartProps) {
  const derived = useMemo(() => {
    if (data.length < 2) return null;
    const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    if (first.value <= 0 || last.value <= 0) return null;
    const years = sorted.length - 1;
    const cagr = Math.pow(last.value / first.value, 1 / years) - 1;
    // Smooth CAGR path for overlay
    const cagrPath = sorted.map((d, i) => ({
      period: d.period,
      cagrLine: first.value * Math.pow(1 + cagr, i),
    }));
    return { sorted, cagr, cagrPath };
  }, [data]);

  if (!derived) {
    return <div className={`wb-chart-empty ${className}`} style={{ height }}>No data</div>;
  }
  const { sorted, cagr, cagrPath } = derived;
  const barColor = color ?? CHART_COLORS.primary;
  const toneClass = cagr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  const sign = cagr >= 0 ? "+" : "";

  return (
    <div className={className}>
      <div className={`text-[12px] font-semibold font-mono mb-2 ${toneClass}`}>
        {sign}{(cagr * 100).toFixed(1)}% CAGR <span className="wb-text-3 font-normal">({sorted[0]!.period}→{sorted[sorted.length - 1]!.period})</span>
      </div>
      <div style={{ height: height - 28 }}>
        <ResponsiveContainer debounce={50} width="100%" height="100%">
          <ComposedChart
            data={sorted.map((d, i) => ({ ...d, cagrLine: cagrPath[i]!.cagrLine }))}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="period" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatValue(v)} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => [
                typeof value === "number" ? formatTooltip(value) : value ?? "—",
                name === "cagrLine" ? "CAGR path" : "Value",
              ]}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false}>
              {sorted.map((_, i) => (
                <Cell key={i} fill={barColor} fillOpacity={i === 0 || i === sorted.length - 1 ? 1 : 0.55} />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="cagrLine"
              stroke={CHART_COLORS.highlight}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              legendType="none"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
