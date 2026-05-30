/* ── Dirty Surplus §6 ─────────────────────────────────────────── */
import { V3AnalyticsBundle, DirtySurplusRecord } from "../../engine/v3Analytics";
import { pct, cr, DS_COLORS } from "./v3Formatters";

export function DirtySurplusSection({ ds }: { ds: V3AnalyticsBundle["dirtySurplus"] }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§6 Clean-Surplus Accounting</h3>
        <p className="text-xs text-slate-500 mb-3">Dirty surplus = ΔCSE − CNI + Dividends paid. Material values indicate capital transactions or OCI events not captured in CNI.</p>
      </div>

      {/* Summary banner */}
      <div className={`rounded-lg border p-3 text-sm ${ds.clean_surplus_compromised ? "bg-red-50 border-red-200 text-red-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
        <strong>Cumulative dirty surplus:</strong> {cr(ds.cumulative_dirty_surplus)} ({pct(ds.cum_ds_pct)} of latest equity)
        {ds.clean_surplus_compromised && " — ⚠ CLEAN SURPLUS COMPROMISED: Cumulative DS exceeds 20% of equity. RE valuation model reliability is reduced."}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              {["Period", "CSE_t", "CSE_{t-1}", "CNI", "Dividends", "Dirty Surplus", "% of CSE", "Class", "CSE_adj"].map((h) => (
                <th key={h} className="px-2 py-2 text-left text-slate-500 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ds.records.map((r: DirtySurplusRecord) => (
              <tr key={r.period_end} className="hover:bg-slate-50">
                <td className="px-2 py-1.5 font-mono">{r.period_end.slice(0, 7)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{cr(r.CSE_t)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{cr(r.CSE_t1)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{cr(r.CNI_t)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{cr(r.d_reported_t)}</td>
                <td className={`px-2 py-1.5 text-right font-mono font-semibold ${Math.abs(r.dirty_surplus) > 100 ? "text-amber-700" : "text-slate-700"}`}>
                  {cr(r.dirty_surplus)}
                </td>
                <td className="px-2 py-1.5 text-right">{pct(r.DS_pct_of_CSE)}</td>
                <td className="px-2 py-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${DS_COLORS[r.ds_class]}`}>
                    {r.ds_class}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-500">{cr(r.CSE_adj)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        CSE_adj = clean-surplus-adjusted equity enforcing CNI − dividends identity. Divergence from actual CSE accumulates as cumulative dirty surplus.
      </p>
    </div>
  );
}
