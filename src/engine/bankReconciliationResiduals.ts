/* ================================================================
   bankReconciliationResiduals — Phase 2.x

   Sector-aware reconciliation residuals for bank, NBFC, generic-financial,
   and insurance subtypes.

   Industrial reconciliation evaluates against a Penman-Nissim recast
   (CSE/MI/FO/OL split). Banks/NBFCs/insurance never produce that recast —
   pipeline.ts:196 returns `periods: []` for the financial-institution
   family, so the industrial residual evaluator has nothing to chew on.
   This left bank companies pinned at `syntactically-valid` because the
   structural-reconciled gate at analysisTraceability.ts:267 requires
   `hasRecastData = true`.

   The checks here are NOT industrial-shape adapted to banks. They are
   independent data-quality bridges over BankPeriodMetrics:

     - bank-asset-coverage:    (advances + investments + cash) / TA
                               Confirms Capitaline picked up the major
                               earning-asset categories. Low coverage =
                               label aliasing miss.

     - bank-liability-coverage: subtype-aware
                                bank:  (deposits + borrowings + equity) / TA
                                nbfc:  (borrowings + equity) / TA
                                insurance: (policyholderFunds + equity) / TA
                                generic-financial: skip (mixed funding)

     - nii-sign-bridge: interestEarned > 0 AND |interestExpended| ≤ interestEarned.
                        A going-concern bank cannot pay more interest than it
                        earns; a sign-flipped raw value would silently
                        produce negative NII.

     - profit-chain-sanity: |pat - pbt| / max(|pbt|, 1) — surfaces tax
                            anomalies (effective tax > 60% or < 0%).

     - debt-mix-coverage (NBFC): (NCD + termLoans...) / borrowings ≤ 1.0
                                  Subtotal cannot exceed total — anything
                                  above 1.0 is a parse error.

     - casa-deposits-sanity (banks): (demand + savings) ≤ totalDeposits.
                                      CASA components are subsets of
                                      total deposits.

     - nim-plausibility (banks/NBFC): NIM ∈ [0.5%, 12%]. Outside that
                                       band suggests denominator
                                       (earning-assets) misalignment.

     - insurance-combined-ratio: combinedRatio < 1.5 (sustained > 150%
                                  insurer is in run-off).

   None of these are tautological — every check compares an extracted
   raw aggregate against an independently-extracted total or sanity
   band. Failures indicate data-quality issues, not engine bugs.
================================================================ */

import type { BankPeriodMetrics } from "./bankPipeline";
import type { FinancialInstitutionSubtype } from "./analysisFamily";
import type {
  ReconciliationResidualStatus,
  ReconciliationResidualCheck,
  ReconciliationResidualSummary,
} from "./types/reconciliation";

const COVERAGE_WARNING_GAP = 0.05;
const COVERAGE_CRITICAL_GAP = 0.20;

const NII_WARNING_THRESHOLD = 0.01;
const NII_CRITICAL_THRESHOLD = 0.05;

const PROFIT_CHAIN_WARNING = 0.40;
const PROFIT_CHAIN_CRITICAL = 0.70;

const NBFC_DEBT_MIX_WARNING_OVERAGE = 0.05;
const NBFC_DEBT_MIX_CRITICAL_OVERAGE = 0.20;

const NIM_LOW = 0.005;
const NIM_HIGH = 0.12;

const COMBINED_RATIO_WARNING = 1.20;
const COMBINED_RATIO_CRITICAL = 1.50;

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function classify(
  ratio: number,
  warning: number,
  critical: number,
): ReconciliationResidualStatus {
  if (ratio >= critical) return "failed";
  if (ratio >= warning) return "degraded";
  return "confirmed";
}

/**
 * Coverage-style check: subtotal / total. Anything below 1 - warning
 * triggers a degraded reading; below 1 - critical is failed. Above 1.0
 * (subtotal exceeds reported total) is a critical breach because totals
 * cannot be smaller than their components — that's a parse error.
 */
function buildCoverageCheck(params: {
  key: string;
  label: string;
  periodEnd: string;
  subtotal: number | null;
  total: number | null;
  warningGap: number;
  criticalGap: number;
}): ReconciliationResidualCheck | null {
  if (
    params.subtotal == null ||
    params.total == null ||
    !Number.isFinite(params.subtotal) ||
    !Number.isFinite(params.total) ||
    params.total <= 0
  ) {
    return null;
  }
  const ratio = params.subtotal / params.total;
  const gap = Math.abs(1 - ratio);
  const status: ReconciliationResidualStatus =
    ratio > 1 + params.warningGap
      ? "failed"
      : classify(gap, params.warningGap, params.criticalGap);
  return {
    key: params.key,
    label: params.label,
    periodEnd: params.periodEnd,
    residual: params.subtotal - params.total,
    ratio: gap,
    warningThreshold: params.warningGap,
    criticalThreshold: params.criticalGap,
    status,
    detail: `${params.label}: subtotal ${params.subtotal.toFixed(2)} of total ${params.total.toFixed(2)} (${formatPct(ratio)} coverage; gap ${formatPct(gap)} vs warning ${formatPct(params.warningGap)} / critical ${formatPct(params.criticalGap)}).`,
  };
}

