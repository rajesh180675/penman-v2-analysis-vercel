import type { FinancialInstitutionAnalysisResult } from "../engine/analysisFamily";
import type { BankValuationModelResult } from "../engine/bankValuation";
import type { BankPeriodMetrics } from "../engine/bankPipeline";
import type {
  BankAssetQualityResult,
  CapitalBufferSeverity,
  NPACyclePosition,
  TrendDirection,
} from "../engine/bankAssetQuality";
import BankHealthChart from "./charts/BankHealthChart";

interface Props {
  bankResult: FinancialInstitutionAnalysisResult;
  marketCapCr?: number | null;
}

function fmtCr(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L Cr`;
  if (Math.abs(v) >= 1000) return `₹${v.toFixed(0)} Cr`;
  return `₹${v.toFixed(2)} Cr`;
}

function fmtPct(v: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtMultiple(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}x`;
}

/** Format a percentage that's already in % units (not 0–1 scale). */
function fmtPctRaw(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

/** Severity coloring for capital buffer cells. */
function capitalToneClass(sev: CapitalBufferSeverity | null): string {
  if (sev === "breach") return "text-rose-700 dark:text-rose-300";
  if (sev === "thin") return "text-amber-700 dark:text-amber-300";
  return "";
}

/** Severity coloring for NPA cycle cells. */
function npaToneClass(pos: NPACyclePosition | null): string {
  if (pos === "rising") return "text-rose-700 dark:text-rose-300";
  if (pos === "peaking") return "text-amber-700 dark:text-amber-300";
  if (pos === "improving") return "text-emerald-700 dark:text-emerald-300";
  return "";
}

/** Trend tone for PCR / slippage / CASA. */
function trendToneClass(t: TrendDirection | null, semantic: "higher-is-good" | "lower-is-good"): string {
  if (!t) return "";
  if (t === "stable") return "";
  if (semantic === "higher-is-good") {
    return t === "improving" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300";
  }
  return t === "improving" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300";
}

/**
 * Phase K2 — NBFC-specific metrics surface.
 *
 * Renders the framing that actually applies to NBFCs (Bajaj Finance,
 * Cholamandalam, Sundaram Finance, etc.) instead of forcing them to read
 * the bank's CASA / NIM-on-earning-assets framing:
 *
 *   - Leverage (Borrowings / Equity) — the canonical NBFC gearing metric
 *   - Yield on advances — what the loan book earns
 *   - Cost of borrowings — what the funding costs
 *   - Spread — yield - cost, the NBFC equivalent of NIM
 *   - Debt mix — NCDs vs bank loans vs institutional vs other, as % of borrowings
 */
function NbfcMetricsSection({ metrics }: { metrics: BankPeriodMetrics[] }) {
  const latest = metrics[metrics.length - 1];

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold mb-1">NBFC Metrics</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Non-banking finance company framing: leverage, spread, and debt mix replace
          the bank-specific CASA / deposit-cost lens.
        </div>
      </div>

      {/* Latest snapshot ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Leverage</div>
          <div className="font-semibold text-lg">{fmtMultiple(latest.leverage)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Borrowings / Equity</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Yield on Advances</div>
          <div className="font-semibold text-lg">{fmtPct(latest.yieldOnAdvances)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Interest earned / loan book</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Cost of Borrowings</div>
          <div className="font-semibold text-lg">{fmtPct(latest.costOfBorrowings)}</div>
          <div className="text-xs text-slate-500 mt-0.5">|Interest expended| / borrowings</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Spread</div>
          <div className={`font-semibold text-lg ${latest.spread != null && latest.spread < 0 ? "text-rose-700 dark:text-rose-300" : ""}`}>
            {fmtPct(latest.spread)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Yield − cost</div>
        </div>
      </div>

      {/* Trend table ─────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="border-b border-slate-300 dark:border-slate-700">
              <th className="text-left py-1 pr-3">Period</th>
              <th className="text-right py-1 px-3">Leverage</th>
              <th className="text-right py-1 px-3">Yield</th>
              <th className="text-right py-1 px-3">Cost</th>
              <th className="text-right py-1 px-3">Spread</th>
              <th className="text-right py-1 px-3">NIM*</th>
              <th className="text-right py-1 px-3">Credit Cost</th>
              <th className="text-right py-1 px-3">ROE</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-900">
                <td className="py-1 pr-3 font-mono">{m.period_end}</td>
                <td className="text-right py-1 px-3">{fmtMultiple(m.leverage)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.yieldOnAdvances)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.costOfBorrowings)}</td>
                <td className={`text-right py-1 px-3 ${m.spread != null && m.spread < 0 ? "text-rose-700 dark:text-rose-300" : ""}`}>
                  {fmtPct(m.spread)}
                </td>
                <td className="text-right py-1 px-3">{fmtPct(m.nim)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.creditCost, 2)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.roe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          * NBFC NIM uses advances-only as the denominator (not advances + investments,
          which is the bank framing). SLR investments don't apply to NBFCs.
        </div>
      </div>

      {/* Debt mix ─────────────────────────────────────────────── */}
      {latest.debtMix && (
        <div>
          <h4 className="font-semibold text-sm mb-2">Latest Debt Mix</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <DebtMixCell label="NCDs" value={latest.debtMix.ncdShare} />
            <DebtMixCell label="Bank Loans" value={latest.debtMix.bankLoanShare} />
            <DebtMixCell label="Institutions" value={latest.debtMix.institutionLoanShare} />
            <DebtMixCell label="Others" value={latest.debtMix.otherLoanShare} />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Shares may sum to less than 100% — Capitaline doesn't separately surface
            commercial paper / FCNRB / inter-corporate borrowings. The residual is
            informational, not a parser bug.
          </div>
        </div>
      )}
    </section>
  );
}

function DebtMixCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="font-semibold text-lg">{fmtPct(value, 0)}</div>
      {value != null && (
        <div className="mt-1 h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 dark:bg-indigo-400"
            style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
          />
        </div>
      )}
    </div>
  );
}

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
function AssetQualitySection({
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

function ModelCard({ name, model, marketCap }: { name: string; model: BankValuationModelResult; marketCap: number | null | undefined }) {
  const computed = model.status === "computed";
  return (
    <div className={`rounded-lg border p-4 ${computed ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40"}`}>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="font-semibold text-sm">{name}</h4>
        <span className={`text-xs px-2 py-0.5 rounded ${computed ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"}`}>
          {computed ? "computed" : "skipped"}
        </span>
      </div>
      {computed ? (
        <>
          <div className="text-2xl font-bold mb-1">{fmtCr(model.intrinsicValue)}</div>
          {model.premiumOverMarket != null && marketCap != null && marketCap > 0 && (
            <div className={`text-sm ${model.premiumOverMarket > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
              {model.premiumOverMarket > 0 ? "+" : ""}{fmtPct(model.premiumOverMarket, 0)} vs market cap of {fmtCr(marketCap)}
            </div>
          )}
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-2">{model.reason}</div>
          {Object.keys(model.diagnostics).length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-slate-500 dark:text-slate-400">Diagnostics</summary>
              <table className="mt-1 w-full">
                <tbody>
                  {Object.entries(model.diagnostics).map(([k, v]) => (
                    <tr key={k} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="py-0.5 text-slate-600 dark:text-slate-400">{k}</td>
                      <td className="py-0.5 text-right font-mono">{v == null ? "—" : typeof v === "number" ? v.toFixed(4) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      ) : (
        <div className="text-sm text-slate-600 dark:text-slate-400 italic">{model.reason}</div>
      )}
    </div>
  );
}

export default function FinancialInstitutionReport({ bankResult, marketCapCr }: Props) {
  const valuation = bankResult.valuation;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Financial Institution Analysis</h2>
        <div className="text-sm text-slate-600 dark:text-slate-400">
          Subtype: <span className="font-mono">{bankResult.subtype}</span> · {bankResult.periods.length} periods
        </div>
      </div>

      {bankResult.bankMetrics && bankResult.bankMetrics.length >= 2 && (
        <BankHealthChart metrics={bankResult.bankMetrics} ke={null} />
      )}

      {bankResult.periods.length > 0 && (
        <section>
          <h3 className="font-semibold mb-2">Period Snapshots</h3>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-slate-300 dark:border-slate-700">
                  <th className="text-left py-1 pr-3">Period</th>
                  <th className="text-right py-1 px-3">Book Value</th>
                  <th className="text-right py-1 px-3">Earnings</th>
                  {bankResult.subtype === "nbfc" ? (
                    <th className="text-right py-1 px-3">Borrowings</th>
                  ) : (
                    <th className="text-right py-1 px-3">Deposits</th>
                  )}
                  <th className="text-right py-1 px-3">{bankResult.subtype === "nbfc" ? "Loan Book" : "Advances"}</th>
                </tr>
              </thead>
              <tbody>
                {bankResult.periods.map((p) => (
                  <tr key={p.period_end} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-1 pr-3 font-mono">{p.period_end}</td>
                    <td className="text-right py-1 px-3">{fmtCr(p.bookValue)}</td>
                    <td className="text-right py-1 px-3">{fmtCr(p.earnings)}</td>
                    <td className="text-right py-1 px-3">
                      {fmtCr(bankResult.subtype === "nbfc" ? p.borrowings : p.deposits)}
                    </td>
                    <td className="text-right py-1 px-3">{fmtCr(p.advances)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Phase K2 — NBFC-specific framing: leverage, yield/cost/spread, debt mix.
          Only rendered when subtype is NBFC and bankMetrics is present. */}
      {bankResult.subtype === "nbfc" && bankResult.bankMetrics && bankResult.bankMetrics.length > 0 && (
        <NbfcMetricsSection metrics={bankResult.bankMetrics} />
      )}

      {/* Phase B5.3 — Asset Quality (NPA, CRAR, PCR, slippage, CASA, growth).
          Renders for both bank and NBFC subtypes when bankMetrics + assetQuality
          are present. The section itself handles the no-coverage case with an
          amber reminder banner — drop a quality_indicators.json sidecar to
          populate it. */}
      {(bankResult.subtype === "bank" || bankResult.subtype === "nbfc") &&
        bankResult.bankMetrics &&
        bankResult.bankMetrics.length > 0 &&
        bankResult.assetQuality && (
          <AssetQualitySection
            metrics={bankResult.bankMetrics}
            signals={bankResult.assetQuality}
          />
        )}

      {valuation && (
        <section>
          <h3 className="font-semibold mb-2">Bank Valuation (Phase B4)</h3>
          <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Sustainable ROE</div>
              <div className="font-semibold">{fmtPct(valuation.sustainableROE)}</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Cost of Equity (ke)</div>
              <div className="font-semibold">{fmtPct(valuation.ke)}</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Terminal Growth (g)</div>
              <div className="font-semibold">{fmtPct(valuation.terminalGrowth)}</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Latest Book Value</div>
              <div className="font-semibold">{fmtCr(valuation.latestBookValue)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <ModelCard name="Justified P/B Gordon" model={valuation.justifiedPB} marketCap={marketCapCr} />
            <ModelCard name="Equity Residual Income" model={valuation.equityResidualIncome} marketCap={marketCapCr} />
            <ModelCard name="Sustainable DDM" model={valuation.sustainableDDM} marketCap={marketCapCr} />
          </div>

          {valuation.triangulatedValue != null && (
            <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50/40 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
              <div className="text-xs uppercase tracking-wide text-indigo-700 dark:text-indigo-300 mb-1">Triangulated Intrinsic Value (median)</div>
              <div className="text-3xl font-bold">{fmtCr(valuation.triangulatedValue)}</div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Median of {valuation.modelsContributing.length} model(s): {valuation.modelsContributing.join(", ")}
              </div>
              {marketCapCr != null && marketCapCr > 0 && (
                <div className={`text-sm mt-2 ${(valuation.triangulatedValue / marketCapCr - 1) > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                  {(valuation.triangulatedValue / marketCapCr - 1) > 0 ? "+" : ""}{fmtPct(valuation.triangulatedValue / marketCapCr - 1, 0)} vs market cap of {fmtCr(marketCapCr)}
                </div>
              )}
            </div>
          )}

          {valuation.modelsContributing.length === 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              No models could compute a value. Each model's reason for skipping is shown above.
            </div>
          )}
        </section>
      )}

      {!valuation && (
        <section>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Bank valuation not computed. This usually means the engine config wasn't passed to processBankData (legacy code path) or the data is empty.
          </div>
        </section>
      )}
    </div>
  );
}
