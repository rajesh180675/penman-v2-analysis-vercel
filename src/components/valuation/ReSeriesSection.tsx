import type { RecastPeriod } from "../../engine/types";
import { computeValuation } from "../../engine/PenmanNissimEngine";
import { toPerShare } from "../../engine/shareCountTools";
import { fmt, fmtPerShare } from "./ValuationReport.formatters";
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export default function ReSeriesSection({
  val,
  data,
  sharesOut,
  ke,
  kwDerived,
  barData,
}: {
  val: ReturnType<typeof computeValuation>;
  data: RecastPeriod[];
  sharesOut: number | null;
  ke: number;
  kwDerived: number;
  barData: Array<{ period: string; RE: number; ReOI: number }>;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">Residual Income Series</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          RE = CNI − ke×CSE₍t−1₎  |  ReOI = OI − kw×NOA₍t−1₎  |  §6.1–6.2
          {sharesOut ? ` · Rendered on a per-share basis using ${sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares.` : " · Rendered in ₹ Cr until a share basis is available."}
        </p>
      </div>
      <div className="p-6">
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b">
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Period</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "CNI / share" : "CNI"}</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "ke×CSE₋₁ / share" : "ke×CSE₋₁"}</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-indigo-500 uppercase">{sharesOut ? "RE / share" : "RE"}</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "OI / share" : "OI"}</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 uppercase">{sharesOut ? "kw×NOA₋₁ / share" : "kw×NOA₋₁"}</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-emerald-500 uppercase">{sharesOut ? "ReOI / share" : "ReOI"}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {val.reSeries.map((r, i) => {
                const cur = data[i + 1];
                const prev = data[i];
                if (!cur || !prev) return null;
                const cni = toPerShare(cur.is.CNI, sharesOut) ?? cur.is.CNI;
                const equityCharge = toPerShare(ke * prev.bs.CSE, sharesOut) ?? (ke * prev.bs.CSE);
                const re = toPerShare(r.RE, sharesOut) ?? r.RE;
                const oi = toPerShare(cur.is.OI, sharesOut) ?? cur.is.OI;
                const noaCharge = toPerShare(kwDerived * prev.bs.NOA, sharesOut) ?? (kwDerived * prev.bs.NOA);
                const reoi = toPerShare(r.ReOI, sharesOut) ?? r.ReOI;
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-slate-600 text-sm">{r.period.slice(0, 7)}</td>
                    <td className="px-4 py-2 text-right font-mono text-sm">{sharesOut ? fmtPerShare(cni) : cur.is.CNI.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{sharesOut ? fmtPerShare(equityCharge) : (ke * prev.bs.CSE).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-indigo-700 text-sm">{sharesOut ? fmtPerShare(re) : fmt(r.RE)}</td>
                    <td className="px-4 py-2 text-right font-mono text-sm">{sharesOut ? fmtPerShare(oi) : cur.is.OI.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{sharesOut ? fmtPerShare(noaCharge) : (kwDerived * prev.bs.NOA).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700 text-sm">{sharesOut ? fmtPerShare(reoi) : fmt(r.ReOI)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { key: "RE" as const, label: "Residual Earnings (RE)", color: "#6366f1" },
            { key: "ReOI" as const, label: "Residual Op. Income (ReOI)", color: "#10b981" },
          ].map(({ key, label, color }) => (
            <div key={key} className="border border-slate-100 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500 mb-3 uppercase">{label} {sharesOut ? "(₹ / share)" : "(₹ Cr)"}</div>
              <ResponsiveContainer debounce={50} width="100%" height={190}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Bar dataKey={key}>
                    {barData.map((entry, i) => (
                      <Cell key={i} fill={entry[key] >= 0 ? color : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