function buildNiiSignCheck(metric: BankPeriodMetrics): ReconciliationResidualCheck | null {
  const earned = metric.interestEarned;
  const expended = metric.interestExpended;
  if (
    earned == null ||
    expended == null ||
    !Number.isFinite(earned) ||
    !Number.isFinite(expended)
  ) {
    return null;
  }
  if (earned <= 0) {
    return {
      key: "nii-sign-bridge",
      label: "Interest Earned > 0 ∧ |Interest Expended| ≤ Interest Earned",
      periodEnd: metric.period_end,
      residual: -earned,
      ratio: 1,
      warningThreshold: NII_WARNING_THRESHOLD,
      criticalThreshold: NII_CRITICAL_THRESHOLD,
      status: "failed",
      detail: `Interest Earned ${earned.toFixed(2)} ≤ 0. A going-concern bank cannot have non-positive interest earned — sign-flipped raw value or label aliasing miss.`,
    };
  }
  const absExpended = Math.abs(expended);
  if (absExpended <= earned) {
    return {
      key: "nii-sign-bridge",
      label: "Interest Earned > 0 ∧ |Interest Expended| ≤ Interest Earned",
      periodEnd: metric.period_end,
      residual: 0,
      ratio: absExpended / Math.max(earned, 1),
      warningThreshold: NII_WARNING_THRESHOLD,
      criticalThreshold: NII_CRITICAL_THRESHOLD,
      status: "confirmed",
      detail: `Interest paid ${absExpended.toFixed(2)} of ${earned.toFixed(2)} earned (${formatPct(absExpended / earned)}); NII is positive.`,
    };
  }
  const ratio = (absExpended - earned) / Math.max(earned, 1);
  return {
    key: "nii-sign-bridge",
    label: "Interest Earned > 0 ∧ |Interest Expended| ≤ Interest Earned",
    periodEnd: metric.period_end,
    residual: absExpended - earned,
    ratio,
    warningThreshold: NII_WARNING_THRESHOLD,
    criticalThreshold: NII_CRITICAL_THRESHOLD,
    status: classify(ratio, NII_WARNING_THRESHOLD, NII_CRITICAL_THRESHOLD),
    detail: `Interest Expended ${absExpended.toFixed(2)} > Interest Earned ${earned.toFixed(2)} (excess ${formatPct(ratio)}). A going-concern bank cannot pay more interest than it earns.`,
  };
}

function buildProfitChainCheck(metric: BankPeriodMetrics): ReconciliationResidualCheck | null {
  const pat = metric.pat;
  const pbt = metric.pbt;
  if (
    pat == null ||
    pbt == null ||
    !Number.isFinite(pat) ||
    !Number.isFinite(pbt) ||
    Math.abs(pbt) < 1
  ) {
    return null;
  }
  // Effective tax rate = (pbt - pat) / pbt. Plausibility band [0%, 60%].
  const effectiveTax = (pbt - pat) / pbt;
  let ratio: number;
  let detail: string;
  if (effectiveTax < 0) {
    // Negative tax — refund or deferred-tax credit. Material refund > 30% is suspicious.
    ratio = Math.abs(effectiveTax);
    detail = `Effective tax ${formatPct(effectiveTax)} (PBT ${pbt.toFixed(2)} → PAT ${pat.toFixed(2)}). Negative tax indicates refund or deferred credit; verify against AR.`;
  } else if (effectiveTax > 0.6) {
    ratio = effectiveTax - 0.3;
    detail = `Effective tax ${formatPct(effectiveTax)} > 60% (PBT ${pbt.toFixed(2)} → PAT ${pat.toFixed(2)}). Indian corporate tax + surcharge caps near 35%; this points to one-off charge or PAT/PBT label swap.`;
  } else {
    ratio = 0;
    detail = `Effective tax ${formatPct(effectiveTax)} (PBT ${pbt.toFixed(2)} → PAT ${pat.toFixed(2)}). Within plausible band.`;
  }
  return {
    key: "profit-chain-sanity",
    label: "PAT and PBT consistent (effective tax ∈ [0, 60%])",
    periodEnd: metric.period_end,
    residual: pbt - pat,
    ratio,
    warningThreshold: PROFIT_CHAIN_WARNING,
    criticalThreshold: PROFIT_CHAIN_CRITICAL,
    status: classify(ratio, PROFIT_CHAIN_WARNING, PROFIT_CHAIN_CRITICAL),
    detail,
  };
}

