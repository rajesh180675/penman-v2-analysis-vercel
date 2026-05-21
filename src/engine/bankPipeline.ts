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
  FinancialInstitutionSubtype,
} from "./analysisFamily";
import { ScopeAssessment } from "./scopePolicy";
import { CapitalineMappingSpec } from "./mappingSpec";
import { computeBankValuation, BankValuationBundle } from "./bankValuation";
import {
  BankQualityIndicators,
  BankQualityPeriod,
  indexQualityByPeriod,
} from "./bankQualityIndicators";
import { computeBankAssetQuality } from "./bankAssetQuality";
import { trace } from "../lib/traceLogger";

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
  premiumEarned?: number | null;
  claimsExpense?: number | null;
  policyholderFunds?: number | null;
  investmentIncome?: number | null;
  claimsRatio?: number | null;
  expenseRatio?: number | null;
  combinedRatio?: number | null;
  premiumGrowth?: number | null;
  floatToEquity?: number | null;
  investmentYield?: number | null;

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
  statement?: string,
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

function avg(a: number | null, b: number | null): number | null {
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
function sumStrict(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return a + b;
}

/**
 * Lenient sum: treats null as zero. Use for income-statement combinations
 * where one missing line item should not block the whole calculation
 * (e.g., total income = NII + Other Income — if other income is genuinely
 * absent we still want NII alone to drive cost-to-income).
 */
function sumLenient(a: number | null, b: number | null): number | null {
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

// ─── Ratio Computation ──────────────────────────────────────────────────────

function computeBankRatios(
  current: BankPeriodMetrics,
  prev: BankPeriodMetrics | null,
  subtype: FinancialInstitutionSubtype = "bank",
): BankPeriodMetrics {
  const result = { ...current };
  // Phase K — NBFC framing: NIM denominator is advances-only (no SLR
  // investments to dilute it), and we surface yield/cost/spread instead
  // of NIM-on-earning-assets which is a bank framing.
  const isNbfcFraming = subtype === "nbfc" || subtype === "generic-financial";

  // Phase D — NBFC borrowings fallback: Capitaline Ind-AS for NBFCs often
  // has no explicit "Borrowings" line item, embedding them in totals only.
  // For NBFCs, virtually all liabilities are borrowings (no retail deposits),
  // so totalAssets − totalEquity is a sound proxy for total borrowings.
  if (isNbfcFraming && result.borrowings == null && result.totalAssets != null && result.totalEquity != null) {
    result.borrowings = result.totalAssets - result.totalEquity;
  }

  if (prev) {
    const avgAssets   = avg(current.totalAssets,  prev.totalAssets);
    const avgEquity   = avg(current.totalEquity,  prev.totalEquity);
    const avgAdvances = avg(current.advances,     prev.advances);

    // M4: apply the same NBFC borrowings fallback to prev so avgBorrowings
    // is consistent — using result.borrowings (fallback-applied) vs raw
    // prev.borrowings produced an asymmetric average for the first NBFC period.
    let prevBorrowings = prev.borrowings;
    if (isNbfcFraming && prevBorrowings == null && prev.totalAssets != null && prev.totalEquity != null) {
      prevBorrowings = prev.totalAssets - prev.totalEquity;
    }
    const avgBorrowings = avg(result.borrowings, prevBorrowings);
    // Earning assets: advances + investments for banks, advances-only for NBFCs.
    const earningAssets = isNbfcFraming
      ? avgAdvances
      : avg(
          sumStrict(current.advances, current.investments),
          sumStrict(prev.advances,    prev.investments),
        );

    // NIM = NII / Average Earning Assets — skip for insurance (premium ≠ interest)
    if (subtype !== "insurance" && current.nii != null && earningAssets != null && earningAssets > 0) {
      result.nim = current.nii / earningAssets;
    }

    // ROA = PAT / Average Total Assets (meaningful for all subtypes incl. insurance)
    if (current.pat != null && avgAssets != null && avgAssets > 0) {
      result.roa = current.pat / avgAssets;
    }

    // ROE = PAT / Average Equity (meaningful for all subtypes incl. insurance)
    if (current.pat != null && avgEquity != null && avgEquity > 0) {
      result.roe = current.pat / avgEquity;
    }

    // Credit Cost = Provisions / Average Advances — skip for insurance (no loan book)
    if (subtype !== "insurance" && current.provisions != null && avgAdvances != null && avgAdvances > 0) {
      result.creditCost = Math.abs(current.provisions) / avgAdvances;
    }

    // Phase K — NBFC: yield on advances, cost of borrowings, spread
    if (isNbfcFraming) {
      if (current.interestEarned != null && avgAdvances != null && avgAdvances > 0) {
        result.yieldOnAdvances = current.interestEarned / avgAdvances;
      }
      if (current.interestExpended != null && avgBorrowings != null && avgBorrowings > 0) {
        result.costOfBorrowings = Math.abs(current.interestExpended) / avgBorrowings;
      }
      if (result.yieldOnAdvances != null && result.costOfBorrowings != null) {
        result.spread = result.yieldOnAdvances - result.costOfBorrowings;
      }
    }
  }

  // Cost to Income = Operating Expenses / (NII + Other Income)
  // Skip for insurance — NII is not meaningful; use expenseRatio instead.
  if (subtype !== "insurance") {
    const totalIncome = sumLenient(current.nii, current.otherIncome);
    if (current.operatingExpenses != null && totalIncome != null && totalIncome > 0) {
      result.costToIncome = Math.abs(current.operatingExpenses) / totalIncome;
    }
  }

  // Phase K — NBFC: leverage and debt mix (point-in-time, no averaging needed)
  if (isNbfcFraming) {
    // Leverage = Total Borrowings / Total Equity. Standard NBFC gearing
    // metric. Banks fund through deposits so this number isn't comparable.
    if (result.borrowings != null && result.totalEquity != null && result.totalEquity > 0) {
      result.leverage = result.borrowings / result.totalEquity;
    }

    // Debt mix: fractions of total borrowings. Sum may be < 1 because
    // Capitaline doesn't break out commercial paper / FCNRB borrowings
    // separately — the residual is informational, not a parser bug.
    if (result.borrowings != null && result.borrowings > 0) {
      const safeShare = (component: number | null): number | null =>
        component != null ? component / result.borrowings! : null;
      result.debtMix = {
        ncdShare: safeShare(current.nonConvertibleDebentures),
        bankLoanShare: safeShare(current.termLoansFromBanks),
        institutionLoanShare: safeShare(current.termLoansFromInstitutions),
        otherLoanShare: safeShare(current.termLoansFromOthers),
      };
    }
  }

  // Insurance specific ratio calculations
  if (subtype === "insurance") {
    if (result.premiumEarned != null && result.premiumEarned > 0) {
      if (result.claimsExpense != null) {
        result.claimsRatio = Math.abs(result.claimsExpense) / result.premiumEarned;
      }
      if (result.operatingExpenses != null) {
        result.expenseRatio = Math.abs(result.operatingExpenses) / result.premiumEarned;
      }
      if (result.claimsRatio != null && result.expenseRatio != null) {
        result.combinedRatio = result.claimsRatio + result.expenseRatio;
      }
    }
    if (result.policyholderFunds != null && result.totalEquity != null && result.totalEquity > 0) {
      result.floatToEquity = result.policyholderFunds / result.totalEquity;
    } else if (result.totalAssets != null && result.totalEquity != null && result.totalEquity > 0) {
      result.floatToEquity = (result.totalAssets - result.totalEquity) / result.totalEquity;
    }

    if (prev) {
      if (current.premiumEarned != null && prev.premiumEarned != null && prev.premiumEarned > 0) {
        result.premiumGrowth = (current.premiumEarned - prev.premiumEarned) / prev.premiumEarned;
      }

      const currInvest = current.policyholderFunds ?? (current.totalAssets != null && current.totalEquity != null ? current.totalAssets - current.totalEquity : null);
      const prevInvest = prev.policyholderFunds ?? (prev.totalAssets != null && prev.totalEquity != null ? prev.totalAssets - prev.totalEquity : null);
      const avgInvest = avg(currInvest, prevInvest);
      if (current.investmentIncome != null && avgInvest != null && avgInvest > 0) {
        result.investmentYield = current.investmentIncome / avgInvest;
      }
    }
  }

  return result;
}

// ─── Subtype Detection ──────────────────────────────────────────────────────

function detectSubtype(scope: ScopeAssessment): FinancialInstitutionSubtype {
  // Count distinct signal labels per kind.
  // Priority: insurance > bank (≥2 labels) > nbfc > bank (1 label) > generic.
  // A single banking-business investment line on an NBFC's books shouldn't
  // flip the classification — require ≥2 distinct banking labels before
  // declaring "bank" outright. A single banking label still routes to "bank"
  // as a last resort when no NBFC signals are present (review W1).
  const counts = new Map<string, number>();
  for (const s of scope.signals) {
    if (s.kind === "manual-override") continue;
    counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  }
  const insuranceCount = counts.get("insurance") ?? 0;
  if (insuranceCount >= 1)            return "insurance";
  const bankingCount = counts.get("banking") ?? 0;
  const nbfcCount    = counts.get("nbfc")    ?? 0;
  if (bankingCount >= 2)              return "bank";
  if (nbfcCount    >= 1)              return "nbfc";
  if (bankingCount === 1)             return "bank";
  return "generic-financial";
}

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
  cfg?: EngineConfig,
  marketCap: number | null = null,
  quality: BankQualityIndicators | null = null,
): FinancialInstitutionAnalysisResult {
  if (!dataArray || dataArray.length === 0) {
    return {
      family: "financial-institution",
      subtype: detectSubtype(scope),
      periods: [],
      traceability: null,
      valuation: null,
    };
  }

  const sorted = [...dataArray].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  // Determine subtype first so ratio computation can branch on it.
  const subtype = detectSubtype(scope);
  trace("bank", "subtypeDetected", { subtype, classification: scope.classification });

  // Extract raw metrics
  const rawMetrics = sorted.map(extractBankMetrics);

  // Compute ratios (need previous period for averages)
  const computed: BankPeriodMetrics[] = [];
  for (let i = 0; i < rawMetrics.length; i++) {
    const prev = i > 0 ? computed[i - 1] : null;
    computed.push(computeBankRatios(rawMetrics[i], prev, subtype));
  }

  // Trace latest period metrics after computation
  if (computed.length > 0) {
    const _lt = computed[computed.length - 1];
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
        if (match.casa_pct != null) {
          m.casaRatio = match.casa_pct;
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
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
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
    latestROE: computed.length > 0 ? computed[computed.length - 1].roe : null,
    latestROA: computed.length > 0 ? computed[computed.length - 1].roa : null,
    latestLeverage: computed.length > 0 ? computed[computed.length - 1].leverage : null,
    latestSpread: computed.length > 0 ? computed[computed.length - 1].spread : null,
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
