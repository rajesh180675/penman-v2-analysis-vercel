import { RecastPeriod } from "../../engine/types";
import { num, pct } from "./AcademicReport.formatters";
import type { RatioTimeline, V3Bundle } from "./AcademicReport.types";

export function CashFlowQualitySection(props: {
  latest: RecastPeriod;
  latestAccrual: number | null;
  accrual5: number | null;
  accrualDeltaReceivables: number;
  accrualDeltaInventory: number;
  accrualDeltaPayables: number;
  accrualWorkingCapitalProxy: number;
  accrualDeltaOtherOA: number;
  accrualDeltaOtherOL: number;
  accrualOtherProxy: number;
  accrualTotalProxy: number;
  cumulativeDirtySurplus: number;
  v3Bundle: V3Bundle | null;
}) {
  const {
    latest, latestAccrual, accrual5, accrualDeltaReceivables, accrualDeltaInventory,
    accrualDeltaPayables, accrualWorkingCapitalProxy, accrualDeltaOtherOA,
    accrualDeltaOtherOL, accrualOtherProxy, accrualTotalProxy, cumulativeDirtySurplus, v3Bundle,
  } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">5) Cash-Flow Quality and Clean-Surplus Diagnostics</h2>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1.5">
          <li>
            Latest accounting FCF (Eq.14) = <b>₹{num(latest.cf.FCF_accounting)} Cr</b>; cash FCF proxy (CFO-Capex) =
            <b> ₹{num(latest.cf.FCF_cash)} Cr</b>.
          </li>
          <li>
            Dividend reconciliation (Eq.15): reported d_t = <b>₹{num(latest.cf.d_t)} Cr</b> vs formula d_t =
            <b> ₹{num(latest.cf.d_t_formula)} Cr</b>; discrepancy = <b>₹{num(latest.cf.d_t_discrepancy)} Cr</b>.
          </li>
          <li>
            Accrual discipline: latest BS accrual ratio <b>{pct(latestAccrual)}</b> and 5Y average <b>{pct(accrual5)}</b>; interpret historical spikes with the NOA transition context in Sections 3A/3B.
          </li>
          <li>
            Latest accrual decomposition proxy: ΔReceivables <b>₹{num(accrualDeltaReceivables)} Cr</b>, ΔInventory <b>₹{num(accrualDeltaInventory)} Cr</b>,
            ΔPayables <b>₹{num(accrualDeltaPayables)} Cr</b>, net working-capital accrual proxy <b>₹{num(accrualWorkingCapitalProxy)} Cr</b>.
          </li>
          <li>
            Other accrual proxy: ΔOther OA <b>₹{num(accrualDeltaOtherOA)} Cr</b>, ΔOther OL <b>₹{num(accrualDeltaOtherOL)} Cr</b>,
            net other accrual proxy <b>₹{num(accrualOtherProxy)} Cr</b>; total accrual proxy <b>₹{num(accrualTotalProxy)} Cr</b>.
          </li>
          <li>
            Cumulative dirty-surplus check Σ(ΔCSE − CNI + d) = <b>₹{num(v3Bundle?.dirtySurplusFramework.cumulative ?? cumulativeDirtySurplus)} Cr</b>
            ({pct(v3Bundle?.dirtySurplusFramework.pct_cse ?? null)} of latest equity).
            {v3Bundle?.dirtySurplusFramework && (
              <> Decomposition — Structural events: <b>₹{num(v3Bundle.dirtySurplusFramework.by_category.structural_events)} Cr</b>,
              Accounting transitions: <b>₹{num(v3Bundle.dirtySurplusFramework.by_category.accounting_transitions)} Cr</b>,
              Steady-state: <b>₹{num(v3Bundle.dirtySurplusFramework.by_category.steady_state)} Cr</b>.</>
            )}
          </li>
        </ul>
      </section>
  );
}

export function AccrualTimeSeriesSection(props: {
  accrualSeries: Array<{ period: string; accrual: number | null }>;
  data: RecastPeriod[];
}) {
  const { accrualSeries, data } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">5A) Accrual-ratio time series</h2>
        <p className="text-xs text-slate-500 mb-3">This series helps separate transition-year accrual spikes from current-period earnings quality.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">BS accrual ratio</th>
                <th className="px-2 py-1 text-left">Flag</th>
                <th className="px-2 py-1 text-left">Regime</th>
                <th className="px-2 py-1 text-left">Interpretation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accrualSeries.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">{pct(row.accrual, 1)}</td>
                  <td className="px-2 py-1">{row.accrual != null && Math.abs(row.accrual) > 0.1 ? `⚠️ ${row.accrual > 0 ? ">" : "<"}10%` : "OK"}</td>
                  <td className="px-2 py-1">{data.find((d) => d.period_end === row.period)?.ratios?.accrual_regime ?? "NORMAL"}</td>
                  <td className="px-2 py-1 text-slate-600">{(() => {
                    const p = data.find((d) => d.period_end === row.period);
                    const regime = p?.ratios?.accrual_regime;
                    if (regime === "QUALITY_ACCRUAL") return "Earnings persistence concern.";
                    if (regime === "GROWTH_ACCRUAL") return "Accruals consistent with growth in operating assets.";
                    if (regime === "ASSET_DISPOSAL") return "Asset reduction / disposal period.";
                    if (row.accrual == null) return "Accrual ratio undefined.";
                    return "";
                  })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
  );
}

export function OperatingTrajectorySection({ ratioTimeline }: { ratioTimeline: RatioTimeline }) {
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">5B) Operating trajectory timeline (full sample)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">PM</th>
                <th className="px-2 py-1 text-right">ROCE</th>
                <th className="px-2 py-1 text-right">FLEV</th>
                <th className="px-2 py-1 text-right">Dividend/CNI</th>
                <th className="px-2 py-1 text-left">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ratioTimeline.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">{pct(row.PM, 1)}</td>
                  <td className="px-2 py-1 text-right">{pct(row.ROCE, 1)}</td>
                  <td className="px-2 py-1 text-right">{num(row.FLEV, 2)}x</td>
                  <td className="px-2 py-1 text-right">{pct(row.payout, 1)}</td>
                  <td className="px-2 py-1">{row.flags.length ? row.flags.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
  );
}