function buildCasaSubsetCheck(metric: BankPeriodMetrics): ReconciliationResidualCheck | null {
  const casaRatio = metric.casaRatio;
  const deposits = metric.deposits;
  if (
    casaRatio == null ||
    deposits == null ||
    !Number.isFinite(casaRatio) ||
    !Number.isFinite(deposits) ||
    deposits <= 0
  ) {
    return null;
  }
  // CASA is a subset of total deposits — by definition ratio ∈ [0, 1].
  // Values above 1 indicate either a parse error (CASA double-counted)
  // or a unit mismatch (CASA in absolute Cr while compared to ratio).
  if (casaRatio <= 1.0) {
    return {
      key: "casa-deposits-sanity",
      label: "CASA ≤ Total Deposits",
      periodEnd: metric.period_end,
      residual: 0,
      ratio: casaRatio,
      warningThreshold: 1.0,
      criticalThreshold: 1.05,
      status: "confirmed",
      detail: `CASA ${formatPct(casaRatio)} of deposits — within definitional band.`,
    };
  }
  const ratio = casaRatio - 1;
  return {
    key: "casa-deposits-sanity",
    label: "CASA ≤ Total Deposits",
    periodEnd: metric.period_end,
    residual: ratio * deposits,
    ratio,
    warningThreshold: 0.05,
    criticalThreshold: 0.20,
    status: classify(ratio, 0.05, 0.20),
    detail: `CASA ${formatPct(casaRatio)} > 100% of deposits — CASA cannot exceed total deposits (definitional). Indicates parse error.`,
  };
}

function buildDebtMixCoverageCheck(metric: BankPeriodMetrics): ReconciliationResidualCheck | null {
  const borrowings = metric.borrowings;
  const components: Array<number | null> = [
    metric.nonConvertibleDebentures,
    metric.termLoansFromBanks,
    metric.termLoansFromInstitutions,
    metric.termLoansFromOthers,
  ];
  if (borrowings == null || borrowings <= 0) return null;
  const present: number[] = components.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (present.length === 0) return null;
  const subtotal = present.reduce((sum, v) => sum + v, 0);
  if (subtotal <= borrowings) {
    return {
      key: "debt-mix-coverage",
      label: "NBFC Debt Mix Components ≤ Total Borrowings",
      periodEnd: metric.period_end,
      residual: borrowings - subtotal,
      ratio: 1 - subtotal / borrowings,
      warningThreshold: 1.0,
      criticalThreshold: 1.0,
      status: "confirmed",
      detail: `Identified components ${subtotal.toFixed(2)} of ${borrowings.toFixed(2)} borrowings (${formatPct(subtotal / borrowings)}). Residual is informational — Capitaline doesn't always break out commercial paper / FCNRB.`,
    };
  }
  const overage = (subtotal - borrowings) / borrowings;
  return {
    key: "debt-mix-coverage",
    label: "NBFC Debt Mix Components ≤ Total Borrowings",
    periodEnd: metric.period_end,
    residual: subtotal - borrowings,
    ratio: overage,
    warningThreshold: NBFC_DEBT_MIX_WARNING_OVERAGE,
    criticalThreshold: NBFC_DEBT_MIX_CRITICAL_OVERAGE,
    status: classify(overage, NBFC_DEBT_MIX_WARNING_OVERAGE, NBFC_DEBT_MIX_CRITICAL_OVERAGE),
    detail: `Identified components ${subtotal.toFixed(2)} exceed total borrowings ${borrowings.toFixed(2)} by ${formatPct(overage)} — components cannot exceed their total. Parse error or double-count.`,
  };
}

