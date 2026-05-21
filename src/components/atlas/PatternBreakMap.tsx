/**
 * Pattern-Break Map v2 — robust anomaly detection across the entire grid.
 *
 * v1 issues this fixes:
 *   - Linear-trend assumption hurts spiky/exponential metrics
 *     -> Now uses median-absolute-deviation (MAD) by default; users can
 *       opt back to linear-trend residuals when they suspect smooth drift
 *   - sigma contains the breaks (single 4-sigma event inflates sigma that grades it)
 *     -> MAD is robust; one outlier no longer poisons the scale for the rest
 *   - Sign-blind coloring (a +2-sigma jump in NPL is BAD news, +2-sigma in revenue is GOOD)
 *     -> atlasHelpers.signConvention() classifies each metric; cells colored
 *       by ECONOMIC interpretation, not just signed deviation
 *   - No top-N triage -> leaderboard surfaces the 8 most-anomalous events
 *   - No co-anomaly detection -> shock-period strip flags periods where >=3
 *     metrics break simultaneously (Covid FY21, demergers, M&A)
 */
import { useMemo, useState } from "react";
import type { RawPeriodData } from "../../engine/types";
import { signConvention, classifyStatement } from "./atlasHelpers";

interface Props {
  rawData: RawPeriodData[];
  allMetrics: string[];
}

type Method = "mad" | "linear";

interface CellZ {
  z: number | null;
  v: number | null;
  fit: number | null;
  isGood: boolean | null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const xBar = xs.reduce((a, b) => a + b, 0) / n;
  const yBar = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xBar) * (ys[i] - yBar);
    den += (xs[i] - xBar) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: yBar - slope * xBar };
}

function madZScores(values: number[]): { zs: number[]; centers: number[] } {
  const med = median(values);
  const dev = values.map((v) => Math.abs(v - med));
  const mad = median(dev);
  const sigma = 1.4826 * mad;
  if (sigma === 0) {
    return { zs: values.map(() => 0), centers: values.map(() => med) };
  }
  return {
    zs: values.map((v) => (v - med) / sigma),
    centers: values.map(() => med),
  };
}

function linearZScores(values: number[]): { zs: number[]; centers: number[] } {
  const xs = values.map((_, i) => i);
  const { slope, intercept } = linearFit(xs, values);
  const fitted = values.map((_, i) => slope * i + intercept);
  const residuals = values.map((y, i) => y - fitted[i]);
  const meanRes = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance = residuals.reduce((a, b) => a + (b - meanRes) ** 2, 0) / residuals.length;
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return { zs: values.map(() => 0), centers: fitted };
  return {
    zs: values.map((y, i) => (y - fitted[i]) / sigma),
    centers: fitted,
  };
}

interface AnomalyEvent {
  metric: string;
  period: string;
  z: number;
  v: number;
  isGood: boolean | null;
  statement: string;
}

interface PeriodShock {
  period: string;
  count: number;
  metrics: string[];
}

function cellTone(z: number | null, isGood: boolean | null): { bg: string; label: string } {
  if (z == null) return { bg: "bg-slate-100 dark:bg-slate-800/50", label: "no data" };
  const abs = Math.abs(z);
  if (abs < 1) return { bg: "bg-slate-200/70 dark:bg-slate-800", label: "within trend" };
  if (isGood === true) {
    if (abs >= 3) return { bg: "bg-emerald-700", label: "severe positive (good)" };
    if (abs >= 2) return { bg: "bg-emerald-500", label: "anomaly (good)" };
    return { bg: "bg-emerald-300/80 dark:bg-emerald-900/40", label: "elevated (good)" };
  }
  if (isGood === false) {
    if (abs >= 3) return { bg: "bg-rose-700", label: "severe negative (bad)" };
    if (abs >= 2) return { bg: "bg-rose-500", label: "anomaly (bad)" };
    return { bg: "bg-rose-300/80 dark:bg-rose-900/40", label: "elevated (bad)" };
  }
  if (z < 0) {
    if (abs >= 3) return { bg: "bg-violet-700", label: "severe break (down)" };
    if (abs >= 2) return { bg: "bg-violet-500", label: "anomaly (down)" };
    return { bg: "bg-violet-300/80 dark:bg-violet-900/40", label: "elevated (down)" };
  }
  if (abs >= 3) return { bg: "bg-cyan-700", label: "severe break (up)" };
  if (abs >= 2) return { bg: "bg-cyan-500", label: "anomaly (up)" };
  return { bg: "bg-cyan-300/80 dark:bg-cyan-900/40", label: "elevated (up)" };
}

