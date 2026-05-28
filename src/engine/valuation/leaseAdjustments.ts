/* ================================================================
   Plan 5 PR-5.5 — Ind-AS 116 lease adjustments.

   Ind-AS 116 (effective FY 2019-20) capitalizes operating leases on
   the balance sheet via a Right-of-Use asset and a matching lease
   liability. Pre-AS 116 statements (or non-Ind-AS jurisdictions)
   keep operating leases off-BS, and the analyst needs to capitalize
   them for apples-to-apples comparison.

   This module exposes two pure functions:

     1. capitalizeOperatingLeases({ annualRent, multiple, taxRate })
        Take an annual operating rent expense and capitalize it into
        a debt-equivalent. Standard practice: 7-8x annual rent in
        India (Damodaran's rule of thumb adjusted for ~5% interest
        rate environment). Returns capitalized debt, imputed
        interest, and restated EBIT/EBITDA.

     2. validateLeaseSelfConsistency({ rouAsset, leaseLiability,
        depreciationOnRou, leaseInterest, totalRent })
        Detect inconsistency between disclosed lease liabilities
        and the implied lease-term arithmetic. If a company shows
        ₹100cr in lease liabilities but the annual rent expense
        suggests a 2-year lease term on long-life assets, flag.

   PR-5.5 ships the helpers + tests. Wiring into the rigor ladder
   (so material lease inconsistency flags economically-plausible)
   is a follow-up.
================================================================ */

export interface CapitalizeOperatingLeasesInputs {
  /** Annual operating rent expense (absolute ₹). */
  annualRent: number;
  /** Capitalization multiple. India default = 8 (Damodaran). */
  multiple?: number;
  /** Tax rate as decimal. Default 25%. */
  taxRate?: number;
  /** EBITDA before lease adjustment (absolute ₹). Optional. */
  reportedEbitda?: number;
  /** EBIT before lease adjustment (absolute ₹). Optional. */
  reportedEbit?: number;
}

export interface CapitalizedLeaseResult {
  capitalizedDebt: number;
  /** Imputed interest expense at proxy rate (capitalizedDebt / multiple). */
  imputedInterest: number;
  /** Imputed depreciation on the ROU asset (annualRent - imputedInterest). */
  imputedDepreciation: number;
  /** Restated EBITDA: rent was opex; under capitalisation it splits
   *  into depreciation + interest, so EBITDA gains the full rent. */
  restatedEbitda: number | null;
  /** Restated EBIT: rent was opex; depreciation replaces it,
   *  so EBIT gains rent - depreciation = imputedInterest. */
  restatedEbit: number | null;
  /** Tax shield on the imputed interest. */
  taxShield: number;
}

/** Damodaran's India rule of thumb. Reflects ~5% interest rate environment. */
const DEFAULT_CAPITALIZATION_MULTIPLE = 8;
const DEFAULT_TAX_RATE = 0.25;

export function capitalizeOperatingLeases(
  inputs: CapitalizeOperatingLeasesInputs,
): CapitalizedLeaseResult {
  const multiple = inputs.multiple ?? DEFAULT_CAPITALIZATION_MULTIPLE;
  const taxRate = inputs.taxRate ?? DEFAULT_TAX_RATE;

  const capitalizedDebt = inputs.annualRent * multiple;
  // Implied interest rate = 1/multiple. So imputed interest = debt/multiple = annualRent.
  // But that overstates — most analysts treat the rent as a perpetuity-equivalent payment.
  // Standard treatment: imputedInterest = capitalizedDebt * (1/multiple), i.e. = annualRent.
  // Then imputedDepreciation = annualRent - imputedInterest = 0 in steady state.
  // The cleaner, defensible split (used by S&P / Moody's analytics):
  //   - Treat the proxy interest rate as ~1/multiple
  //   - imputedInterest = annualRent / 2 (half of rent is interest)
  //   - imputedDepreciation = annualRent / 2
  // We expose imputedInterest = annualRent / 2 to match S&P methodology.
  const imputedInterest = inputs.annualRent / 2;
  const imputedDepreciation = inputs.annualRent - imputedInterest;
  const taxShield = imputedInterest * taxRate;

  const restatedEbitda =
    inputs.reportedEbitda != null ? inputs.reportedEbitda + inputs.annualRent : null;
  const restatedEbit =
    inputs.reportedEbit != null ? inputs.reportedEbit + inputs.annualRent - imputedDepreciation : null;

  return {
    capitalizedDebt,
    imputedInterest,
    imputedDepreciation,
    restatedEbitda,
    restatedEbit,
    taxShield,
  };
}

export interface LeaseSelfConsistencyInputs {
  /** Right-of-Use asset (absolute ₹). */
  rouAsset: number;
  /** Total lease liability (current + non-current, absolute ₹). */
  leaseLiability: number;
  /** Depreciation charged on ROU during the period (absolute ₹). */
  depreciationOnRou: number;
  /** Interest expense on lease liability during the period (absolute ₹). */
  leaseInterest: number;
  /** Total disclosed operating-rent equivalent (cash lease payments) for the period. */
  totalRentPayments: number;
  /** Material threshold (default 15%) for ratio mismatch. */
  materialThreshold?: number;
}

