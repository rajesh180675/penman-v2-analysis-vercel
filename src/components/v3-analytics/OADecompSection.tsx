/* ── OA Decomposition §3B (S-15.1) ───────────────────────────── */
import { OADecompositionResult } from "../../engine/v3Analytics";

export function OADecompSection({ decompositions }: { decompositions: OADecompositionResult[] }) {
  if (!decompositions.length) {
    return (
      <div className="text-sm text-slate-500 py-4">No OA decomposition periods selected (need ≥2 periods with structural events or terminal period).</div>
    );
  }
  const COMP_LABELS: Record<string, string> = {
    deltaPPE: "ΔPPE", deltaROU: "ΔROU", deltaInventory: "ΔInventory",
    deltaReceivables: "ΔReceivables", deltaGoodwill: "ΔGoodwill",
    deltaIntangibles: "ΔIntangibles", deltaCWIP: "ΔCWIP",
    deltaDTA: "ΔDTA", deltaOtherOA: "ΔOther OA",
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§3B OA Sub-Component Decomposition (S-15.1)</h3>
        <p className="text-xs text-slate-500">Decomposed for all structurally flagged periods and terminal period.</p>
      </div>
      {decompositions.map((d) => (
        <div key={d.period_end} className="border border-slate-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">{d.period_end.slice(0, 7)}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {Object.keys(COMP_LABELS).map((k) => (
                    <th key={k} className={`px-2 py-1 text-center font-medium ${k === "deltaOtherOA" ? "text-amber-600" : "text-slate-500"}`}>
                      {COMP_LABELS[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {Object.keys(COMP_LABELS).map((k) => {
                    const v = d.components[k as keyof typeof d.components];
                    return (
                      <td key={k} className={`px-2 py-1 text-center font-mono ${k === "deltaOtherOA" && Math.abs(v) > 500 ? "font-bold text-amber-700" : "text-slate-700"}`}>
                        {Math.abs(v) >= 1 ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "₹0"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {d.interpretation && (
            <p className="text-xs text-amber-700 mt-2 bg-amber-50 rounded px-2 py-1">{d.interpretation}</p>
          )}
        </div>
      ))}
    </div>
  );
}
