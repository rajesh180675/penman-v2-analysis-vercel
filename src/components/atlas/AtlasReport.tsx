/**
 * Atlas Report — Fundamental Data Visualization
 *
 * Four novel sub-views over raw + derived fundamental data, none of which
 * commercial tools (Tikr / Koyfin / Screener / Tijori) attempt:
 *
 *   1. Coverage Heatmap — every metric × every period as a colored cell.
 *      Reveals which metrics have data and which years are gappy at a glance.
 *
 *   2. Time-Trail Scatter — pick any two metrics. Each dot is a year, lines
 *      connect chronologically. Reveals regime changes invisible in line charts.
 *
 *   3. Pattern-Break Map — z-score deviation per metric per period vs its own
 *      trend. Spots anomalies across the entire fundamental dataset at once.
 *
 *   4. Metric Inventory — every canonical engine field, sorted by population
 *      density. Shows what the engine HAS vs what it expects.
 *
 * Why these are novel: every other fundamental-data tool shows the data
 * they extracted as if it's complete. This tab shows you exactly what's
 * present, what's missing, and what's anomalous — turning the analyst's
 * silent assumption ("the data is right") into a visible artifact.
 */
import { useState, useMemo } from "react";
import type { RawPeriodData } from "../../engine/types";
import type { PipelineResult } from "../../engine/pipeline";
import CoverageHeatmap from "./CoverageHeatmap";
import TimeTrailScatter from "./TimeTrailScatter";
import PatternBreakMap from "./PatternBreakMap";
import MetricInventory from "./MetricInventory";

interface Props {
  rawData: RawPeriodData[] | null;
  pipelineResult: PipelineResult | null;
}

type AtlasView = "coverage" | "scatter" | "patternBreak" | "inventory";

const VIEWS: { id: AtlasView; label: string; icon: string; tagline: string }[] = [
  {
    id: "coverage",
    label: "Coverage Heatmap",
    icon: "🗺️",
    tagline: "Every metric × every period — see what data you actually have",
  },
  {
    id: "scatter",
    label: "Time-Trail Scatter",
    icon: "🌀",
    tagline: "Two metrics across years — regime changes line charts hide",
  },
  {
    id: "patternBreak",
    label: "Pattern-Break Map",
    icon: "⚡",
    tagline: "σ-deviations from trend — anomalies across all metrics at once",
  },
  {
    id: "inventory",
    label: "Metric Inventory",
    icon: "🧮",
    tagline: "What the engine knows vs what your data carries",
  },
];

export default function AtlasReport({ rawData, pipelineResult }: Props) {
  const [view, setView] = useState<AtlasView>("coverage");

  // Pre-compute the union of all metric keys ever seen across periods
  const { allMetrics, sortedPeriods } = useMemo(() => {
    if (!rawData || rawData.length === 0) return { allMetrics: [], sortedPeriods: [] };
    const m = new Set<string>();
    for (const p of rawData) {
      for (const k of Object.keys(p.raw_metric_values)) m.add(k);
    }
    const periods = [...rawData].sort((a, b) =>
      a.period_end.localeCompare(b.period_end),
    );
    return { allMetrics: [...m].sort(), sortedPeriods: periods };
  }, [rawData]);

  if (!rawData || rawData.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900/60">
        <p className="text-sm text-slate-500">Atlas needs raw period data. Load a company first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-5 dark:border-emerald-900/40 dark:from-emerald-950/30 dark:to-teal-950/30">
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none">🛰️</div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
              Atlas — Fundamental Data, Visualized
            </h2>
            <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 mt-1 max-w-3xl">
              {allMetrics.length} metrics × {sortedPeriods.length} periods ={" "}
              {allMetrics.length * sortedPeriods.length} cells of fundamental data.
              Every commercial tool hides what's missing or anomalous. Atlas surfaces it.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-mono uppercase text-emerald-700 dark:text-emerald-400">
              Source
            </div>
            <div className="text-xs text-emerald-900 dark:text-emerald-200 font-semibold">
              raw_metric_values
            </div>
          </div>
        </div>
      </div>

      {/* Sub-tab nav */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {VIEWS.map((v) => {
          const active = v.id === view;
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                active
                  ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:bg-slate-900/70"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{v.icon}</span>
                <span
                  className={`text-sm font-semibold ${
                    active
                      ? "text-emerald-900 dark:text-emerald-200"
                      : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {v.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">
                {v.tagline}
              </p>
            </button>
          );
        })}
      </div>

      {/* Active view */}
      <div className="min-h-[400px]">
        {view === "coverage" && (
          <CoverageHeatmap
            rawData={sortedPeriods}
            allMetrics={allMetrics}
          />
        )}
        {view === "scatter" && (
          <TimeTrailScatter
            rawData={sortedPeriods}
            allMetrics={allMetrics}
          />
        )}
        {view === "patternBreak" && (
          <PatternBreakMap
            rawData={sortedPeriods}
            allMetrics={allMetrics}
          />
        )}
        {view === "inventory" && (
          <MetricInventory
            rawData={sortedPeriods}
            allMetrics={allMetrics}
            pipelineResult={pipelineResult}
          />
        )}
      </div>
    </div>
  );
}
