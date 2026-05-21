/**
 * Pattern-Break Map — z-score deviation from each metric's own trend.
 *
 * For every metric × every period, computes the standardised residual
 * after fitting a simple linear trend on the metric's history. Cells
 * with |z| ≥ 2 are highlighted as anomalies; |z| ≥ 3 as severe breaks.
 *
 * Color encodes signed deviation:
 *   - Deep rose:    z ≤ -3   (severe negative break)
 *   - Rose:         -3 < z ≤ -2
 *   - Light rose:   -2 < z ≤ -1
 *   - Slate:        |z| < 1   (within trend)
 *   - Light emerald: 1 ≤ z < 2
 *   - Emerald:      2 ≤ z < 3
 *   - Deep emerald: z ≥ 3   (severe positive break)
 *
 * Why this is novel: every fundamental tool shows you the value. None
 * tell you whether the value is anomalous vs that metric's own history
 * across the entire dataset at once. This converts trend-following from
 * an analyst chore into a one-glance scan.
 *
 * Method note: linear regression on (period_idx, value), residual / σ.
 * Robust to drift (trend is estimated, not assumed flat) but not to
 * structural breaks — a single regime change inflates σ and masks
 * smaller anomalies in the same metric. A future extension could swap
 * to STL decomposition or robust median-deviation.
 */
import { useMemo, useState } from "react";
import type { RawPeriodData } from "../../engine/types";

interface Props {
  rawData: RawPeriodData[];
  allMetrics: string[];
}

interface CellZ {
  z: number | null;
  v: number | null;
  fit: number | null;
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xBar) * (ys[i] - yBar);
    den += (xs[i] - xBar) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yBar - slope * xBar;
  return { slope, intercept };
}

function zClass(z: number | null): {
  bg: string;
  label: string;
} {
  if (z == null) return { bg: "bg-slate-100 dark:bg-slate-800/50", label: "no data" };
  const abs = Math.abs(z);
  if (abs < 1) return { bg: "bg-slate-200/70 dark:bg-slate-800", label: "within trend" };
  if (z < 0) {
    if (abs >= 3) return { bg: "bg-rose-700", label: "severe break (down)" };
    if (abs >= 2) return { bg: "bg-rose-500", label: "anomaly (down)" };
    return { bg: "bg-rose-300/80 dark:bg-rose-900/40", label: "elevated (down)" };
  }
  if (abs >= 3) return { bg: "bg-emerald-700", label: "severe break (up)" };
  if (abs >= 2) return { bg: "bg-emerald-500", label: "anomaly (up)" };
  return { bg: "bg-emerald-300/80 dark:bg-emerald-900/40", label: "elevated (up)" };
}

