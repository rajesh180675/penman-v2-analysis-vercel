import type { BankPeriodMetrics } from "../../engine/bankPipeline";
import { fmtCr, fmtPct, fmtMultiple } from "./financialInstitutionFormatters";

export function InsuranceMetricsSection({ metrics }: { metrics: BankPeriodMetrics[] }) {
  const latest = metrics[metrics.length - 1]!;

  // Check if sidecar has Tier 2 metrics (e.g. solvency_ratio or embedded_value or persistency_13m)
  const hasTier2 = metrics.some(m => m.quality && (
    m.quality.solvency_ratio != null ||
    m.quality.embedded_value != null ||
    m.quality.persistency_13m != null
  ));

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold mb-1">Insurance Business Metrics</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Insurance economics: premium underwriting, claims experience, float leverage, and asset yield metrics.
        </div>
      </div>

      {/* Latest Tier-1 snapshot — 5 KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Claims Ratio</div>
          <div className="font-semibold text-lg">{fmtPct(latest.claimsRatio ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Claims Incurred / Premium</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Expense Ratio</div>
          <div className="font-semibold text-lg">{fmtPct(latest.expenseRatio ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Operating Cost / Premium</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Combined Ratio</div>
          <div className={`font-semibold text-lg ${latest.combinedRatio != null && latest.combinedRatio > 1.0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {fmtPct(latest.combinedRatio ?? null)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Claims + Expense Ratio</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Float to Equity</div>
          <div className="font-semibold text-lg">{fmtMultiple(latest.floatToEquity ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Policyholder Funds / Equity</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Premium Growth</div>
          <div className={`font-semibold text-lg ${
            latest.premiumGrowth != null && latest.premiumGrowth > 0
              ? "text-emerald-700 dark:text-emerald-300"
              : latest.premiumGrowth != null && latest.premiumGrowth < 0
              ? "text-rose-700 dark:text-rose-300"
              : ""
          }`}>
            {latest.premiumGrowth != null ? fmtPct(latest.premiumGrowth) : "—"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">YoY Premium Growth</div>
        </div>
      </div>

      {/* Historical Trend Table */}
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="border-b border-slate-300 dark:border-slate-700">
              <th className="text-left py-1 pr-3">Period</th>
              <th className="text-right py-1 px-3">Premium Earned</th>
              <th className="text-right py-1 px-3">Claims Paid</th>
              <th className="text-right py-1 px-3">Claims %</th>
              <th className="text-right py-1 px-3">OpEx %</th>
              <th className="text-right py-1 px-3">Combined %</th>
              <th className="text-right py-1 px-3">Float Leverage</th>
              <th className="text-right py-1 px-3">Investment Yield</th>
              <th className="text-right py-1 px-3">ROE</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-900">
                <td className="py-1 pr-3 font-mono">{m.period_end}</td>
                <td className="text-right py-1 px-3">{fmtCr(m.premiumEarned ?? null)}</td>
                <td className="text-right py-1 px-3">{m.claimsExpense != null ? fmtCr(Math.abs(m.claimsExpense)) : "—"}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.claimsRatio ?? null)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.expenseRatio ?? null)}</td>
                <td className={`text-right py-1 px-3 font-medium ${m.combinedRatio != null && m.combinedRatio > 1.0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {fmtPct(m.combinedRatio ?? null)}
                </td>
                <td className="text-right py-1 px-3">{fmtMultiple(m.floatToEquity ?? null)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.investmentYield ?? null)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.roe ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tier 2 Actuarial Metrics Section */}
      {hasTier2 ? (
        <div className="pt-4 space-y-3">
          <div>
            <h4 className="font-semibold text-sm mb-1">Tier-2 Regulatory & Actuarial Indicators</h4>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Sourced from sidecar Annual Report (AR) disclosures: solvency safety buffers, Embedded Value, and persistency scales.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-slate-300 dark:border-slate-700">
                  <th className="text-left py-1 pr-3">Period</th>
                  <th className="text-right py-1 px-3">Solvency Ratio</th>
                  <th className="text-right py-1 px-3">Embedded Value</th>
                  <th className="text-right py-1 px-3">Value of New Biz (VNB)</th>
                  <th className="text-right py-1 px-3">New Biz Margin (NBM)</th>
                  <th className="text-right py-1 px-3">13m Persistency</th>
                  <th className="text-right py-1 px-3">61m Persistency</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const q = m.quality;
                  if (!q) return null;
                  return (
                    <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-900">
                      <td className="py-1 pr-3 font-mono">{m.period_end}</td>
                      <td className={`text-right py-1 px-3 font-medium ${q.solvency_ratio != null && q.solvency_ratio < 1.5 ? "text-rose-600" : "text-emerald-600"}`}>
                        {q.solvency_ratio != null ? `${q.solvency_ratio.toFixed(2)}x` : "—"}
                      </td>
                      <td className="text-right py-1 px-3">{fmtCr(q.embedded_value ?? null)}</td>
                      <td className="text-right py-1 px-3">{fmtCr(q.vnb ?? null)}</td>
                      <td className="text-right py-1 px-3">{q.nbm_pct != null ? `${q.nbm_pct.toFixed(1)}%` : "—"}</td>
                      <td className="text-right py-1 px-3">{q.persistency_13m != null ? `${q.persistency_13m.toFixed(1)}%` : "—"}</td>
                      <td className="text-right py-1 px-3">{q.persistency_61m != null ? `${q.persistency_61m.toFixed(1)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-xs text-amber-800 dark:border-amber-900/30 dark:text-amber-300">
          <span className="font-semibold uppercase mr-2 text-[10px] bg-amber-200 dark:bg-amber-900/60 px-1.5 py-0.5 rounded">Tier-2 Advisory</span>
          To inspect Solvency safety buffers, Embedded Value growth, and policyholder persistency levels, drop a hand-curated <code className="font-mono bg-slate-100 dark:bg-slate-900 px-1 rounded">quality_indicators.json</code> sidecar in the company directory.
        </div>
      )}
    </section>
  );
}
