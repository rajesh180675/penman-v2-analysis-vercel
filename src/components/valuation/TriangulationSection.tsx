import { computeValuation } from "../../engine/PenmanNissimEngine";
import { fmt } from "./ValuationReport.formatters";

export default function TriangulationSection({
  val,
  sharesOut,
}: {
  val: ReturnType<typeof computeValuation>;
  sharesOut: number | null;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">Valuation Triangulation (v3)</h2>
        <p className="text-xs text-slate-500 mt-0.5">Per-share value is primary. Company totals remain as context in ₹ Cr.</p>
      </div>
      <div className="p-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b">
              <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Model</th>
              <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Per Share (₹)</th>
              <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Value (₹ Cr)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              ["RE (CV3)", val.V_RE_CV3, val.perShare?.intrinsic_re_per_share ?? null],
              ["ReOI (CV03)", val.V_ReOI_CV03, val.perShare?.intrinsic_reoi_per_share ?? null],
              ["FCFF", val.fcf?.EV_FCFF != null ? (val.fcf.EV_FCFF - val.NFO_latest) : null, val.perShare?.intrinsic_fcff_per_share ?? null],
              ["FCFE", val.fcf?.V_FCFE ?? null, val.perShare?.intrinsic_fcfe_per_share ?? null],
              ["DDM", val.perShare?.intrinsic_ddm_per_share != null && sharesOut ? val.perShare.intrinsic_ddm_per_share * sharesOut : null, val.perShare?.intrinsic_ddm_per_share ?? null],
              ["AEG", val.aeg?.V_AEG ?? null, val.perShare?.intrinsic_aeg_per_share ?? null],
            ].map(([name, v, ps]) => (
              <tr key={name as string}>
                <td className="px-3 py-2 text-slate-700">{name as string}</td>
                <td className="px-3 py-2 text-right font-mono">{typeof ps === "number" ? `₹${ps.toFixed(2)}` : "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{typeof v === "number" ? `₹${fmt(v)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {val.perShare?.implied_growth_rate != null && (
          <p className="text-xs text-slate-500 mt-3">
            Reverse DCF implied growth: <b>{(val.perShare.implied_growth_rate * 100).toFixed(2)}%</b>
          </p>
        )}
      </div>
    </div>
  );
}
