/**
 * DonutChart — allocation mix (capital employed, portfolio weights, cost
 * structure). Center label = total or headline metric. Token palette, INR
 * formatting, interactive legend.
 */
import { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_PALETTE, fmtINR, fmtINRFull, TOOLTIP_STYLE } from "./chartUtils";

export interface DonutEntry {
  label: string;
  value: number;
  color?: string | undefined;
}

interface DonutChartProps {
  entries: DonutEntry[];
  /** Center label, top line (e.g. "₹42,100 Cr"). */
  centerLabel?: string | undefined;
  /** Center label, bottom line (e.g. "Total capital employed"). */
  centerSub?: string | undefined;
  formatValue?: ((v: number) => string) | undefined;
  formatTooltip?: ((v: number) => string) | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

export function DonutChart({
  entries,
  centerLabel,
  centerSub,
  formatValue = fmtINR,
  formatTooltip = fmtINRFull,
  height = 240,
  className = "",
}: DonutChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (entries.length === 0 || total <= 0) {
    return <div className={`wb-chart-empty ${className}`} style={{ height }}>No data</div>;
  }
  return (
    <div className={`flex items-center gap-4 ${className}`} style={{ height }}>
      <div className="relative flex-1 min-w-0" style={{ height }}>
        <ResponsiveContainer debounce={50} width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => {
                const v = typeof value === "number" ? value : 0;
                return [`${formatTooltip(v)} · ${((v / total) * 100).toFixed(1)}%`, String(name)];
              }}
            />
            <Pie
              data={entries}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              cornerRadius={3}
              strokeWidth={0}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {entries.map((e, i) => {
                const color = e.color ?? CHART_PALETTE[i % CHART_PALETTE.length] ?? "#6366f1";
                return <Cell key={i} fill={color} opacity={active === null || active === i ? 1 : 0.45} />;
              })}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {(centerLabel != null || centerSub != null) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            {centerLabel != null && <div className="text-lg font-bold wb-text-1 font-mono">{centerLabel}</div>}
            {centerSub != null && <div className="text-[10px] wb-text-3 uppercase tracking-wide mt-0.5">{centerSub}</div>}
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 shrink-0 max-w-[45%]">
        {entries.map((e, i) => {
          const color = e.color ?? CHART_PALETTE[i % CHART_PALETTE.length] ?? "#6366f1";
          return (
            <li
              key={e.label}
              className={`flex items-center gap-2 text-[12px] cursor-default transition-opacity ${active === null || active === i ? "opacity-100" : "opacity-50"}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} />
              <span className="wb-text-2 truncate">{e.label}</span>
              <span className="ml-auto font-mono wb-text-1 pl-3">{((e.value / total) * 100).toFixed(0)}%</span>
              <span className="font-mono wb-text-3 pl-1 text-[11px]">{formatValue(e.value)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
