/**
 * Bank Analysis Pipeline — Phase 3
 *
 * Processes financial institution data (banks, NBFCs) through a bank-specific
 * reformulation that treats loans as operating assets, deposits as operating
 * liabilities, and NII as core revenue.
 *
 * Unlike the industrial Penman-Nissim pipeline which separates OA/FA/OL/FO,
 * banks have a fundamentally different balance sheet where:
 * - Advances (loans) = core earning assets
 * - Deposits = core funding (not financial obligation)
 * - Investments = mix of SLR requirement + treasury
 * - NII (Net Interest Income) = core revenue
 * - Provisions = credit cost (analogous to COGS for banks)
 *
 * Phase 3 change: all label lookups now delegate to CapitalineMappingSpec
 * instead of maintaining a parallel hardcoded BANK_METRIC_KEYS object.
 */

import { RawPeriodData, EngineConfig } from "./types";
import {
  FinancialInstitutionAnalysisResult,
  FinancialInstitutionPeriodSnapshot,
} from "./analysisFamily";
import { ScopeAssessment } from "./scopePolicy";
import { computeBankValuation, BankValuationBundle } from "./bankValuation";
import {
  BankQualityIndicators,
  BankQualityPeriod,
  indexQualityByPeriod,
} from "./bankQualityIndicators";
import { computeBankAssetQuality } from "./bankAssetQuality";
import { trace } from "../lib/traceLogger";
import { BankPeriodMetrics, extractBankMetrics } from "./bankPipeline/metrics";
import { computeBankRatios, detectSubtype } from "./bankPipeline/ratios";

export type { BankPeriodMetrics };

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Process bank/NBFC data through the financial institution pipeline.
 * Produces period snapshots with bank-specific metrics and ratios, plus
 * (when an EngineConfig is provided) the three bank valuation models
 * from bankValuation.ts.
 *
 * `cfg` is optional for back-compat with existing callers that only
 * want metrics. When omitted, valuation is null.
 *
 * `quality` is optional. When provided, asset-quality indicators
 * (GNPA, NNPA, PCR, CRAR, slippage, CASA, growth) are joined to each
 * `BankPeriodMetrics` by period_end and surfaced via `metrics.quality`.
 * Periods without a matching record receive `quality: null`.
 */
