import { WorkspaceFilingRecord } from "../lib/researchWorkspace";

interface Props {
  filings: WorkspaceFilingRecord[];
}

export default function FilingHistoryPanel({ filings }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">Filing History</h3>
          <p className="mt-1 text-sm text-slate-500">
            Every remembered run is treated like a filing checkpoint so the investor can see which period and source the conclusion came from.
          </p>
        </div>
        <div className="text-xs text-slate-500">{filings.length} filings</div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Period</th>
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Provider</th>
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Kind</th>
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filings.map((filing) => (
              <tr key={filing.filingId}>
                <td className="px-3 py-2 text-slate-700">{filing.periodEnd?.slice(0, 10) ?? "—"}</td>
                <td className="px-3 py-2 text-slate-700">{filing.sourceProvider}</td>
                <td className="px-3 py-2 text-slate-700">{filing.filingKind}</td>
                <td className="px-3 py-2 text-slate-700">{filing.latestAnalysisStatus}</td>
              </tr>
            ))}
            {!filings.length && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No filing memory exists for this company yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
