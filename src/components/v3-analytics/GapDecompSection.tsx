/* ── RE/ReOI Gap Decomposition §6 (S-15.2) ───────────────────── */
import { ReReOIGapDecomposition } from "../../engine/v3Analytics";

export function GapDecompSection({ gap }: { gap: ReReOIGapDecomposition }) {
  const rows = [
    { label: "Dirty surplus (PV)", value: gap.dirty_surplus },
    { label: "NFO timing", value: gap.nfo_timing },
    { label: "TV divergence (ke vs kw)", value: gap.tv_divergence },
    { label: "Explicit-period discounting", value: gap.explicit_period_discounting },
    { label: "Residual", value: gap.residual },
    { label: "Total gap", value: gap.total, bold: true },
  ];
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§6 RE ↔ ReOI Gap Decomposition (S-15.2)</h3>
        <p className="text-xs text-slate-500">Exact four-component decomposition of the V_RE − V_ReOI valuation gap.</p>
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
                <td className={`px-3 py-2 ${r.label === "Dominant driver" || r.label === gap.dominant_driver.replace(/_/g, " ") ? "text-indigo-700" : "text-slate-700"}`}>
                  {r.label}
                  {r.label.replace(/ /g, "_").toLowerCase() === gap.dominant_driver ? " ★" : ""}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.value != null ? `₹${r.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">
                  {gap.total !== 0 && r.value != null ? `${((r.value / gap.total) * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-indigo-700">Primary driver: <span className="font-bold">{gap.dominant_driver.replace(/_/g, " ")}</span></p>
        <p className="text-xs text-indigo-600 mt-1">
          Under clean surplus, V_RE ≡ V_ReOI. The gap arises from: dirty surplus (OCI bypass), NFO timing,
          different discount rates (ke vs kw) in terminal and explicit periods.
        </p>
      </div>
    </div>
  );
}
