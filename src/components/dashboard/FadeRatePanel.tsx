import type { FadeRateAnalysis } from "../../engine/fadeRateEngine";

interface Props {
  fadeRate: FadeRateAnalysis | null;
}

const CONF_STYLE = { high: "bg-green-900/40 text-green-300", medium: "bg-amber-900/40 text-amber-300", low: "bg-red-900/40 text-red-300" };
const MOAT_LABEL: Record<string, string> = { none: "No Advantage", weak: "Weak", moderate: "Moderate", strong: "Strong", durable: "Durable Moat" };
const MOAT_COLOR: Record<string, string> = { none: "text-slate-400", weak: "text-red-400", moderate: "text-amber-300", strong: "text-green-400", durable: "text-emerald-300" };
const LC_BADGE: Record<string, string> = { startup: "bg-purple-800/50 text-purple-300", growth: "bg-blue-800/50 text-blue-300", mature: "bg-slate-700/50 text-slate-300", decline: "bg-red-800/50 text-red-300" };

export default function FadeRatePanel({ fadeRate }: Props) {
  if (!fadeRate) return null;
  const f = fadeRate.firm;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Earnings Persistence (ω)</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONF_STYLE[f.confidence]}`}>{f.confidence}</span>
      </div>

      {/* Main omega */}
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{f.omega.toFixed(2)}</span>
        <span className={`text-sm font-medium ${MOAT_COLOR[f.impliedCompetitiveAdvantage]}`}>
          {MOAT_LABEL[f.impliedCompetitiveAdvantage]}
        </span>
      </div>

      {/* Raw / Prior / Shrinkage row */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-slate-900/50 rounded p-1.5">
          <div className="text-slate-400">Raw ω</div>
          <div className="text-slate-200 font-medium">{f.omegaRaw.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900/50 rounded p-1.5">
          <div className="text-slate-400">Industry Prior</div>
          <div className="text-slate-200 font-medium">{f.omegaIndustryPrior.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900/50 rounded p-1.5">
          <div className="text-slate-400">Shrinkage λ</div>
          <div className="text-slate-200 font-medium">{f.shrinkageWeight.toFixed(2)}</div>
        </div>
      </div>

      {/* Structural break warning */}
      {f.structuralBreak.detected && (
        <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300">
          ⚠️ Structural break{f.structuralBreak.breakYear ? ` in ${f.structuralBreak.breakYear}` : ""}
          {f.structuralBreak.cause ? ` — ${f.structuralBreak.cause}` : ""}
        </div>
      )}

      {/* Margin vs Turnover */}
      {(f.omegaMargin != null || f.omegaTurnover != null) && (
        <div className="flex gap-3 text-xs">
          {f.omegaMargin != null && (
            <div className="flex-1 bg-slate-900/50 rounded p-1.5 text-center">
              <div className="text-slate-400">Margin ω</div>
              <div className="text-slate-200 font-medium">{f.omegaMargin.toFixed(2)}</div>
            </div>
          )}
          {f.omegaTurnover != null && (
            <div className="flex-1 bg-slate-900/50 rounded p-1.5 text-center">
              <div className="text-slate-400">Turnover ω</div>
              <div className="text-slate-200 font-medium">{f.omegaTurnover.toFixed(2)}</div>
            </div>
          )}
        </div>
      )}

      {/* Terminal Value Multiplier */}
      <div className="flex justify-between text-xs text-slate-400">
        <span>Terminal Value Multiplier</span>
        <span className="text-slate-200 font-medium">{f.terminalValueMultiplier.toFixed(2)}×</span>
      </div>

      {/* Segment table */}
      {fadeRate.segments.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-slate-400 font-medium">Segments</div>
          <div className="text-xs space-y-1">
            {fadeRate.segments.map((s) => (
              <div key={s.segment} className="flex items-center justify-between bg-slate-900/40 rounded px-2 py-1">
                <span className="text-slate-300 truncate max-w-[40%]">{s.segment}</span>
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${LC_BADGE[s.lifecycle]}`}>{s.lifecycle}</span>
                  <span className="text-slate-200 font-medium w-8 text-right">{s.omega.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
