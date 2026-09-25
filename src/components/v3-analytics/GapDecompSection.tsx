/* ── RE/ReOI Gap Decomposition §6 (S-15.2) ───────────────────── */
import { ReReOIGapDecomposition } from "../../engine/v3Analytics";

export function GapDecompSection({ gap }: { gap: ReReOIGapDecomposition }) {
  const rows: Array<{ key: string; label: string; value: number; bold?: boolean }> = [
    { key: "anchor_book_identity", label: "Anchor book identity (B − NOA + NFO + MI)", value: gap.anchor_book_identity },
    { key: "explicit_period_discounting", label: "Explicit-period discounting", value: gap.explicit_period_discounting },
    { key: "tv_divergence", label: "TV divergence (ke vs kw)", value: gap.tv_divergence },
    { key: "residual", label: "Residual", value: gap.residual },
    { key: "total", label: "Total gap", value: gap.total, bold: true },
  ];
  const driverLabel = rows.find((r) => r.key === gap.dominant_driver)?.label ?? gap.dominant_driver.replace(/_/g, " ");
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-1">§6 RE ↔ ReOI Gap Decomposition (S-15.2)</h3>
        <p className="text-xs text-slate-500">Exact decomposition of the V_RE − V_ReOI gap for one valuation anchored at the latest balance sheet.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-slate-500 font-medium">Component</th>
              <th className="px-3 py-2 text-right text-slate-500 font-medium">₹ Crore</th>
              <th className="px-3 py-2 text-right text-slate-500 font-medium">% of total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.label} className={r.bold ? "bg-slate-50 font-semibold" : "hover:bg-slate-50"}>
                <td className={`px-3 py-2 ${r.key === gap.dominant_driver ? "text-indigo-700" : "text-slate-700"}`}>
                  {r.label}
                  {r.key === gap.dominant_driver ? " ★" : ""}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {`₹${r.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">
                  {gap.total !== 0 ? `${((r.value / gap.total) * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-indigo-700">Primary driver: <span className="font-bold">{driverLabel}</span></p>
        <p className="text-xs text-indigo-600 mt-1">
          With a closed recast and consistent discount rates, V_RE ≡ V_ReOI. The gap arises from a balance-sheet
          identity miss at the anchor, and from discounting the same forecast at ke on the equity side and kw on
          the operating side — in the explicit years and in the terminal value.
        </p>
      </div>
    </div>
  );
}
