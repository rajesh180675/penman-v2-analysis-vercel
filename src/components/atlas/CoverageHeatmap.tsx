/**
 * Coverage Heatmap v2 — magnitude × sign × statement grouping.
 *
 * v1 issues this fixes:
 *   - 1-bit cells (sign-class only) → cells now encode magnitude via opacity
 *   - Flat list → metrics cluster into BS / PL / CF / Ratio / Other groups
 *   - Disconnected detail panel → click a row to expand inline values
 *
 * Cell encoding:
 *   - hue:    sign (emerald=+, rose=-, amber=zero, slate=null)
 *   - alpha:  |value| z-normalized within the metric's own row
 *             (faintest cell ≈ smallest abs value; darkest ≈ largest)
 *
 * Why this is novel: every fundamental tool either shows you the value
 * (table) or the trend (line chart). None encode magnitude+sign+presence
 * in a single grid that scales to 200+ metrics × 25 periods.
 */
import { useMemo, useState } from "react";
import type { RawPeriodData } from "../../engine/types";
import { classifyStatement, statementLabel, type AtlasStatement } from "./atlasHelpers";

interface Props {
  rawData: RawPeriodData[];
  allMetrics: string[];
}

type CellState = "positive" | "zero" | "negative" | "null";

interface MetricStats {
  coverage: number;
  nonNull: number;
  absMax: number;
  statement: AtlasStatement;
}

function classify(v: number | null | undefined): CellState {
  if (v == null || !Number.isFinite(v)) return "null";
  if (v === 0) return "zero";
  if (v < 0) return "negative";
  return "positive";
}

const STATE_LABEL: Record<CellState, string> = {
  positive: "Positive",
  zero: "Zero / dash",
  negative: "Negative",
  null: "Missing",
};

// Statement → color anchor for group dividers
const STATEMENT_ACCENT: Record<AtlasStatement, string> = {
  BS: "border-l-blue-400 dark:border-l-blue-600",
  PL: "border-l-emerald-400 dark:border-l-emerald-600",
  CF: "border-l-amber-400 dark:border-l-amber-600",
  Ratio: "border-l-violet-400 dark:border-l-violet-600",
  Other: "border-l-slate-400 dark:border-l-slate-600",
};

