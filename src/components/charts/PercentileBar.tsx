interface PercentileEntry {
  label: string;
  value: number;
  percentile: number;
  isTarget?: boolean | undefined;
}

interface Props {
  title: string;
  entries: PercentileEntry[];
  format?: "pct" | "mult" | "number" | "currency" | undefined;
}

function formatValue(value: number, format: Props["format"] = "number"): string {
  switch (format) {
    case "pct": return `${(value * 100).toFixed(1)}%`;
    case "mult": return `${value.toFixed(2)}×`;
    case "currency": return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    default: return value.toFixed(1);
  }
}

function percentileColor(pct: number): string {
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 50) return "bg-indigo-500";
  if (pct >= 25) return "bg-amber-500";
  return "bg-red-400";
}

/**
 * Horizontal percentile bars showing where each company ranks on a metric.
 * Sorted by percentile descending. Target company highlighted.
 */
export default function PercentileBar({ title, entries, format = "number" }: Props) {
  const sorted = [...entries].sort((a, b) => b.percentile - a.percentile);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">{title}</h3>
      <div className="space-y-2.5">
        {sorted.map((entry, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`w-20 text-xs font-medium truncate ${entry.isTarget ? "text-indigo-700 dark:text-indigo-300" : "text-slate-600 dark:text-slate-400"}`}>
              {entry.label}
            </div>
            <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full transition-all ${entry.isTarget ? "bg-indigo-500" : percentileColor(entry.percentile)}`}
                style={{ width: `${Math.max(3, entry.percentile)}%` }}
              />
              <span className="absolute right-2 top-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                P{entry.percentile.toFixed(0)}
              </span>
            </div>
            <div className={`w-16 text-xs text-right font-mono ${entry.isTarget ? "font-bold text-indigo-700 dark:text-indigo-300" : "text-slate-600 dark:text-slate-400"}`}>
              {formatValue(entry.value, format)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
