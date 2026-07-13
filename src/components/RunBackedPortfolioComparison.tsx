import type { ReturnTypeOfPortfolioComparison } from "../engine/portfolioRunComparison.types";

function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }

export default function RunBackedPortfolioComparison({ comparison }: { readonly comparison: ReturnTypeOfPortfolioComparison }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="run-backed-portfolio-comparison">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-bold text-slate-800">Immutable-run portfolio comparison</h2><p className="mt-1 text-sm text-slate-500">Only policy-, schema-, date-, trust-, and range-comparable runs receive scores or allocation weights.</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${comparison.status === "comparable" ? "bg-emerald-100 text-emerald-800" : comparison.status === "guarded" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>{comparison.status}</span>
      </div>
      <p className="mt-3 text-sm text-slate-700">{comparison.summary}</p>
      <p className="mt-1 text-xs font-medium text-slate-500">Residual cash / unallocated weight: {pct(comparison.residualCashWeight)}</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b bg-slate-50 text-xs uppercase text-slate-500"><th className="px-3 py-2 text-left">Issuer / run</th><th className="px-3 py-2 text-left">Range</th><th className="px-3 py-2 text-right">Uncertainty</th><th className="px-3 py-2 text-right">Score</th><th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-left">Decision</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{comparison.rows.map((row) => <tr key={row.runId}>
          <td className="px-3 py-2"><div className="font-medium text-slate-800">{row.label}</div><div className="font-mono text-[10px] text-slate-400">{row.runId} · {row.reproducibilityHash.slice(0, 18)}…</div></td>
          <td className="px-3 py-2 font-mono text-xs">{row.lowPerShare != null ? `₹${row.lowPerShare.toFixed(2)}` : "—"} / {row.midPerShare != null ? `₹${row.midPerShare.toFixed(2)}` : "—"} / {row.highPerShare != null ? `₹${row.highPerShare.toFixed(2)}` : "—"}</td>
          <td className="px-3 py-2 text-right">{row.uncertaintyWidthRatio == null ? "—" : pct(row.uncertaintyWidthRatio)}</td><td className="px-3 py-2 text-right">{row.score == null ? "—" : row.score.toFixed(1)}</td><td className="px-3 py-2 text-right font-semibold">{pct(row.targetWeight)}</td>
          <td className="px-3 py-2 text-xs">{row.comparable ? <span className="text-emerald-700">Comparable</span> : <span className="text-rose-700">{row.exclusionCodes.join(" · ")}</span>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  );
}
