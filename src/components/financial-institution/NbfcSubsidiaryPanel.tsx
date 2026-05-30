import type { BankPeriodMetrics } from "../../engine/bankPipeline";
import { fmtCr } from "./financialInstitutionFormatters";

/**
 * Phase D3c — Subsidiary Breakdown Panel.
 *
 * Renders a table of subsidiary financials from the quality_indicators.json
 * sidecar (Capitaline "Subsidiaries" XLS export). Shows PAT, equity, and
 * total assets per subsidiary over time. Useful for SOTP validation.
 */
export function NbfcSubsidiaryPanel({ metrics }: { metrics: BankPeriodMetrics[] }) {
  const periodsWithSubs = metrics.filter(m =>
    m.quality?.subsidiaries && m.quality.subsidiaries.length > 0 &&
    m.quality.subsidiaries.some(s => s.name !== "No Subsidiaries")
  );

  if (periodsWithSubs.length === 0) return null;

  const allNames = new Set<string>();
  for (const m of periodsWithSubs) {
    for (const s of m.quality!.subsidiaries!) {
      if (s.name && s.name !== "No Subsidiaries") allNames.add(s.name);
    }
  }
  const subNames = [...allNames].sort();
  if (subNames.length === 0) return null;

  const latestWithSubs = periodsWithSubs[periodsWithSubs.length - 1]!;
  const latestSubs = latestWithSubs.quality!.subsidiaries!.filter(s => s.name !== "No Subsidiaries");
  const totalSubPat = latestSubs.reduce((sum, s) => sum + (s.pat_cr ?? 0), 0);
  const totalSubAssets = latestSubs.reduce((sum, s) => sum + (s.total_assets_cr ?? 0), 0);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold mb-1">Subsidiary Financials (Sidecar)</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Per-subsidiary standalone financials from Capitaline export.
          {" "}{periodsWithSubs.length} periods with data, {subNames.length} subsidiaries tracked.
        </div>
      </div>

      {/* Latest snapshot KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {latestSubs.map(sub => (
          <div key={sub.name} className="rounded border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate" title={sub.name}>
              {sub.name}
            </div>
            <div className="font-semibold text-lg">{fmtCr(sub.pat_cr ?? null)}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              PAT &middot; Assets {fmtCr(sub.total_assets_cr ?? null)}
            </div>
          </div>
        ))}
        {latestSubs.length > 1 && (
          <div className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-3">
            <div className="text-xs text-blue-600 dark:text-blue-400">Total Subsidiaries</div>
            <div className="font-semibold text-lg">{fmtCr(totalSubPat)}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              PAT &middot; Assets {fmtCr(totalSubAssets)}
            </div>
          </div>
        )}
      </div>

      {/* Historical table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="text-left py-1 px-2">Period</th>
              {subNames.map(name => (
                <th key={name} className="text-right py-1 px-2">
                  <span className="truncate block max-w-[120px]" title={name}>
                    {name.replace(/Ltd$/, "").replace(/Bajaj /, "").trim()}
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">PAT / Assets</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periodsWithSubs.slice(-8).map(m => {
              const fy = m.quality?.fiscal_label ?? m.period_end.slice(0, 4);
              const subs = m.quality!.subsidiaries!;
              return (
                <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1 px-2 font-mono">{fy}</td>
                  {subNames.map(name => {
                    const sub = subs.find(s => s.name === name);
                    return (
                      <td key={name} className="text-right py-1 px-2">
                        {sub ? (
                          <span className="font-mono">
                            {sub.pat_cr != null ? sub.pat_cr.toFixed(0) : "—"}
                            <span className="text-slate-400 mx-1">/</span>
                            {sub.total_assets_cr != null ? (sub.total_assets_cr >= 1000 ? (sub.total_assets_cr / 1000).toFixed(1) + "K" : sub.total_assets_cr.toFixed(0)) : "—"}
                          </span>
                        ) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="text-[10px] text-slate-400 mt-1">
          Values in \u20b9 Cr. PAT / Total Assets. &ldquo;K&rdquo; = thousands of Cr.
        </div>
      </div>
    </section>
  );
}
