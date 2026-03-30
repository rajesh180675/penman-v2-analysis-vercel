import { rankWorkspaceCompanies } from "../engine/portfolioRanking";
import { WorkspaceCompanyRecord } from "../lib/researchWorkspace";

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

interface Props {
  companies: WorkspaceCompanyRecord[];
  activeCompanyId?: string | null;
  onSelectCompany?: (companyId: string) => void;
}

export default function WatchlistDashboard({ companies, activeCompanyId, onSelectCompany }: Props) {
  const rows = rankWorkspaceCompanies(companies);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">Watchlist Dashboard</h3>
          <p className="mt-1 text-sm text-slate-500">
            This ranks remembered companies by signal quality, expected stress CAGR, and confidence so the investor can focus on the most actionable names first.
          </p>
        </div>
        <div className="text-xs text-slate-500">{rows.length} tracked companies</div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Company</th>
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Signal</th>
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Confidence</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">Stress CAGR</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">Score</th>
              <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-500">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr
                key={row.companyId}
                className={activeCompanyId === row.companyId ? "bg-indigo-50" : ""}
              >
                <td className="px-3 py-2">
                  {onSelectCompany ? (
                    <button
                      onClick={() => onSelectCompany(row.companyId)}
                      className="font-medium text-indigo-700 hover:underline"
                    >
                      {row.label}
                    </button>
                  ) : (
                    <span className="font-medium text-slate-800">{row.label}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-700">{row.signalLabel}</td>
                <td className="px-3 py-2 text-slate-700">{row.confidence}</td>
                <td className="px-3 py-2 text-right font-mono">{pct(row.expectedCagrStress)}</td>
                <td className="px-3 py-2 text-right font-mono">{row.score.toFixed(0)}</td>
                <td className="px-3 py-2 text-right">{row.targetWeightPct != null ? `${row.targetWeightPct.toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No tracked companies yet. Load a company, run valuation, and the dashboard will start ranking opportunities.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
