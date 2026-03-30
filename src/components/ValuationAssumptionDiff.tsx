import { WorkspaceValuationSnapshot } from "../lib/researchWorkspace";

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

interface Props {
  current: WorkspaceValuationSnapshot | null;
  previous: WorkspaceValuationSnapshot | null;
}

export default function ValuationAssumptionDiff({ current, previous }: Props) {
  if (!current || !previous) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-bold text-slate-800">Assumption Diff</h3>
        <p className="mt-2 text-sm text-slate-500">A second saved valuation snapshot is required before the app can show what actually changed.</p>
      </div>
    );
  }

  const rows = [
    { label: "Market price", current: current.marketPrice != null ? `₹${current.marketPrice.toFixed(2)}` : "—", previous: previous.marketPrice != null ? `₹${previous.marketPrice.toFixed(2)}` : "—" },
    { label: "Signal", current: current.signalLabel, previous: previous.signalLabel },
    { label: "Stress CAGR", current: pct(current.expectedCagrStress), previous: pct(previous.expectedCagrStress) },
    { label: "Stress upside", current: pct(current.stressUpsidePct), previous: pct(previous.stressUpsidePct) },
    { label: "Required margin of safety", current: pct(current.requiredMarginOfSafetyPct), previous: pct(previous.requiredMarginOfSafetyPct) },
    { label: "Opportunity score", current: current.opportunityScore != null ? `${current.opportunityScore.toFixed(0)}/100` : "—", previous: previous.opportunityScore != null ? `${previous.opportunityScore.toFixed(0)}/100` : "—" },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-bold text-slate-800">Assumption Diff</h3>
      <p className="mt-1 text-sm text-slate-500">This prevents “same stock, different mood” analysis. The investor can see what actually changed between two stored valuation states.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Metric</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">Current</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">Previous</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="px-3 py-2 text-slate-700">{row.label}</td>
                <td className="px-3 py-2 text-right font-mono">{row.current}</td>
                <td className="px-3 py-2 text-right font-mono">{row.previous}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