export default function PatternBreakMap({ rawData, allMetrics }: Props) {
  const [search, setSearch] = useState("");
  const [threshold, setThreshold] = useState<1 | 2 | 3>(2);
  const [sortBy, setSortBy] = useState<"break" | "alpha">("break");

  // Compute z-score grid: metric → period_end → CellZ
  const { grid, breakCount } = useMemo(() => {
    const g: Record<string, Record<string, CellZ>> = {};
    const bc: Record<string, number> = {};

    for (const metric of allMetrics) {
      const xs: number[] = [];
      const ys: number[] = [];
      rawData.forEach((p, i) => {
        const v = p.raw_metric_values[metric];
        if (v != null && Number.isFinite(v)) {
          xs.push(i);
          ys.push(v);
        }
      });

      g[metric] = {};
      bc[metric] = 0;

      if (xs.length < 3) {
        // Not enough data to fit a trend
        rawData.forEach((p) => {
          g[metric][p.period_end] = {
            z: null,
            v: p.raw_metric_values[metric] ?? null,
            fit: null,
          };
        });
        continue;
      }

      const { slope, intercept } = linearFit(xs, ys);
      const fitted = ys.map((_, k) => slope * xs[k] + intercept);
      const residuals = ys.map((y, k) => y - fitted[k]);
      const meanRes = residuals.reduce((a, b) => a + b, 0) / residuals.length;
      const variance = residuals.reduce((a, b) => a + (b - meanRes) ** 2, 0) / residuals.length;
      const sigma = Math.sqrt(variance);

      // Build z grid
      let xsIdx = 0;
      rawData.forEach((p, i) => {
        const v = p.raw_metric_values[metric];
        if (v != null && Number.isFinite(v)) {
          const fit = slope * i + intercept;
          const z = sigma > 0 ? (v - fit) / sigma : 0;
          g[metric][p.period_end] = { z, v, fit };
          if (Math.abs(z) >= threshold) bc[metric] += 1;
          xsIdx++;
        } else {
          g[metric][p.period_end] = { z: null, v: null, fit: null };
        }
      });
    }
    return { grid: g, breakCount: bc };
  }, [rawData, allMetrics, threshold]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = q ? allMetrics.filter((m) => m.toLowerCase().includes(q)) : allMetrics;

    if (sortBy === "break") {
      list = [...list].sort((a, b) => (breakCount[b] ?? 0) - (breakCount[a] ?? 0));
    } else {
      list = [...list].sort();
    }
    return list;
  }, [allMetrics, search, sortBy, breakCount]);

  // Aggregate stats
  const totals = useMemo(() => {
    let sev = 0,
      anom = 0,
      elev = 0,
      ok = 0,
      none = 0;
    for (const m of allMetrics) {
      for (const p of rawData) {
        const z = grid[m]?.[p.period_end]?.z;
        if (z == null) none++;
        else if (Math.abs(z) >= 3) sev++;
        else if (Math.abs(z) >= 2) anom++;
        else if (Math.abs(z) >= 1) elev++;
        else ok++;
      }
    }
    return { sev, anom, elev, ok, none };
  }, [grid, allMetrics, rawData]);

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatCell label="Severe (|z|≥3)" value={totals.sev} dot="bg-rose-700" tone="rose" />
        <StatCell label="Anomaly (|z|≥2)" value={totals.anom} dot="bg-rose-500" tone="rose" />
        <StatCell label="Elevated (|z|≥1)" value={totals.elev} dot="bg-rose-300" />
        <StatCell label="Within trend" value={totals.ok} dot="bg-slate-300" />
        <StatCell label="No data / fit" value={totals.none} dot="bg-slate-200" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search metrics…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Threshold:</span>
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            {([1, 2, 3] as const).map((t) => (
              <button
                key={t}
                onClick={() => setThreshold(t)}
                className={`px-2.5 py-1 text-xs rounded-md transition tabular-nums ${
                  threshold === t
                    ? "bg-white shadow-sm dark:bg-slate-700"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                |z|≥{t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          {(["break", "alpha"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 text-xs rounded-md transition ${
                sortBy === s
                  ? "bg-white shadow-sm dark:bg-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              {s === "break" ? "By breaks" : "A → Z"}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60 overflow-hidden">
        <div className="overflow-auto max-h-[600px]">
          <table className="text-xs border-collapse w-full">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-900 text-left p-2 font-semibold text-slate-600 dark:text-slate-300 border-b border-r border-slate-200 dark:border-slate-700 min-w-[280px]">
                  Metric
                </th>
                <th className="text-center p-2 font-semibold text-slate-600 dark:text-slate-300 border-b border-r border-slate-200 dark:border-slate-700 min-w-[60px]">
                  Breaks
                </th>
                {rawData.map((p) => (
                  <th
                    key={p.period_end}
                    className="p-1 font-mono text-[10px] text-slate-500 border-b border-slate-200 dark:border-slate-700 min-w-[44px] text-center"
                  >
                    {p.period_end.slice(0, 7)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const cnt = breakCount[m] ?? 0;
                return (
                  <tr key={m} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="sticky left-0 z-10 bg-white dark:bg-slate-900/80 p-1.5 pr-2 border-r border-slate-200 dark:border-slate-700 align-middle truncate" title={m}>
                      <span className="text-slate-800 dark:text-slate-200 truncate">{m}</span>
                    </td>
                    <td
                      className={`text-center font-mono tabular-nums border-r border-slate-200 dark:border-slate-700 ${
                        cnt > 0
                          ? "text-rose-700 dark:text-rose-400 font-semibold"
                          : "text-slate-400"
                      }`}
                    >
                      {cnt}
                    </td>
                    {rawData.map((p) => {
                      const cell = grid[m]?.[p.period_end];
                      const c = zClass(cell?.z ?? null);
                      const tooltip =
                        cell?.z == null
                          ? `${m}\n${p.period_end}\nNo data or fit`
                          : `${m}\n${p.period_end}\nValue: ${cell.v?.toLocaleString() ?? "—"}\nFit: ${cell.fit?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "—"}\nz: ${cell.z.toFixed(2)} (${c.label})`;
                      return (
                        <td
                          key={p.period_end}
                          className="p-0 border-b border-slate-100 dark:border-slate-800/60"
                          title={tooltip}
                        >
                          <div
                            className={`w-full h-6 ${c.bg} transition-opacity hover:opacity-80 flex items-center justify-center`}
                          >
                            {cell?.z != null && Math.abs(cell.z) >= 2 && (
                              <span className="text-[9px] font-bold text-white tabular-nums">
                                {cell.z > 0 ? "+" : ""}
                                {cell.z.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Method note */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">
          How the z-score is computed
        </h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li>For each metric, fit a linear trend on (period_index, value).</li>
          <li>Compute residual r = value − fit at each period.</li>
          <li>z = r / σ(r). Cells where |z| ≥ {threshold} are flagged.</li>
          <li>
            Caveat: a single structural break inflates σ and can mask smaller
            anomalies. Cross-check with the Coverage Heatmap before drawing
            conclusions.
          </li>
        </ul>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  dot,
  tone = "slate",
}: {
  label: string;
  value: number;
  dot: string;
  tone?: "slate" | "rose";
}) {
  const accent =
    tone === "rose"
      ? "text-rose-700 dark:text-rose-400"
      : "text-slate-900 dark:text-slate-100";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center gap-1.5">
        <span className={`w-2.5 h-2.5 rounded-sm ${dot}`} />
        <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <div className={`text-base font-semibold tabular-nums mt-0.5 ${accent}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
