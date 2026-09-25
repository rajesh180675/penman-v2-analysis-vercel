import { toPerShare } from "../../engine/shareCountTools";
import { fmt, fmtPerShare } from "./ValuationReport.formatters";
import type { ReSeriesRow } from "./ValuationReport.hooks";
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export default function ReSeriesSection({
  rows,
  sharesOut,
  barData,
}: {
  rows: ReSeriesRow[];
  sharesOut: number | null;
  barData: Array<{ period: string; phase: ReSeriesRow["phase"]; RE: number; ReOI: number }>;
}) {
  const money = (value: number) => (Number.isFinite(value)
    ? (sharesOut ? fmtPerShare(toPerShare(value, sharesOut) ?? value) : value.toLocaleString("en-IN", { maximumFractionDigits: 0 }))
    : "—");
  const residual = (value: number) => (sharesOut ? fmtPerShare(toPerShare(value, sharesOut) ?? value) : fmt(value));
  const realizedCount = rows.filter((r) => r.phase === "realized").length;
  const forecastCount = rows.length - realizedCount;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Residual Income Series</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          RE = CNI − ke×CSE₍t−1₎  |  ReOI = OI − kw×NOA₍t−1₎  |  §6.1–6.2
          {sharesOut ? ` · Rendered on a per-share basis using ${sharesOut.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr shares.` : " · Rendered in ₹ Cr until a share basis is available."}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {realizedCount} realized {realizedCount === 1 ? "year" : "years"} for context, then the {forecastCount}-year forecast
          (marked F) that the valuation discounts from the latest balance sheet.
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
              {rows.map((r) => (
                <tr key={`${r.phase}-${r.period}`} className={r.phase === "forecast" ? "bg-indigo-50/40" : "hover:bg-slate-50"}>
                  <td className="px-4 py-2 font-mono text-slate-600 text-sm">
                    {r.period.slice(0, 7)}
                    {r.phase === "forecast" ? <span className="ml-1 text-[10px] font-semibold text-indigo-500">F</span> : null}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-sm">{money(r.CNI)}</td>
                  <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{money(r.equityCharge)}</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-indigo-700 text-sm">{residual(r.RE)}</td>
                  <td className="px-4 py-2 text-right font-mono text-sm">{money(r.OI)}</td>
                  <td className="px-4 py-2 text-right font-mono text-sm text-slate-400">{money(r.operatingCharge)}</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700 text-sm">{residual(r.ReOI)}</td>
                </tr>
              ))}
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
                      <Cell
                        key={i}
                        fill={entry[key] >= 0 ? color : "#ef4444"}
                        fillOpacity={entry.phase === "forecast" ? 0.45 : 1}
                      />
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
