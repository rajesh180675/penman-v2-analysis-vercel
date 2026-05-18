interface CompanyMetric {
  companyId: string;
  label: string;
  metrics: Record<string, number | null>;
}

interface MetricSpec {
  key: string;
  label: string;
  /** "higher-is-better" or "lower-is-better" — drives color polarity */
  direction: "higher-better" | "lower-better";
  /** Format for display: "pct", "mult", "ratio" */
  format: "pct" | "mult" | "ratio";
}

interface Props {
  companies: CompanyMetric[];
  metrics: MetricSpec[];
}

/**
 * Sector Heatmap — companies (rows) × metrics (columns) color-coded matrix.
 * Each cell colored by relative rank (top quartile emerald, bottom quartile red).
 * Reveals at a glance who excels and lags on each dimension.
 */
export default function SectorHeatmap({ companies, metrics }: Props) {
  if (!companies.length || !metrics.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sector Heatmap</h3>
        <p className="text-xs text-slate-500 mt-2">Need at least 2 companies for cross-section heatmap.</p>
      </div>
    );
  }

  // Compute per-metric ranks
  const ranks = metrics.map(m => {
    const values = companies.map(c => c.metrics[m.key]).filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length === 0) return { key: m.key, ranks: new Map<string, number>() };

    const sorted = [...values].sort((a, b) => m.direction === "higher-better" ? b - a : a - b);
    const rankMap = new Map<string, number>();
    companies.forEach(c => {
      const v = c.metrics[m.key];
      if (v == null || !Number.isFinite(v)) return;
      const idx = sorted.indexOf(v);
      const percentile = idx / Math.max(1, values.length - 1); // 0 = best, 1 = worst
      rankMap.set(c.companyId, percentile);
    });
    return { key: m.key, ranks: rankMap };
  });

  const ranksByKey = Object.fromEntries(ranks.map(r => [r.key, r.ranks]));

  const formatValue = (v: number | null, fmt: MetricSpec["format"]) => {
    if (v == null || !Number.isFinite(v)) return "—";
    if (fmt === "pct") return `${(v * 100).toFixed(1)}%`;
    if (fmt === "mult") return `${v.toFixed(2)}x`;
    return v.toFixed(2);
  };

  const cellColor = (rank: number | undefined) => {
    if (rank == null) return "bg-slate-100 dark:bg-slate-800/50 text-slate-400";
    if (rank <= 0.25) return "bg-emerald-200 dark:bg-emerald-700/60 text-emerald-900 dark:text-emerald-100";
    if (rank <= 0.5)  return "bg-emerald-100 dark:bg-emerald-800/40 text-emerald-800 dark:text-emerald-200";
    if (rank <= 0.75) return "bg-amber-100 dark:bg-amber-800/40 text-amber-800 dark:text-amber-200";
    return "bg-red-100 dark:bg-red-800/40 text-red-800 dark:text-red-200";
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sector Heatmap</h3>
          <p className="text-xs text-slate-500">Cross-section ranking. Green = top quartile · Amber = third quartile · Red = bottom quartile.</p>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-emerald-200 dark:bg-emerald-700/60"></span>
            <span className="text-slate-600 dark:text-slate-400">Best</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-800/40"></span>
            <span className="text-slate-600 dark:text-slate-400">Above</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-amber-100 dark:bg-amber-800/40"></span>
            <span className="text-slate-600 dark:text-slate-400">Below</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-red-100 dark:bg-red-800/40"></span>
            <span className="text-slate-600 dark:text-slate-400">Worst</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white dark:bg-slate-900/60 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-700 z-10">
                Company
              </th>
              {metrics.map(m => (
                <th
                  key={m.key}
                  className="px-2 py-2 text-center text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-700"
                  title={m.direction === "higher-better" ? "Higher is better" : "Lower is better"}
                >
                  {m.label}
                  <span className="ml-1 text-slate-400">{m.direction === "higher-better" ? "↑" : "↓"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies.map(c => (
              <tr key={c.companyId}>
                <td className="sticky left-0 bg-white dark:bg-slate-900/60 px-2 py-2 font-semibold text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 z-10">
                  {c.label}
                </td>
                {metrics.map(m => {
                  const v = c.metrics[m.key];
                  const rank = ranksByKey[m.key]?.get(c.companyId);
                  return (
                    <td
                      key={m.key}
                      className={`px-2 py-2 text-center font-mono border border-white dark:border-slate-900 ${cellColor(rank)}`}
                    >
                      {formatValue(v, m.format)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