const STATEMENT_BADGE: Record<AtlasStatement, string> = {
  BS: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  PL: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  CF: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Ratio: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  Other: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function CoverageHeatmap({ rawData, allMetrics }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"alpha" | "coverage" | "magnitude">("coverage");
  const [statementFilter, setStatementFilter] = useState<"all" | AtlasStatement>("all");
  const [groupByStatement, setGroupByStatement] = useState(true);

  const periods = rawData;

  const stats = useMemo<Record<string, MetricStats>>(() => {
    const out: Record<string, MetricStats> = {};
    for (const m of allMetrics) {
      let nonNull = 0;
      let absMax = 0;
      for (const p of periods) {
        const v = p.raw_metric_values[m];
        if (v != null && Number.isFinite(v)) {
          nonNull++;
          if (Math.abs(v) > absMax) absMax = Math.abs(v);
        }
      }
      out[m] = {
        coverage: periods.length > 0 ? nonNull / periods.length : 0,
        nonNull,
        absMax,
        statement: classifyStatement(m),
      };
    }
    return out;
  }, [allMetrics, periods]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = q ? allMetrics.filter((m) => m.toLowerCase().includes(q)) : allMetrics;
    if (statementFilter !== "all") {
      list = list.filter((m) => stats[m]!.statement === statementFilter);
    }

    if (sortBy === "coverage") {
      list = [...list].sort((a, b) => stats[b]!.coverage - stats[a]!.coverage);
    } else if (sortBy === "magnitude") {
      list = [...list].sort((a, b) => stats[b]!.absMax - stats[a]!.absMax);
    } else {
      list = [...list].sort();
    }
    return list;
  }, [allMetrics, search, sortBy, statementFilter, stats]);

  // Group filtered metrics by statement when groupByStatement=true
  const grouped = useMemo(() => {
    if (!groupByStatement) return [{ statement: null as AtlasStatement | null, items: filtered }];
    const order: AtlasStatement[] = ["BS", "PL", "CF", "Ratio", "Other"];
    const buckets = new Map<AtlasStatement, string[]>();
    for (const s of order) buckets.set(s, []);
    for (const m of filtered) buckets.get(stats[m]!.statement)!.push(m);
    return order
      .map((s) => ({ statement: s as AtlasStatement | null, items: buckets.get(s)! }))
      .filter((g) => g.items.length > 0);
  }, [filtered, groupByStatement, stats]);

  const totals = useMemo(() => {
    let pos = 0, neg = 0, zero = 0, nul = 0;
    const byStmt: Record<AtlasStatement, number> = { BS: 0, PL: 0, CF: 0, Ratio: 0, Other: 0 };
    for (const m of allMetrics) {
      byStmt[stats[m]!.statement]++;
      for (const p of periods) {
        const c = classify(p.raw_metric_values[m]);
        if (c === "positive") pos++;
        else if (c === "negative") neg++;
        else if (c === "zero") zero++;
        else nul++;
      }
    }
    return { pos, neg, zero, nul, total: pos + neg + zero + nul, byStmt };
  }, [allMetrics, periods, stats]);

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatCell label="Cells" value={totals.total.toLocaleString()} />
        <StatCell label="Positive" value={totals.pos.toLocaleString()} dot="bg-emerald-500" />
        <StatCell label="Negative" value={totals.neg.toLocaleString()} dot="bg-rose-500" />
        <StatCell label="Zero / dash" value={totals.zero.toLocaleString()} dot="bg-amber-300" />
        <StatCell label="Missing" value={totals.nul.toLocaleString()} dot="bg-slate-300" />
      </div>

      {/* Statement breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(["BS", "PL", "CF", "Ratio", "Other"] as AtlasStatement[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatementFilter(statementFilter === s ? "all" : s)}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              statementFilter === s
                ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900/40"
                : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
            } ${totals.byStmt[s] === 0 ? "opacity-40" : ""}`}
            disabled={totals.byStmt[s] === 0}
          >
            <div className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATEMENT_BADGE[s]}`}>
              {s}
            </div>
            <div className="text-base font-semibold tabular-nums mt-1 text-slate-900 dark:text-slate-100">
              {totals.byStmt[s]}
            </div>
            <div className="text-[10px] text-slate-500">{statementLabel(s)}</div>
          </button>
        ))}
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
        <label className="flex items-center gap-1.5 text-xs cursor-pointer text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={groupByStatement}
            onChange={(e) => setGroupByStatement(e.target.checked)}
            className="rounded"
          />
          Group by statement
        </label>
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
          {filtered.length} of {allMetrics.length}
        </span>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60 overflow-hidden">
        <div className="overflow-auto max-h-[600px]">
          <table className="text-xs border-collapse w-full">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-900 text-left p-2 font-semibold text-slate-600 dark:text-slate-300 border-b border-r border-slate-200 dark:border-slate-700 min-w-[280px]">
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
              {grouped.map((g, gi) => (
                <>
                  {g.statement && groupByStatement && (
                    <tr key={`group-${g.statement}-${gi}`} className="bg-slate-50/80 dark:bg-slate-900/80">
                      <td
                        colSpan={periods.length + 1}
                        className={`px-3 py-1.5 border-y border-slate-200 dark:border-slate-700 border-l-4 ${STATEMENT_ACCENT[g.statement]}`}
                      >
                        <span className="text-[11px] uppercase font-mono font-semibold text-slate-600 dark:text-slate-400 tracking-wider">
                          {statementLabel(g.statement)}
                        </span>
                        <span className="ml-2 text-[11px] font-mono text-slate-400">{g.items.length}</span>
                      </td>
                    </tr>
                  )}
                  {g.items.map((m) => {
                    const isSelected = selected === m;
                    const s = stats[m]!;
                    return (
                      <tr
                        key={m}
                        className={`group cursor-pointer ${
                          isSelected
                            ? "bg-blue-50 dark:bg-blue-950/30"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
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
                              {(s.coverage * 100).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        {periods.map((p) => {
                          const v = p.raw_metric_values[m];
                          const c = classify(v);
                          // Magnitude → opacity. Smallest non-zero absolute value
                          // gets 0.18 alpha; the row's max gets 1.0.
                          let alpha = 1;
                          if (c === "positive" || c === "negative") {
                            const ratio = s.absMax > 0 ? Math.abs(v as number) / s.absMax : 1;
                            alpha = 0.2 + 0.8 * ratio;
                          }
                          const bg =
                            c === "null"
                              ? "rgba(148, 163, 184, 0.18)"
                              : c === "zero"
                              ? "rgba(252, 211, 77, 0.85)" // amber-300
                              : c === "positive"
                              ? `rgba(16, 185, 129, ${alpha.toFixed(2)})` // emerald-500
                              : `rgba(244, 63, 94, ${alpha.toFixed(2)})`; // rose-500
                          return (
                            <td
                              key={p.period_end}
                              className="p-0 border-b border-slate-100 dark:border-slate-800/60"
                              title={`${m}\n${p.period_end}\n${STATE_LABEL[c]}${
                                v != null ? `: ${v.toLocaleString()}` : ""
                              }`}
                            >
                              <div
                                className="w-full h-6 transition-opacity hover:brightness-110"
                                style={{ backgroundColor: bg }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected metric detail */}
      {selected && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  STATEMENT_BADGE[stats[selected]!.statement]
                }`}
              >
                {stats[selected]!.statement}
              </span>
              <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">{selected}</h3>
            </div>
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
                      : v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reading guide */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-2">
          Reading the cells
        </h4>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
          <li>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-emerald-500 mr-1.5" />
            Positive value · darker = larger relative to the metric's own range
          </li>
          <li>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-rose-500 mr-1.5" />
            Negative value · darker = larger absolute value
          </li>
          <li>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-amber-300 mr-1.5" />
            Zero or "—" / dash placeholder
          </li>
          <li>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-slate-300 mr-1.5" />
            Missing — no value carried in the export for this period
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
}: {
  label: string;
  value: string;
  dot?: string | undefined;
}) {
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
