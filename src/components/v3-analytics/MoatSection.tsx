/* ── Moat Score ───────────────────────────────────────────────── */
import { MoatScoreResult, MoatDimension } from "../../engine/moatScoring";
import { pct } from "./v3Formatters";
import { MetricCard, InfoBlock, InfoRow, NullState } from "./SharedUI";

export function MoatSection({ moat }: { moat: MoatScoreResult | null }) {
  if (!moat) return <NullState message="Insufficient data for moat scoring (need ≥ 3 periods with RNOA)." />;

  const MOAT_COLORS: Record<string, string> = {
    wide: "text-emerald-700 bg-emerald-50 border-emerald-200",
    narrow: "text-blue-700 bg-blue-50 border-blue-200",
    none: "text-red-700 bg-red-50 border-red-200",
    "insufficient-data": "text-slate-500 bg-slate-50 border-slate-200",
  };
  const TREND_COLORS: Record<string, string> = {
    strengthening: "text-emerald-700",
    stable: "text-blue-700",
    eroding: "text-red-700",
    "insufficient-data": "text-slate-500",
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Economic Moat Score</h3>
        <p className="text-xs text-slate-500">Buffett/Munger moat analysis operationalized through Penman-Nissim ratios. No qualitative inputs — the numbers speak for themselves.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Composite Score"
          value={`${moat.compositeScore}/100`}
          badge={moat.moatWidth.toUpperCase()}
          color={MOAT_COLORS[moat.moatWidth]!}
        />
        <MetricCard
          label="Moat Trend"
          value={moat.moatTrend.replace("-", " ")}
          badge={
            moat.spreadMeasuredPeriods === 0
              ? `no SPREAD in ${moat.totalPeriods} periods`
              : `${moat.periodsAboveCostOfCapital}/${moat.spreadMeasuredPeriods} SPREAD periods above kw`
          }
          color={TREND_COLORS[moat.moatTrend] + " bg-slate-50"}
        />
        <MetricCard
          label="Median RNOA"
          value={moat.medianRNOA != null ? pct(moat.medianRNOA) : "—"}
          badge={`SPREAD: ${moat.medianSPREAD != null ? pct(moat.medianSPREAD) : "—"}`}
          color="text-slate-700 bg-slate-50"
        />
        <MetricCard
          label="CAP Estimate"
          value={moat.cap.years != null ? `${moat.cap.years.toFixed(1)} yrs` : "—"}
          badge={moat.cap.confidence.toUpperCase()}
          color={moat.cap.confidence === "high" ? "text-emerald-700 bg-emerald-50" : moat.cap.confidence === "medium" ? "text-amber-700 bg-amber-50" : "text-slate-500 bg-slate-50"}
        />
      </div>

      {/* CAP detail */}
      <InfoBlock title="Competitive Advantage Period (CAP)">
        <InfoRow label="Method" value={moat.cap.method} />
        <InfoRow label="AR(1) phi" value={moat.cap.phi != null ? moat.cap.phi.toFixed(3) : "—"} />
        <InfoRow label="Latest RNOA" value={moat.cap.latestRNOA != null ? pct(moat.cap.latestRNOA) : "—"} />
        <InfoRow label="Fade target (kw)" value={pct(moat.cap.kw)} />
        <InfoRow
          label="Strong SPREAD periods (>5%)"
          value={
            moat.spreadMeasuredPeriods === 0
              ? `— (no SPREAD in ${moat.totalPeriods} periods)`
              : `${moat.periodsWithStrongSpread} / ${moat.spreadMeasuredPeriods} with SPREAD`
          }
        />
      </InfoBlock>

      {/* Dimension breakdown */}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">Dimension Scores</p>
        <div className="space-y-3">
          {moat.dimensions.map((dim: MoatDimension) => (
            <div key={dim.name} className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-700">{dim.name}</span>
                <span className="text-xs font-bold text-slate-800">{dim.score.toFixed(0)}/100 <span className="text-slate-400 font-normal">(wt {(dim.weight * 100).toFixed(0)}%)</span></span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2">
                <div
                  className={`h-1.5 rounded-full ${dim.score >= 70 ? "bg-emerald-500" : dim.score >= 40 ? "bg-amber-400" : "bg-red-400"}`}
                  style={{ width: `${dim.score}%` }}
                />
              </div>
              {dim.evidence.map((e, i) => (
                <p key={i} className="text-xs text-slate-500">{e}</p>
              ))}
            </div>
          ))}
        </div>
      </div>

      {moat.notes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          {moat.notes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
        </div>
      )}
    </div>
  );
}
