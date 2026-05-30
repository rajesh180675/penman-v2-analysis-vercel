import type { LossMakerValuationResult } from "../../engine/lossMakerValuation";

export default function LossMakerPanel({ lossMaker }: { lossMaker: LossMakerValuationResult }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">📉</span>
        <h3 className="font-semibold text-slate-800 dark:text-slate-200">Loss-Maker Valuation Anchors</h3>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${lossMaker.profitabilityPath.signal === "green" ? "bg-emerald-100 text-emerald-800" :
            lossMaker.profitabilityPath.signal === "amber" ? "bg-amber-100 text-amber-800" :
              "bg-red-100 text-red-800"
          }`}>{lossMaker.profitabilityPath.signal.toUpperCase()}</span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Earnings-based models skipped — {lossMaker.lossYears}/{lossMaker.totalYears} periods have CNI ≤ 0.
        These anchors answer: what would the company need to do to justify the current price?
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          ["Revenue", lossMaker.latestRevenueCr != null ? `₹${lossMaker.latestRevenueCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr` : "—"],
          ["YoY Growth", lossMaker.revenueGrowthYoY != null ? `${(lossMaker.revenueGrowthYoY * 100).toFixed(1)}%` : "—"],
          ["3Y CAGR", lossMaker.revenueCAGR3y != null ? `${(lossMaker.revenueCAGR3y * 100).toFixed(1)}%` : "—"],
          ["Cash Burn/yr", lossMaker.cashBurnRateCr != null ? `₹${lossMaker.cashBurnRateCr.toFixed(0)} Cr` : "Self-funding"],
        ] as [string, string][]).map(([label, val]) => (
          <div key={label} className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</div>
            <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{val}</div>
          </div>
        ))}
      </div>

      {!lossMaker.revenueMultiple.skipReason && (
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Revenue Multiple (EV/Sales)</div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Multiple: <strong>{lossMaker.revenueMultiple.multiple.toFixed(1)}x</strong> <span className="text-xs text-slate-400">({lossMaker.revenueMultiple.source})</span></span>
            <span>Implied EV: <strong>₹{lossMaker.revenueMultiple.impliedEVCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr</strong></span>
            {lossMaker.revenueMultiple.perShareValue != null && (
              <span>Per share: <strong>₹{lossMaker.revenueMultiple.perShareValue.toFixed(1)}</strong></span>
            )}
          </div>
        </div>
      )}

      {!lossMaker.reverseDCF.skipReason && lossMaker.reverseDCF.impliedSteadyStateMargin != null && (
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Reverse-DCF — What the market cap implies</div>
          <div className="flex flex-wrap gap-4 text-sm">
            {lossMaker.reverseDCF.marketCapCr != null && (
              <span>Market cap: <strong>₹{lossMaker.reverseDCF.marketCapCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr</strong></span>
            )}
            <span>Implied steady-state margin: <strong>{(lossMaker.reverseDCF.impliedSteadyStateMargin * 100).toFixed(1)}%</strong></span>
            {lossMaker.reverseDCF.impliedRevenueCAGR != null && (
              <span>Implied 5Y revenue CAGR: <strong>{(lossMaker.reverseDCF.impliedRevenueCAGR * 100).toFixed(1)}%</strong></span>
            )}
          </div>
        </div>
      )}

      <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Path to Profitability</div>
        <div className="flex flex-wrap gap-3 text-xs mb-2">
          <span className={lossMaker.profitabilityPath.highGrowth ? "text-emerald-700" : "text-slate-400"}>
            {lossMaker.profitabilityPath.highGrowth ? "✓" : "✗"} High revenue growth
          </span>
          <span className={lossMaker.profitabilityPath.improvingMargins ? "text-emerald-700" : "text-slate-400"}>
            {lossMaker.profitabilityPath.improvingMargins ? "✓" : "✗"} Improving margins
          </span>
          <span className={lossMaker.profitabilityPath.narrowingLoss ? "text-emerald-700" : "text-slate-400"}>
            {lossMaker.profitabilityPath.narrowingLoss ? "✓" : "✗"} Narrowing operating loss
          </span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">{lossMaker.profitabilityPath.summary}</p>
      </div>

      <p className="text-xs text-slate-400 italic">{lossMaker.recommendation}</p>
    </div>
  );
}
