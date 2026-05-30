import { NP_BENCHMARKS, RecastPeriod } from "../../engine/types";
import { pct, num } from "./AcademicReport.formatters";
import type { ValuationReadiness, V3Bundle, TerminalAnchor } from "./AcademicReport.types";

export function ExecutiveFindingsSection(props: {
  first: RecastPeriod;
  latest: RecastPeriod;
  salesCagr: number | null;
  cniCagr: number | null;
  cseCagr: number | null;
  roce5: number | null;
  rnoa5: number | null;
  spread5: number | null;
  steadyRnoa: number | null;
  pm5: number | null;
  ato5: number | null;
  latestAccrual: number | null;
  ccrLatest: number | null;
  ccr5: number | null;
  accrual5: number | null;
  fScore: number | null;
  mScore: number | null;
  mFlag: boolean;
  zScore: number | null;
  zZone: string;
  reoiIdentityGap: number;
  reoiIdentityGapPct: number | null;
  confidenceTier: string;
  terminalFlagCount: number;
  tvGrade: string;
  tvShare: number | null;
  valuationReadiness: ValuationReadiness;
  valuationLatest: RecastPeriod;
  v3ConfidenceScore: number | null;
  v3ConfidenceClass: string | null;
  v3TerminalAnchor: TerminalAnchor;
  v3Bundle: V3Bundle | null;
}) {
  const {
    first, latest, salesCagr, cniCagr, cseCagr, roce5, rnoa5, spread5, steadyRnoa,
    pm5, ato5, latestAccrual, ccrLatest, ccr5, accrual5, fScore, mScore, mFlag,
    zScore, zZone, reoiIdentityGap, reoiIdentityGapPct, confidenceTier, terminalFlagCount,
    tvGrade, tvShare, valuationReadiness, valuationLatest, v3ConfidenceScore,
    v3ConfidenceClass, v3TerminalAnchor, v3Bundle,
  } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">1) Executive Findings</h2>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1.5">
          <li>
            Over the sample ({first.period_end.slice(0, 4)} to {latest.period_end.slice(0, 4)}), Sales CAGR = <b>{pct(salesCagr)}</b>,
            CNI CAGR = <b>{pct(cniCagr)}</b>, and book equity CAGR = <b>{pct(cseCagr)}</b>.
          </li>
          <li>
            Five-period central-tendency profitability (median for NOA-sensitive ratios): ROCE <b>{pct(roce5)}</b>, RNOA <b>{pct(rnoa5)}</b>, Spread <b>{pct(spread5)}</b>; steady-state (latest 2y) RNOA <b>{pct(steadyRnoa)}</b>.
          </li>
          <li>
            Operations profile: PM <b>{pct(pm5)}</b> and ATO <b>{num(ato5, 2)}x</b> (median), benchmarked versus N&amp;P medians
            ({(NP_BENCHMARKS.PM!.median * 100).toFixed(1)}% and {NP_BENCHMARKS.ATO!.median.toFixed(2)}x).
          </li>
          <li>
            Earnings quality: accrual ratio (BS) latest = <b>{pct(latestAccrual)}</b>, cash conversion ratio latest = <b>{num(ccrLatest, 2)}x</b> (5Y average {num(ccr5, 2)}x); historical 5Y average accrual ({pct(accrual5)}) is transition-driven by NOA regime shifts.
          </li>
          <li>
            Quality diagnostics: Piotroski F-score <b>{fScore ?? "—"}/9</b>, Beneish M-score <b>{mScore?.toFixed(2) ?? "—"}</b>
            {mFlag ? " (watchlist)" : " (clean threshold)"}, Altman Z' <b>{zScore?.toFixed(2) ?? "—"}</b> ({zZone});
            valuation identity gap |RE−ReOI| = <b>₹{num(reoiIdentityGap)} Cr</b> ({pct(reoiIdentityGapPct)}).
          </li>
          <li>
            Valuation confidence: <b>{confidenceTier}</b> ({terminalFlagCount} terminal-period flags). Terminal-value dependence tier: <b>{tvGrade}</b> at <b>{pct(tvShare, 1)}</b>.
            {" "}Valuation status: <b>{valuationReadiness.status}</b> with anchor period <b>{valuationLatest.period_end.slice(0, 10)}</b>.
            {v3ConfidenceScore != null && (
              <> — <b>Composite Confidence: {v3ConfidenceScore.toFixed(0)}/100 ({v3ConfidenceClass})</b>
              {v3TerminalAnchor && <> | Terminal anchor: <b>{v3TerminalAnchor.label}</b> (g = {pct(v3TerminalAnchor.g_applied)})</>}</>
            )}
          </li>
        </ul>
        {v3Bundle?.crossSectionIssues?.length ? (
          <div className="mt-3 text-xs text-amber-700">
            <b>Consistency warnings:</b>
            <ul className="list-disc pl-5 mt-1">
              {v3Bundle.crossSectionIssues.map((issue, idx) => <li key={idx}>{issue}</li>)}
            </ul>
          </div>
        ) : null}
      </section>
  );
}
