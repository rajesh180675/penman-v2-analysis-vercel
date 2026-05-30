import { RawPeriodData } from "../types";
import { CapitalineMappingSpec } from "../mappingSpec";
import { BankQualityPeriod } from "../bankQualityIndicators";

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
  /** Dividend paid (Cr, absolute value). Sourced from CF statement. */
  dividendPaid: number | null;

  // Derived Ratios — common to bank and NBFC
  nim: number | null;            // NII / Avg Earning Assets (or Advances for NBFC)
  roa: number | null;            // PAT / Avg Total Assets
  roe: number | null;            // PAT / Avg Equity
  creditCost: number | null;     // Provisions / Avg Advances
  costToIncome: number | null;   // OpEx / (NII + Other Income)
  casaRatio: number | null;      // CASA Deposits / Total Deposits (if available)

  // Phase K — NBFC-specific funding mix (raw, sourced from mappingSpec).
  // Banks: these are typically null because banks fund through deposits.
  // NBFCs: these are the primary funding lens — leverage, NCD reliance,
  // bank-debt vs institutional-debt mix, etc.
  nonConvertibleDebentures: number | null;
  termLoansFromBanks: number | null;
  termLoansFromInstitutions: number | null;
  termLoansFromOthers: number | null;

  // Phase K — NBFC-specific derived metrics. Computed only when subtype
  // is "nbfc" or "generic-financial" (where borrowings are material).
  // For pure banks these stay null because the lens is wrong.
  /** Total Borrowings / Total Equity. Canonical NBFC gearing metric. */
  leverage: number | null;
  /** Cost of borrowings = |Interest Expended| / Avg Borrowings. NBFC-only;
   *  for banks this would mix deposits (cost-of-deposits) and borrowings. */
  costOfBorrowings: number | null;
  /** Yield on advances = Interest Earned / Avg Advances. */
  yieldOnAdvances: number | null;
  /** Spread = yieldOnAdvances - costOfBorrowings. Replaces "NIM" framing
   *  for NBFCs where the SLR-investment-adjusted NIM is meaningless. */
  spread: number | null;
  /** Debt mix at period end as fractions of borrowings (sum may be < 1
   *  when other components like commercial paper aren't separately
   *  identified by Capitaline). null when borrowings is missing. */
  debtMix: {
    ncdShare: number | null;
    bankLoanShare: number | null;
    institutionLoanShare: number | null;
    otherLoanShare: number | null;
  } | null;

  // Insurance Specific Fields (Tier 1 & Tier 2)
  premiumEarned?: number | null | undefined;
  claimsExpense?: number | null | undefined;
  policyholderFunds?: number | null | undefined;
  investmentIncome?: number | null | undefined;
  claimsRatio?: number | null | undefined;
  expenseRatio?: number | null | undefined;
  combinedRatio?: number | null | undefined;
  premiumGrowth?: number | null | undefined;
  floatToEquity?: number | null | undefined;
  investmentYield?: number | null | undefined;

  // Phase B5 — Asset-quality indicators sourced from the bank's annual
  // report (NOT Capitaline). Joined by period_end from the optional
  // sidecar `quality_indicators.json`. null when no sidecar is provided
  // or no record matches this period.
  quality: BankQualityPeriod | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATEMENT_KINDS = ["BalanceSheet", "ProfitLoss", "CashFlow"] as const;

/**
 * Validity test for an extracted raw value. We accept zero — a clean year
 * with zero provisions or zero borrowings is real data, not "missing". Only
 * null/undefined/NaN/non-finite values are rejected.
 *
 * Review C1: prior implementation also rejected `val !== 0`, which silently
 * dropped legitimate zeros (e.g., creditCost would be null instead of 0%).
 */
function isValidValue(v: unknown): v is number {
  return v != null && typeof v === "number" && Number.isFinite(v);
}

/**
 * Pick the first valid value from a list of label aliases.
 *
 * - When `statement` is supplied, only that statement is tried for each alias
 *   (then the bare key as a final fallback). This prevents cross-statement
 *   leakage, where a bank PL "Other Income" miss would silently fall back to
 *   a BalanceSheet value with the same string label (review C2).
 * - When `statement` is omitted, all statements are tried in BS → PL → CF order.
 */
