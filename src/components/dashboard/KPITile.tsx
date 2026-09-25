/**
 * KPITile — dashboard/ratio KPI tile on the Workbench primitives.
 * Uses wb-metric tokens (dark-safe by construction), the pure-SVG Sparkline
 * (no per-tile Recharts instance), and the SVG Icon trend indicator.
 */
import { Sparkline, trendTone } from "../charts/Sparkline";
import { Icon } from "../shared/Icon";

interface SparklinePoint {
  period: string;
  value: number | null;
}

interface Props {
  label: string;
  value: number | null;
  format: "pct" | "mult" | "currency" | "number";
  subtitle?: string | undefined;
  history?: SparklinePoint[] | undefined;
  trend?: number | null | undefined;
  /** False for metrics where down is good (e.g. debt ratios) — flips spark tone */
  higherIsBetter?: boolean | undefined;
  onClick?: () => void;
}

function formatValue(value: number | null, format: Props["format"]): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "pct": return `${(value * 100).toFixed(1)}%`;
    case "mult": return `${value.toFixed(2)}×`;
    case "currency": return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    case "number": return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  }
}

function TrendBadge({ trend, format }: { trend: number | null; format: Props["format"] }) {
  if (trend == null || !Number.isFinite(trend)) return null;
  const isUp = trend > 0;
  const color = isUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  const display = format === "pct" ? `${(Math.abs(trend) * 100).toFixed(1)}pp` : Math.abs(trend).toFixed(2);
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon name={isUp ? "trend-up" : "trend-down"} size={12} />
      {display}
    </span>
  );
}

export default function KPITile({ label, value, format, subtitle, history, trend, higherIsBetter = true, onClick }: Props) {
  const sparkValues = history?.map((p) => p.value) ?? [];
  const hasSparkline = sparkValues.filter((v) => v != null).length >= 3;
  const tone = trendTone(trend, higherIsBetter);

  return (
    <div
      onClick={onClick}
      className={`wb-metric transition-all ${
        onClick ? "cursor-pointer hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-600" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="wb-metric-label">{label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="wb-metric-value truncate" style={{ fontSize: "1.375rem" }}>
              {formatValue(value, format)}
            </span>
            <TrendBadge trend={trend ?? null} format={format} />
          </div>
          {subtitle && <div className="text-xs wb-text-3 mt-0.5">{subtitle}</div>}
        </div>

        {hasSparkline && (
          <div className="flex-shrink-0 ml-2 self-center">
            <Sparkline values={sparkValues} width={80} height={36} tone={tone} />
          </div>
        )}
      </div>
    </div>
  );
}
