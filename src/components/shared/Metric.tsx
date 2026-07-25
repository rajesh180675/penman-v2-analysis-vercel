/**
 * Metric — unified KPI tile for the Workbench UI.
 * Absorbs DesignSystem.MetricCard and dashboard/KPITile into one component
 * with token-based styling and an Icon-based trend indicator.
 */
import { ReactNode } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Icon } from "./Icon";

export type MetricFormat = "pct" | "mult" | "currency" | "days" | "number" | "ratio";

export function formatMetricValue(value: number | null | undefined, format: MetricFormat): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "pct": return `${(value * 100).toFixed(1)}%`;
    case "mult": return `${value.toFixed(2)}×`;
    case "currency": return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    case "days": return `${value.toFixed(0)}d`;
    case "ratio": return value.toFixed(3);
    default: return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  }
}

interface MetricTrendProps {
  value: number | null | undefined;
  format?: MetricFormat | undefined;
}

export function MetricTrend({ value, format = "pct" }: MetricTrendProps) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value > 0.0001;
  const down = value < -0.0001;
  const color = up
    ? "text-emerald-600 dark:text-emerald-400"
    : down
      ? "text-rose-600 dark:text-rose-400"
      : "wb-text-3";
  const icon = up ? "trend-up" : down ? "trend-down" : "trend-flat";
  const display = format === "pct"
    ? `${(Math.abs(value) * 100).toFixed(1)}pp`
    : Math.abs(value).toFixed(2);
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon name={icon as "trend-up"} size={12} />
      {display}
    </span>
  );
}

interface SparklinePoint {
  period: string;
  value: number | null;
}

interface MetricProps {
  label: string;
  value: number | null | undefined;
  format?: MetricFormat | undefined;
  subtitle?: string | undefined;
  context?: ReactNode;
  trend?: number | null | undefined;
  history?: SparklinePoint[] | undefined;
  onClick?: (() => void) | undefined;
}

export function Metric({ label, value, format = "number", subtitle, context, trend, history, onClick }: MetricProps) {
  const sparkData = history?.filter((p) => p.value != null) ?? [];
  const hasSparkline = sparkData.length >= 3;

  return (
    <div
      onClick={onClick}
      className={`wb-surface rounded-xl border p-4 transition-all ${
        onClick ? "cursor-pointer hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-600" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium wb-text-3 uppercase tracking-wide">{label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold wb-text-1 truncate font-financial">
              {formatMetricValue(value, format)}
            </span>
            <MetricTrend value={trend} format={format} />
          </div>
          {subtitle && <div className="text-xs wb-text-3 mt-0.5">{subtitle}</div>}
          {context != null && <div className="text-xs wb-text-3 mt-1">{context}</div>}
        </div>
        {hasSparkline && (
          <div className="w-20 h-10 flex-shrink-0 ml-2">
            <ResponsiveContainer debounce={50} width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-chart-1)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
