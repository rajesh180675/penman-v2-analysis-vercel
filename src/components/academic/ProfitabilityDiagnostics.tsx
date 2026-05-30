import { NP_BENCHMARKS, RecastPeriod } from "../../engine/types";
import { pct, num } from "./AcademicReport.formatters";
import { Row } from "./AcademicUi";
import type { V3Bundle } from "./AcademicReport.types";

export function ProfitabilityDiagnosticsSection(props: {
  latest: RecastPeriod;
  roce5: number | null;
  rnoa5: number | null;
  spread5: number | null;
  pm5: number | null;
  ato5: number | null;
  steadyRnoa: number | null;
  steadyAto: number | null;
  salesCagr: number | null;
  cniCagr: number | null;
}) {
  const { latest, roce5, rnoa5, spread5, pm5, ato5, steadyRnoa, steadyAto, salesCagr, cniCagr } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">3) Profitability and Growth Diagnostics</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-right">Latest</th>
                <th className="px-3 py-2 text-right">5Y Robust</th>
                <th className="px-3 py-2 text-right">N&amp;P Median</th>
                <th className="px-3 py-2 text-left">Interpretation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <Row metric="ROCE" latest={pct(latest.ratios?.ROCE)} avg5={pct(roce5)} bm={`${(NP_BENCHMARKS.ROCE!.median * 100).toFixed(1)}%`} note="Shareholder return on common equity." />
              <Row metric="RNOA" latest={pct(latest.ratios?.RNOA)} avg5={pct(rnoa5)} bm={`${(NP_BENCHMARKS.RNOA!.median * 100).toFixed(1)}%`} note="Core operating profitability net of operating liabilities." />
              <Row metric="Spread" latest={pct(latest.ratios?.SPREAD)} avg5={pct(spread5)} bm={`${(NP_BENCHMARKS.SPREAD!.median * 100).toFixed(1)}%`} note="Value creation wedge between operating return and financing cost." />
              <Row metric="PM" latest={pct(latest.ratios?.PM)} avg5={pct(pm5)} bm={`${(NP_BENCHMARKS.PM!.median * 100).toFixed(1)}%`} note="Operating margin after comprehensive classification." />
              <Row metric="ATO" latest={`${num(latest.ratios?.ATO, 2)}x`} avg5={`${num(ato5, 2)}x`} bm={`${NP_BENCHMARKS.ATO!.median.toFixed(2)}x`} note="Operating asset productivity / turnover." />
              <Row metric="Steady-state RNOA (2Y avg)" latest={pct(steadyRnoa)} avg5="—" bm={`${(NP_BENCHMARKS.RNOA!.median * 100).toFixed(1)}%`} note="Use for post-transition anchoring when NOA regime shifts." />
              <Row metric="Steady-state ATO (2Y avg)" latest={`${num(steadyAto, 2)}x`} avg5="—" bm={`${NP_BENCHMARKS.ATO!.median.toFixed(2)}x`} note="Recent capital-intensity regime productivity." />
              <Row metric="Sales CAGR" latest={pct(salesCagr)} avg5="—" bm="—" note="Top-line growth trajectory over full sample." />
              <Row metric="CNI CAGR" latest={pct(cniCagr)} avg5="—" bm="—" note="Growth in comprehensive earnings available to common." />
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">NOA-sensitive ratios (RNOA, Spread, ATO) use 5Y median to prevent denominator-driven explosions when NOA is near zero.</p>
      </section>
  );
}

export function VersionChangeLogSection({ v3Bundle }: { v3Bundle: V3Bundle | null }) {
  if (!v3Bundle?.versionChangeLog.length) return null;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">2.6A) Methodology Changes from Prior Version</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Variable</th>
                <th className="px-2 py-1 text-right">Prior</th>
                <th className="px-2 py-1 text-right">Current</th>
                <th className="px-2 py-1 text-right">Δ</th>
                <th className="px-2 py-1 text-left">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {v3Bundle.versionChangeLog.map((c, i) => (
                <tr key={`${c.variable}_${i}`}>
                  <td className="px-2 py-1">{c.variable}</td>
                  <td className="px-2 py-1 text-right">{num(c.old_value, 4)}</td>
                  <td className="px-2 py-1 text-right">{num(c.new_value, 4)}</td>
                  <td className="px-2 py-1 text-right">{pct(c.delta_pct, 1)}</td>
                  <td className="px-2 py-1 text-amber-700">{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
  );
}
