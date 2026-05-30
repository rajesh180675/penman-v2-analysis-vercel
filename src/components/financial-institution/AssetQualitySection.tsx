import type { BankPeriodMetrics } from "../../engine/bankPipeline";
import type { BankAssetQualityResult } from "../../engine/bankAssetQuality";
import { fmtPctRaw, capitalToneClass, npaToneClass, trendToneClass } from "./financialInstitutionFormatters";

/**
 * Phase B5.3 — Asset Quality surface for bank/NBFC subtypes.
 *
 * Renders the curated quality indicators (GNPA, NNPA, PCR, CRAR, Tier-1,
 * CASA, slippage, growth) plus the six derived signals from
 * computeBankAssetQuality. Every section is independently skip-with-reason:
 * a partially-curated sidecar still produces meaningful output for the
 * fields that are present.
 *
 * When NO sidecar is provided, every signal carries a skipReason and the
 * KPI grid renders "—" everywhere — the section serves as a reviewer-
 * facing reminder that asset-quality data needs hand-curation from the AR.
 */
export function AssetQualitySection({
  metrics,
  signals,
}: {
  metrics: BankPeriodMetrics[];
  signals: BankAssetQualityResult;
}) {
  const latest = metrics[metrics.length - 1];
  const latestQ = latest?.quality ?? null;
  const periodsWithQuality = metrics.filter((m) => m.quality != null).length;
  const noCoverage = periodsWithQuality === 0;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold mb-1">Asset Quality (Phase B5)</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Sourced from the bank's annual report — Capitaline's static .xls
          export does not carry NPA / CRAR / PCR / slippage / CASA. Drop a
          curated <span className="font-mono">quality_indicators.json</span>{" "}
          alongside the Capitaline files to populate this section.
        </div>
      </div>

      {noCoverage ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          No <span className="font-mono">quality_indicators.json</span> sidecar
          found for this company. Asset-quality signals (NPA cycle, PCR trend,
          capital buffer, deposit franchise, etc.) require hand-curated data
          from the AR's 10-year highlights table and MD&A prose.
        </div>
      ) : (
        <>
          {/* Latest snapshot KPI grid ───────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Gross NPA</div>
              <div className={`font-semibold text-lg ${npaToneClass(signals.npaCycle.position)}`}>
                {fmtPctRaw(latestQ?.gnpa_pct)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {signals.npaCycle.position
                  ? `cycle: ${signals.npaCycle.position}`
                  : signals.npaCycle.skipReason}
              </div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Net NPA</div>
              <div className="font-semibold text-lg">{fmtPctRaw(latestQ?.nnpa_pct)}</div>
              <div className="text-xs text-slate-500 mt-0.5">net of provisions</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">PCR</div>
              <div className={`font-semibold text-lg ${trendToneClass(signals.pcrTrend.direction, "higher-is-good")}`}>
                {fmtPctRaw(latestQ?.pcr_pct)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {signals.pcrTrend.direction ?? signals.pcrTrend.skipReason}
              </div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">CRAR</div>
              <div className={`font-semibold text-lg ${capitalToneClass(signals.capitalBuffer.severity)}`}>
                {fmtPctRaw(latestQ?.crar_pct)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {signals.capitalBuffer.severity
                  ? `${signals.capitalBuffer.severity}, T1 headroom ${signals.capitalBuffer.headroom_pp != null ? signals.capitalBuffer.headroom_pp.toFixed(1) + "pp" : "—"}`
                  : signals.capitalBuffer.skipReason}
              </div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Tier-1</div>
              <div className="font-semibold text-lg">{fmtPctRaw(latestQ?.tier1_pct)}</div>
              <div className="text-xs text-slate-500 mt-0.5">RBI floor 9.5%</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Slippage</div>
              <div className={`font-semibold text-lg ${trendToneClass(signals.slippage.direction, "lower-is-good")}`}>
                {fmtPctRaw(latestQ?.slippage_pct)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {signals.slippage.direction ?? "MD&A only"}
              </div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">CASA</div>
              <div className={`font-semibold text-lg ${trendToneClass(signals.depositFranchise.trend, "higher-is-good")}`}>
                {fmtPctRaw(latestQ?.casa_pct)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {signals.depositFranchise.level
                  ? `${signals.depositFranchise.level} franchise`
                  : signals.depositFranchise.skipReason}
              </div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Advances Growth</div>
              <div className="font-semibold text-lg">{fmtPctRaw(latestQ?.advances_growth_pct)}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {signals.loanGrowth.interpretation
                  ? `${signals.loanGrowth.interpretation} (Δ ${signals.loanGrowth.delta_pp?.toFixed(1)}pp vs ${signals.loanGrowth.system_growth_pct}% system)`
                  : signals.loanGrowth.skipReason}
              </div>
            </div>
          </div>

          {/* Severity callout banners ─────────────────────────────── */}
          <div className="space-y-2">
            {signals.capitalBuffer.severity === "breach" && (
              <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
                <span className="font-semibold">Capital breach.</span>{" "}
                Latest Tier-1 of {fmtPctRaw(signals.capitalBuffer.latest_tier1_pct)}{" "}
                is below the RBI minimum of {signals.capitalBuffer.tier1_minimum_pct}%.
                Going-concern assumption needs verification.
              </div>
            )}
            {signals.capitalBuffer.severity === "thin" && (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="font-semibold">Thin capital buffer.</span>{" "}
                Tier-1 headroom of only {signals.capitalBuffer.headroom_pp?.toFixed(1)}pp
                over the RBI minimum — limited cushion for credit-cost shocks.
              </div>
            )}
            {signals.npaCycle.position === "rising" && (
              <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
                <span className="font-semibold">Asset quality deteriorating.</span>{" "}
                GNPA rose from {signals.npaCycle.prior_gnpa_pct?.toFixed(2)}% to{" "}
                {signals.npaCycle.latest_gnpa_pct?.toFixed(2)}% over the available
                window. Stress test loan-loss provisioning assumptions.
              </div>
            )}
            {signals.pcrTrend.direction === "weakening" && (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="font-semibold">PCR weakening.</span>{" "}
                {signals.pcrTrend.summary}. Future credit costs may surprise to
                the upside.
              </div>
            )}
            {signals.depositFranchise.level === "weak" && (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <span className="font-semibold">Weak deposit franchise.</span>{" "}
                CASA of {fmtPctRaw(signals.depositFranchise.latest_casa_pct)} is
                below the Indian banking norm — cost of funds will track
                wholesale rates more than CASA peers.
              </div>
            )}
          </div>

          {/* Trend table ─────────────────────────────────────────── */}
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-slate-300 dark:border-slate-700">
                  <th className="text-left py-1 pr-3">Period</th>
                  <th className="text-right py-1 px-3">GNPA</th>
                  <th className="text-right py-1 px-3">NNPA</th>
                  <th className="text-right py-1 px-3">PCR</th>
                  <th className="text-right py-1 px-3">CRAR</th>
                  <th className="text-right py-1 px-3">Tier-1</th>
                  <th className="text-right py-1 px-3">CASA</th>
                  <th className="text-right py-1 px-3">Slippage</th>
                  <th className="text-right py-1 px-3">Adv. Growth</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const q = m.quality;
                  return (
                    <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-900">
                      <td className="py-1 pr-3 font-mono">{q?.fiscal_label ?? m.period_end}</td>
                      <td className="text-right py-1 px-3">{fmtPctRaw(q?.gnpa_pct)}</td>
                      <td className="text-right py-1 px-3">{fmtPctRaw(q?.nnpa_pct)}</td>
                      <td className="text-right py-1 px-3">{fmtPctRaw(q?.pcr_pct)}</td>
                      <td className="text-right py-1 px-3">{fmtPctRaw(q?.crar_pct)}</td>
                      <td className="text-right py-1 px-3">{fmtPctRaw(q?.tier1_pct)}</td>
                      <td className="text-right py-1 px-3">{fmtPctRaw(q?.casa_pct)}</td>
                      <td className="text-right py-1 px-3">{fmtPctRaw(q?.slippage_pct)}</td>
                      <td className="text-right py-1 px-3">{fmtPctRaw(q?.advances_growth_pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Coverage: {periodsWithQuality}/{metrics.length} periods carry curated quality data.
              Latest period field density: {(signals.coverage.latestFieldDensity * 100).toFixed(0)}%.
              Source page references on each quality record audit-trail.
            </div>
          </div>
        </>
      )}
    </section>
  );
}
