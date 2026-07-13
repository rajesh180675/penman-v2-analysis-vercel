/* ── Greenfield Pipeline Sidecar Panel ─────────────────────────────
   Displays the six-layer greenfield sidecar result: as-reported vs
   adjusted confidence, anomaly signals, adjustment audit trail, and
   validation diff table. */
import type { GreenfieldPipelineResult } from "../../engine/greenfieldPipeline";
import { Card } from "./debugUi";

interface Props {
  greenfield?: GreenfieldPipelineResult | null | undefined;
}

function ConfidenceBadge({ level, score }: { level: string; score: number }) {
  const colors: Record<string, string> = {
    high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    low: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    blocked: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colors[level] ?? colors.medium}`}>
      {level.toUpperCase()} ({score.toFixed(0)})
    </span>
  );
}

function severityColor(severity: string): string {
  switch (severity) {
    case "CRITICAL": return "text-red-600 dark:text-red-400";
    case "BLOCKING": return "text-red-600 dark:text-red-400";
    case "WARNING": return "text-amber-600 dark:text-amber-400";
    default: return "text-slate-500 dark:text-slate-400";
  }
}

export function GreenfieldPanel({ greenfield }: Props) {
  if (!greenfield) return null;

  const { confidence, triage, validation, analysisWindow } = greenfield;
  const activeSignals = triage.activeSignals;
  const adjustedDiff = validation.diffTable.filter((r) => r.validationStatus === "accepted");

  return (
    <Card title="Greenfield Sidecar — As-Reported vs Adjusted">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Six-layer accounting-quality sidecar: normalizes raw data, detects anomalies, applies
        adjustments, validates, and scores confidence for both as-reported and adjusted lenses.
      </p>

      {/* Confidence comparison */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">As-Reported</div>
          <ConfidenceBadge level={confidence.asReported.level} score={confidence.asReported.score} />
          {confidence.asReported.penalties.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {confidence.asReported.penalties.slice(0, 3).map((p, i) => (
                <li key={i} className="text-xs text-slate-500 dark:text-slate-400">
                  −{p.points} {p.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Adjusted</div>
          <ConfidenceBadge level={confidence.adjusted.level} score={confidence.adjusted.score} />
          {confidence.adjusted.bonuses.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {confidence.adjusted.bonuses.slice(0, 3).map((b, i) => (
                <li key={i} className="text-xs text-emerald-600 dark:text-emerald-400">
                  +{b.points} {b.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Analysis window */}
      {analysisWindow.excludedPeriods.length > 0 && (
        <div className="mb-4 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Analysis window: </span>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {analysisWindow.mode}
          </span>
          {analysisWindow.excludedPeriods.length > 0 && (
            <span className="text-slate-400 ml-2">
              (excluded: {analysisWindow.excludedPeriods.join(", ")})
            </span>
          )}
        </div>
      )}

      {/* Active signals */}
      {activeSignals.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Active Anomaly Signals ({activeSignals.length})
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {activeSignals.map((sig) => (
              <div key={sig.id} className="text-xs border-l-2 border-slate-200 dark:border-slate-700 pl-2 py-1">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${severityColor(sig.severity)}`}>
                    {sig.detectorId}
                  </span>
                  <span className="text-slate-400">p_artifact={sig.p_artifact.toFixed(2)}</span>
                  {sig.blocksValuation && (
                    <span className="text-red-500 font-medium">blocks valuation</span>
                  )}
                </div>
                <div className="text-slate-600 dark:text-slate-400">
                  {sig.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Adjustment audit trail */}
      {adjustedDiff.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Adjustments Applied ({adjustedDiff.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-1 pr-3">Period</th>
                  <th className="py-1 pr-3">Field</th>
                  <th className="py-1 pr-3 text-right">Before</th>
                  <th className="py-1 pr-3 text-right">After</th>
                  <th className="py-1 pr-3 text-right">Delta</th>
                  <th className="py-1">Adjuster</th>
                </tr>
              </thead>
              <tbody>
                {adjustedDiff.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1 pr-3 font-mono text-slate-500">{row.period.slice(0, 10)}</td>
                    <td className="py-1 pr-3 font-mono">{row.field}</td>
                    <td className="py-1 pr-3 text-right">
                      {typeof row.before === "number" ? row.before.toFixed(1) : String(row.before)}
                    </td>
                    <td className="py-1 pr-3 text-right">
                      {typeof row.after === "number" ? row.after.toFixed(1) : String(row.after)}
                    </td>
                    <td className="py-1 pr-3 text-right font-mono">
                      {row.delta != null ? (row.delta >= 0 ? "+" : "") + row.delta.toFixed(1) : "—"}
                    </td>
                    <td className="py-1 text-slate-400">{row.adjusterId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Validation status */}
      {validation.status !== "accepted" && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          Validation: {validation.status} ({validation.rejectedCount} rejected, {validation.acceptedCount} accepted)
        </div>
      )}
    </Card>
  );
}