export function processBankData(
  dataArray: RawPeriodData[],
  scope: ScopeAssessment,
  cfg?: EngineConfig | undefined,
  marketCap: number | null = null,
  quality: BankQualityIndicators | null = null,
): FinancialInstitutionAnalysisResult {
  if (!dataArray || dataArray.length === 0) {
    return {
      family: "financial-institution",
      subtype: detectSubtype(scope, cfg?.company_type ?? undefined),
      periods: [],
      traceability: null,
      valuation: null,
    };
  }

  const sorted = [...dataArray].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  // Determine subtype first so ratio computation can branch on it.
  const subtype = detectSubtype(scope, cfg?.company_type ?? undefined);
  trace("bank", "subtypeDetected", { subtype, classification: scope.classification });

  // Extract raw metrics
  const rawMetrics = sorted.map(extractBankMetrics);

  // Compute ratios (need previous period for averages)
  const computed: BankPeriodMetrics[] = [];
  for (let i = 0; i < rawMetrics.length; i++) {
    const prev = i > 0 ? computed[i - 1]! : null;
    computed.push(computeBankRatios(rawMetrics[i]!, prev, subtype));
  }

  // Trace latest period metrics after computation
  if (computed.length > 0) {
    const _lt = computed[computed.length - 1]!;
    trace("bank", "metricsComputed", {
      periods: computed.length,
      latestPeriod: _lt.period_end,
      nim: _lt.nim, roa: _lt.roa, roe: _lt.roe,
      leverage: _lt.leverage, spread: _lt.spread,
      yieldOnAdvances: _lt.yieldOnAdvances,
      costOfBorrowings: _lt.costOfBorrowings,
      creditCost: _lt.creditCost,
    });
  }

  // Phase B5 — Join hand-curated asset-quality indicators by period_end.
  // Periods without a matching record stay quality: null. The join is
  // O(n+m) — index once, lookup per period.
  if (quality) {
    const qualityIndex = indexQualityByPeriod(quality);
    let joinMatched = 0;
    let joinWithSubs = 0;
    let joinWithCti = 0;
    for (const m of computed) {
      const match = qualityIndex.get(m.period_end);
      if (match) {
        joinMatched++;
        m.quality = match;
        if (match.subsidiaries && match.subsidiaries.length > 0 &&
            match.subsidiaries.some(s => s.name !== "No Subsidiaries")) {
          joinWithSubs++;
        }
        // Only pull CASA from the sidecar when we have a matching quality record
        // AND the sidecar actually has a value. Do NOT overwrite a Capitaline-derived
        // casaRatio with null.
        //
        // `casa_pct` is a PERCENT (validated to [0, 100] in bankQualityIndicators)
        // while `casaRatio` is a FRACTION — metrics.ts computes it as
        // casaDeposits / deposits. Assigning across without /100 put 43.5 into a
        // field the definitional check reads as 4350%, so
        // "CASA ≤ Total Deposits" failed for every sidecar-backed period and
        // reported "Indicates parse error" about the sidecar join, not the parse.
        // Compare the cost-to-income branch immediately below, which has always
        // divided.
        if (match.casa_pct != null) {
          m.casaRatio = match.casa_pct / 100;
        }
        // Phase D2 — AR-sourced cost-to-income (Opex/NTI) overrides the computed
        // value when available. The AR's "Total operating expenses to NTI" is the
        // definitive figure: properly excludes provisions, credit costs, one-offs.
        // The computed fallback (employee + other - provisions + dep) is a secondary
        // approximation that runs 5-8pp higher due to CSR, bank charges, etc.
        if (match.cost_to_income_pct != null) {
          m.costToIncome = match.cost_to_income_pct / 100;
          joinWithCti++;
        }

        // Insurance Tier 1 — Capitaline Ind-AS doesn't carry premium/claims/opex
        // for life insurers (LIC). When the sidecar has them (from AR IRDAI
        // 5-year summary via extract_insurance_quality.py), prefer those values.
        // Critical: the pipeline computes claimsRatio/expenseRatio/combinedRatio
        // BEFORE the quality join runs, using the (null) Capitaline-derived
        // premium/claims values. We override BOTH the raw fields AND the
        // derived ratios here so the UI gets sensible values for life insurers.
        // See references/bank-casa-extraction.md for the data-source matrix.
        if (subtype === "insurance") {
          if (match.net_premium_cr != null) {
            m.premiumEarned = match.net_premium_cr;
          }
          if (match.claims_paid_cr != null) {
            m.claimsExpense = match.claims_paid_cr;
          }
          if (match.operating_expenses_cr != null) {
            m.operatingExpenses = match.operating_expenses_cr;
          }
          if (match.investment_income_cr != null) {
            m.investmentIncome = match.investment_income_cr;
          }
          // Pre-derived ratios (sidecar values are already in % units —
          // engine convention is fractional, so divide by 100)
          if (match.claims_ratio_pct != null) {
            m.claimsRatio = match.claims_ratio_pct / 100;
          }
          if (match.expense_ratio_pct != null) {
            m.expenseRatio = match.expense_ratio_pct / 100;
          }
          if (match.combined_ratio_pct != null) {
            m.combinedRatio = match.combined_ratio_pct / 100;
          }
          if (match.premium_growth_pct != null) {
            m.premiumGrowth = match.premium_growth_pct / 100;
          }
          // Investment yield is a published metric in IRDAI AR. Prefer it
          // over the computed (income / avg policyholder funds) value because
          // (a) AR figure is on a daily-mark basis, more precise than YoY avg,
          // (b) the computed path runs in extractBankMetrics() BEFORE the
          // sidecar override above replaces investmentIncome, leaving stale
          // yield = 0 when income was originally null.
          if (match.investment_yield_pct != null) {
            m.investmentYield = match.investment_yield_pct / 100;
          }
        }
      }
    }
    trace("bank", "qualityJoin", {
      computedPeriods: computed.length,
      qualityPeriods: qualityIndex.size,
      matched: joinMatched,
      unmatched: computed.length - joinMatched,
      withSubsidiaries: joinWithSubs,
      withCostToIncome: joinWithCti,
    });
  } else {
    trace("bank", "qualityJoin", { computedPeriods: computed.length, qualityPeriods: 0, matched: 0, unmatched: computed.length, withSubsidiaries: 0, withCostToIncome: 0 }, null, { level: "warn", msg: "No quality sidecar provided" });
  }

  // Phase B5.1 — Fallback sanitisation: computed cost-to-income can exceed 100%
  // when X-Detail P&L labels mis-align (operatingExpenses >> totalIncome). This
  // is physically impossible for a going-concern NBFC. For periods without an AR
  // sidecar, null the field so the UI shows "—" instead of garbage like 36167%.
  // Accurate historical values require AR back-fill (see extract_nbfc_quality.py).
  for (const m of computed) {
    if (m.costToIncome != null && (m.costToIncome > 1.0 || m.costToIncome < 0.0)) {
      m.costToIncome = null;
    }
  }

  // Phase B5.2 — Derive asset-quality signals (NPA cycle, PCR trend,
  // slippage trajectory, loan growth vs system, deposit franchise,
  // capital buffer) from the joined records. Always populated for
  // bank/NBFC subtypes; signals carry skip-with-reason when their
  // input fields are missing, so the bundle is safe to surface even
  // when no sidecar is provided.
  const qualityRecords: BankQualityPeriod[] = computed
    .map((m) => m.quality)
    .filter((q): q is BankQualityPeriod => q != null);
  const assetQuality = computeBankAssetQuality(qualityRecords);

  // Convert to FinancialInstitutionPeriodSnapshot
  const periods: FinancialInstitutionPeriodSnapshot[] = computed.map(m => ({
    period_end:    m.period_end,
    bookValue:     m.totalEquity,
    earnings:      m.pat,
    deposits:      m.deposits,
    borrowings:    m.borrowings,
    advances:      m.advances,
    premiumEarned: m.premiumEarned ?? null,
    claimsExpense: m.claimsExpense ?? null,
  }));

  // Phase B4: bank valuation. Only run when caller supplied a config —
  // valuation needs ke and terminal growth assumptions.
  // Derive payout ratio from CF data: median(dividendPaid / PAT) over last 5y.
  let derivedPayoutRatio: number | null = null;
  const payoutSamples = computed
    .slice(-5)
    .filter(m => m.pat != null && m.pat > 0 && m.dividendPaid != null && m.dividendPaid > 0)
    .map(m => m.dividendPaid! / m.pat!);
  if (payoutSamples.length >= 2) {
    const sorted = [...payoutSamples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    derivedPayoutRatio = sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
    // Clamp to [0.05, 0.95] — extreme values indicate data issues
    derivedPayoutRatio = Math.max(0.05, Math.min(0.95, derivedPayoutRatio));
  }
  const valuation: BankValuationBundle | null = cfg
    ? computeBankValuation(
        computed,
        cfg,
        marketCap,
        derivedPayoutRatio,
        subtype === "insurance",
        subtype === "nbfc",
      )
    : null;

  trace("bank", "processBankData:result", {
    subtype,
    periodsCount: periods.length,
    hasValuation: valuation != null,
    latestROE: computed.length > 0 ? computed[computed.length - 1]!.roe : null,
    latestROA: computed.length > 0 ? computed[computed.length - 1]!.roa : null,
    latestLeverage: computed.length > 0 ? computed[computed.length - 1]!.leverage : null,
    latestSpread: computed.length > 0 ? computed[computed.length - 1]!.spread : null,
  });

  return {
    family: "financial-institution",
    subtype,
    periods,
    traceability: null,
    valuation,
    bankMetrics: computed,
    assetQuality,
  };
}

/** Export internals for UI consumption and testing */
export { extractBankMetrics, computeBankRatios, detectSubtype };
