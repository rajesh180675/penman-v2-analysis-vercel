import type { BankPeriodMetrics } from "../../engine/bankPipeline";
import { fmtPct, fmtMultiple } from "./financialInstitutionFormatters";

/**
 * Phase K2 — NBFC-specific metrics surface.
 *
 * Renders the framing that actually applies to NBFCs (Bajaj Finance,
 * Cholamandalam, Sundaram Finance, etc.) instead of forcing them to read
 * the bank's CASA / NIM-on-earning-assets framing:
 *
 *   - Leverage (Borrowings / Equity) — the canonical NBFC gearing metric
 *   - Yield on advances — what the loan book earns
 *   - Cost of borrowings — what the funding costs
 *   - Spread — yield - cost, the NBFC equivalent of NIM
 *   - Debt mix — NCDs vs bank loans vs institutional vs other, as % of borrowings
 */
export function NbfcMetricsSection({ metrics }: { metrics: BankPeriodMetrics[] }) {
  const latest = metrics[metrics.length - 1]!;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold mb-1">NBFC Metrics</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Non-banking finance company framing: leverage, spread, and debt mix replace
          the bank-specific CASA / deposit-cost lens.
        </div>
      </div>

      {/* Latest snapshot ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Leverage</div>
          <div className="font-semibold text-lg">{fmtMultiple(latest.leverage)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Borrowings / Equity</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Yield on Advances</div>
          <div className="font-semibold text-lg">{fmtPct(latest.yieldOnAdvances)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Interest earned / loan book</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Cost of Borrowings</div>
          <div className="font-semibold text-lg">{fmtPct(latest.costOfBorrowings)}</div>
          <div className="text-xs text-slate-500 mt-0.5">|Interest expended| / borrowings</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Spread</div>
          <div className={`font-semibold text-lg ${latest.spread != null && latest.spread < 0 ? "text-rose-700 dark:text-rose-300" : ""}`}>
            {fmtPct(latest.spread)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Yield − cost</div>
        </div>
      </div>

      {/* Trend table ─────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="border-b border-slate-300 dark:border-slate-700">
              <th className="text-left py-1 pr-3">Period</th>
              <th className="text-right py-1 px-3">Leverage</th>
              <th className="text-right py-1 px-3">Yield</th>
              <th className="text-right py-1 px-3">Cost</th>
              <th className="text-right py-1 px-3">Spread</th>
              <th className="text-right py-1 px-3">NIM*</th>
              <th className="text-right py-1 px-3">Credit Cost</th>
              <th className="text-right py-1 px-3">ROE</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-900">
                <td className="py-1 pr-3 font-mono">{m.period_end}</td>
                <td className="text-right py-1 px-3">{fmtMultiple(m.leverage)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.yieldOnAdvances)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.costOfBorrowings)}</td>
                <td className={`text-right py-1 px-3 ${m.spread != null && m.spread < 0 ? "text-rose-700 dark:text-rose-300" : ""}`}>
                  {fmtPct(m.spread)}
                </td>
                <td className="text-right py-1 px-3">{fmtPct(m.nim)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.creditCost, 2)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.roe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          * NBFC NIM uses advances-only as the denominator (not advances + investments,
          which is the bank framing). SLR investments don't apply to NBFCs.
        </div>
      </div>

      {/* Debt mix ─────────────────────────────────────────────── */}
      {latest.debtMix && (
        <div>
          <h4 className="font-semibold text-sm mb-2">Latest Debt Mix</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <DebtMixCell label="NCDs" value={latest.debtMix.ncdShare} />
            <DebtMixCell label="Bank Loans" value={latest.debtMix.bankLoanShare} />
            <DebtMixCell label="Institutions" value={latest.debtMix.institutionLoanShare} />
            <DebtMixCell label="Others" value={latest.debtMix.otherLoanShare} />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Shares may sum to less than 100% — Capitaline doesn't separately surface
            commercial paper / FCNRB / inter-corporate borrowings. The residual is
            informational, not a parser bug.
          </div>
        </div>
      )}
    </section>
  );
}

function DebtMixCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="font-semibold text-lg">{fmtPct(value, 0)}</div>
      {value != null && (
        <div className="mt-1 h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 dark:bg-indigo-400"
            style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}