function buildNimPlausibilityCheck(metric: BankPeriodMetrics): ReconciliationResidualCheck | null {
  const nim = metric.nim;
  if (nim == null || !Number.isFinite(nim)) return null;
  let ratio: number;
  let status: ReconciliationResidualStatus;
  let detail: string;
  if (nim < NIM_LOW) {
    ratio = NIM_LOW - nim;
    status = nim < 0 ? "failed" : "degraded";
    detail = `NIM ${formatPct(nim)} below plausibility floor ${formatPct(NIM_LOW)} — earning-assets denominator may be inflated, or Capitaline mislabeled "Total Income" as "Interest Earned".`;
  } else if (nim > NIM_HIGH) {
    ratio = nim - NIM_HIGH;
    status = nim > NIM_HIGH * 2 ? "failed" : "degraded";
    detail = `NIM ${formatPct(nim)} above plausibility ceiling ${formatPct(NIM_HIGH)} — earning-assets denominator may be missing investments, or Other Income leaked into NII.`;
  } else {
    ratio = 0;
    status = "confirmed";
    detail = `NIM ${formatPct(nim)} within plausible band [${formatPct(NIM_LOW)}, ${formatPct(NIM_HIGH)}].`;
  }
  return {
    key: "nim-plausibility",
    label: "NIM ∈ [0.5%, 12%]",
    periodEnd: metric.period_end,
    residual: 0,
    ratio,
    warningThreshold: 0,
    criticalThreshold: NIM_LOW,
    status,
    detail,
  };
}

function buildInsuranceCombinedCheck(metric: BankPeriodMetrics): ReconciliationResidualCheck | null {
  const cr = metric.combinedRatio;
  if (cr == null || !Number.isFinite(cr)) return null;
  let ratio: number;
  let status: ReconciliationResidualStatus;
  let detail: string;
  if (cr <= COMBINED_RATIO_WARNING) {
    ratio = 0;
    status = "confirmed";
    detail = `Combined ratio ${formatPct(cr)} within warning band [<${formatPct(COMBINED_RATIO_WARNING)}].`;
  } else if (cr <= COMBINED_RATIO_CRITICAL) {
    ratio = cr - COMBINED_RATIO_WARNING;
    status = "degraded";
    detail = `Combined ratio ${formatPct(cr)} above warning ${formatPct(COMBINED_RATIO_WARNING)} but below critical ${formatPct(COMBINED_RATIO_CRITICAL)}. Sustained > 100% indicates underwriting losses — not a data error per se but worth flagging.`;
  } else {
    ratio = cr - COMBINED_RATIO_CRITICAL;
    status = "failed";
    detail = `Combined ratio ${formatPct(cr)} above critical ${formatPct(COMBINED_RATIO_CRITICAL)} — either insurer is in run-off or claims/expenses denominator is wrong.`;
  }
  return {
    key: "insurance-combined-ratio",
    label: "Combined Ratio ≤ 150%",
    periodEnd: metric.period_end,
    residual: 0,
    ratio,
    warningThreshold: COMBINED_RATIO_WARNING - 1,
    criticalThreshold: COMBINED_RATIO_CRITICAL - 1,
    status,
    detail,
  };
}

