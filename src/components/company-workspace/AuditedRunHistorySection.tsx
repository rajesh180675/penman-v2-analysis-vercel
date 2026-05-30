import { InspectorRunPayload, pct } from "./CompanyWorkspace.formatters";

interface Props {
  runHistory: InspectorRunPayload[];
  loadingRuns: boolean;
}

export default function AuditedRunHistorySection({ runHistory, loadingRuns }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-bold text-slate-800">Audited Run History</h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b">
              <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Run</th>
              <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Latest period</th>
              <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Signal</th>
              <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Stress CAGR</th>
              <th className="px-3 py-2 text-right text-xs uppercase text-slate-500">Health</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runHistory.map((run) => (
              <tr key={run.runId}>
                <td className="px-3 py-2 text-slate-700">{run.runId.slice(0, 8)}</td>
                <td className="px-3 py-2 text-slate-700">{run.latestAnalysisSnapshot?.latestPeriod?.slice(0, 10) ?? "—"}</td>
                <td className="px-3 py-2 text-slate-700">{run.latestValuationSignal?.label ?? run.latestValuationSignal?.state ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{pct(run.latestValuationSignal?.expectedCagrStress)}</td>
                <td className="px-3 py-2 text-right">{run.health?.severity?.toUpperCase() ?? "—"}</td>
              </tr>
            ))}
            {!runHistory.length && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  {loadingRuns ? "Loading run history..." : "No remembered audited runs for this company yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
