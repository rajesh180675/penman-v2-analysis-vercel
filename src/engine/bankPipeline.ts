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

import { RawPeriodData } from "./types";
import {
  FinancialInstitutionAnalysisResult,
  FinancialInstitutionPeriodSnapshot,
  FinancialInstitutionSubtype,
} from "./analysisFamily";
import { ScopeAssessment } from "./scopePolicy";
import { CapitalineMappingSpec } from "./mappingSpec";

/** Bank-specific metrics extracted from raw data */
export interface BankPeriodMetrics {
  period_end: string;

  // Balance Sheet
  totalAssets: number | null;
  totalEquity: number | null;
  advances: number | null;       // Loan book
  deposits: number | null;       // Core funding
  investments: number | null;    // SLR + treasury
  borrowings: number | null;     // Non-deposit funding
  cashAndBalanceWithRBI: number | null;

  // P&L
  interestEarned: number | null;
  interestExpended: number | null;
  nii: number | null;            // Net Interest Income (derived)
  otherIncome: number | null;    // Fee, commission, trading
  operatingExpenses: number | null;
  provisions: number | null;     // Credit cost
  pat: number | null;
  pbt: number | null;

  // Derived Ratios
  nim: number | null;            // NII / Avg Earning Assets
  roa: number | null;            // PAT / Avg Total Assets
  roe: number | null;            // PAT / Avg Equity
  creditCost: number | null;     // Provisions / Avg Advances
  costToIncome: number | null;   // OpEx / (NII + Other Income)
  casaRatio: number | null;      // CASA Deposits / Total Deposits (if available)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Pick the first non-null, non-zero value from a list of label aliases,
 * trying composite keys (label__Statement) first, then base keys.
 */
function pickValue(
  raw: Record<string, number | null | undefined>,
  keys: readonly string[],
  statement?: string,
): number | null {
  for (const key of keys) {
    if (statement) {
      const composite = `${key}__${statement}`;
      const val = raw[composite];
      if (val != null && Number.isFinite(val) && val !== 0) return val;
    }
    // Try all statement variants
    for (const stmt of ["BalanceSheet", "ProfitLoss", "CashFlow"]) {
      const composite = `${key}__${stmt}`;
      const val = raw[composite];
      if (val != null && Number.isFinite(val) && val !== 0) return val;
    }
    // Try base key
    const val = raw[key];
    if (val != null && Number.isFinite(val as number) && val !== 0) return val as number;
  }
  return null;
}

function avg(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return a ?? b;
  return (a + b) / 2;
}

function sum(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract bank metrics from a single period's raw data.
 * All label lookups go through CapitalineMappingSpec.bankBalanceSheet /
 * bankProfitLoss so there is a single source of truth for label aliases.
 */
function extractBankMetrics(period: RawPeriodData): BankPeriodMetrics {
  const raw = period.raw_metric_values ?? {};
  const bs = CapitalineMappingSpec.bankBalanceSheet;
  const pl = CapitalineMappingSpec.bankProfitLoss;

  // Balance Sheet
  const totalAssets        = pickValue(raw, bs.totalAssets,         "BalanceSheet");
  const totalEquity        = pickValue(raw, bs.totalEquity,         "BalanceSheet");
  const advances           = pickValue(raw, bs.advances,            "BalanceSheet");
  const deposits           = pickValue(raw, bs.deposits,            "BalanceSheet");
  const investments        = pickValue(raw, bs.investments,         "BalanceSheet");
  const borrowings         = pickValue(raw, bs.borrowings,          "BalanceSheet");
  const cashAndBalanceWithRBI = pickValue(raw, bs.cashAndBalanceWithRBI, "BalanceSheet");

  // P&L
  const interestEarned     = pickValue(raw, pl.interestIncome,      "ProfitLoss");
  const interestExpended   = pickValue(raw, pl.interestExpended,    "ProfitLoss");
  const otherIncome        = pickValue(raw, pl.otherIncome,         "ProfitLoss");
  const operatingExpenses  = pickValue(raw, pl.operatingExpenses,   "ProfitLoss");
  const provisions         = pickValue(raw, pl.provisions,          "ProfitLoss");
  const pat                = pickValue(raw, pl.profitAfterTax,      "ProfitLoss");
  const pbt                = pickValue(raw, pl.profitBeforeTax,     "ProfitLoss");

  // NII = Interest Earned − |Interest Expended|
  const nii = (interestEarned != null && interestExpended != null)
    ? interestEarned - Math.abs(interestExpended)
    : null;

  return {
    period_end: period.period_end,
    totalAssets,
    totalEquity,
    advances,
    deposits,
    investments,
    borrowings,
    cashAndBalanceWithRBI,
    interestEarned,
    interestExpended,
    nii,
    otherIncome,
    operatingExpenses,
    provisions,
    pat,
    pbt,
    // Ratios computed in computeBankRatios
    nim: null,
    roa: null,
    roe: null,
    creditCost: null,
    costToIncome: null,
    casaRatio: null,
  };
}

// ─── Ratio Computation ──────────────────────────────────────────────────────

function computeBankRatios(
  current: BankPeriodMetrics,
  prev: BankPeriodMetrics | null,
): BankPeriodMetrics {
  const result = { ...current };

  if (prev) {
    const avgAssets   = avg(current.totalAssets,  prev.totalAssets);
    const avgEquity   = avg(current.totalEquity,  prev.totalEquity);
    const avgAdvances = avg(current.advances,     prev.advances);
    const earningAssets = avg(
      sum(current.advances, current.investments),
      sum(prev.advances,    prev.investments),
    );

    // NIM = NII / Average Earning Assets
    if (current.nii != null && earningAssets != null && earningAssets > 0) {
      result.nim = current.nii / earningAssets;
    }

    // ROA = PAT / Average Total Assets
    if (current.pat != null && avgAssets != null && avgAssets > 0) {
      result.roa = current.pat / avgAssets;
    }

    // ROE = PAT / Average Equity
    if (current.pat != null && avgEquity != null && avgEquity > 0) {
      result.roe = current.pat / avgEquity;
    }

    // Credit Cost = Provisions / Average Advances
    if (current.provisions != null && avgAdvances != null && avgAdvances > 0) {
      result.creditCost = Math.abs(current.provisions) / avgAdvances;
    }
  }

  // Cost to Income = Operating Expenses / (NII + Other Income)
  const totalIncome = sum(current.nii, current.otherIncome);
  if (current.operatingExpenses != null && totalIncome != null && totalIncome > 0) {
    result.costToIncome = Math.abs(current.operatingExpenses) / totalIncome;
  }

  return result;
}

// ─── Subtype Detection ──────────────────────────────────────────────────────

function detectSubtype(scope: ScopeAssessment): FinancialInstitutionSubtype {
  const kinds = new Set(scope.signals.map(s => s.kind));
  if (kinds.has("banking")) return "bank";
  if (kinds.has("nbfc"))    return "nbfc";
  return "generic-financial";
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Process bank/NBFC data through the financial institution pipeline.
 * Produces period snapshots with bank-specific metrics and ratios.
 */
export function processBankData(
  dataArray: RawPeriodData[],
  scope: ScopeAssessment,
): FinancialInstitutionAnalysisResult {
  if (!dataArray || dataArray.length === 0) {
    return {
      family: "financial-institution",
      subtype: detectSubtype(scope),
      periods: [],
      traceability: null,
    };
  }

  const sorted = [...dataArray].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  // Extract raw metrics
  const rawMetrics = sorted.map(extractBankMetrics);

  // Compute ratios (need previous period for averages)
  const computed: BankPeriodMetrics[] = [];
  for (let i = 0; i < rawMetrics.length; i++) {
    const prev = i > 0 ? computed[i - 1] : null;
    computed.push(computeBankRatios(rawMetrics[i], prev));
  }

  // Convert to FinancialInstitutionPeriodSnapshot
  const periods: FinancialInstitutionPeriodSnapshot[] = computed.map(m => ({
    period_end:    m.period_end,
    bookValue:     m.totalEquity,
    earnings:      m.pat,
    deposits:      m.deposits,
    advances:      m.advances,
    premiumEarned: null,
    claimsExpense: null,
  }));

  return {
    family: "financial-institution",
    subtype: detectSubtype(scope),
    periods,
    traceability: null,
  };
}

/** Export internals for UI consumption and testing */
export { extractBankMetrics, computeBankRatios, detectSubtype };
