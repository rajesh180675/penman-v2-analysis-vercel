import type { MoatScoreResult, MoatWidth } from "../../engine/moatScoring";

interface Props {
  moat: MoatScoreResult | null;
  /** Optional title override */
  title?: string | undefined;
}

const WIDTH_STYLES: Record<MoatWidth, { bg: string; text: string; border: string; label: string; emoji: string }> = {
  wide: {
    bg: "bg-emerald-50 dark:bg-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-700",
    label: "Wide Moat",
    emoji: "🏰",
  },
  narrow: {
    bg: "bg-blue-50 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-700",
    label: "Narrow Moat",
    emoji: "🛡️",
  },
  none: {
    bg: "bg-slate-50 dark:bg-slate-800/50",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-300 dark:border-slate-700",
    label: "No Moat",
    emoji: "⚠️",
  },
  "insufficient-data": {
    bg: "bg-amber-50 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-700",
    label: "Insufficient Data",
    emoji: "❓",
  },
};

const TREND_LABEL: Record<string, { label: string; color: string }> = {
  strengthening: { label: "↗ Strengthening", color: "text-emerald-600" },
  stable:        { label: "→ Stable",        color: "text-blue-600" },
  eroding:       { label: "↘ Eroding",       color: "text-red-600" },
  "insufficient-data": { label: "— Unknown", color: "text-slate-500" },
};

export default function MoatPanel({ moat, title = "Economic Moat" }: Props) {
  if (!moat) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
        <p className="text-xs text-slate-500 mt-2">Insufficient data — need at least 3 periods of valid RNOA data.</p>
      </div>
    );
  }

  const style = WIDTH_STYLES[moat.moatWidth];
  const trend = TREND_LABEL[moat.moatTrend]!;

  return (
    <div className={`rounded-xl border-2 ${style.border} ${style.bg} p-5`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl">{style.emoji}</span>
            <span className={`text-lg font-bold ${style.text}`}>{style.label}</span>
            <span className={`text-xs font-medium ${trend.color}`}>{trend.label}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{moat.compositeScore}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Score / 100</div>
        </div>
      </div>

      {!moat.dataSufficient && moat.skipReason && (
        <div className="rounded-lg bg-amber-100 dark:bg-amber-900/40 border border-amber-300 p-2 text-xs text-amber-800 dark:text-amber-200 mb-3">
          ⚠️ {moat.skipReason}
        </div>
      )}

      {/* Key stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {moat.medianRNOA != null && (
          <div className="rounded-lg bg-white/70 dark:bg-slate-800/50 p-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Median RNOA</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{(moat.medianRNOA * 100).toFixed(1)}%</div>
          </div>
        )}
        {moat.medianSPREAD != null && (
          <div className="rounded-lg bg-white/70 dark:bg-slate-800/50 p-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Median SPREAD</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{(moat.medianSPREAD * 100).toFixed(1)}%</div>
          </div>
        )}
        {/* Denominator is the periods that carry a SPREAD, not every period
            analysed. Both counts come from `spreadValues`
            (moatScoring/industrial.ts:85-90), which is always shorter than
            `sorted`: the pipeline computes ratios from i > 0 only
            (pipeline.ts:285), and SPREAD is null whenever |avgNFO| <= 1
            (ratiosResidual.ts:32-33) — i.e. for debt-free companies. Dividing
            by `totalPeriods` counted unmeasured periods as periods that failed
            to clear kw. */}
        <div className="rounded-lg bg-white/70 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Periods &gt; kw</div>
          {moat.spreadMeasuredPeriods === 0 ? (
            <>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">—</div>
              <div className="text-[10px] text-slate-500">
                No SPREAD in {moat.totalPeriods} periods
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {moat.periodsAboveCostOfCapital}/{moat.spreadMeasuredPeriods}
              </div>
              <div className="text-[10px] text-slate-500">
                with SPREAD · {moat.totalPeriods} analysed
              </div>
            </>
          )}
        </div>
        <div className="rounded-lg bg-white/70 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">CAP (years)</div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {moat.cap.years != null ? `${moat.cap.years}y` : "—"}
            <span className="text-[10px] font-normal text-slate-400 ml-1">({moat.cap.confidence})</span>
          </div>
        </div>
      </div>

      {/* Dimension bars */}
      <div className="space-y-1.5">
        {moat.dimensions.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-28 text-slate-600 dark:text-slate-400 truncate">{d.name}</span>
            <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  d.score >= 70 ? "bg-emerald-500" :
                  d.score >= 40 ? "bg-blue-500" :
                  "bg-slate-400"
                }`}
                style={{ width: `${d.score}%` }}
              />
            </div>
            <span className="w-8 text-right font-mono text-slate-700 dark:text-slate-300">{d.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
