/* ── Accruals §5A (S-15.3) ────────────────────────────────────── */
import { AccrualTableRow } from "../../engine/v3Analytics";

export function AccrualsSection({ rows }: { rows: AccrualTableRow[] }) {
  const REGIME_COLORS: Record<string, string> = {
    GROWTH_ACCRUAL: "text-blue-700 bg-blue-50",
    QUALITY_ACCRUAL: "text-red-700 bg-red-50",
    ASSET_DISPOSAL: "text-amber-700 bg-amber-50",
    CASH_GENERATION: "text-emerald-700 bg-emerald-50",
    CASH_ACCUMULATION: "text-purple-700 bg-purple-50",
    NORMAL: "text-slate-500 bg-slate-50",
  };
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§5A Accrual Regime Classification (S-15.3)</h3>
        <p className="text-xs text-slate-500">Balance sheet accrual ratios with regime context. Distinguishes growth accruals from quality concerns.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              {["Period", "BS Accrual Ratio", "Flag", "Regime", "Interpretation"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.period_end} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-slate-600">{row.period_end.slice(0, 7)}</td>
                <td className={`px-3 py-2 font-mono font-semibold ${row.bs_accrual_ratio != null && Math.abs(row.bs_accrual_ratio) > 0.10 ? "text-amber-700" : "text-slate-700"}`}>
                  {row.bs_accrual_ratio != null ? `${(row.bs_accrual_ratio * 100).toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2">{row.flag}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${REGIME_COLORS[row.regime] ?? "text-slate-500 bg-slate-50"}`}>
                    {row.regime}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{row.interpretation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">GROWTH_ACCRUAL = NOA expansion with revenue support (not a quality concern). QUALITY_ACCRUAL = elevated accruals without revenue backing (persistence risk).</p>
    </div>
  );
}
