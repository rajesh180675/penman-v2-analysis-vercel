import { useState } from "react";
import type { FinancialInstitutionAnalysisResult } from "../engine/analysisFamily";
import type {
  BankValuationModelResult,
  BankScenarioCard,
  CreditCostCycleCheck,
  CrarGovernorResult,
  EclStressGovernorResult,
  SpreadCompressionCheck,
} from "../engine/bankValuation";
import type { BankPeriodMetrics } from "../engine/bankPipeline";
import type { NbfcSidecarData } from "../engine/nbfcSidecarLoader";
import type { EngineConfig } from "../engine/types";
import type {
  BankAssetQualityResult,
  CapitalBufferSeverity,
  NPACyclePosition,
  TrendDirection,
} from "../engine/bankAssetQuality";
import BankHealthChart from "./charts/BankHealthChart";
import SubsidiaryGrowthChart from "./charts/SubsidiaryGrowthChart";
import LgdStageChart from "./charts/LgdStageChart";

interface Props {
  bankResult: FinancialInstitutionAnalysisResult;
  marketCapCr?: number | null;
  /** Engine config — required for Excel export. When omitted, export button hidden. */
  config?: EngineConfig;
  /** Company label used in Cover sheet. Falls back to config.ticker. */
  companyId?: string | null;
  /** Audit run ID surfaced in Cover sheet for traceability. */
  auditRunId?: string | null;
  /** Phase D4 — LGD stage migration + RBI NHB regulatory metrics. */
  nbfcSidecar?: NbfcSidecarData | null;
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

function InsuranceMetricsSection({ metrics }: { metrics: BankPeriodMetrics[] }) {
  const latest = metrics[metrics.length - 1];

  // Check if sidecar has Tier 2 metrics (e.g. solvency_ratio or embedded_value or persistency_13m)
  const hasTier2 = metrics.some(m => m.quality && (
    m.quality.solvency_ratio != null ||
    m.quality.embedded_value != null ||
    m.quality.persistency_13m != null
  ));

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold mb-1">Insurance Business Metrics</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Insurance economics: premium underwriting, claims experience, float leverage, and asset yield metrics.
        </div>
      </div>

      {/* Latest Tier-1 snapshot — 5 KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Claims Ratio</div>
          <div className="font-semibold text-lg">{fmtPct(latest.claimsRatio ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Claims Incurred / Premium</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Expense Ratio</div>
          <div className="font-semibold text-lg">{fmtPct(latest.expenseRatio ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Operating Cost / Premium</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Combined Ratio</div>
          <div className={`font-semibold text-lg ${latest.combinedRatio != null && latest.combinedRatio > 1.0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {fmtPct(latest.combinedRatio ?? null)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Claims + Expense Ratio</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Float to Equity</div>
          <div className="font-semibold text-lg">{fmtMultiple(latest.floatToEquity ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Policyholder Funds / Equity</div>
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">Premium Growth</div>
          <div className={`font-semibold text-lg ${
            latest.premiumGrowth != null && latest.premiumGrowth > 0
              ? "text-emerald-700 dark:text-emerald-300"
              : latest.premiumGrowth != null && latest.premiumGrowth < 0
              ? "text-rose-700 dark:text-rose-300"
              : ""
          }`}>
            {latest.premiumGrowth != null ? fmtPct(latest.premiumGrowth) : "—"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">YoY Premium Growth</div>
        </div>
      </div>

      {/* Historical Trend Table */}
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="border-b border-slate-300 dark:border-slate-700">
              <th className="text-left py-1 pr-3">Period</th>
              <th className="text-right py-1 px-3">Premium Earned</th>
              <th className="text-right py-1 px-3">Claims Paid</th>
              <th className="text-right py-1 px-3">Claims %</th>
              <th className="text-right py-1 px-3">OpEx %</th>
              <th className="text-right py-1 px-3">Combined %</th>
              <th className="text-right py-1 px-3">Float Leverage</th>
              <th className="text-right py-1 px-3">Investment Yield</th>
              <th className="text-right py-1 px-3">ROE</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-900">
                <td className="py-1 pr-3 font-mono">{m.period_end}</td>
                <td className="text-right py-1 px-3">{fmtCr(m.premiumEarned ?? null)}</td>
                <td className="text-right py-1 px-3">{m.claimsExpense != null ? fmtCr(Math.abs(m.claimsExpense)) : "—"}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.claimsRatio ?? null)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.expenseRatio ?? null)}</td>
                <td className={`text-right py-1 px-3 font-medium ${m.combinedRatio != null && m.combinedRatio > 1.0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {fmtPct(m.combinedRatio ?? null)}
                </td>
                <td className="text-right py-1 px-3">{fmtMultiple(m.floatToEquity ?? null)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.investmentYield ?? null)}</td>
                <td className="text-right py-1 px-3">{fmtPct(m.roe ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tier 2 Actuarial Metrics Section */}
      {hasTier2 ? (
        <div className="pt-4 space-y-3">
          <div>
            <h4 className="font-semibold text-sm mb-1">Tier-2 Regulatory & Actuarial Indicators</h4>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Sourced from sidecar Annual Report (AR) disclosures: solvency safety buffers, Embedded Value, and persistency scales.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-slate-300 dark:border-slate-700">
                  <th className="text-left py-1 pr-3">Period</th>
                  <th className="text-right py-1 px-3">Solvency Ratio</th>
                  <th className="text-right py-1 px-3">Embedded Value</th>
                  <th className="text-right py-1 px-3">Value of New Biz (VNB)</th>
                  <th className="text-right py-1 px-3">New Biz Margin (NBM)</th>
                  <th className="text-right py-1 px-3">13m Persistency</th>
                  <th className="text-right py-1 px-3">61m Persistency</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const q = m.quality;
                  if (!q) return null;
                  return (
                    <tr key={m.period_end} className="border-b border-slate-100 dark:border-slate-900">
                      <td className="py-1 pr-3 font-mono">{m.period_end}</td>
                      <td className={`text-right py-1 px-3 font-medium ${q.solvency_ratio != null && q.solvency_ratio < 1.5 ? "text-rose-600" : "text-emerald-600"}`}>
                        {q.solvency_ratio != null ? `${q.solvency_ratio.toFixed(2)}x` : "—"}
                      </td>
                      <td className="text-right py-1 px-3">{fmtCr(q.embedded_value ?? null)}</td>
                      <td className="text-right py-1 px-3">{fmtCr(q.vnb ?? null)}</td>
                      <td className="text-right py-1 px-3">{q.nbm_pct != null ? `${q.nbm_pct.toFixed(1)}%` : "—"}</td>
                      <td className="text-right py-1 px-3">{q.persistency_13m != null ? `${q.persistency_13m.toFixed(1)}%` : "—"}</td>
                      <td className="text-right py-1 px-3">{q.persistency_61m != null ? `${q.persistency_61m.toFixed(1)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-xs text-amber-800 dark:border-amber-900/30 dark:text-amber-300">
          <span className="font-semibold uppercase mr-2 text-[10px] bg-amber-200 dark:bg-amber-900/60 px-1.5 py-0.5 rounded">Tier-2 Advisory</span>
          To inspect Solvency safety buffers, Embedded Value growth, and policyholder persistency levels, drop a hand-curated <code className="font-mono bg-slate-100 dark:bg-slate-900 px-1 rounded">quality_indicators.json</code> sidecar in the company directory.
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
 * Phase D2 — NBFC IndAS-109 quality section.
 *
 * Renders the NBFC-specific quality lens that the bank section can't:
 * Stage 1/2/3 distribution, ECL coverage on Stage 3, AUM and AUM growth.
 * Pulled from the quality_indicators.json sidecar produced by
 * scripts/extract_nbfc_quality.py.
 */
function NbfcQualitySection({ metrics }: { metrics: BankPeriodMetrics[] }) {
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

/**
 * Phase D4 — LGD Stage Migration + RBI NHB Regulatory Metrics Panel.
 *
 * Shows the ECL stage migration matrix (from LGD sidecar files) and
 * key regulatory metrics from the RBI NHB disclosure.
 */
function NbfcRegulatoryPanel({ sidecar }: { sidecar: NbfcSidecarData }) {
  const { lgd, rbiNhb } = sidecar;
  if (lgd.length === 0 && rbiNhb.length === 0) return null;

  // Latest LGD matrix
  const latestLgd = lgd.length > 0 ? lgd[lgd.length - 1] : null;

  // RBI NHB: filter to periods with actual data
  const nhbWithData = rbiNhb.filter(p =>
    (p.gnpa_cr != null && p.gnpa_cr > 0) ||
    (p.crar_pct != null && p.crar_pct > 0)
  );

  return (
    <section className="space-y-6">
      <div>
        <h3 className="font-semibold mb-1">Regulatory Disclosures (LGD + RBI NHB)</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Stage migration matrices from Capitaline &ldquo;Loss Given Default&rdquo; export
          ({lgd.length} periods) and RBI/NHB regulatory metrics ({nhbWithData.length} periods with data).
        </div>
      </div>

      {/* LGD Stage Migration — latest year */}
      {latestLgd && latestLgd.gross_carrying.closing && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            ECL Stage Migration — {latestLgd.fiscal_label} (Gross Carrying Amount, \u20b9 Cr)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="text-left py-1.5 px-2">Movement</th>
                  <th className="text-right py-1.5 px-2">Stage 1</th>
                  <th className="text-right py-1.5 px-2">Stage 2</th>
                  <th className="text-right py-1.5 px-2">Stage 3</th>
                  <th className="text-right py-1.5 px-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["Opening Balance", latestLgd.gross_carrying.opening],
                  ["New Business (net)", latestLgd.gross_carrying.new_business],
                  ["Credit Worthiness Transfer", latestLgd.gross_carrying.credit_worthiness_transfer],
                  ["Write-offs", latestLgd.gross_carrying.writeoff],
                  ["Transfer to Stage 1", latestLgd.gross_carrying.transfer_to_s1],
                  ["Transfer to Stage 2", latestLgd.gross_carrying.transfer_to_s2],
                  ["Transfer to Stage 3", latestLgd.gross_carrying.transfer_to_s3],
                  ["Closing Balance", latestLgd.gross_carrying.closing],
                ] as [string, { stage1: number | null; stage2: number | null; stage3: number | null; total: number | null } | null][]).filter(([, v]) => v != null).map(([label, vals]) => {
                  const isClosing = label === "Closing Balance" || label === "Opening Balance";
                  return (
                    <tr key={label} className={`border-b border-slate-100 dark:border-slate-800 ${isClosing ? "font-semibold bg-slate-50/50 dark:bg-slate-800/30" : ""}`}>
                      <td className="py-1 px-2">{label}</td>
                      <td className="text-right py-1 px-2 font-mono">{fmtNum(vals!.stage1)}</td>
                      <td className="text-right py-1 px-2 font-mono">{fmtNum(vals!.stage2)}</td>
                      <td className="text-right py-1 px-2 font-mono">{fmtNum(vals!.stage3)}</td>
                      <td className="text-right py-1 px-2 font-mono">{fmtNum(vals!.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* LGD trend: Stage 3 closing over time */}
          {lgd.length > 1 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Stage 3 Gross Carrying &amp; Write-offs Trend
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left py-1 px-2">FY</th>
                      <th className="text-right py-1 px-2">S3 Opening</th>
                      <th className="text-right py-1 px-2">New to S3</th>
                      <th className="text-right py-1 px-2">Write-offs</th>
                      <th className="text-right py-1 px-2">S3 Closing</th>
                      <th className="text-right py-1 px-2">Total Book</th>
                      <th className="text-right py-1 px-2">S3 %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lgd.map(m => {
                      const s3Close = m.gross_carrying.closing?.stage3 ?? null;
                      const totalClose = m.gross_carrying.closing?.total ?? null;
                      const s3Pct = s3Close != null && totalClose != null && totalClose > 0
                        ? (s3Close / totalClose * 100).toFixed(2) + "%"
                        : "\u2014";
                      return (
                        <tr key={m.fiscal_label} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-1 px-2 font-mono">{m.fiscal_label}</td>
                          <td className="text-right py-1 px-2 font-mono">{fmtNum(m.gross_carrying.opening?.stage3 ?? null)}</td>
                          <td className="text-right py-1 px-2 font-mono">{fmtNum(m.gross_carrying.transfer_to_s3?.stage3 ?? null)}</td>
                          <td className="text-right py-1 px-2 font-mono text-rose-600 dark:text-rose-400">{fmtNum(m.gross_carrying.writeoff?.stage3 ?? null)}</td>
                          <td className="text-right py-1 px-2 font-mono font-semibold">{fmtNum(s3Close)}</td>
                          <td className="text-right py-1 px-2 font-mono">{fmtNum(totalClose)}</td>
                          <td className="text-right py-1 px-2 font-mono">{s3Pct}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RBI NHB — NPA Movement + Capital Adequacy */}
      {nhbWithData.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            RBI/NHB Regulatory Metrics ({nhbWithData.length} periods)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="text-left py-1.5 px-2">Period</th>
                  <th className="text-right py-1.5 px-2">GNPA (Cr)</th>
                  <th className="text-right py-1.5 px-2">NNPA (Cr)</th>
                  <th className="text-right py-1.5 px-2">NNPA %</th>
                  <th className="text-right py-1.5 px-2">CRAR %</th>
                  <th className="text-right py-1.5 px-2">Tier-1 %</th>
                  <th className="text-right py-1.5 px-2">Provisions (Cr)</th>
                  <th className="text-right py-1.5 px-2">Additions (Cr)</th>
                </tr>
              </thead>
              <tbody>
                {nhbWithData.slice(0, 12).map(p => (
                  <tr key={p.period_code} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1 px-2 font-mono">{p.fiscal_label}</td>
                    <td className="text-right py-1 px-2 font-mono">{fmtNum(p.gnpa_cr)}</td>
                    <td className="text-right py-1 px-2 font-mono">{fmtNum(p.nnpa_cr)}</td>
                    <td className="text-right py-1 px-2 font-mono">{p.nnpa_pct != null ? p.nnpa_pct.toFixed(2) + "%" : "\u2014"}</td>
                    <td className="text-right py-1 px-2 font-mono">{p.crar_pct != null && p.crar_pct > 0 ? p.crar_pct.toFixed(2) + "%" : "\u2014"}</td>
                    <td className="text-right py-1 px-2 font-mono">{p.tier1_pct != null && p.tier1_pct > 0 ? p.tier1_pct.toFixed(2) + "%" : "\u2014"}</td>
                    <td className="text-right py-1 px-2 font-mono">{fmtNum(p.provisions_closing_cr)}</td>
                    <td className="text-right py-1 px-2 font-mono">{fmtNum(p.gnpa_additions_cr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/** Format a number with commas, or em-dash for null/zero. */
function fmtNum(v: number | null): string {
  if (v == null) return "\u2014";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1000) {
    return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }
  return v.toFixed(2);
}

/**
 * Phase D3c — Subsidiary Breakdown Panel.
 *
 * Renders a table of subsidiary financials from the quality_indicators.json
 * sidecar (Capitaline "Subsidiaries" XLS export). Shows PAT, equity, and
 * total assets per subsidiary over time. Useful for SOTP validation.
 */
function NbfcSubsidiaryPanel({ metrics }: { metrics: BankPeriodMetrics[] }) {
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

  const latestWithSubs = periodsWithSubs[periodsWithSubs.length - 1];
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
                            {sub.pat_cr != null ? sub.pat_cr.toFixed(0) : "\u2014"}
                            <span className="text-slate-400 mx-1">/</span>
                            {sub.total_assets_cr != null ? (sub.total_assets_cr >= 1000 ? (sub.total_assets_cr / 1000).toFixed(1) + "K" : sub.total_assets_cr.toFixed(0)) : "\u2014"}
                          </span>
                        ) : "\u2014"}
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

/**
 * Phase D2 — Governor & cycle diagnostic banners (NBFC-only).
 *
 * Renders amber/rose advisory banners surfacing the CRAR-buffer growth
 * governor adjustment (when the model throttled g) and the through-cycle
 * credit-cost band check (when latest is well below or above trailing
 * 7y median, suggesting under-provisioning or stress-peak).
 */
function NbfcGovernorBanners({
  crarGov,
  cycle,
  eclStressGov,
  spreadComp,
}: {
  crarGov: CrarGovernorResult | undefined;
  cycle: CreditCostCycleCheck | undefined;
  eclStressGov: EclStressGovernorResult | undefined;
  spreadComp: SpreadCompressionCheck | undefined;
}) {
  if (!crarGov && !cycle && !eclStressGov && !spreadComp) return null;
  const gShouldShow = crarGov && crarGov.status === "computed" &&
    crarGov.headroomBps != null && crarGov.headroomBps < 300;
  const cycleShouldShow = cycle && cycle.status === "computed" &&
    (cycle.severity === "under-provisioning" || cycle.severity === "stress-peak");
  if (!gShouldShow && !cycleShouldShow) return null;

  return (
    <div className="space-y-2">
      {gShouldShow && crarGov && (
        <div className={`rounded border p-3 text-sm ${
          (crarGov.headroomBps ?? 0) <= 0
            ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        }`}>
          <span className="font-semibold">CRAR-buffer governor active.</span>{" "}
          {crarGov.message}
        </div>
      )}
      {cycleShouldShow && cycle && (
        <div className={`rounded border p-3 text-sm ${
          cycle.severity === "stress-peak"
            ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        }`}>
          <span className="font-semibold">
            Credit cost {cycle.severity === "under-provisioning" ? "below trend" : "elevated"}.
          </span>{" "}
          {cycle.message}
        </div>
      )}

      {/* Phase D3 — ECL Stress Governor visual panel */}
      {eclStressGov && eclStressGov.status === "computed" && (
        <EclStressPanel ecl={eclStressGov} />
      )}

      {/* Phase D3b — Spread Compression / Cost-of-Funds Sensitivity */}
      {spreadComp && spreadComp.status === "computed" && (
        <SpreadCompressionPanel sc={spreadComp} />
      )}
    </div>
  );
}

/**
 * Phase D3 — ECL Stress Governor visual panel.
 *
 * Renders a compact stress gauge showing:
 *   - The uncovered stress % on a color-coded bar (green → amber → rose)
 *   - The fade factor applied to justified P/B
 *   - Stage 3, ECL coverage, restructured breakdown
 *   - Stage 2 watchlist advisory when elevated
 *
 * The gauge uses the same threshold bands as the governor:
 *   [0, 2%)   green  — healthy
 *   [2%, 5%)  amber  — warning
 *   [5%, 10%) rose   — distress
 *   [10%+]    red    — severe
 */
function EclStressPanel({ ecl }: { ecl: EclStressGovernorResult }) {
  const stress = ecl.uncoveredStressPct ?? 0;
  const factor = ecl.fadeFactor;

  // Color coding based on zone
  const zone = stress < 2 ? "healthy" : stress < 5 ? "warning" : stress < 10 ? "distress" : "severe";
  const zoneColors = {
    healthy:  { bar: "bg-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-800 dark:text-emerald-200", label: "Healthy" },
    warning:  { bar: "bg-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", text: "text-amber-800 dark:text-amber-200", label: "Warning" },
    distress: { bar: "bg-rose-500", bg: "bg-rose-50 dark:bg-rose-950/20", border: "border-rose-200 dark:border-rose-800", text: "text-rose-800 dark:text-rose-200", label: "Distress" },
    severe:   { bar: "bg-red-600", bg: "bg-red-50 dark:bg-red-950/20", border: "border-red-200 dark:border-red-800", text: "text-red-800 dark:text-red-200", label: "Severe" },
  };
  const c = zoneColors[zone];

  // Gauge bar width: cap at 12% for display (so even 15% doesn't overflow)
  const barPct = Math.min(stress / 12 * 100, 100);

  return (
    <div className={`rounded border p-4 ${c.border} ${c.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">ECL Stress Governor</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.bar} text-white`}>
            {c.label}
          </span>
        </div>
        {factor < 1.0 && (
          <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
            P/B fade: {(factor * 100).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Stress gauge bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
          <span>Uncovered Stress</span>
          <span className="font-mono font-semibold">{stress.toFixed(2)}%</span>
        </div>
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden relative">
          {/* Threshold markers */}
          <div className="absolute top-0 bottom-0 left-[16.7%] w-px bg-slate-400 dark:bg-slate-500 opacity-50" title="2% warning" />
          <div className="absolute top-0 bottom-0 left-[41.7%] w-px bg-slate-400 dark:bg-slate-500 opacity-50" title="5% distress" />
          <div className="absolute top-0 bottom-0 left-[83.3%] w-px bg-slate-400 dark:bg-slate-500 opacity-50" title="10% severe" />
          {/* Fill */}
          <div
            className={`h-full rounded-full transition-all ${c.bar}`}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
          <span>0%</span>
          <span>2%</span>
          <span>5%</span>
          <span>10%</span>
          <span>12%+</span>
        </div>
      </div>

      {/* Breakdown grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Stage 3</div>
          <div className="font-semibold font-mono">{ecl.latestStage3Pct != null ? ecl.latestStage3Pct.toFixed(2) + "%" : "—"}</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">ECL Coverage</div>
          <div className="font-semibold font-mono">{ecl.latestEclCoveragePct != null ? ecl.latestEclCoveragePct.toFixed(1) + "%" : "⚠️ missing"}</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Restructured</div>
          <div className="font-semibold font-mono">{ecl.latestRestructuredPct != null ? ecl.latestRestructuredPct.toFixed(2) + "%" : "—"}</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Stage 2</div>
          <div className="font-semibold font-mono">{ecl.latestStage2Pct != null ? ecl.latestStage2Pct.toFixed(2) + "%" : "—"}</div>
        </div>
      </div>

      {/* P/B fade detail (only when fade is active) */}
      {factor < 1.0 && (
        <div className="flex items-center gap-3 text-xs bg-white/60 dark:bg-slate-800/60 rounded p-2 mb-2">
          <div className="flex items-center gap-1">
            <span className="text-slate-500 dark:text-slate-400">Original P/B:</span>
            <span className="font-mono font-semibold">{ecl.originalPB.toFixed(2)}x</span>
          </div>
          <span className="text-slate-400">→</span>
          <div className="flex items-center gap-1">
            <span className="text-slate-500 dark:text-slate-400">Faded P/B:</span>
            <span className={`font-mono font-semibold ${c.text}`}>{ecl.effectivePB.toFixed(2)}x</span>
          </div>
          <span className="text-slate-400">→</span>
          <div className="flex items-center gap-1">
            <span className="text-slate-500 dark:text-slate-400">Factor:</span>
            <span className="font-mono font-semibold">{(factor * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* Stage 2 watchlist advisory */}
      {ecl.latestStage2Pct != null && ecl.latestStage2Pct > 3.0 && (
        <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
          ⚠️ Stage 2 watchlist at {ecl.latestStage2Pct.toFixed(1)}% — elevated migration risk to Stage 3.
        </div>
      )}
    </div>
  );
}

/**
 * Phase D3b — Spread Compression / Cost-of-Funds Sensitivity panel.
 *
 * Shows:
 *   - Current spread vs trailing median (compression gauge)
 *   - Cost-of-borrowings trend (rising/stable/falling)
 *   - Stress scenarios: ROA under +150bps and +250bps CoB shocks
 *   - Visual comparison bar: current ROA vs stressed ROA
 */
function SpreadCompressionPanel({ sc }: { sc: SpreadCompressionCheck }) {
  const spreadBps = sc.latestSpread != null ? (sc.latestSpread * 10000).toFixed(0) : "—";
  const medianBps = sc.medianSpread != null ? (sc.medianSpread * 10000).toFixed(0) : "—";
  const cobPct = sc.latestCostOfBorrowings != null ? (sc.latestCostOfBorrowings * 100).toFixed(2) : "—";
  const yieldPct = sc.latestYieldOnAdvances != null ? (sc.latestYieldOnAdvances * 100).toFixed(2) : "—";

  const zoneColors = {
    compressed: { bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", badge: "bg-amber-500", label: "Compressed" },
    normal:     { bg: "bg-slate-50 dark:bg-slate-900/20", border: "border-slate-200 dark:border-slate-700", badge: "bg-slate-500", label: "Normal" },
    expanding:  { bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", badge: "bg-emerald-500", label: "Expanding" },
    unknown:    { bg: "bg-slate-50 dark:bg-slate-900/20", border: "border-slate-200 dark:border-slate-700", badge: "bg-slate-400", label: "Unknown" },
  };
  const c = zoneColors[sc.severity];

  // ROA bar widths (scale: 0-5% ROA maps to 0-100% width)
  const roaScale = (v: number | null) => v != null ? Math.max(0, Math.min(100, (v / 0.05) * 100)) : 0;

  return (
    <div className={`rounded border p-4 ${c.border} ${c.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Cost-of-Funds Sensitivity</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.badge} text-white`}>
            {c.label}
          </span>
        </div>
        {sc.cobTrendBps != null && (
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
            sc.cobTrendBps > 20 ? "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300" :
            sc.cobTrendBps < -20 ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" :
            "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}>
            CoB {sc.cobTrendBps > 0 ? "+" : ""}{sc.cobTrendBps.toFixed(0)}bps YoY
          </span>
        )}
      </div>

      {/* Spread metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Yield</div>
          <div className="font-semibold font-mono">{yieldPct}%</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Cost of Borrowings</div>
          <div className="font-semibold font-mono">{cobPct}%</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">Spread</div>
          <div className="font-semibold font-mono">{spreadBps}bps</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-800/60 rounded p-2">
          <div className="text-slate-500 dark:text-slate-400">vs Median</div>
          <div className="font-semibold font-mono">{medianBps}bps</div>
        </div>
      </div>

      {/* ROA stress scenario bars */}
      {sc.currentROA != null && (
        <div className="space-y-1.5 mb-2">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">ROA Stress Scenarios</div>
          {/* Current ROA */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] w-16 text-right text-slate-500">Current</span>
            <div className="flex-1 h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${roaScale(sc.currentROA)}%` }} />
            </div>
            <span className="text-[10px] w-12 font-mono">{(sc.currentROA * 100).toFixed(2)}%</span>
          </div>
          {/* +150bps stress */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] w-16 text-right text-slate-500">+150bps</span>
            <div className="flex-1 h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${
                sc.stressedROA_150bps != null && sc.stressedROA_150bps < 0.01 ? "bg-rose-500" : "bg-amber-500"
              }`} style={{ width: `${roaScale(sc.stressedROA_150bps)}%` }} />
            </div>
            <span className="text-[10px] w-12 font-mono">{sc.stressedROA_150bps != null ? (sc.stressedROA_150bps * 100).toFixed(2) + "%" : "—"}</span>
          </div>
          {/* +250bps stress */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] w-16 text-right text-slate-500">+250bps</span>
            <div className="flex-1 h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${
                sc.stressedROA_250bps != null && sc.stressedROA_250bps < 0.01 ? "bg-red-600" : "bg-rose-500"
              }`} style={{ width: `${roaScale(sc.stressedROA_250bps)}%` }} />
            </div>
            <span className="text-[10px] w-12 font-mono">{sc.stressedROA_250bps != null ? (sc.stressedROA_250bps * 100).toFixed(2) + "%" : "—"}</span>
          </div>
        </div>
      )}

      {/* Interpretation note */}
      {sc.stressedROA_150bps != null && sc.stressedROA_150bps < 0.01 && (
        <div className="text-xs text-rose-700 dark:text-rose-300 mt-1">
          ⚠️ A +150bps funding shock would push ROA below 1% — earnings fragility risk.
        </div>
      )}
      {sc.stressedROA_250bps != null && sc.stressedROA_250bps < 0 && (
        <div className="text-xs text-red-700 dark:text-red-300 mt-1">
          🚨 A +250bps shock would make the NBFC loss-making at current yields.
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

export default function FinancialInstitutionReport({ bankResult, marketCapCr, config, companyId, auditRunId, nbfcSidecar }: Props) {
  const valuation = bankResult.valuation;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportWorkbook = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const { generateBankWorkbook } = await import("../engine/bankExcelExport");
      // config is required for the workbook; if not passed, fall back to a minimal default
      const cfg = config ?? null;
      if (!cfg) {
        throw new Error("Engine config not available — cannot generate workbook.");
      }
      const wbArray = await generateBankWorkbook(bankResult, cfg, {
        companyLabel: companyId ?? cfg.ticker ?? undefined,
        auditRunId: auditRunId ?? null,
        marketCapCr,
      });
      const blob = new Blob([wbArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const latestPeriod = bankResult.periods[bankResult.periods.length - 1]?.period_end?.slice(0, 10) ?? "latest";
      const subtypeLower = bankResult.subtype.toLowerCase();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${subtypeLower}_workbook_${latestPeriod}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[FinancialInstitutionReport] export failed:", err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold mb-1">Financial Institution Analysis</h2>
          <div className="text-sm text-slate-600 dark:text-slate-400">
            Subtype: <span className="font-mono">{bankResult.subtype}</span> · {bankResult.periods.length} periods
          </div>
        </div>
        {/* H5 — Bank/NBFC/Insurance Excel export. Industrial pipeline already
            had this; banks were the audit gap. Workbook contents adapt to subtype. */}
        {config && (
          <button
            onClick={handleExportWorkbook}
            disabled={exporting}
            className="text-sm px-3 py-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/60 font-medium border border-emerald-200 dark:border-emerald-900/60 disabled:opacity-50"
          >
            {exporting ? "Generating…" : "📥 Export Excel Workbook"}
          </button>
        )}
      </div>
      {exportError && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 p-3 text-sm text-rose-900 dark:text-rose-200">
          Export failed: {exportError}
        </div>
      )}

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
                  ) : bankResult.subtype === "insurance" ? (
                    <th className="text-right py-1 px-3">Premium Earned</th>
                  ) : (
                    <th className="text-right py-1 px-3">Deposits</th>
                  )}
                  <th className="text-right py-1 px-3">
                    {bankResult.subtype === "nbfc" ? "Loan Book" : bankResult.subtype === "insurance" ? "Claims Incurred" : "Advances"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {bankResult.periods.map((p) => (
                  <tr key={p.period_end} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-1 pr-3 font-mono">{p.period_end}</td>
                    <td className="text-right py-1 px-3">{fmtCr(p.bookValue)}</td>
                    <td className="text-right py-1 px-3">{fmtCr(p.earnings)}</td>
                    {config?.shares_outstanding && config.shares_outstanding > 0 && (<>
                      <td className="text-right py-1 px-3 text-indigo-600 dark:text-indigo-400">
                        {p.bookValue != null ? `₹${(p.bookValue / config.shares_outstanding).toFixed(0)}` : "—"}
                      </td>
                      <td className="text-right py-1 px-3 text-indigo-600 dark:text-indigo-400">
                        {p.earnings != null ? `₹${(p.earnings / config.shares_outstanding).toFixed(1)}` : "—"}
                      </td>
                    </>)}
                    <td className="text-right py-1 px-3">
                      {fmtCr(
                        bankResult.subtype === "nbfc"
                          ? p.borrowings
                          : bankResult.subtype === "insurance"
                          ? p.premiumEarned
                          : p.deposits
                      )}
                    </td>
                    <td className="text-right py-1 px-3">
                      {fmtCr(bankResult.subtype === "insurance" ? p.claimsExpense : p.advances)}
                    </td>
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

      {/* Phase D2 — NBFC IndAS-109 quality (Stage 3, ECL coverage, AUM, AUM growth). */}
      {bankResult.subtype === "nbfc" && bankResult.bankMetrics && bankResult.bankMetrics.length > 0 && (
        <NbfcQualitySection metrics={bankResult.bankMetrics} />
      )}

      {/* Phase D3c — Subsidiary breakdown from sidecar data. */}
      {bankResult.subtype === "nbfc" && bankResult.bankMetrics && bankResult.bankMetrics.length > 0 && (
        <NbfcSubsidiaryPanel metrics={bankResult.bankMetrics} />
      )}
      {bankResult.subtype === "nbfc" && bankResult.bankMetrics && bankResult.bankMetrics.length > 0 && bankResult.bankMetrics[0]?.quality?.subsidiaries && (
        <SubsidiaryGrowthChart
          periods={bankResult.bankMetrics.filter(m => m.quality?.subsidiaries).map(m => ({
            fiscal_label: m.period_end.slice(0, 4),
            subsidiaries: m.quality!.subsidiaries!,
          }))}
        />
      )}

      {/* Phase D4 — LGD stage migration + RBI NHB regulatory metrics. */}
      {bankResult.subtype === "nbfc" && nbfcSidecar && (
        <NbfcRegulatoryPanel sidecar={nbfcSidecar} />
      )}
      {bankResult.subtype === "nbfc" && nbfcSidecar && nbfcSidecar.lgd.length >= 2 && (
        <LgdStageChart lgdData={nbfcSidecar.lgd} />
      )}

      {/* Phase D2 — NBFC governor + credit-cycle advisory banners. */}
      {bankResult.subtype === "nbfc" && valuation && (
        <NbfcGovernorBanners
          crarGov={valuation.crarGovernor}
          cycle={valuation.creditCostCycle}
          eclStressGov={valuation.eclStressGovernor}
          spreadComp={valuation.spreadCompression}
        />
      )}

      {/* Insurance-specific framing */}
      {bankResult.subtype === "insurance" && bankResult.bankMetrics && bankResult.bankMetrics.length > 0 && (
        <InsuranceMetricsSection metrics={bankResult.bankMetrics} />
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
          <h3 className="font-semibold mb-2">{bankResult.subtype === "insurance" ? "Insurance Valuation" : "Bank Valuation"} (Phase B4)</h3>
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

          <div className={`grid grid-cols-1 ${
            (valuation.evBased?.status === "computed" ? 1 : 0) +
            (valuation.pAum?.status === "computed" ? 1 : 0) +
            (valuation.roaLeverageRI?.status === "computed" ? 1 : 0) >= 2
              ? "md:grid-cols-3 lg:grid-cols-5"
              : valuation.evBased?.status === "computed" ||
                valuation.pAum?.status === "computed" ||
                valuation.roaLeverageRI?.status === "computed"
              ? "md:grid-cols-4"
              : "md:grid-cols-3"
          } gap-3 mb-4`}>
            <ModelCard name="Justified P/B Gordon" model={valuation.justifiedPB} marketCap={marketCapCr} />
            <ModelCard name="Equity Residual Income" model={valuation.equityResidualIncome} marketCap={marketCapCr} />
            <ModelCard name="Sustainable DDM" model={valuation.sustainableDDM} marketCap={marketCapCr} />
            {valuation.evBased?.status === "computed" && (
              <ModelCard name="EV Based Valuation" model={valuation.evBased} marketCap={marketCapCr} />
            )}
            {/* Phase D2 — NBFC P/AUM lens. */}
            {valuation.pAum && (
              <ModelCard name="P/AUM (NBFC)" model={valuation.pAum} marketCap={marketCapCr} />
            )}
            {/* Phase D2 — ROA × Leverage three-stage Residual Income (NBFC). */}
            {valuation.roaLeverageRI && (
              <ModelCard name="ROA × Leverage RI (NBFC)" model={valuation.roaLeverageRI} marketCap={marketCapCr} />
            )}
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
          {/* Phase E: Scenario Analysis */}
          {valuation.scenarios && valuation.scenarios.cards.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300">
                Scenario Analysis (Phase E)
              </h4>
              <div className="grid grid-cols-3 gap-3">
                {valuation.scenarios.cards.map((card: BankScenarioCard) => {
                  const colorClass =
                    card.key === "base"
                      ? "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/20"
                      : card.key === "stress"
                        ? "border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-900/20"
                        : "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-900/20";
                  const upsideClass =
                    card.upsidePct != null && card.upsidePct > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400";
                  return (
                    <div key={card.key} className={"rounded-lg border p-4 text-sm " + colorClass}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs uppercase tracking-wide">
                          {card.label}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {Math.round(card.probability * 100)}%
                        </span>
                      </div>
                      <div className="text-2xl font-bold mb-1">
                        {(() => {
                          const shares = config?.shares_outstanding;
                          const perShare = shares && shares > 0 && card.intrinsicValue != null
                            ? card.intrinsicValue / shares
                            : card.intrinsicPerShare;
                          return perShare != null
                            ? `₹${perShare.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                            : card.intrinsicValue != null
                              ? fmtCr(card.intrinsicValue)
                              : "N/A";
                        })()}
                      </div>
                      {card.intrinsicValue != null && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 -mt-0.5 mb-1">
                          {fmtCr(card.intrinsicValue)} total
                        </div>
                      )}
                      {card.upsidePct != null && (
                        <div className={"text-xs font-medium " + upsideClass}>
                          {card.upsidePct > 0 ? "+" : ""}
                          {Math.round(card.upsidePct * 100)}% vs market
                        </div>
                      )}
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                        ROE {Math.round(card.roe * 100)}% &middot; g {Math.round(card.g * 100)}% &middot; ke {Math.round(card.ke * 100)}%
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 italic">
                        {card.reason}
                      </div>
                    </div>
                  );
                })}
              </div>
              {valuation.scenarios.primary && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Primary case: {valuation.scenarios.primary}
                </div>
              )}
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
