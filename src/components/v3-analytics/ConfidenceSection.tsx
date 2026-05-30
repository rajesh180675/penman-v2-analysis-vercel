/* ── Confidence Score §14 ─────────────────────────────────────── */
import { V3AnalyticsBundle, ConfidenceComponent } from "../../engine/v3Analytics";
import { CONF_COLORS } from "./v3Formatters";

export function ConfidenceSection({ conf, validation }: {
  conf: V3AnalyticsBundle["confidence"];
  validation: V3AnalyticsBundle["validation"];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§14 Composite Confidence Score</h3>
        <p className="text-xs text-slate-500">Weighted across 6 dimensions: separation quality, clean surplus, RE–ReOI convergence, Eq.16 closure, earnings persistence, terminal cleanliness.</p>
      </div>

      {/* Score header */}
      <div className={`rounded-xl border p-4 ${CONF_COLORS[conf.classification]}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold">{conf.composite.toFixed(1)}/100</p>
            <p className="text-sm font-semibold capitalize">{conf.classification.replace("_", " ")}</p>
          </div>
          <div className="text-4xl">
            {conf.classification === "HIGH" ? "✓" : conf.classification === "MODERATE" ? "◎" : conf.classification === "LOW" ? "⚠" : "✗"}
          </div>
        </div>
      </div>

      {/* Component bars */}
      <div className="space-y-3">
        {conf.components.map((c: ConfidenceComponent) => (
          <div key={c.name}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium text-slate-700">{c.name} <span className="text-slate-400 font-normal">(weight {c.weight})</span></span>
              <span className="text-slate-600 font-mono">{c.score.toFixed(0)}/100</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${c.score >= 80 ? "bg-emerald-500" : c.score >= 60 ? "bg-blue-500" : c.score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.max(2, c.score)}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{c.detail}</p>
          </div>
        ))}
      </div>

      {/* Data validation summary */}
      {(validation.errors > 0 || validation.warnings > 0) && (
        <div className="border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">§2.5 Data Validation: {validation.errors} error(s), {validation.warnings} warning(s)</p>
          {validation.checks.filter((c) => !c.passed).map((c, i) => (
            <p key={i} className={`text-xs ${c.severity === "ERROR" ? "text-red-700" : "text-amber-600"}`}>
              • [{c.severity}] {c.description}{c.detail ? `: ${c.detail}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
