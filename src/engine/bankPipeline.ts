/**
 * Bank Analysis Pipeline — Phase 3 Foundation
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
 */

import { RawPeriodData } from "./types";
import {
  FinancialInstitutionAnalysisResult,
  FinancialInstitutionPeriodSnapshot,
  FinancialInstitutionSubtype,
} from "./analysisFamily";
import { ScopeAssessment } from "./scopePolicy";

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

/** Keys used to extract bank metrics from Capitaline raw data */
const BANK_METRIC_KEYS = {
  // Balance Sheet
  totalAssets: ["Total Assets", "Total Assets/Liabilities"],
  totalEquity: ["Total Equity", "Total Shareholders Funds", "Total Shareholders' Funds"],
  advances: ["Advances", "Total Advances", "Loans and Advances to Customers"],
  deposits: ["Deposits", "Total Deposits"],
  investments: ["Investments", "Total Investments", "Investments of Banking Business"],
  borrowings: ["Borrowings", "Total Borrowings"],
  cashRBI: ["Cash and Balance with RBI", "Cash and Balances with Reserve Bank of India"],

  // P&L
  interestEarned: ["Interest Earned", "Interest Income", "Interest / Discount on Advances / Bills"],
  interestExpended: ["Interest Expended", "Interest Expense"],
  otherIncome: ["Other Income", "Non-Interest Income", "Fee and Commission Income"],
  operatingExpenses: ["Operating Expenses", "Payments to and Provisions for Employees"],
  provisions: ["Provisions and Contingencies", "Provision for NPA", "Prov. & W/O (Net)"],
  pat: ["Profit After Tax", "Net Profit"],
  pbt: ["Profit Before Tax", "Net Profit before Tax & Extraordinary Items"],
} as const;

function pickValue(raw: Record<string, number | null | undefined>, keys: readonly string[], statement?: string): number | null {
  for (const key of keys) {
    // Try composite key first
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

function extractBankMetrics(period: RawPeriodData): BankPeriodMetrics {
  const raw = period.raw_metric_values ?? {};

  const totalAssets = pickValue(raw, BANK_METRIC_KEYS.totalAssets, "BalanceSheet");
  const totalEquity = pickValue(raw, BANK_METRIC_KEYS.totalEquity, "BalanceSheet");
  const advances = pickValue(raw, BANK_METRIC_KEYS.advances, "BalanceSheet");
  const deposits = pickValue(raw, BANK_METRIC_KEYS.deposits, "BalanceSheet");
  const investments = pickValue(raw, BANK_METRIC_KEYS.investments, "BalanceSheet");
  const borrowings = pickValue(raw, BANK_METRIC_KEYS.borrowings, "BalanceSheet");
  const cashAndBalanceWithRBI = pickValue(raw, BANK_METRIC_KEYS.cashRBI, "BalanceSheet");

  const interestEarned = pickValue(raw, BANK_METRIC_KEYS.interestEarned, "ProfitLoss");
  const interestExpended = pickValue(raw, BANK_METRIC_KEYS.interestExpended, "ProfitLoss");
  const otherIncome = pickValue(raw, BANK_METRIC_KEYS.otherIncome, "ProfitLoss");
  const operatingExpenses = pickValue(raw, BANK_METRIC_KEYS.operatingExpenses, "ProfitLoss");
  const provisions = pickValue(raw, BANK_METRIC_KEYS.provisions, "ProfitLoss");
  const pat = pickValue(raw, BANK_METRIC_KEYS.pat, "ProfitLoss");
  const pbt = pickValue(raw, BANK_METRIC_KEYS.pbt, "ProfitLoss");

  // Derived
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

function computeBankRatios(current: BankPeriodMetrics, prev: BankPeriodMetrics | null): BankPeriodMetrics {
  const result = { ...current };

  if (prev) {
    const avgAssets = avg(current.totalAssets, prev.totalAssets);
    const avgEquity = avg(current.totalEquity, prev.totalEquity);
    const avgAdvances = avg(current.advances, prev.advances);
    const earningAssets = avg(
      sum(current.advances, current.investments),
      sum(prev.advances, prev.investments),
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

function avg(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return a ?? b;
  return (a + b) / 2;
}

function sum(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function detectSubtype(scope: ScopeAssessment): FinancialInstitutionSubtype {
  const kinds = new Set(scope.signals.map(s => s.kind));
  if (kinds.has("banking")) return "bank";
  if (kinds.has("nbfc")) return "nbfc";
  if (kinds.has("insurance")) return "generic-financial";
  return "generic-financial";
}

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
    period_end: m.period_end,
    bookValue: m.totalEquity,
    earnings: m.pat,
    deposits: m.deposits,
    advances: m.advances,
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

/** Export bank metrics for UI consumption */
export { extractBankMetrics, computeBankRatios, detectSubtype };