function pickValue(
  raw: Record<string, number | null | undefined>,
  keys: readonly string[],
  statement?: string | undefined,
): number | null {
  for (const key of keys) {
    if (statement) {
      const val = raw[`${key}__${statement}`];
      if (isValidValue(val)) return val;
    } else {
      for (const stmt of STATEMENT_KINDS) {
        const val = raw[`${key}__${stmt}`];
        if (isValidValue(val)) return val;
      }
    }
    // Bare key (no statement suffix) as final fallback. Mapping spec keys
    // sometimes appear without a statement when the parser cannot classify.
    const baseVal = raw[key];
    if (isValidValue(baseVal)) return baseVal;
  }
  return null;
}

export function avg(a: number | null, b: number | null): number | null {
  // M5: when one value is null, return the non-null value as a point estimate
  // rather than silently degrading to null. This preserves ratio computation
  // for the first period of a new data series (prev is null for period 0).
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
}

/**
 * Strict sum: returns null if any operand is null. Use this for ratio
 * denominators (e.g., earning assets = advances + investments) where
 * mixing null with zero would inflate the numerator-side ratio (review C3).
 */
export function sumStrict(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return a + b;
}

/**
 * Lenient sum: treats null as zero. Use for income-statement combinations
 * where one missing line item should not block the whole calculation
 * (e.g., total income = NII + Other Income — if other income is genuinely
 * absent we still want NII alone to drive cost-to-income).
 */
