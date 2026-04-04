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
    { label: "Market freshness", current: current.marketFreshness ?? "—", previous: previous.marketFreshness ?? "—" },
    { label: "Anchor period", current: current.valuationAnchorPeriod?.slice(0, 10) ?? "—", previous: previous.valuationAnchorPeriod?.slice(0, 10) ?? "—" },
    { label: "Latest reported period", current: current.latestReportedPeriod?.slice(0, 10) ?? "—", previous: previous.latestReportedPeriod?.slice(0, 10) ?? "—" },
    { label: "Persistence score", current: current.persistenceScore != null ? `${current.persistenceScore.toFixed(0)}/100` : "—", previous: previous.persistenceScore != null ? `${previous.persistenceScore.toFixed(0)}/100` : "—" },
    { label: "Margin durability", current: current.marginDurabilityScore != null ? `${current.marginDurabilityScore.toFixed(0)}/100` : "—", previous: previous.marginDurabilityScore != null ? `${previous.marginDurabilityScore.toFixed(0)}/100` : "—" },
    { label: "WC discipline", current: current.workingCapitalDisciplineScore != null ? `${current.workingCapitalDisciplineScore.toFixed(0)}/100` : "—", previous: previous.workingCapitalDisciplineScore != null ? `${previous.workingCapitalDisciplineScore.toFixed(0)}/100` : "—" },
  ];

  const forecastDiff = [
    { label: "Persistence narrative", current: current.persistenceNarrative ?? "—", previous: previous.persistenceNarrative ?? "—" },
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
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {forecastDiff.map((row) => (
          <div key={row.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</div>
            <div className="mt-2 text-slate-800"><strong>Current:</strong> {row.current}</div>
            <div className="mt-1 text-slate-600"><strong>Previous:</strong> {row.previous}</div>
          </div>
        ))}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 md:col-span-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Forecast discipline diff</div>
          <div className="mt-2"><strong>Current:</strong></div>
          <ul className="mt-1 space-y-1">{(current.forecastDiscipline ?? []).map((item) => <li key={`c:${item}`}>• {item}</li>)}</ul>
          <div className="mt-3"><strong>Previous:</strong></div>
          <ul className="mt-1 space-y-1">{(previous.forecastDiscipline ?? []).map((item) => <li key={`p:${item}`}>• {item}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
