/* ── Terminal Anchor §11 ──────────────────────────────────────── */
import { computeValuation } from "../../engine/PenmanNissimEngine";
import { computeAnchorTable, V3AnalyticsBundle } from "../../engine/v3Analytics";
import { pct, cr } from "./v3Formatters";

export function TerminalAnchorSection({ anchor, anchorTable, valuation, ke }: {
  anchor: V3AnalyticsBundle["anchorResult"];
  anchorTable: ReturnType<typeof computeAnchorTable>;
  valuation: ReturnType<typeof computeValuation>;
  ke: number;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§11 Terminal Value Anchoring</h3>
        <p className="text-xs text-slate-500">Anchor selection: three candidate RE values derived from the explicit series; selection driven by terminal period event flags.</p>
      </div>

      {/* Selected anchor banner */}
      <div className={`rounded-lg border p-3 text-sm ${anchor.terminal_event_flags.length === 0 ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
        <strong>Selected: {anchor.anchor_method}</strong> — RE anchor = {cr(anchor.selected_RE_anchor)}
        {anchor.terminal_event_flags.length > 0 && (
          <span className="ml-2 text-xs">({anchor.terminal_event_flags.join(", ")})</span>
        )}
      </div>

      {/* Terminal g */}
      <div className="bg-slate-50 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-600 mb-1">Terminal Growth Rate</p>
        <p className="text-lg font-bold text-slate-800">{pct(anchor.g_terminal)}</p>
        <p className="text-xs text-slate-500 mt-1">{anchor.g_source}</p>
        {anchor.g_terminal >= ke - 0.015 && (
          <p className="text-xs text-red-600 mt-1">⚠ g is close to ke ({pct(ke)}). Gordon formula becomes highly sensitive.</p>
        )}
      </div>

      {/* Anchor candidates table */}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">§12.2 Anchor Sensitivity Table</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {["Anchor", "RE Level", "V(RE, CV3)", "TV Share"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {anchorTable.map((row) => (
                <tr
                  key={row.label}
                  className={`hover:bg-slate-50 ${row.anchor === anchor.selected_RE_anchor ? "bg-indigo-50 font-semibold" : ""}`}
                >
                  <td className="px-3 py-2 text-slate-700">
                    {row.anchor === anchor.selected_RE_anchor && <span className="text-indigo-600 mr-1">→</span>}
                    {row.label}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{cr(row.anchor)}</td>
                  <td className="px-3 py-2 text-right font-mono">{cr(row.V_RE_CV3)}</td>
                  <td className="px-3 py-2 text-right">{pct(row.tv_share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Implied steady-state ROCE */}
      {valuation.CSE0 > 0 && (
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-slate-600 mb-1">§11.7 Implied Steady-State ROCE</p>
          <p className="text-xs text-slate-500">ROCE_ss = ke + RE_anchor / CSE_latest</p>
          <p className="text-base font-bold text-slate-800 mt-1">
            {pct(ke + anchor.selected_RE_anchor / Math.max(valuation.CSE0, 1))}
          </p>
        </div>
      )}
    </div>
  );
}
