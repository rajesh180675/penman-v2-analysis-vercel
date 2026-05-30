/* ── Section 6B Per-Share (S-16.3) ───────────────────────────── */
import { Section6BResult } from "../../engine/v3Analytics";

export function Section6BPanel({ s6b }: { s6b: Section6BResult }) {
  const fmt = (v: number | null) => v != null ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : "—";
  const pctFmt = (v: number | null) => v != null ? `${(v * 100).toFixed(1)}%` : "—";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§6B Per-Share &amp; Market-Implied Checks (S-16.1–16.3)</h3>
        <p className="text-xs text-slate-500">
          {s6b.status === "empty" && "Share count unavailable from canonical data. Provide shares_outstanding in config."}
          {s6b.status === "partial" && `Shares derived: ${s6b.shares?.toLocaleString("en-IN")} Cr (${s6b.shares_source}). Provide market_price in config for full analytics.`}
          {s6b.status === "full" && `Full market-implied analytics. Shares: ${s6b.shares?.toLocaleString("en-IN")} Cr.`}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-slate-500 font-medium">Metric</th>
              <th className="px-3 py-2 text-right text-slate-500 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr><td className="px-3 py-2 text-slate-700">Shares outstanding</td><td className="px-3 py-2 text-right font-mono">{s6b.shares != null ? `${s6b.shares.toLocaleString("en-IN")} Cr` : "—"}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Share count source</td><td className="px-3 py-2 text-right text-xs text-slate-500 max-w-xs">{s6b.shares_source || "—"}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Share count confidence</td><td className="px-3 py-2 text-right"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${s6b.shares_confidence === "HIGH" ? "bg-emerald-50 text-emerald-700" : s6b.shares_confidence === "MEDIUM" ? "bg-blue-50 text-blue-700" : s6b.shares_confidence === "LOW" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{s6b.shares_confidence}</span></td></tr>
            <tr className="font-semibold bg-indigo-50"><td className="px-3 py-2 text-indigo-700">RE intrinsic per share</td><td className="px-3 py-2 text-right font-mono text-indigo-800">{fmt(s6b.intrinsic_per_share)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Market price</td><td className="px-3 py-2 text-right font-mono">{fmt(s6b.market_price)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Market capitalisation</td><td className="px-3 py-2 text-right font-mono">{s6b.market_cap != null ? `₹${s6b.market_cap.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr` : "—"}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Margin of safety</td><td className={`px-3 py-2 text-right font-mono font-semibold ${s6b.margin_of_safety != null && s6b.margin_of_safety > 0 ? "text-emerald-700" : "text-red-700"}`}>{pctFmt(s6b.margin_of_safety)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">V(primary) / Market cap</td><td className="px-3 py-2 text-right font-mono">{pctFmt(s6b.v_primary_over_mcap)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Implied terminal growth g*</td><td className="px-3 py-2 text-right font-mono">{pctFmt(s6b.implied_g)}</td></tr>
            <tr><td className="px-3 py-2 text-slate-700">Implied ke</td><td className="px-3 py-2 text-right font-mono">{pctFmt(s6b.implied_ke)}</td></tr>
          </tbody>
        </table>
      </div>

      {s6b.mos_interpretation && (
        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600">{s6b.mos_interpretation}</div>
      )}
      {s6b.implied_g_note && (
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">{s6b.implied_g_note}</div>
      )}
      {s6b.implied_ke_note && (
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">{s6b.implied_ke_note}</div>
      )}
      {s6b.dilution_note && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          <span className="font-semibold">Dilution note: </span>{s6b.dilution_note}
        </div>
      )}
      {s6b.status !== "full" && (
        <div className="bg-slate-100 rounded-lg p-3 text-xs text-slate-500">
          To complete this section, set <code className="bg-white px-1 rounded">market_price</code> in analysis configuration.
        </div>
      )}
    </div>
  );
}
