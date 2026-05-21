/**
 * Metric Inventory v2 — engine-mapped vs raw-only + statement classification.
 *
 * v1 issues this fixes:
 *   - Tier classification was string-match heuristic ("ratio" in name)
 *     -> Now uses atlasHelpers.isEngineMapped() backed by mappingSpec
 *   - No engine-usage indicator (which metrics actually drive the engine?)
 *     -> New "Engine" badge on every row
 *   - Sparkline had no scale -> mini value range shown alongside
 *   - Last value lacked delta -> period-over-period delta with arrow
 *
 * The killer feature: of N metrics, X% are engine-wired, the rest is
 * Capitaline noise the engine ignores. This was previously invisible.
 */
import { useMemo, useState } from "react";
import type { RawPeriodData } from "../../engine/types";
import type { PipelineResult } from "../../engine/pipeline";
import {
  classifyStatement,
  engineCanonical,
  isEngineMapped,
  statementLabel,
  type AtlasStatement,
} from "./atlasHelpers";

interface Props {
  rawData: RawPeriodData[];
  allMetrics: string[];
  pipelineResult: PipelineResult | null;
}

interface MetricRow {
  name: string;
  coverage: number;
  nonNullCount: number;
  firstPeriod: string | null;
  lastPeriod: string | null;
  values: (number | null)[];
  min: number;
  max: number;
  statement: AtlasStatement;
  engineMapped: boolean;
  canonicalField: string | null;
  lastValue: number | null;
  prevValue: number | null;
  yoyDelta: number | null;
}

