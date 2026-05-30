/* ── Sensitivity Matrix §12 ───────────────────────────────────── */
import { computeSensitivityMatrix } from "../../engine/v3Analytics";
import { pct } from "./v3Formatters";

export function SensitivitySection({ matrix, baseKe, baseG }: {
  matrix: ReturnType<typeof computeSensitivityMatrix>;
  baseKe: number;
  baseG: number;
}) {
  const keVals = Array.from(new Set(matrix.map((r) => r.ke))).sort((a, b) => a - b);
  const gVals = Array.from(new Set(matrix.map((r) => r.g))).sort((a, b) => a - b);

  const lookup = (ke: number, g: number) =>
    matrix.find((r) => Math.abs(r.ke - ke) < 0.0001 && Math.abs(r.g - g) < 0.0001)?.V_RE_CV3 ?? null;

  const allVals = matrix.map((r) => r.V_RE_CV3);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);

  const heatColor = (v: number | null) => {
    if (v == null) return "bg-slate-100";
    const t = maxV > minV ? (v - minV) / (maxV - minV) : 0.5;
    if (t > 0.75) return "bg-emerald-100 text-emerald-800";
    if (t > 0.5) return "bg-blue-100 text-blue-800";
    if (t > 0.25) return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-800";
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§12.1 RE Sensitivity Matrix</h3>
        <p className="text-xs text-slate-500">V(RE, CV3) in ₹ Cr. Rows = cost of equity (ke); columns = terminal growth (g). Base case highlighted.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-3 py-2 text-left text-slate-500 font-medium">ke \ g</th>
              {gVals.map((g) => (
                <th key={g} className={`px-3 py-2 text-center font-medium ${Math.abs(g - baseG) < 0.0001 ? "text-indigo-700 bg-indigo-50" : "text-slate-500"}`}>
                  {pct(g)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keVals.map((ke_i) => (
              <tr key={ke_i} className={Math.abs(ke_i - baseKe) < 0.0001 ? "bg-indigo-50" : "hover:bg-slate-50"}>
                <td className={`px-3 py-2 font-medium border-r border-slate-200 ${Math.abs(ke_i - baseKe) < 0.0001 ? "text-indigo-700" : "text-slate-600"}`}>
                  {pct(ke_i)}
                </td>
                {gVals.map((g_j) => {
                  const v = lookup(ke_i, g_j);
                  const isBase = Math.abs(ke_i - baseKe) < 0.0001 && Math.abs(g_j - baseG) < 0.0001;
                  return (
                    <td key={g_j} className={`px-3 py-2 text-center font-mono font-semibold ${isBase ? "ring-2 ring-indigo-400 ring-inset" : ""} ${heatColor(v)}`}>
                      {v != null ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Highlighted cell = base case. Heat: green = high, red = low relative to matrix range.</p>
    </div>
  );
}