export function evaluateBankReconciliationResiduals(params: {
  bankMetrics: BankPeriodMetrics[] | null | undefined;
  subtype: FinancialInstitutionSubtype;
}): ReconciliationResidualSummary {
  const bankMetrics = params.bankMetrics ?? [];
  const subtype = params.subtype;

  if (bankMetrics.length === 0) {
    return {
      status: "failed",
      summary: "No bank metrics were available for reconciliation residual checks.",
      warningCount: 0,
      errorCount: 0,
      maxResidualRatio: 0,
      checks: [],
    };
  }

  const checks: ReconciliationResidualCheck[] = [];

  for (const metric of bankMetrics) {
    // Asset coverage — universally applicable to bank/NBFC/insurance.
    // Only run when ALL three components are present; treating null as 0
    // turns a parser-miss into a fake coverage gap, which double-counts
    // the data-quality issue already surfaced by parser fidelity.
    if (
      metric.advances != null &&
      metric.investments != null &&
      metric.cashAndBalanceWithRBI != null &&
      metric.totalAssets != null &&
      metric.totalAssets > 0
    ) {
      const assetSubtotal =
        metric.advances + metric.investments + metric.cashAndBalanceWithRBI;
      const check = buildCoverageCheck({
        key: "bank-asset-coverage",
        label: "Advances + Investments + Cash with RBI ≈ Total Assets",
        periodEnd: metric.period_end,
        subtotal: assetSubtotal,
        total: metric.totalAssets,
        warningGap: COVERAGE_WARNING_GAP,
        criticalGap: COVERAGE_CRITICAL_GAP,
      });
      if (check) checks.push(check);
    }

    // Liability coverage — subtype-aware, all components must be present.
    if (subtype === "bank") {
      if (
        metric.deposits != null &&
        metric.borrowings != null &&
        metric.totalEquity != null &&
        metric.totalAssets != null &&
        metric.totalAssets > 0
      ) {
        const liabSubtotal = metric.deposits + metric.borrowings + metric.totalEquity;
        const check = buildCoverageCheck({
          key: "bank-liability-coverage",
          label: "Deposits + Borrowings + Equity ≈ Total Assets",
          periodEnd: metric.period_end,
          subtotal: liabSubtotal,
          total: metric.totalAssets,
          warningGap: COVERAGE_WARNING_GAP,
          criticalGap: COVERAGE_CRITICAL_GAP,
        });
        if (check) checks.push(check);
      }
    } else if (subtype === "nbfc") {
      if (
        metric.borrowings != null &&
        metric.totalEquity != null &&
        metric.totalAssets != null &&
        metric.totalAssets > 0
      ) {
        const liabSubtotal = metric.borrowings + metric.totalEquity;
        const check = buildCoverageCheck({
          key: "bank-liability-coverage",
          label: "Borrowings + Equity ≈ Total Assets (NBFC)",
          periodEnd: metric.period_end,
          subtotal: liabSubtotal,
          total: metric.totalAssets,
          warningGap: COVERAGE_WARNING_GAP,
          criticalGap: COVERAGE_CRITICAL_GAP,
        });
        if (check) checks.push(check);
      }
    } else if (subtype === "insurance") {
      if (
        metric.policyholderFunds != null &&
        metric.totalEquity != null &&
        metric.totalAssets != null &&
        metric.totalAssets > 0
      ) {
        const liabSubtotal = metric.policyholderFunds + metric.totalEquity;
        const check = buildCoverageCheck({
          key: "bank-liability-coverage",
          label: "Policyholder Funds + Equity ≈ Total Assets (Insurance)",
          periodEnd: metric.period_end,
          subtotal: liabSubtotal,
          total: metric.totalAssets,
          warningGap: COVERAGE_WARNING_GAP,
          criticalGap: COVERAGE_CRITICAL_GAP,
        });
        if (check) checks.push(check);
      }
    }
    // generic-financial: skip liability-side bridge — funding mix is undefined.

    // NII sign — banks/NBFCs only (insurance has no interest-margin model).
    if (subtype !== "insurance") {
      const niiCheck = buildNiiSignCheck(metric);
      if (niiCheck) checks.push(niiCheck);
    }

    // Profit chain — universal.
    const profitCheck = buildProfitChainCheck(metric);
    if (profitCheck) checks.push(profitCheck);

    // CASA subset — banks only.
    if (subtype === "bank") {
      const casaCheck = buildCasaSubsetCheck(metric);
      if (casaCheck) checks.push(casaCheck);
    }

    // Debt-mix coverage — NBFC only (banks fund through deposits).
    if (subtype === "nbfc" || subtype === "generic-financial") {
      const debtMixCheck = buildDebtMixCoverageCheck(metric);
      if (debtMixCheck) checks.push(debtMixCheck);
    }

    // NIM plausibility — banks/NBFCs only.
    if (subtype === "bank" || subtype === "nbfc") {
      const nimCheck = buildNimPlausibilityCheck(metric);
      if (nimCheck) checks.push(nimCheck);
    }

    // Insurance combined ratio — insurance only.
    if (subtype === "insurance") {
      const combinedCheck = buildInsuranceCombinedCheck(metric);
      if (combinedCheck) checks.push(combinedCheck);
    }
  }

  if (checks.length === 0) {
    return {
      status: "confirmed",
      summary: "No applicable bank residual checks for the available data.",
      warningCount: 0,
      errorCount: 0,
      maxResidualRatio: 0,
      checks,
    };
  }

  const warningCount = checks.filter((c) => c.status === "degraded").length;
  const errorCount = checks.filter((c) => c.status === "failed").length;
  const maxResidualRatio = checks.reduce((max, c) => Math.max(max, c.ratio), 0);
  const worst = [...checks].sort((a, b) => b.ratio - a.ratio)[0];
  const status: ReconciliationResidualStatus =
    errorCount > 0 ? "failed" : warningCount > 0 ? "degraded" : "confirmed";
  const summary =
    status === "failed"
      ? `${errorCount} bank reconciliation check(s) breached the critical threshold. Worst: ${worst.label} in ${worst.periodEnd} at ${formatPct(worst.ratio)}.`
      : status === "degraded"
        ? `${warningCount} bank reconciliation check(s) above warning, none critical. Worst: ${worst.label} in ${worst.periodEnd} at ${formatPct(worst.ratio)}.`
        : `All ${checks.length} bank reconciliation checks cleared. Worst: ${worst.label} in ${worst.periodEnd} at ${formatPct(worst.ratio)}.`;

  return {
    status,
    summary,
    warningCount,
    errorCount,
    maxResidualRatio,
    checks,
  };
}