export function sumLenient(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract bank metrics from a single period's raw data.
 * All label lookups go through CapitalineMappingSpec.bankBalanceSheet /
 * bankProfitLoss so there is a single source of truth for label aliases.
 */
export function extractBankMetrics(period: RawPeriodData): BankPeriodMetrics {
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

  // CASA sub-components — demand (current) + savings deposits.
  // casaRatio is derived here when Capitaline provides the breakdown;
  // it may be overwritten later by the quality sidecar join if a more
  // precise figure is available there.
  const demandDeposits  = pickValue(raw, bs.demandDeposits,  "BalanceSheet");
  const savingsDeposits = pickValue(raw, bs.savingsDeposits, "BalanceSheet");
  // CASA = (demand + savings) / total deposits.
  // Capitaline bank BS (HDFC, ICICI) only exposes current accounts ("in Current Accounts")
  // without a savings sub-line. Allow partial CASA when only one component is available.
  const casaDeposits =
    demandDeposits != null && savingsDeposits != null ? demandDeposits + savingsDeposits
    : demandDeposits != null ? demandDeposits
    : savingsDeposits != null ? savingsDeposits
    : null;
  const casaRatioRaw: number | null =
    casaDeposits != null && deposits != null && deposits > 0
      ? casaDeposits / deposits
      : null;

  // Phase K — NBFC funding mix breakdown
  const nonConvertibleDebentures   = pickValue(raw, bs.nonConvertibleDebentures,   "BalanceSheet");
  const termLoansFromBanks         = pickValue(raw, bs.termLoansFromBanks,         "BalanceSheet");
  const termLoansFromInstitutions  = pickValue(raw, bs.termLoansFromInstitutions,  "BalanceSheet");
  const termLoansFromOthers        = pickValue(raw, bs.termLoansFromOthers,        "BalanceSheet");

  // Insurance raw fields
  const policyholderFunds          = pickValue(raw, bs.policyholderFunds,          "BalanceSheet");

  // P&L
  const interestEarned     = pickValue(raw, pl.interestIncome,      "ProfitLoss");
  const interestExpended   = pickValue(raw, pl.interestExpended,    "ProfitLoss");
  const otherIncome        = pickValue(raw, pl.otherIncome,         "ProfitLoss");
  let   operatingExpenses  = pickValue(raw, pl.operatingExpenses,   "ProfitLoss");
  const provisions         = pickValue(raw, pl.provisions,          "ProfitLoss");
  const pat                = pickValue(raw, pl.profitAfterTax,      "ProfitLoss");
  const pbt                = pickValue(raw, pl.profitBeforeTax,     "ProfitLoss");

  // Phase D2 — NBFC operating-expenses fallback. Bajaj/Cholamandalam/Muthoot
  // report separate IndAS line items (Employee Benefits + Other Expenses +
  // Depreciation) instead of a single "Operating Expenses" headline. Bank-
  // specific labels above don't match — without this fallback costToIncome
  // stays null and renders as 0 in the UI. Note: pickValue returns 0 (not
  // null) when Capitaline has the bank-label row but with a zero value
  // (universal label universe), so we trigger on `null OR 0`. We use the
  // industrial profitLoss aliases directly because they match Bajaj's
  // exact label names.
  //
  // X-Detail P&L fix: In the X-Detail format, "Other Expenses" includes
  // "Provision for Doubtful Loan / Deposit / Advances" as a sub-item.
  // Provisions are NOT operating expenses — they're credit costs. When
  // provisions is separately identifiable (non-null, non-zero), subtract
  // it from "Other Expenses" to get true operating expenses. This brings
  // cost-to-income from ~62% (with provisions) to ~33-40% (without).
  if (operatingExpenses == null || operatingExpenses === 0) {
    const indPL = CapitalineMappingSpec.profitLoss;
    const employeeExp     = pickValue(raw, indPL.employeeExpense,        "ProfitLoss");
    let   otherExp        = pickValue(raw, indPL.otherExpenses,          "ProfitLoss");
    const depAmort        = pickValue(raw, indPL.depreciationAmortization, "ProfitLoss");

    // Subtract provisions from "Other Expenses" when separately identifiable.
    // In X-Detail P&L, "Provision for Doubtful Loan / Deposit / Advances"
    // sits INSIDE "Other Expenses" but is a credit cost, not an opex item.
    if (otherExp != null && otherExp !== 0 && provisions != null && provisions !== 0) {
      otherExp = otherExp - Math.abs(provisions);
    }

    // Need at least two of three to consider this a meaningful sum
    const present = [employeeExp, otherExp, depAmort].filter(v => v != null && v !== 0).length;
    if (present >= 2) {
      operatingExpenses = (employeeExp ?? 0) + (otherExp ?? 0) + (depAmort ?? 0);
    }
  }

  // Cash Flow — dividend paid (for payout ratio derivation in DDM/RI models)
  const cf = CapitalineMappingSpec.cashFlow;
  const dividendPaidRaw    = pickValue(raw, cf.dividendPaid,        "CashFlow");
  const dividendPaid       = dividendPaidRaw != null ? Math.abs(dividendPaidRaw) : null;

  // Insurance P&L fields
  const premiumEarned      = pickValue(raw, pl.premiumEarned,      "ProfitLoss");
  const claimsExpense      = pickValue(raw, pl.claimsExpense,      "ProfitLoss");
  const investmentIncome   = pickValue(raw, pl.investmentIncome,   "ProfitLoss");

  // NII = Interest Earned − |Interest Expended|.
  // Sign sanity check: a going-concern bank must have NII > 0 and < interestEarned
  // (interest paid on deposits/borrowings cannot exceed interest earned on advances).
  // If a parser ever delivers sign-flipped values (interestEarned < 0), the math
  // would silently produce negative NII; we set it to null instead so downstream
  // ratios are blocked rather than misleading (review W7).
  let nii: number | null = null;
  if (interestEarned != null && interestExpended != null) {
    if (interestEarned > 0) {
      nii = interestEarned - Math.abs(interestExpended);
      // Reject negative NII (interest paid > interest earned — bad data).
      // Note: nii > interestEarned is impossible here since interestExpended
      // is always non-negative after Math.abs, so that branch is omitted.
      if (nii < 0) nii = null;
    }
    // else: interestEarned <= 0 is sign-flipped raw data; leave NII null
  }

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
    dividendPaid,
    nim: null,
    roa: null,
    roe: null,
    creditCost: null,
    costToIncome: null,
    // Capitaline-derived CASA ratio (demand + savings / total deposits).
    // null when Capitaline does not break out deposit sub-types.
    // May be overwritten by quality sidecar join below if sidecar has a value.
    casaRatio: casaRatioRaw,
    // Phase K — NBFC funding mix (raw)
    nonConvertibleDebentures,
    termLoansFromBanks,
    termLoansFromInstitutions,
    termLoansFromOthers,
    // Phase K — NBFC derived (computed in computeBankRatios)
    leverage: null,
    costOfBorrowings: null,
    yieldOnAdvances: null,
    spread: null,
    debtMix: null,
    // Insurance raw and derived
    policyholderFunds,
    premiumEarned,
    claimsExpense,
    investmentIncome,
    claimsRatio: null,
    expenseRatio: null,
    combinedRatio: null,
    premiumGrowth: null,
    floatToEquity: null,
    investmentYield: null,
    // Phase B5 — populated post-extraction by the join in processBankData
    quality: null,
  };
}