const STATEMENT_BADGE: Record<AtlasStatement, string> = {
  BS: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  PL: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  CF: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Ratio: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  Other: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function MetricInventory({ rawData, allMetrics, pipelineResult }: Props) {
  const [search, setSearch] = useState("");
  const [stmtFilter, setStmtFilter] = useState<"all" | AtlasStatement>("all");
  const [engineFilter, setEngineFilter] = useState<"all" | "mapped" | "unmapped">("all");
  const [sortBy, setSortBy] = useState<"coverage" | "alpha" | "magnitude">("coverage");

  const rows: MetricRow[] = useMemo(() => {
    return allMetrics.map((name) => {
      const values: (number | null)[] = [];
      let nonNull = 0;
      let first: string | null = null;
      let last: string | null = null;
      let mn = Infinity;
      let mx = -Infinity;
      let lastValue: number | null = null;
      let prevValue: number | null = null;
      for (const p of rawData) {
        const v = p.raw_metric_values[name];
        const finite = v != null && Number.isFinite(v);
        values.push(finite ? v : null);
        if (finite) {
          nonNull++;
          if (first === null) first = p.period_end;
          last = p.period_end;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
          // Track the most recent and second-most-recent finite values for YoY
          prevValue = lastValue;
          lastValue = v;
        }
      }
      const yoyDelta =
        lastValue != null && prevValue != null && prevValue !== 0
          ? (lastValue - prevValue) / Math.abs(prevValue)
          : null;
      return {
        name,
        coverage: rawData.length > 0 ? nonNull / rawData.length : 0,
        nonNullCount: nonNull,
        firstPeriod: first,
        lastPeriod: last,
        values,
        min: nonNull > 0 ? mn : 0,
        max: nonNull > 0 ? mx : 0,
        statement: classifyStatement(name),
        engineMapped: isEngineMapped(name),
        canonicalField: engineCanonical(name),
        lastValue,
        prevValue,
        yoyDelta,
      };
    });
  }, [rawData, allMetrics]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = rows;
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    if (stmtFilter !== "all") list = list.filter((r) => r.statement === stmtFilter);
    if (engineFilter === "mapped") list = list.filter((r) => r.engineMapped);
    else if (engineFilter === "unmapped") list = list.filter((r) => !r.engineMapped);

    if (sortBy === "coverage") list = [...list].sort((a, b) => b.coverage - a.coverage);
    else if (sortBy === "magnitude") list = [...list].sort((a, b) => Math.abs(b.max) - Math.abs(a.max));
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [rows, search, stmtFilter, engineFilter, sortBy]);

  const stats = useMemo(() => {
    const stmtCount: Record<AtlasStatement, number> = { BS: 0, PL: 0, CF: 0, Ratio: 0, Other: 0 };
    let mapped = 0;
    for (const r of rows) {
      stmtCount[r.statement]++;
      if (r.engineMapped) mapped++;
    }
    return { stmtCount, mapped, unmapped: rows.length - mapped };
  }, [rows]);

  const recastCount = pipelineResult?.periods.length ?? 0;
  const bankMetricCount = pipelineResult?.bankResult?.bankMetrics?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Top summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryCard
          label="Total metrics"
          value={allMetrics.length.toString()}
          subline={`${rawData.length} periods`}
        />
        <SummaryCard
          label="Engine-wired"
          value={stats.mapped.toString()}
          subline={`${((stats.mapped / Math.max(rows.length, 1)) * 100).toFixed(0)}% maps to canonical fields`}
          accent="emerald"
        />
        <SummaryCard
          label="Unmapped"
          value={stats.unmapped.toString()}
          subline="Capitaline data the engine ignores"
          accent="amber"
        />
        <SummaryCard
          label="Pipeline output"
          value={(recastCount > 0 ? recastCount : bankMetricCount).toString()}
          subline={
            bankMetricCount > 0
              ? `${bankMetricCount} bank periods`
              : `${recastCount} recast periods`
          }
          accent="blue"
        />
      </div>

      {/* Statement breakdown row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(["BS", "PL", "CF", "Ratio", "Other"] as AtlasStatement[]).map((s) => (
          <button
            key={s}
            onClick={() => setStmtFilter(stmtFilter === s ? "all" : s)}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              stmtFilter === s
                ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900/40"
                : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
            } ${stats.stmtCount[s] === 0 ? "opacity-40" : ""}`}
            disabled={stats.stmtCount[s] === 0}
          >
            <div className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATEMENT_BADGE[s]}`}>
              {s}
            </div>
            <div className="text-base font-semibold tabular-nums mt-1 text-slate-900 dark:text-slate-100">
              {stats.stmtCount[s]}
            </div>
            <div className="text-[10px] text-slate-500">{statementLabel(s)}</div>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search metrics..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          {(["all", "mapped", "unmapped"] as const).map((e) => (
            <button
              key={e}
              onClick={() => setEngineFilter(e)}
              className={`px-2.5 py-1 text-xs rounded-md transition ${
                engineFilter === e
                  ? "bg-white shadow-sm dark:bg-slate-700"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {e === "all" ? "All metrics" : e === "mapped" ? "Engine-wired" : "Unmapped"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          {(["coverage", "alpha", "magnitude"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 text-xs rounded-md transition ${
                sortBy === s
                  ? "bg-white shadow-sm dark:bg-slate-700"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {s === "coverage" ? "Coverage" : s === "alpha" ? "A -> Z" : "Magnitude"}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60 overflow-hidden">
        <div className="overflow-auto max-h-[600px]">
          <table className="text-xs w-full">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
              <tr className="text-slate-600 dark:text-slate-300">
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[280px]">Metric</th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[60px]">Stmt</th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[80px]">Engine</th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[120px]">Coverage</th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[140px]">Spark · range</th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[100px]">Last value</th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[80px]">YoY</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.name}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800/60"
                >
                  <td className="p-2 font-mono text-slate-800 dark:text-slate-200" title={r.name}>
                    {r.name}
                  </td>
                  <td className="p-2">
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATEMENT_BADGE[r.statement]}`}
                    >
                      {r.statement}
                    </span>
                  </td>
                  <td className="p-2">
                    {r.engineMapped ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-mono text-emerald-800 dark:text-emerald-300"
                        title={`Maps to canonical engine field: ${r.canonicalField}`}
                      >
                        <span>✓</span>
                        <span className="truncate max-w-[100px]">{r.canonicalField}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">unmapped</span>
                    )}
                  </td>
                  <td className="p-2">
                    <CoverageBar coverage={r.coverage} count={r.nonNullCount} total={rawData.length} />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Sparkline values={r.values} />
                      {r.nonNullCount > 0 && (
                        <span className="text-[9px] font-mono text-slate-400 leading-tight" title={`${r.firstPeriod} to ${r.lastPeriod}`}>
                          {compactNum(r.min)}<br/>{compactNum(r.max)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {r.lastValue != null
                      ? r.lastValue.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : "-"}
                  </td>
                  <td className="p-2">
                    {r.yoyDelta != null ? (
                      <span
                        className={`inline-flex items-center gap-0.5 text-[11px] font-mono tabular-nums ${
                          r.yoyDelta > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : r.yoyDelta < 0
                            ? "text-rose-700 dark:text-rose-400"
                            : "text-slate-500"
                        }`}
                      >
                        <span>{r.yoyDelta > 0 ? "+" : ""}{(r.yoyDelta * 100).toFixed(1)}%</span>
                        <span className="text-[9px]">{r.yoyDelta > 0 ? "▲" : r.yoyDelta < 0 ? "▼" : "="}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Insight banner */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <h4 className="text-xs font-semibold text-emerald-900 dark:text-emerald-300 uppercase mb-2">
          What this tells you
        </h4>
        <ul className="text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
          <li>
            <span className="font-semibold">{stats.mapped} of {rows.length} metrics</span> are wired into the
            engine via mappingSpec - those drive every ratio, valuation lens, and quality gate.
          </li>
          <li>
            <span className="font-semibold">{stats.unmapped} are unmapped</span> - Capitaline carries them, the
            engine doesn't use them. If you spot one that SHOULD drive valuation, file a bug to add it
            to mappingSpec.ts.
          </li>
          <li>
            Coverage bars below 50% mean the export is gappy for that field - either the company doesn't
            disclose, or Capitaline didn't carry it through the years.
          </li>
        </ul>
      </div>
    </div>
  );
}

function compactNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toFixed(1) + "Cr";
  if (abs >= 1e5) return (n / 1e5).toFixed(1) + "L";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function CoverageBar({ coverage, count, total }: { coverage: number; count: number; total: number }) {
  const pct = Math.round(coverage * 100);
  const tone =
    pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : pct >= 20 ? "bg-orange-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-slate-500 shrink-0 min-w-[50px] text-right">
        {count}/{total} - {pct}%
      </span>
    </div>
  );
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const finite = values.filter((v) => v != null && Number.isFinite(v)) as number[];
  if (finite.length < 2) return <span className="text-[10px] text-slate-400">-</span>;
  const mn = Math.min(...finite);
  const mx = Math.max(...finite);
  const range = mx - mn || 1;
  const w = 90;
  const h = 24;
  const points = values
    .map((v, i) => {
      if (v == null) return null;
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - mn) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean) as string[];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        className="text-slate-500 dark:text-slate-400"
      />
      {(() => {
        const lastIdx = values.length - 1;
        const v = values[lastIdx];
        if (v == null) return null;
        const x = w;
        const y = h - ((v - mn) / range) * h;
        return <circle cx={x} cy={y} r={2.2} className="fill-emerald-500" />;
      })()}
    </svg>
  );
}

function SummaryCard({
  label,
  value,
  subline,
  accent = "slate",
}: {
  label: string;
  value: string;
  subline: string;
  accent?: "slate" | "emerald" | "blue" | "amber";
}) {
  const accentMap = {
    slate: "text-slate-900 dark:text-slate-100",
    emerald: "text-emerald-700 dark:text-emerald-400",
    blue: "text-blue-700 dark:text-blue-400",
    amber: "text-amber-700 dark:text-amber-400",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${accentMap[accent]}`}>{value}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subline}</div>
    </div>
  );
}
