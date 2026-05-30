import type { BankPeriodMetrics } from "../../engine/bankPipeline";
import { fmtCr, fmtPctRaw } from "./financialInstitutionFormatters";

/**
 * Phase D2 — NBFC IndAS-109 quality section.
 *
 * Renders the NBFC-specific quality lens that the bank section can't:
 * Stage 1/2/3 distribution, ECL coverage on Stage 3, AUM and AUM growth.
 * Pulled from the quality_indicators.json sidecar produced by
 * scripts/extract_nbfc_quality.py.
 */
export function NbfcQualitySection({ metrics }: { metrics: BankPeriodMetrics[] }) {
  const periodsWithNbfc = metrics.filter(m => m.quality && (
    m.quality.stage3_pct != null ||
    m.quality.aum_cr != null ||
    m.quality.ecl_coverage_pct != null
  )).length;
  if (periodsWithNbfc === 0) return null;

  // Find latest period that actually has NBFC sidecar data
  const latest = [...metrics].reverse().find(m => m.quality && (
    m.quality.stage3_pct != null || m.quality.aum_cr != null
  )) ?? metrics[metrics.length - 1];
  const latestQ = latest?.quality ?? null;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold mb-1">NBFC Asset Quality (IndAS 109)</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          ECL framework metrics from the AR — Stage 3 (credit-impaired) loans,
          ECL coverage on bad book, and AUM scale. Sourced via
          {" "}<span className="font-mono">extract_nbfc_quality.py</span>.
        </div>
      </div>

      {/* Latest snapshot KPIs ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Stage 3 Loans</div>
          <div className={`font-semibold text-lg ${latestQ?.stage3_pct != null && latestQ.stage3_pct > 3 ? "text-rose-700 dark:text-rose-300" : ""}`}>
            {fmtPctRaw(latestQ?.stage3_pct)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">credit-impaired %</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Stage 2 Loans</div>
          <div className="font-semibold text-lg">{fmtPctRaw(latestQ?.stage2_pct)}</div>
          <div className="text-xs text-slate-500 mt-0.5">significant deterioration %</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">ECL Coverage on Stage 3</div>
          <div className={`font-semibold text-lg ${latestQ?.ecl_coverage_pct != null && latestQ.ecl_coverage_pct < 50 ? "text-amber-700 dark:text-amber-300" : ""}`}>
            {fmtPctRaw(latestQ?.ecl_coverage_pct)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">impairment / gross Stage 3</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total ECL</div>
          <div className="font-semibold text-lg">{fmtPctRaw(latestQ?.total_ecl_pct)}</div>
          <div className="text-xs text-slate-500 mt-0.5">total provisions / loan book</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">AUM</div>
          <div className="font-semibold text-lg">{fmtCr(latestQ?.aum_cr ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">consolidated assets-under-management</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">AUM Growth</div>
          <div className={`font-semibold text-lg ${
            latestQ?.aum_growth_pct != null && latestQ.aum_growth_pct > 0
              ? "text-emerald-700 dark:text-emerald-300"
              : latestQ?.aum_growth_pct != null && latestQ.aum_growth_pct < 0
              ? "text-rose-700 dark:text-rose-300"
              : ""
          }`}>
            {fmtPctRaw(latestQ?.aum_growth_pct)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">YoY</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">CRAR</div>
          <div className="font-semibold text-lg">{fmtPctRaw(latestQ?.crar_pct)}</div>
          <div className="text-xs text-slate-500 mt-0.5">RBI norm 15% (NBFC)</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Tier-I</div>
          <div className="font-semibold text-lg">{fmtPctRaw(latestQ?.tier1_pct)}</div>
          <div className="text-xs text-slate-500 mt-0.5">RBI norm 10% (NBFC)</div>
        </div>
      </div>

      {/* Trend table ─────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="border-b border-slate-300 dark:border-slate-700">
              <th className="text-left py-1 pr-3">Period</th>
              <th className="text-right py-1 px-3">Stage 3 %</th>
              <th className="text-right py-1 px-3">Stage 2 %</th>
              <th className="text-right py-1 px-3">ECL Cov %</th>
              <th className="text-right py-1 px-3">Total ECL %</th>
              <th className="text-right py-1 px-3">AUM (Cr)</th>
              <th className="text-right py-1 px-3">AUM Growth</th>
              <th className="text-right py-1 px-3">CRAR</th>
              <th className="text-right py-1 px-3">Tier-I</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const q = m.quality;
              return (
                <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-1 pr-3 font-mono">{q?.fiscal_label ?? m.period_end}</td>
                  <td className="text-right py-1 px-3">{fmtPctRaw(q?.stage3_pct)}</td>
                  <td className="text-right py-1 px-3">{fmtPctRaw(q?.stage2_pct)}</td>
                  <td className="text-right py-1 px-3">{fmtPctRaw(q?.ecl_coverage_pct)}</td>
                  <td className="text-right py-1 px-3">{fmtPctRaw(q?.total_ecl_pct)}</td>
                  <td className="text-right py-1 px-3">{q?.aum_cr != null ? fmtCr(q.aum_cr) : "—"}</td>
                  <td className="text-right py-1 px-3">{fmtPctRaw(q?.aum_growth_pct)}</td>
                  <td className="text-right py-1 px-3">{fmtPctRaw(q?.crar_pct)}</td>
                  <td className="text-right py-1 px-3">{fmtPctRaw(q?.tier1_pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
