/**
 * HorizontalBarList — ranked metric bars (peer ranking, segment contribution,
 * top/bottom movers). Compact, label-outside, tone-aware. Pure Recharts
 * vertical layout, bar size scaled to list length.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { CHART_PALETTE, fmtINR, fmtINRFull, TOOLTIP_STYLE } from "./chartUtils";

export type HBarTone = "neutral" | "positive" | "negative";

export interface HBarEntry {
  label: string;
  value: number;
  /** Positive = green bar, negative = red, otherwise palette[0]. */
  tone?: HBarTone | undefined;
  /** Value annotation rendered at bar end (overrides formatValue when set). */
  display?: string | undefined;
}

interface HorizontalBarListProps {
  entries: HBarEntry[];
  formatValue?: ((v: number) => string) | undefined;
  formatTooltip?: ((v: number) => string) | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

const toneColor = (t: HBarTone | undefined): string =>
  t === "positive" ? "var(--color-fin-positive)" : t === "negative" ? "var(--color-fin-negative)" : CHART_PALETTE[0] ?? "#6366f1";

export function HorizontalBarList({
  entries,
  formatValue = fmtINR,
  formatTooltip = fmtINRFull,
  height,
  className = "",
}: HorizontalBarListProps) {
  if (entries.length === 0) {
    return <div className={`wb-chart-empty ${className}`} style={{ height: height ?? 200 }}>No data</div>;
  }
  const h = height ?? Math.max(160, entries.length * 30 + 24);
  return (
    <div className={className} style={{ height: h }}>
      <ResponsiveContainer debounce={50} width="100%" height="100%">
        <BarChart data={entries} layout="vertical" margin={{ top: 2, right: 56, left: 8, bottom: 2 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={130} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [typeof value === "number" ? formatTooltip(value) : value ?? "—", ""]} cursor={{ fill: "var(--color-surface-2)", opacity: 0.5 }} />
          <Bar dataKey="value" isAnimationActive={false} radius={[3, 3, 3, 3]} maxBarSize={16}>
            {entries.map((e, i) => (
              <Cell key={i} fill={toneColor(e.tone)} />
            ))}
            <LabelList dataKey="value" position="right" formatter={(v: unknown) => (typeof v === "number" ? formatValue(v) : String(v))} style={{ fontSize: 11, fill: "var(--color-text-2)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
