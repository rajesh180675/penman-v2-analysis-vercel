/* ── Capital Allocation ───────────────────────────────────────── */
import { CapAllocScoreResult, CapAllocDimension } from "../../engine/capitalAllocationScoring";
import { pct } from "./v3Formatters";
import { MetricCard, InfoBlock, InfoRow, NullState } from "./SharedUI";

export function CapitalAllocSection({ ca }: { ca: CapAllocScoreResult | null }) {
  if (!ca) return <NullState message="Insufficient data for capital allocation scoring (need ≥ 3 periods)." />;

  const GRADE_BG: Record<string, string> = {
    A: "text-emerald-700 bg-emerald-50 border-emerald-200",
    B: "text-blue-700 bg-blue-50 border-blue-200",
    C: "text-amber-700 bg-amber-50 border-amber-200",
    D: "text-red-700 bg-red-50 border-red-200",
  };
  const TREND_COLOR: Record<string, string> = {
    improving: "text-emerald-700",
    stable: "text-blue-700",
    deteriorating: "text-red-700",
    "insufficient-data": "text-slate-500",
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">Capital Allocation Quality</h3>
        <p className="text-xs text-slate-500">Scores how well management deploys retained earnings — reinvestment returns, payout discipline, buyback timing, and dilution avoidance.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Composite Score"
          value={`${ca.compositeScore}/100`}
          badge={`Grade ${ca.grade}`}
          color={GRADE_BG[ca.grade]!}
        />
        <MetricCard
          label="Trend"
          value={ca.trend.replace("-", " ")}
          badge={`${ca.totalPeriods} periods`}
          color={TREND_COLOR[ca.trend] + " bg-slate-50"}
        />
        <MetricCard
          label="Median FCF Conversion"
          value={ca.medianFCFConversion != null ? pct(ca.medianFCFConversion) : "—"}
          badge="FCF / CNI"
          color="text-slate-700 bg-slate-50"
        />
        <MetricCard
          label="Incremental ROIC"
          value={ca.medianIncrementalROIC != null ? pct(ca.medianIncrementalROIC) : "—"}
          badge="on new NOA"
          color="text-slate-700 bg-slate-50"
        />
      </div>

      <InfoBlock title="Payout & Issuance">
        <InfoRow label="Median payout ratio" value={ca.medianPayoutRatio != null ? pct(ca.medianPayoutRatio) : "—"} />
        <InfoRow label="Value-accretive buybacks" value={`${ca.buybacksValueAccretive} periods`} />
        <InfoRow label="Dilutive issuances" value={`${ca.dilutiveIssuances} periods`} />
      </InfoBlock>

      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">Dimension Scores</p>
        <div className="space-y-3">
          {ca.dimensions.map((dim: CapAllocDimension) => (
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

      {ca.notes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          {ca.notes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
        </div>
      )}
    </div>
  );
}