export default function PatternBreakMap({ rawData, allMetrics }: Props) {
  const [search, setSearch] = useState("");
  const [threshold, setThreshold] = useState<1 | 2 | 3>(2);
  const [sortBy, setSortBy] = useState<"break" | "alpha">("break");
  const [method, setMethod] = useState<Method>("mad");

  const { grid, breakCount, anomalies, periodShocks } = useMemo(() => {
    const g: Record<string, Record<string, CellZ>> = {};
    const bc: Record<string, number> = {};
    const events: AnomalyEvent[] = [];

    for (const metric of allMetrics) {
      const values: number[] = [];
      rawData.forEach((p) => {
        const v = p.raw_metric_values[metric];
        if (v != null && Number.isFinite(v)) values.push(v);
      });

      g[metric] = {};
      bc[metric] = 0;
      const conv = signConvention(metric);
      const stmt = classifyStatement(metric);

      if (values.length < 3) {
        rawData.forEach((p) => {
          g[metric][p.period_end] = {
            z: null,
            v: p.raw_metric_values[metric] ?? null,
            fit: null,
            isGood: null,
          };
        });
        continue;
      }

      const { zs, centers } =
        method === "mad" ? madZScores(values) : linearZScores(values);

      let valIdx = 0;
      rawData.forEach((p) => {
        const v = p.raw_metric_values[metric];
        if (v != null && Number.isFinite(v)) {
          const z = zs[valIdx];
          const fit = centers[valIdx];
          let isGood: boolean | null = null;
          if (Math.abs(z) >= 1 && conv !== "neutral") {
            isGood = conv === "up-good" ? z > 0 : z < 0;
          }
          g[metric][p.period_end] = { z, v, fit, isGood };
          if (Math.abs(z) >= threshold) {
            bc[metric] += 1;
            events.push({ metric, period: p.period_end, z, v, isGood, statement: stmt });
          }
          valIdx++;
        } else {
          g[metric][p.period_end] = { z: null, v: null, fit: null, isGood: null };
        }
      });
    }

    events.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

    const periodCounts = new Map<string, AnomalyEvent[]>();
    for (const e of events) {
      if (!periodCounts.has(e.period)) periodCounts.set(e.period, []);
      periodCounts.get(e.period)!.push(e);
    }
    const shocks: PeriodShock[] = [];
    for (const [period, evs] of periodCounts) {
      if (evs.length >= 3) {
        shocks.push({
          period,
          count: evs.length,
          metrics: evs.slice(0, 6).map((e) => e.metric),
        });
      }
    }
    shocks.sort((a, b) => b.count - a.count);

    return { grid: g, breakCount: bc, anomalies: events, periodShocks: shocks };
  }, [rawData, allMetrics, threshold, method]);

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

  return (
    <div className="space-y-4">
      {anomalies.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 dark:border-rose-900/40 dark:bg-rose-950/20">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-rose-900 dark:text-rose-200">
              Top {Math.min(8, anomalies.length)} anomalies
            </h3>
            <span className="text-[11px] font-mono text-rose-700 dark:text-rose-400">
              {anomalies.length} cells with {"|z| ≥"} {threshold}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {anomalies.slice(0, 8).map((e, i) => {
              const tone =
                e.isGood === true
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                  : e.isGood === false
                  ? "border-rose-300 bg-white dark:border-rose-800 dark:bg-rose-950/30"
                  : "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900/40";
              const sign = e.z > 0 ? "+" : "";
              return (
                <div
                  key={`${e.metric}-${e.period}-${i}`}
                  className={`rounded-lg border px-3 py-1.5 ${tone}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase text-slate-500 shrink-0">
                      {e.statement}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                      {e.period.slice(0, 7)}
                    </span>
                    <span
                      className={`ml-auto text-sm font-bold tabular-nums shrink-0 ${
                        e.isGood === true
                          ? "text-emerald-700 dark:text-emerald-400"
                          : e.isGood === false
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {sign}{e.z.toFixed(1)}σ
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300 truncate" title={e.metric}>
                    {e.metric}
                  </div>
                  <div className="text-[10px] tabular-nums text-slate-500 mt-0.5">
                    value: {e.v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {periodShocks.length > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-200">
              Shock periods · {periodShocks.length}
            </h3>
            <span className="text-[11px] text-violet-700 dark:text-violet-400">
              {"≥3 metrics breaking simultaneously"}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {periodShocks.slice(0, 6).map((s) => (
              <div
                key={s.period}
                className="rounded-lg border border-violet-300 bg-white p-2 dark:border-violet-800 dark:bg-slate-900/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono font-semibold text-violet-900 dark:text-violet-200">
                    {s.period.slice(0, 7)}
                  </span>
                  <span className="text-xs font-bold tabular-nums text-violet-700 dark:text-violet-400">
                    {s.count} breaks
                  </span>
                </div>
                <ul className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 space-y-0.5">
                  {s.metrics.map((m) => (
                    <li key={m} className="truncate" title={m}>
                      · {m}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search metrics..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Method:</span>
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            {(["mad", "linear"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                title={
                  m === "mad"
                    ? "Median-absolute-deviation (robust to outliers)"
                    : "Linear trend residual (assumes smooth drift)"
                }
                className={`px-2.5 py-1 text-xs rounded-md transition uppercase ${
                  method === m
                    ? "bg-white shadow-sm dark:bg-slate-700"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {m === "mad" ? "MAD" : "Trend"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">{"|z|≥"}</span>
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            {([1, 2, 3] as const).map((t) => (
              <button
                key={t}
                onClick={() => setThreshold(t)}
                className={`px-2.5 py-1 text-xs rounded-md transition tabular-nums ${
                  threshold === t
                    ? "bg-white shadow-sm dark:bg-slate-700"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {t}
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
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {s === "break" ? "By breaks" : "A -> Z"}
            </button>
          ))}
        </div>
      </div>

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
                      const c = cellTone(cell?.z ?? null, cell?.isGood ?? null);
                      const tooltip =
                        cell?.z == null
                          ? `${m}\n${p.period_end}\nNo data or fit`
                          : `${m}\n${p.period_end}\nValue: ${cell.v?.toLocaleString() ?? "-"}\nCenter: ${cell.fit?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "-"}\nz: ${cell.z.toFixed(2)} (${c.label})`;
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

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">
          How the z-score is computed
        </h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          {method === "mad" ? (
            <>
              <li>For each metric: median = median(values), MAD = median(|value - median|), sigma = 1.4826 x MAD</li>
              <li>z = (value - median) / sigma. Cells where {"|z| ≥"} {threshold} are flagged.</li>
              <li>Robust to outliers - a single 4-sigma event no longer poisons the scale used to grade the rest.</li>
            </>
          ) : (
            <>
              <li>For each metric: fit linear trend on (period_idx, value), residual r = value - fit, sigma = stdev(r), z = r / sigma.</li>
              <li>Better when the metric drifts smoothly; worse when there's a single structural break.</li>
              <li>If linear shows fewer breaks than MAD, your metric drifts smoothly. If MAD shows fewer, breaks are skewing the linear sigma.</li>
            </>
          )}
          <li>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-emerald-500 mr-1.5" />
            Economically GOOD direction (revenue up, NPL down)
          </li>
          <li>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-rose-500 mr-1.5" />
            Economically BAD direction (revenue down, NPL up, provisions up)
          </li>
          <li>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-cyan-500 mr-1.5" />
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-violet-500 mr-1.5" />
            Sign-neutral metric (working capital, share capital) - colored by raw direction only
          </li>
        </ul>
      </div>
    </div>
  );
}
