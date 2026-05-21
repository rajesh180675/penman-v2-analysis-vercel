/**
 * Metric Inventory — what the engine knows vs what your data carries.
 *
 * Every canonical engine field, sorted by population density. Shows:
 *   - Density bar: % of periods with non-null data
 *   - Tier badge: Tier 1 (Capitaline raw) / Tier 2 (sidecar/AR) / Derived
 *   - First/last populated period
 *   - Mini-sparkline of the values
 *
 * Why this is novel: every fundamental tool gives you a fixed set of
 * fields. None show you the entire ingestion inventory. This makes
 * "what data do I actually have for THIS company" a one-tab answer.
 */
import { useMemo, useState } from "react";
import type { RawPeriodData } from "../../engine/types";
import type { PipelineResult } from "../../engine/pipeline";

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
  tier: "raw" | "ratio" | "computed";
}

// Heuristics: anything in raw_metric_values is Tier 1 raw Capitaline.
// We classify subtypes by name patterns common in the export.
function classify(name: string): MetricRow["tier"] {
  const lower = name.toLowerCase();
  if (
    lower.includes("ratio") ||
    lower.includes("%") ||
    lower.includes("per share") ||
    lower.includes("eps") ||
    lower.includes("roa") ||
    lower.includes("roe")
  ) {
    return "ratio";
  }
  if (
    lower.includes("growth") ||
    lower.includes("change") ||
    lower.includes("yoy")
  ) {
    return "computed";
  }
  return "raw";
}

const TIER_BADGE: Record<MetricRow["tier"], { label: string; cls: string }> = {
  raw: {
    label: "Raw",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  ratio: {
    label: "Ratio",
    cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  computed: {
    label: "Derived",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
};

export default function MetricInventory({ rawData, allMetrics, pipelineResult }: Props) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | MetricRow["tier"]>("all");
  const [sortBy, setSortBy] = useState<"coverage" | "alpha" | "magnitude">("coverage");

  const rows: MetricRow[] = useMemo(() => {
    return allMetrics.map((name) => {
      const values: (number | null)[] = [];
      let nonNull = 0;
      let first: string | null = null;
      let last: string | null = null;
      let mn = Infinity;
      let mx = -Infinity;
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
        }
      }
      return {
        name,
        coverage: rawData.length > 0 ? nonNull / rawData.length : 0,
        nonNullCount: nonNull,
        firstPeriod: first,
        lastPeriod: last,
        values,
        min: nonNull > 0 ? mn : 0,
        max: nonNull > 0 ? mx : 0,
        tier: classify(name),
      };
    });
  }, [rawData, allMetrics]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = rows;
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    if (tierFilter !== "all") list = list.filter((r) => r.tier === tierFilter);

    if (sortBy === "coverage") {
      list = [...list].sort((a, b) => b.coverage - a.coverage);
    } else if (sortBy === "magnitude") {
      list = [...list].sort((a, b) => Math.abs(b.max) - Math.abs(a.max));
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [rows, search, tierFilter, sortBy]);

  const tierCounts = useMemo(() => {
    const c = { raw: 0, ratio: 0, computed: 0 };
    for (const r of rows) c[r.tier]++;
    return c;
  }, [rows]);

  // Engine-side summary
  const recastCount = pipelineResult?.periods.length ?? 0;
  const bankMetricCount = pipelineResult?.bankResult?.bankMetrics?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Engine summary banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryCard
          label="Total metrics"
          value={allMetrics.length.toString()}
          subline={`${rawData.length} periods · ${(allMetrics.length * rawData.length).toLocaleString()} cells`}
        />
        <SummaryCard
          label="Raw line items"
          value={tierCounts.raw.toString()}
          subline="Direct from Capitaline export"
          accent="emerald"
        />
        <SummaryCard
          label="Ratios / per-share"
          value={tierCounts.ratio.toString()}
          subline="Capitaline pre-computed"
          accent="blue"
        />
        <SummaryCard
          label="Engine recast periods"
          value={recastCount > 0 ? recastCount.toString() : bankMetricCount > 0 ? bankMetricCount.toString() : "—"}
          subline={bankMetricCount > 0 ? "Bank pipeline" : "Industrial pipeline"}
          accent="amber"
        />
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
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          {(["all", "raw", "ratio", "computed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`px-2.5 py-1 text-xs rounded-md transition capitalize ${
                tierFilter === t
                  ? "bg-white shadow-sm dark:bg-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              {t === "all" ? "All" : t === "computed" ? "Derived" : t}
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
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              {s === "coverage" ? "Coverage" : s === "alpha" ? "A → Z" : "Magnitude"}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* Inventory table */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60 overflow-hidden">
        <div className="overflow-auto max-h-[600px]">
          <table className="text-xs w-full">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
              <tr className="text-slate-600 dark:text-slate-300">
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[280px]">
                  Metric
                </th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[60px]">
                  Tier
                </th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[120px]">
                  Coverage
                </th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[100px]">
                  Range
                </th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[140px]">
                  Spark
                </th>
                <th className="text-left p-2 font-semibold border-b border-slate-200 dark:border-slate-700 min-w-[120px]">
                  Last value
                </th>
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
                      className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TIER_BADGE[r.tier].cls}`}
                    >
                      {TIER_BADGE[r.tier].label}
                    </span>
                  </td>
                  <td className="p-2">
                    <CoverageBar coverage={r.coverage} count={r.nonNullCount} total={rawData.length} />
                  </td>
                  <td className="p-2">
                    {r.nonNullCount > 0 ? (
                      <span className="text-[10px] font-mono text-slate-500" title={`${r.firstPeriod} → ${r.lastPeriod}`}>
                        {r.firstPeriod?.slice(0, 4)} → {r.lastPeriod?.slice(0, 4)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Sparkline values={r.values} />
                  </td>
                  <td className="p-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {r.values[r.values.length - 1] != null
                      ? r.values[r.values.length - 1]!.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CoverageBar({ coverage, count, total }: { coverage: number; count: number; total: number }) {
  const pct = Math.round(coverage * 100);
  const tone = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : pct >= 20 ? "bg-orange-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-slate-500 shrink-0 min-w-[50px] text-right">
        {count}/{total} · {pct}%
      </span>
    </div>
  );
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const finite = values.filter((v) => v != null && Number.isFinite(v)) as number[];
  if (finite.length < 2) return <span className="text-[10px] text-slate-400">—</span>;
  const mn = Math.min(...finite);
  const mx = Math.max(...finite);
  const range = mx - mn || 1;
  const w = 120;
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
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.2} className="text-slate-500 dark:text-slate-400" />
      {/* Last point dot */}
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
