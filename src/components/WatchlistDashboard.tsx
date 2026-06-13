/* ================================================================
   WatchlistDashboard — workspace/universe overview

   Shows every company that has been loaded or added to the research
   workspace, with the latest analysis status, signal, and quick links.
   This is the lazy-loaded component behind the "Watchlist" tab.
================================================================ */

import type { WorkspaceCompanyRecord } from "../lib/researchWorkspace";
import { trace } from "../lib/traceLogger";

interface WatchlistDashboardProps {
  companies: WorkspaceCompanyRecord[];
  activeCompanyId: string | null;
  onSelectCompany: (companyId: string) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function signalTone(state: string | null | undefined): string {
  if (!state) return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  switch (state) {
    case "screaming-buy":
    case "high-conviction":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "interesting":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
    case "fairly-valued":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    case "expensive":
    case "bubble":
      return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
}

function statusTone(status: string | null | undefined): string {
  if (status === "production-ready") return "text-emerald-700 dark:text-emerald-300";
  if (status === "guarded") return "text-amber-700 dark:text-amber-300";
  if (status === "blocked") return "text-rose-700 dark:text-rose-300";
  return "text-slate-600 dark:text-slate-400";
}

export default function WatchlistDashboard(props: WatchlistDashboardProps) {
  const { companies, onSelectCompany } = props;

  trace("ui", "WatchlistDashboard:render", { count: companies.length });

  if (companies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="text-5xl mb-4">🗂</div>
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">Watchlist is empty</h2>
        <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
          Load a company from the Data tab or run a batch analysis of the library. Tracked companies will appear here with their latest signal and analysis status.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">Watchlist</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {companies.length} compan{companies.length === 1 ? "y" : "ies"} tracked
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60">
        <table className="min-w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900/80 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Watch level</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
              <th className="px-4 py-3 font-medium">Runs</th>
              <th className="px-4 py-3 font-medium">Analysis</th>
              <th className="px-4 py-3 font-medium">Latest signal</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {companies.map((c) => {
              const latestAnalysis = c.analysisHistory[0];
              const latestSignal = c.signalHistory[0];
              const latestValuation = c.valuations[0];
              const signalState = latestSignal?.state ?? latestValuation?.signalState ?? null;

              return (
                <tr key={c.companyId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800 dark:text-slate-200">{c.label || c.companyId}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-500">{c.issuer?.sector ?? c.issuer?.subSector ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {c.notes.watchLevel.replace(/-/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatDate(c.lastSeenAt)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.runs.length}</td>
                  <td className="px-4 py-3">
                    <span className={`font-medium capitalize ${statusTone(latestAnalysis?.analysisStatus)}`}>
                      {latestAnalysis?.analysisStatus ?? "unknown"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {signalState ? (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${signalTone(signalState)}`}>
                        {signalState.replace(/-/g, " ")}
                      </span>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        trace("ui", "WatchlistDashboard:selectCompany", { companyId: c.companyId });
                        onSelectCompany(c.companyId);
                      }}
                      className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                    >
                      Open workspace
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
