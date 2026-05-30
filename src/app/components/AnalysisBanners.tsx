import { RawPeriodData, EngineConfig } from "../../engine/types";
import { formatSharedApiStatus, type SharedApiResult } from "../../lib/sharedResearchApi";
import type { QualityGateReport } from "../../engine/mappingAudit";

interface AnalysisBannersProps {
  setConfig: (fn: (prev: EngineConfig) => EngineConfig) => void;
  config: EngineConfig;
  rawData: RawPeriodData[] | null;
  sharedRegistryStatus: SharedApiResult<unknown> | null;
  engineError: string | null;
  hasUnacknowledgedBreaks: boolean;
  structuralBreakPeriods: string[];
  valuationDataSelection: {
    usedStandaloneFallback?: boolean;
    consolidatedPeriodCount: number;
    standalonePeriodCount: number;
  } | null;
  qualityGate: QualityGateReport | null;
  itServicesSignal: { isITServices?: boolean; reason: string } | null;
  cyclicalitySignal: {
    classification: string;
    reason: string;
    metricUsed: string;
    latestValue: number | null;
    medianValue: number | null;
  } | null;
}

export function AnalysisBanners({
  setConfig,
  config,
  rawData,
  sharedRegistryStatus,
  engineError,
  hasUnacknowledgedBreaks,
  structuralBreakPeriods,
  valuationDataSelection,
  qualityGate,
  itServicesSignal,
  cyclicalitySignal,
}: AnalysisBannersProps) {
  return (
    <>
      {sharedRegistryStatus && !sharedRegistryStatus.ok && sharedRegistryStatus.status !== 404 && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>Shared comparison sync:</strong> {formatSharedApiStatus(sharedRegistryStatus, "Shared comparison registry synced.")}
        </div>
      )}
      {engineError && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>Engine Error:</strong> {engineError}
        </div>
      )}
      {/* Phase I9 — structural break / demerger confirmation banner */}
      {hasUnacknowledgedBreaks && (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-semibold mb-1">Structural break detected — possible demerger or M&A event</div>
          <div className="mb-2">
            S-5.1 (dirty surplus spike) fired on{" "}
            <span className="font-mono">{structuralBreakPeriods.join(", ")}</span>.
            This typically indicates a demerger, scheme of arrangement, buyback, or Ind AS transition adjustment.
            Pre-break periods may distort growth rates, mean-reversion anchors, and terminal value.
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => {
                // Find the earliest break period and exclude everything before it.
                const sorted = [...structuralBreakPeriods].sort();
                const firstBreak = sorted[0]!;
                const toExclude = (rawData ?? [])
                  .map(p => p.period_end)
                  .filter(pe => pe < firstBreak);
                setConfig(prev => ({ ...prev, excluded_periods: toExclude }));
              }}
              className="px-3 py-1.5 rounded bg-amber-700 text-white text-xs font-medium hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500"
            >
              Exclude pre-break periods
            </button>
            <button
              onClick={() => {
                // Acknowledge by setting excluded_periods to empty array —
                // suppresses the banner without actually excluding anything.
                setConfig(prev => ({ ...prev, excluded_periods: [] }));
              }}
              className="px-3 py-1.5 rounded border border-amber-400 text-amber-800 text-xs font-medium hover:bg-amber-100 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-900/30"
            >
              Keep all periods (I understand the risk)
            </button>
          </div>
        </div>
      )}
      {/* Phase I9 — show which periods are excluded when exclusions are active */}
      {(config.excluded_periods?.length ?? 0) > 0 && (() => {
        const totalPeriods = rawData?.length ?? 0;
        const remainingPeriods = totalPeriods - (config.excluded_periods?.length ?? 0);
        const lowHistory = remainingPeriods > 0 && remainingPeriods < 10;
        return (
          <div className={`mb-5 rounded-lg border p-3 text-xs flex flex-col gap-2 ${
            lowHistory
              ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
              : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400"
          }`}>
            <div className="flex items-center justify-between gap-4">
              <span>
                Period exclusions active:{" "}
                <span className="font-mono">{config.excluded_periods!.join(", ")}</span>
                {" "}excluded from the pipeline.
              </span>
              <button
                onClick={() => setConfig(prev => ({ ...prev, excluded_periods: [] }))}
                className="shrink-0 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Clear exclusions
              </button>
            </div>
            {lowHistory && (
              <div className="text-xs">
                ⚠️ Only <strong>{remainingPeriods}</strong> period{remainingPeriods !== 1 ? "s" : ""} remain after exclusion.
                Rigor is capped at <span className="font-mono">structurally-reconciled</span> — time-series signals
                (growth rates, mean-reversion, terminal value anchoring) require at least 10 periods for reliability.
              </div>
            )}
          </div>
        );
      })()}
      {valuationDataSelection?.usedStandaloneFallback && (
        <div className="mb-5 rounded-lg border border-teal-300 bg-teal-50 p-4 text-sm text-teal-900 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-200">
          <div className="font-semibold mb-1">Standalone valuation fallback active</div>
          <div>
            Consolidated statements have only <strong>{valuationDataSelection.consolidatedPeriodCount}</strong> period{valuationDataSelection.consolidatedPeriodCount === 1 ? "" : "s"};
            standalone has <strong>{valuationDataSelection.standalonePeriodCount}</strong> periods. Main valuation, recast, ratios, and advanced models use standalone as the explicit fallback.
          </div>
          <div className="mt-2 text-xs text-teal-700 dark:text-teal-300">
            Consolidated-vs-standalone gap analysis still uses both datasets in the Scope tab. Treat headline valuation as parent-standalone, not consolidated group value.
          </div>
        </div>
      )}
      {qualityGate?.scopeAssessment?.screeningOnly && (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-semibold mb-1">Screening mode — single period uploaded</div>
          <div>{qualityGate.scopeAssessment.screeningReason}</div>
          <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            What still works: current-period ratios, balance-sheet quality flags, point-in-time EPV/Graham-Dodd estimates, bank/NBFC metrics.
            What is disabled: growth rates, trend signals, mean-reversion anchors, V_RE_CV* residual-income valuation, rigor ladder above syntactically-valid.
            Upload at least 3 years of data to unlock the full analysis.
          </div>
        </div>
      )}
      {/* Phase E1 — IT-services caveat banner */}
      {itServicesSignal?.isITServices && (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
          <div className="font-semibold mb-1">💻 IT-services company detected</div>
          <div className="mb-1">{itServicesSignal.reason}</div>
          <div className="text-xs text-blue-700 dark:text-blue-300">
            The Penman-Nissim RNOA/ATO decomposition is less meaningful for human-capital businesses — NOA is structurally small (mostly receivables + cash), so RNOA looks inflated and ATO is not a useful efficiency signal.
            The moat score and terminal value anchors may overstate durability.
            Focus on: revenue growth, margin trend, FCFE yield, and employee cost ratio instead.
          </div>
        </div>
      )}
      {/* Phase F — Cyclicality peak/trough banner */}
      {(cyclicalitySignal?.classification === "cyclical-peak" || cyclicalitySignal?.classification === "cyclical-trough") && (
        <div className={`mb-5 rounded-lg border p-4 text-sm ${cyclicalitySignal.classification === "cyclical-peak"
          ? "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-200"
          : "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200"
          }`}>
          <div className="font-semibold mb-1">
            {cyclicalitySignal.classification === "cyclical-peak" ? "🔺 Cyclical company at peak" : "🔻 Cyclical company at trough"}
          </div>
          <div className="mb-1">{cyclicalitySignal.reason}</div>
          <div className="text-xs opacity-80">
            {cyclicalitySignal.classification === "cyclical-peak"
              ? `Latest ${cyclicalitySignal.metricUsed === "core-pm" ? "margin" : "RNOA"} (${cyclicalitySignal.latestValue != null ? (cyclicalitySignal.latestValue * 100).toFixed(1) + "%" : "—"}) is above the cycle median (${cyclicalitySignal.medianValue != null ? (cyclicalitySignal.medianValue * 100).toFixed(1) + "%" : "—"}). Valuation anchored on current earnings will overstate intrinsic value. Consider using the cycle-median as the terminal anchor.`
              : `Latest ${cyclicalitySignal.metricUsed === "core-pm" ? "margin" : "RNOA"} (${cyclicalitySignal.latestValue != null ? (cyclicalitySignal.latestValue * 100).toFixed(1) + "%" : "—"}) is below the cycle median (${cyclicalitySignal.medianValue != null ? (cyclicalitySignal.medianValue * 100).toFixed(1) + "%" : "—"}). Valuation anchored on current earnings will understate intrinsic value. Consider using the cycle-median as the terminal anchor.`
            }
          </div>
        </div>
      )}
    </>
  );
}