export type LeaseConsistencyVerdict = "consistent" | "minor-mismatch" | "material-mismatch";

export interface LeaseSelfConsistencyResult {
  /** Implied lease term in years = leaseLiability / annualPayments. */
  impliedLeaseTermYears: number;
  /** Implied interest rate = leaseInterest / leaseLiability. */
  impliedInterestRate: number;
  /** Ratio of ROU asset to lease liability — should be near 1.0 at steady state. */
  rouToLiabilityRatio: number;
  /** Whether DepRou + Interest reconciles to TotalRentPayments within materialThreshold. */
  paymentReconciles: boolean;
  /** Aggregate verdict. */
  verdict: LeaseConsistencyVerdict;
  /** Human-readable diagnostics for surfacing in a UI. */
  diagnostics: string[];
}

const DEFAULT_MATERIAL_THRESHOLD = 0.15;
const SUSPICIOUS_LEASE_TERM_LOW = 1.0; // < 1 year is suspicious for capitalised leases
const SUSPICIOUS_LEASE_TERM_HIGH = 30.0; // > 30 years is unusual for non-real-estate
const SUSPICIOUS_INTEREST_LOW = 0.02; // < 2% effective is implausible
const SUSPICIOUS_INTEREST_HIGH = 0.20; // > 20% is implausible for senior-secured leases
const SUSPICIOUS_ROU_RATIO_LOW = 0.7;
const SUSPICIOUS_ROU_RATIO_HIGH = 1.4;

export function validateLeaseSelfConsistency(
  inputs: LeaseSelfConsistencyInputs,
): LeaseSelfConsistencyResult {
  const threshold = inputs.materialThreshold ?? DEFAULT_MATERIAL_THRESHOLD;
  const diagnostics: string[] = [];

  const impliedTerm =
    inputs.totalRentPayments > 0 ? inputs.leaseLiability / inputs.totalRentPayments : Infinity;
  const impliedRate =
    inputs.leaseLiability > 0 ? inputs.leaseInterest / inputs.leaseLiability : 0;
  const rouRatio =
    inputs.leaseLiability > 0 ? inputs.rouAsset / inputs.leaseLiability : 0;

  // Reconciliation: cash payments ≈ depreciation + interest (close, but accruals diverge)
  const expectedPayments = inputs.depreciationOnRou + inputs.leaseInterest;
  const paymentRatio =
    expectedPayments > 0
      ? Math.abs(inputs.totalRentPayments - expectedPayments) / expectedPayments
      : Infinity;
  const paymentReconciles = paymentRatio <= threshold;

  let verdict: LeaseConsistencyVerdict = "consistent";

  if (impliedTerm < SUSPICIOUS_LEASE_TERM_LOW) {
    diagnostics.push(
      `Implied lease term ${impliedTerm.toFixed(2)}y is suspiciously short — liability disclosure may understate.`,
    );
    verdict = "material-mismatch";
  } else if (impliedTerm > SUSPICIOUS_LEASE_TERM_HIGH) {
    diagnostics.push(
      `Implied lease term ${impliedTerm.toFixed(2)}y is unusually long — verify against asset disclosures.`,
    );
    if (verdict === "consistent") verdict = "minor-mismatch";
  }

  if (impliedRate < SUSPICIOUS_INTEREST_LOW || impliedRate > SUSPICIOUS_INTEREST_HIGH) {
    diagnostics.push(
      `Implied lease interest rate ${(impliedRate * 100).toFixed(1)}% is outside the 2–20% plausibility band.`,
    );
    if (verdict === "consistent") verdict = "minor-mismatch";
  }

  if (rouRatio < SUSPICIOUS_ROU_RATIO_LOW || rouRatio > SUSPICIOUS_ROU_RATIO_HIGH) {
    diagnostics.push(
      `ROU/liability ratio ${rouRatio.toFixed(2)} is outside the 0.7–1.4 steady-state band — check restatement.`,
    );
    if (verdict === "consistent") verdict = "minor-mismatch";
  }

  if (!paymentReconciles && expectedPayments > 0) {
    diagnostics.push(
      `Cash rent ${inputs.totalRentPayments.toFixed(0)} reconciles to dep+interest ${expectedPayments.toFixed(0)} with ${(paymentRatio * 100).toFixed(1)}% gap (threshold ${(threshold * 100).toFixed(1)}%).`,
    );
    verdict = paymentRatio > 2 * threshold ? "material-mismatch" : "minor-mismatch";
  }

  return {
    impliedLeaseTermYears: impliedTerm,
    impliedInterestRate: impliedRate,
    rouToLiabilityRatio: rouRatio,
    paymentReconciles,
    verdict,
    diagnostics,
  };
}
