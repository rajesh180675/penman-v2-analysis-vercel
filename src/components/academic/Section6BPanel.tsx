import { num, pct } from "./AcademicReport.formatters";
import type { Section6BLocal, V3Bundle } from "./AcademicReport.types";

export function Section6BPanel(props: {
  local6B: Section6BLocal;
  v3Bundle: V3Bundle | null;
}) {
  const { local6B, v3Bundle } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6B) Per-share and market-implied checks</h2>
        {local6B.status === "shares_unavailable" && (
          <p className="text-sm text-amber-700">Share count could not be derived from available data. Enter shares outstanding and market price to complete this section.</p>
        )}
        {local6B.status !== "shares_unavailable" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <tr><td className="px-2 py-1">RE intrinsic per share</td><td className="px-2 py-1 text-right">{`₹${num(local6B.intrinsic, 1)}`}</td></tr>
                <tr><td className="px-2 py-1">Market price</td><td className="px-2 py-1 text-right">{local6B.status === "full" ? `₹${num(local6B.marketPrice, 1)}` : "—"}</td></tr>
                <tr><td className="px-2 py-1">Margin of safety</td><td className="px-2 py-1 text-right">{pct(local6B.status === "full" ? local6B.mos : null, 1)}</td></tr>
                <tr><td className="px-2 py-1">Implied growth g*</td><td className="px-2 py-1 text-right">{pct(local6B.status === "full" ? local6B.impliedG : null, 2)}</td></tr>
                <tr><td className="px-2 py-1">Implied ke</td><td className="px-2 py-1 text-right">{pct(local6B.status === "full" ? local6B.impliedKe : null, 2)}</td></tr>
                <tr><td className="px-2 py-1">Market cap</td><td className="px-2 py-1 text-right">{local6B.status === "full" ? `₹${num(local6B.marketCap)} Cr` : "—"}</td></tr>
                <tr><td className="px-2 py-1">Shares outstanding</td><td className="px-2 py-1 text-right">{`${num(local6B.shares, 0)} Cr`}</td></tr>
                <tr><td className="px-2 py-1">Share count source</td><td className="px-2 py-1 text-right text-slate-500">{local6B.sharesSource}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {local6B.status === "market_price_required" && (
          <p className="text-xs text-amber-700 mt-3">{local6B.prompt}</p>
        )}
        {local6B.status === "full" && (
          <p className="text-xs text-slate-600 mt-2">{local6B.mos > 0.2 ? "Substantial margin of safety." : local6B.mos > 0 ? "Modest margin of safety." : "Market price exceeds intrinsic estimate."}</p>
        )}
        {v3Bundle?.shareCount?.dilution_note && (
          <p className="text-xs text-slate-500 mt-1">Dilution note: {v3Bundle.shareCount.dilution_note}</p>
        )}
      </section>
  );
}
