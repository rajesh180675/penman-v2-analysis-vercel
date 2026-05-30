import { computeValuation } from "../../engine/PenmanNissimEngine";
import { toPerShare } from "../../engine/shareCountTools";

export default function SensitivityGrid({
  ke, gRate, val, sharesOut, fmt
}: {
  ke: number; gRate: number;
  val: ReturnType<typeof computeValuation>;
  sharesOut: number | null;
  fmt: (n: number) => string;
}) {
  const KES = [0.08, 0.10, 0.12, 0.14, 0.16];
  const GS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07];
  const T = val.reSeries.length;
  const lastRE = T > 0 ? val.reSeries[T - 1]!.RE : 0;

  const computeV = (keV: number, gv: number): number | null => {
    if (keV - gv <= 0.001) return null;
    const cv3 = lastRE * (1 + gv) / (keV - gv);
    const disc = Math.pow(1 + keV, T);
    return val.CSE0 + val.pvRE + cv3 / disc;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">Sensitivity Grid — V_RE_CV3 (S-9.7)</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {sharesOut != null
            ? "Per-share values across ke × g using the resolved share basis. Company totals are shown below for context."
            : "₹ Cr across ke × g. Columns strictly ascending by g (S-9.7). Base highlighted."}
        </p>
      </div>
      <div className="p-6 overflow-x-auto space-y-5">
        {sharesOut != null && sharesOut > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2 uppercase">Per Share (₹) — {sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares</div>
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-left border">ke ↓ / g →</th>
                  {GS.map(gv => (
                    <th key={gv} className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-right border">{(gv * 100).toFixed(0)}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KES.map(keV => (
                  <tr key={keV}>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600 border bg-slate-50">ke={(keV * 100).toFixed(0)}%</td>
                    {GS.map(gv => {
                      const v = computeV(keV, gv);
                      const ps = toPerShare(v, sharesOut);
                      const isBase = Math.abs(keV - ke) < 0.005 && Math.abs(gv - gRate) < 0.005;
                      if (ps == null) return <td key={gv} className="px-3 py-2 text-center text-xs text-slate-400 border">—</td>;
                      return (
                        <td key={gv} className={`px-3 py-2 text-right font-mono text-xs border ${isBase ? "bg-indigo-100 font-bold text-indigo-800" : "text-slate-700"}`}>
                          ₹{ps.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2 uppercase">Value (₹ Cr)</div>
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-left border">ke ↓ / g →</th>
                {GS.map(gv => (
                  <th key={gv} className="px-3 py-2 bg-slate-100 text-xs text-slate-500 text-right border">{(gv * 100).toFixed(0)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KES.map(keV => (
                <tr key={keV}>
                  <td className="px-3 py-2 text-xs font-semibold text-slate-600 border bg-slate-50">ke={(keV * 100).toFixed(0)}%</td>
                  {GS.map(gv => {
                    const v = computeV(keV, gv);
                    const isBase = Math.abs(keV - ke) < 0.005 && Math.abs(gv - gRate) < 0.005;
                    if (v == null) return <td key={gv} className="px-3 py-2 text-center text-xs text-slate-400 border">—</td>;
                    return (
                      <td key={gv} className={`px-3 py-2 text-right font-mono text-xs border ${isBase ? "bg-indigo-100 font-bold text-indigo-800" : v > 0 ? "text-slate-700" : "text-red-500"}`}>
                        {fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
