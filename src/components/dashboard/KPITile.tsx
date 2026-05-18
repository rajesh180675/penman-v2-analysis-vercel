import { LineChart, Line, ResponsiveContainer } from "recharts";

interface SparklinePoint {
  period: string;
  value: number | null;
}

interface Props {
  label: string;
  value: number | null;
  format: "pct" | "mult" | "currency" | "number";
  subtitle?: string;
  history?: SparklinePoint[];
  trend?: number | null;
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

function TrendArrow({ trend, format }: { trend: number | null; format: Props["format"] }) {
  if (trend == null || !Number.isFinite(trend)) return null;
  const isUp = trend > 0;
  const color = isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  const arrow = isUp ? "↗" : "↘";
  const display = format === "pct" ? `${(Math.abs(trend) * 100).toFixed(1)}pp` : Math.abs(trend).toFixed(2);
  return <span className={`text-xs font-medium ${color}`}>{arrow} {display}</span>;
}

export default function KPITile({ label, value, format, subtitle, history, trend, onClick }: Props) {
  const sparkData = history?.filter(p => p.value != null) ?? [];
  const hasSparkline = sparkData.length >= 3;

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60 transition-all ${
        onClick ? "cursor-pointer hover:border-indigo-300 hover:shadow-sm dark:hover:border-indigo-600" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white truncate">
              {formatValue(value, format)}
            </span>
            <TrendArrow trend={trend ?? null} format={format} />
          </div>
          {subtitle && (
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</div>
          )}
        </div>

        {/* Sparkline */}
        {hasSparkline && (
          <div className="w-20 h-10 flex-shrink-0 ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#6366f1"
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
