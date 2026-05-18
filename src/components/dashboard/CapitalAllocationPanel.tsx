import type { CapAllocScoreResult, CapAllocGrade } from "../../engine/capitalAllocationScoring";

interface Props {
  result: CapAllocScoreResult | null;
  title?: string;
}

const GRADE_STYLES: Record<CapAllocGrade, { bg: string; text: string; border: string; label: string }> = {
  A: {
    bg: "bg-emerald-50 dark:bg-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-700",
    label: "Excellent",
  },
  B: {
    bg: "bg-blue-50 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-700",
    label: "Good",
  },
  C: {
    bg: "bg-amber-50 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-700",
    label: "Average",
  },
  D: {
    bg: "bg-red-50 dark:bg-red-900/30",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-300 dark:border-red-700",
    label: "Poor",
  },
};

const TREND_LABEL: Record<string, { label: string; color: string }> = {
  improving:        { label: "↗ Improving",       color: "text-emerald-600" },
  stable:           { label: "→ Stable",          color: "text-blue-600" },
  deteriorating:    { label: "↘ Deteriorating",   color: "text-red-600" },
  "insufficient-data": { label: "— Unknown",      color: "text-slate-500" },
};

function pct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export default function CapitalAllocationPanel({ result, title = "Capital Allocation" }: Props) {
  if (!result) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
        <p className="text-xs text-slate-500 mt-2">Insufficient data for capital allocation scoring.</p>
      </div>
    );
  }

  const style = GRADE_STYLES[result.grade];
  const trend = TREND_LABEL[result.trend];

  return (
    <div className={`rounded-xl border-2 ${style.border} ${style.bg} p-5`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-2xl font-bold ${style.text}`}>Grade {result.grade}</span>
            <span className={`text-sm ${style.text}`}>· {style.label}</span>
            <span className={`text-xs font-medium ${trend.color}`}>{trend.label}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{result.compositeScore}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Score / 100</div>
        </div>
      </div>

      {!result.dataSufficient && result.skipReason && (
        <div className="rounded-lg bg-amber-100 dark:bg-amber-900/40 border border-amber-300 p-2 text-xs text-amber-800 dark:text-amber-200 mb-3">
          ⚠️ {result.skipReason}
        </div>
      )}

      {/* Key stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div className="rounded-lg bg-white/70 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Median Payout</div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{pct(result.medianPayoutRatio)}</div>
        </div>
        <div className="rounded-lg bg-white/70 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">FCF Conversion</div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{pct(result.medianFCFConversion)}</div>
        </div>
        <div className="rounded-lg bg-white/70 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Incr. ROIC</div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{pct(result.medianIncrementalROIC)}</div>
        </div>
        <div className="rounded-lg bg-white/70 dark:bg-slate-800/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Buybacks Accretive</div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {result.buybacksValueAccretive}/{result.totalPeriods}
          </div>
        </div>
      </div>

      {/* Dimension bars */}
      <div className="space-y-1.5">
        {result.dimensions.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-32 text-slate-600 dark:text-slate-400 truncate">{d.name}</span>
            <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  d.score >= 75 ? "bg-emerald-500" :
                  d.score >= 50 ? "bg-blue-500" :
                  d.score >= 25 ? "bg-amber-500" :
                  "bg-red-400"
                }`}
                style={{ width: `${d.score}%` }}
              />
            </div>
            <span className="w-8 text-right font-mono text-slate-700 dark:text-slate-300">{d.score}</span>
          </div>
        ))}
      </div>

      {result.dilutiveIssuances > 0 && (
        <div className="mt-3 text-xs text-red-700 dark:text-red-300">
          ⚠ {result.dilutiveIssuances} dilutive issuance(s) detected — equity raised when SPREAD was negative.
        </div>
      )}
    </div>
  );
}
