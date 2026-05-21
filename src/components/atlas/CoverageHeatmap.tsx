/**
 * Coverage Heatmap — every metric × every period.
 *
 * Each cell is colored by what kind of value the parser captured:
 *   - emerald: positive numeric value
 *   - amber:   zero (parser saw "0" or "-" mapped to 0)
 *   - rose:    negative value
 *   - slate:   null / missing
 *
 * Row labels are searchable. Click a metric row to see its values.
 *
 * Why this is novel: every fundamental-data tool shows you the metrics
 * they HAVE. None show you the entire raw inventory and which years are
 * gappy. This turns invisible data quality into a visible artifact.
 */
import { useMemo, useState } from "react";
import type { RawPeriodData } from "../../engine/types";

interface Props {
  rawData: RawPeriodData[];
  allMetrics: string[];
}

type CellState = "positive" | "zero" | "negative" | "null";

function classify(v: number | null | undefined): CellState {
  if (v == null || !Number.isFinite(v)) return "null";
  if (v === 0) return "zero";
  if (v < 0) return "negative";
  return "positive";
}

const STATE_BG: Record<CellState, string> = {
  positive: "bg-emerald-500",
  zero: "bg-amber-300",
  negative: "bg-rose-500",
  null: "bg-slate-200 dark:bg-slate-800",
};

const STATE_LABEL: Record<CellState, string> = {
  positive: "Positive",
  zero: "Zero / dash",
  negative: "Negative",
  null: "Missing",
};

export default function CoverageHeatmap({ rawData, allMetrics }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"alpha" | "coverage" | "magnitude">("coverage");

  const periods = rawData;

  // Compute coverage % and a magnitude proxy per metric
  const metricStats = useMemo(() => {
    const stats: Record<string, { coverage: number; mag: number; nonNull: number }> = {};
    for (const m of allMetrics) {
      let nonNull = 0;
      let absSum = 0;
      for (const p of periods) {
        const v = p.raw_metric_values[m];
        if (v != null && Number.isFinite(v)) {
          nonNull++;
          absSum += Math.abs(v);
        }
      }
      stats[m] = {
        coverage: periods.length > 0 ? nonNull / periods.length : 0,
        mag: nonNull > 0 ? absSum / nonNull : 0,
        nonNull,
      };
    }
    return stats;
  }, [allMetrics, periods]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = q ? allMetrics.filter((m) => m.toLowerCase().includes(q)) : allMetrics;

    if (sortBy === "coverage") {
      list = [...list].sort((a, b) => metricStats[b].coverage - metricStats[a].coverage);
    } else if (sortBy === "magnitude") {
      list = [...list].sort((a, b) => metricStats[b].mag - metricStats[a].mag);
    } else {
      list = [...list].sort();
    }
    return list;
  }, [allMetrics, search, sortBy, metricStats]);

  // Aggregate stats for header
  const totals = useMemo(() => {
    let pos = 0,
      neg = 0,
      zero = 0,
      nul = 0;
    for (const m of allMetrics) {
      for (const p of periods) {
        const c = classify(p.raw_metric_values[m]);
        if (c === "positive") pos++;
        else if (c === "negative") neg++;
        else if (c === "zero") zero++;
        else nul++;
      }
    }
    return { pos, neg, zero, nul, total: pos + neg + zero + nul };
  }, [allMetrics, periods]);

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatCell label="Cells total" value={totals.total.toLocaleString()} />
        <StatCell label="Positive" value={totals.pos.toLocaleString()} dot="bg-emerald-500" />
        <StatCell label="Negative" value={totals.neg.toLocaleString()} dot="bg-rose-500" />
        <StatCell label="Zero / dash" value={totals.zero.toLocaleString()} dot="bg-amber-300" />
        <StatCell label="Missing" value={totals.nul.toLocaleString()} dot="bg-slate-300" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search metrics (e.g. 'depos', 'income', 'cash')"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          {(["coverage", "alpha", "magnitude"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 text-xs rounded-md transition ${
                sortBy === s
                  ? "bg-white shadow-sm dark:bg-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              {s === "coverage" ? "By coverage" : s === "alpha" ? "A → Z" : "By magnitude"}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
          {filtered.length} of {allMetrics.length} metrics
        </span>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60 overflow-hidden">
        <div className="overflow-auto max-h-[600px]">
          <table className="text-xs border-collapse w-full">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-900 text-left p-2 font-semibold text-slate-600 dark:text-slate-300 border-b border-r border-slate-200 dark:border-slate-700 min-w-[260px]">
                  Metric ({filtered.length})
                </th>
                {periods.map((p) => (
                  <th
                    key={p.period_end}
                    className="p-1 font-mono text-[10px] text-slate-500 border-b border-slate-200 dark:border-slate-700 min-w-[40px] text-center"
                    title={p.period_end}
                  >
                    {p.period_end.slice(0, 7)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const isSelected = selected === m;
                return (
                  <tr
                    key={m}
                    className={`group cursor-pointer ${
                      isSelected ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    }`}
                    onClick={() => setSelected(isSelected ? null : m)}
                  >
                    <td
                      className={`sticky left-0 z-10 p-1.5 pr-2 border-r border-slate-200 dark:border-slate-700 align-middle ${
                        isSelected ? "bg-blue-50 dark:bg-blue-950/30" : "bg-white dark:bg-slate-900/80"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-800 dark:text-slate-200 truncate" title={m}>
                          {m}
                        </span>
                        <span className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0">
                          {(metricStats[m].coverage * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    {periods.map((p) => {
                      const v = p.raw_metric_values[m];
                      const c = classify(v);
                      return (
                        <td
                          key={p.period_end}
                          className={`p-0 border-b border-slate-100 dark:border-slate-800/60`}
                          title={`${m}\n${p.period_end}\n${STATE_LABEL[c]}${v != null ? `: ${v.toLocaleString()}` : ""}`}
                        >
                          <div
                            className={`w-full h-6 ${STATE_BG[c]} ${
                              c === "null" ? "" : "opacity-90 hover:opacity-100"
                            } transition-opacity`}
                          />
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

      {/* Selected metric detail */}
      {selected && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
              {selected}
            </h3>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-blue-700 dark:text-blue-300 hover:underline"
            >
              clear
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {periods.map((p) => {
              const v = p.raw_metric_values[selected];
              return (
                <div
                  key={p.period_end}
                  className="rounded-lg border border-blue-200 bg-white p-2 dark:border-blue-900/40 dark:bg-slate-900/60"
                >
                  <div className="text-[10px] font-mono text-slate-500">
                    {p.period_end.slice(0, 7)}
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {v == null
                      ? "—"
                      : v.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center gap-1.5">
        {dot && <span className={`w-2.5 h-2.5 rounded-sm ${dot}`} />}
        <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <div className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
        {value}
      </div>
    </div>
  );
}
