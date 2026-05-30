/* ── Triggers §15 ─────────────────────────────────────────────── */
import { V3AnalyticsBundle } from "../../engine/v3Analytics";
import { pct } from "./v3Formatters";

export function TriggersSection({ triggers, fadeParams }: {
  triggers: V3AnalyticsBundle["triggers"];
  fadeParams: V3AnalyticsBundle["fadeParams"];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§15.3 Monitoring Triggers</h3>
        <p className="text-xs text-slate-500">Auto-generated investment monitoring triggers derived from the analysis.</p>
      </div>

      <div className="space-y-3">
        {triggers.map((t) => (
          <div key={t.id} className="border border-slate-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-indigo-700 mb-1">{t.title}</p>
            <p className="text-sm text-slate-700">{t.body}</p>
          </div>
        ))}
      </div>

      {/* §9.1 Fade parameter estimates */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">§9.1 Fade Parameter Estimates</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {["Driver", "φ (fade)", "Target", "Source", "R²"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fadeParams.map((fp) => (
                <tr key={fp.driver} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-700">{fp.driver}</td>
                  <td className="px-3 py-2 font-mono">{fp.phi.toFixed(3)}</td>
                  <td className="px-3 py-2 font-mono">{fp.driver === "PM" || fp.driver === "ATO" ? (fp.driver === "PM" ? pct(fp.target) : fp.target.toFixed(2) + "×") : pct(fp.target)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${fp.source === "COMPANY_SPECIFIC" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                      {fp.source === "COMPANY_SPECIFIC" ? "Company AR(1)" : "N&P Default"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-500">{fp.r_squared > 0 ? fp.r_squared.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-1">Company-specific AR(1) estimation requires ≥10 periods and R² &gt; 0.30, φ in (0.50, 0.98).</p>
      </div>
    </div>
  );
}
