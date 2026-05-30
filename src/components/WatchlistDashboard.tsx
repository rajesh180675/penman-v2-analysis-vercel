import { rankWorkspaceCompanies } from "../engine/portfolioRanking";
import { WorkspaceCompanyRecord } from "../lib/researchWorkspace";
import { TrendIndicator } from "./shared/DesignSystem";

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

interface Props {
  companies: WorkspaceCompanyRecord[];
  activeCompanyId?: string | null | undefined;
  onSelectCompany?: (companyId: string) => void;
}

const SIGNAL_STYLES: Record<string, { bg: string; text: string; border: string; emoji: string; label: string }> = {
  "screaming-buy": { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-300", emoji: "🚀", label: "Screaming Buy" },
  "high-conviction": { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300", border: "border-blue-300", emoji: "✅", label: "High Conviction" },
  "buy": { bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200", emoji: "✅", label: "Buy" },
  "watch": { bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200", emoji: "👀", label: "Watch" },
  "hold": { bg: "bg-slate-50 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300", border: "border-slate-200", emoji: "→", label: "Hold" },
  "avoid": { bg: "bg-red-50 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", border: "border-red-300", emoji: "🛑", label: "Avoid" },
};

function signalStyle(signal: string | null | undefined) {
  if (!signal) return SIGNAL_STYLES.hold!;
  const key = signal.toLowerCase().replace(/\s+/g, "-");
  return SIGNAL_STYLES[key] ?? SIGNAL_STYLES.hold!;
}

function ConfidenceDots({ confidence }: { confidence: string | null | undefined }) {
  const level = confidence?.toLowerCase() === "high" ? 3 : confidence?.toLowerCase() === "medium" ? 2 : 1;
  const color = level === 3 ? "bg-emerald-500" : level === 2 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map(i => (
        <div key={i} className={`w-1.5 h-1.5 rounded-full ${i <= level ? color : "bg-slate-200 dark:bg-slate-700"}`} />
      ))}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pctVal = Math.max(0, Math.min(100, score));
  const color = pctVal >= 75 ? "bg-emerald-500" : pctVal >= 50 ? "bg-blue-500" : pctVal >= 25 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pctVal}%` }} />
      </div>
      <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 w-7 text-right">{score.toFixed(0)}</span>
    </div>
  );
}

export default function WatchlistDashboard({ companies, activeCompanyId, onSelectCompany }: Props) {
  const rows = rankWorkspaceCompanies(companies);

  // Aggregate stats
  const totalCount = rows.length;
  const buyCount = rows.filter(r => /buy|conviction/i.test(r.signalLabel ?? "")).length;
  const watchCount = rows.filter(r => /watch/i.test(r.signalLabel ?? "")).length;
  const avoidCount = rows.filter(r => /avoid/i.test(r.signalLabel ?? "")).length;
  const avgScore = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;

  return (
    <div className="space-y-4">
      {/* Aggregate KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl bg-white border border-slate-200 dark:bg-slate-900/60 dark:border-slate-700 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Tracked</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{totalCount}</div>
        </div>
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 p-3">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Buy / Conviction</div>
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{buyCount}</div>
        </div>
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 p-3">
          <div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">Watch</div>
          <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{watchCount}</div>
        </div>
        <div className="rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 p-3">
          <div className="text-[10px] uppercase tracking-wide text-red-700 dark:text-red-300">Avoid</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-300">{avoidCount}</div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 dark:bg-slate-900/60 dark:border-slate-700 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Avg Score</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{avgScore.toFixed(0)}</div>
        </div>
      </div>

      {/* Card grid (mobile) + Table (desktop) */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-900/60 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Watchlist — Ranked by Opportunity</h3>
            <p className="mt-1 text-sm text-slate-500">
              Tracked companies sorted by signal quality, stress CAGR, and confidence. Click any name to switch context.
            </p>
          </div>
        </div>

        {!rows.length ? (
          <div className="px-6 py-12 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-slate-500">
              No tracked companies yet. Load a company, run valuation, and the dashboard will start ranking opportunities.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">#</th>
                  <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Company</th>
                  <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Signal</th>
                  <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Conf.</th>
                  <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Stress CAGR</th>
                  <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Score</th>
                  <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((row, i) => {
                  const sigStyle = signalStyle(row.signalLabel);
                  const isActive = activeCompanyId === row.companyId;
                  return (
                    <tr
                      key={row.companyId}
                      className={`transition-colors ${isActive ? "bg-indigo-50 dark:bg-indigo-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}
                    >
                      <td className="px-4 py-3 text-xs font-mono text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        {onSelectCompany ? (
                          <button
                            onClick={() => onSelectCompany(row.companyId)}
                            className="font-semibold text-indigo-700 dark:text-indigo-400 hover:underline text-left"
                          >
                            {row.label}
                          </button>
                        ) : (
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{row.label}</span>
                        )}
                        {isActive && <span className="ml-2 text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 font-bold">Active</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${sigStyle.bg} ${sigStyle.text} ${sigStyle.border}`}>
                          <span>{sigStyle.emoji}</span>
                          <span>{row.signalLabel ?? sigStyle.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ConfidenceDots confidence={row.confidence} />
                          <span className="text-xs text-slate-600 dark:text-slate-400 capitalize">{row.confidence ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-mono font-bold ${
                          row.expectedCagrStress != null && row.expectedCagrStress > 0.10 ? "text-emerald-600" :
                          row.expectedCagrStress != null && row.expectedCagrStress > 0 ? "text-blue-600" :
                          row.expectedCagrStress != null && row.expectedCagrStress < 0 ? "text-red-600" :
                          "text-slate-500"
                        }`}>
                          {pct(row.expectedCagrStress)}
                        </span>
                        {row.expectedCagrStress != null && (
                          <TrendIndicator value={row.expectedCagrStress} format="pct" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBar score={row.score} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.targetWeightPct != null ? (
                          <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{row.targetWeightPct.toFixed(1)}%</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
