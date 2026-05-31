/* ================================================================
   reconciliationResiduals — Phase 1.1 / 1.2 (de-tautologized)

   Six tautological identity checks were removed because they evaluate
   to 0 by algebraic construction in PenmanNissimEngine and therefore
   cleared regardless of input quality:
     - balance-sheet-assets         (OA = TA - FA  ⇒ (OA+FA)-TA ≡ 0)
     - balance-sheet-capital        (OL = TA-CSE-MI-FO  ⇒ residual ≡ 0)
     - noa-financing-identity       (NOA-NFO-CSE-MI ≡ 0)
     - cni-operating-financing-bridge (OI = CNI+NFE+MII ⇒ residual ≡ 0)
     - core-oi-unusual-bridge       (CoreOI = OI-UOI  ⇒ residual ≡ 0)
     - core-nfe-unusual-bridge      (CoreNFE = NFE-UFE ⇒ residual ≡ 0)

   These are now enforced by `console.assert` runtime guards inside
   evaluateReconciliationResiduals (debug-only — they detect engine
   regressions, not data-quality issues).

   In their place this stage now performs FOUR independent comparisons
   between recast outputs and as-reported raw lines:
     - external-equity-bridge       recast (CSE+MI) vs raw "Total Equity"
     - ol-coverage-bridge           explicit-OL components / OL ∈ [0.7, 1.3]
     - recast-ta-vs-raw             bs.TA vs reported (Total Current Assets
                                    + Total Non-Current Assets). NOTE: the
                                    original bs.TA-vs-raw-"Total Assets" form
                                    was itself tautological — bs.TA resolves
                                    the same "Total Assets" cell the check read
                                    back, so the residual was identically 0.
                                    Re-based onto the independently-reported
                                    asset subtotals (asset-side analog of
                                    ol-coverage), which genuinely diverge when
                                    a subtotal is corrupted or an asset line
                                    falls into the OA_Other plug.
     - recast-equity-side-vs-raw    CSE+MI+FO+OL vs raw "Total Equity and Liabilities"

   Plus a new S-9.4C consistency check:
     - kw-consistency-bridge        |kw_used - kw_structural| / kw_structural

   IMPORTANT — kw-consistency-bridge is PROVENANCE-DRIVEN and fail-closed.
   It does NOT compare kwUsed vs kwStructural magnitudes (that diff is
   tautologically zero: the pipeline stamps both from one
   deriveKwFromStructure call). Instead it asserts that every period which
   CAN derive a structural kw (any non-first period) actually has a valid
   one stamped — equivalently, that the shared `resolveKw` seam resolves
   to the structural rung rather than silently falling back to the config
   approximation. A non-first period missing a structural kw fails closed.
   See buildKwConsistencyCheck for the full rationale.
================================================================ */
import { EngineConfig, RecastPeriod } from "./types";

// Types relocated to ./types/reconciliation (pure leaf, weakness #1 cycle break).
// Imported back for internal use; re-exported so existing "./reconciliationResiduals" paths stay valid.
import type {
  ReconciliationResidualStatus,
  ReconciliationResidualCheck,
  ReconciliationResidualSummary,
} from "./types/reconciliation";
export type {
  ReconciliationResidualStatus,
  ReconciliationResidualCheck,
  ReconciliationResidualSummary,
};

const MIN_OPERATING_COST_BRIDGE_COVERAGE = 0.6;

const KW_CONSISTENCY_WARNING_THRESHOLD = 0.01;
const KW_CONSISTENCY_CRITICAL_THRESHOLD = 0.05;

/**
 * external-equity-bridge / ol-coverage-bridge use a wider tolerance than
 * the structural identities because their inputs are independent reads
 * with rounding noise (Total Equity reported in lakhs, recast in crores,
 * etc.). 1% warning / 5% critical mirrors the cash-distribution bridge.
 */
const EXTERNAL_EQUITY_WARNING_THRESHOLD = 0.01;
const EXTERNAL_EQUITY_CRITICAL_THRESHOLD = 0.05;

const RAW_RECAST_WARNING_THRESHOLD = 0.01;
const RAW_RECAST_CRITICAL_THRESHOLD = 0.05;

function classifyResidual(
  ratio: number,
  warningThreshold: number,
  criticalThreshold: number,
): ReconciliationResidualStatus {
  if (ratio >= criticalThreshold) return "failed";
  if (ratio >= warningThreshold) return "degraded";
  return "confirmed";
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function readTraceValue(period: RecastPeriod, line: string): number | null {
  const entries = period.trace?.[line];
  if (!entries?.length) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const value = entries[index]?.value;
    if (Number.isFinite(value)) return value!;
  }
  return null;
}

function hasTraceEvidence(period: RecastPeriod | null | undefined, line: string): boolean {
  const entries = period?.trace?.[line];
  if (!entries?.length) return false;
  return entries.some((entry) =>
    entry.statement !== "Derived"
    && entry.note !== "unmatched"
    && !entry.note?.startsWith("duplicate_source_ignored:")
  );
}

function buildCheck(params: {
  key: string;
  label: string;
  periodEnd: string;
  residual: number;
  denominator: number;
  warningThreshold: number;
  criticalThreshold: number;
}): ReconciliationResidualCheck {
  const ratio = Math.abs(params.residual) / Math.max(Math.abs(params.denominator), 1);
  const status = classifyResidual(ratio, params.warningThreshold, params.criticalThreshold);
  return {
    key: params.key,
    label: params.label,
    periodEnd: params.periodEnd,
    residual: params.residual,
    ratio,
    warningThreshold: params.warningThreshold,
    criticalThreshold: params.criticalThreshold,
    status,
    detail: `${params.label} residual ${params.residual.toFixed(2)} (${formatPct(ratio)} of basis, warning ${formatPct(params.warningThreshold)}, critical ${formatPct(params.criticalThreshold)}).`,
  };
}

function buildOptionalCheck(params: {
  key: string;
  label: string;
  periodEnd: string;
  residual: number | null;
  denominator: number | null;
  warningThreshold: number;
  criticalThreshold: number;
}): ReconciliationResidualCheck | null {
  if (
    params.residual == null ||
    params.denominator == null ||
    !Number.isFinite(params.residual) ||
    !Number.isFinite(params.denominator)
  ) {
    return null;
  }
  return buildCheck({
    key: params.key,
    label: params.label,
    periodEnd: params.periodEnd,
    residual: params.residual,
    denominator: params.denominator,
    warningThreshold: params.warningThreshold,
    criticalThreshold: params.criticalThreshold,
  });
}

/**
 * S-9.4C kw-consistency residual builder — PROVENANCE-DRIVEN, fail-closed.
 *
 * The old form compared `period.kwUsed - period.kwStructural`, but the
 * pipeline stamps both from the identical `deriveKwFromStructure` result
 * (pipeline.ts:248-249) and nothing else writes kwUsed, so that residual
 * was identically 0 — tautological, permanently "confirmed". A magnitude
 * diff against a fresh re-derivation is equally tautological at evaluation
 * time (same ke, same prev reproduces kwStructural exactly).
 *
 * The genuine invariant is provenance: `kwUsed` is stamped ONLY by the
 * pipeline's kw step (pipeline.ts:248-249), together with `kwStructural`,
 * for every period that can derive a structural kw. So `kwUsed` presence
 * marks "this period went through kw-stamping" — and in that context the
 * structural kw MUST be valid. If it isn't, every kw consumer silently
 * resolves `resolveKw` to the config approximation instead — the exact
 * "derive once, consume everywhere" violation S-9.4C forbids — so it fails
 * closed (ratio 1 → drives the ladder).
 *
 * Periods with no `kwUsed` were never kw-stamped (the first period, which
 * has no prior to weight against; or directly-constructed recast fixtures
 * that bypass the pipeline) and are legitimately skipped, not failed.
 */
function buildKwConsistencyCheck(period: RecastPeriod): ReconciliationResidualCheck | null {
  const kwUsed = period.kwUsed;
  // No kwUsed → this period never went through the pipeline's kw-stamping
  // step, so there is nothing to assert about structural provenance.
  if (kwUsed == null || !Number.isFinite(kwUsed)) {
    return null;
  }
  const kwStructural = period.kwStructural;
  const structurallyResolved =
    kwStructural != null && Number.isFinite(kwStructural) && kwStructural > 0;
  const status: ReconciliationResidualStatus = structurallyResolved ? "confirmed" : "failed";
  const ratio = structurallyResolved ? 0 : 1;
  const detail = structurallyResolved
    ? `kw resolved structurally (kw_structural=${kwStructural!.toFixed(4)}) — every module charges the same S-9.4C-derived capital cost.`
    : `kw was used (kw_used=${kwUsed.toFixed(4)}) without a structural kw stamped — kw consumers silently fall back to the config approximation, breaking S-9.4C "derive once" consistency.`;
  return {
    key: "kw-consistency-bridge",
    label: "kw resolved structurally (S-9.4C)",
    periodEnd: period.period_end,
    residual: ratio,
    ratio,
    warningThreshold: KW_CONSISTENCY_WARNING_THRESHOLD,
    criticalThreshold: KW_CONSISTENCY_CRITICAL_THRESHOLD,
    status,
    detail,
  };
}

export function evaluateReconciliationResiduals(params: {
  recastData?: RecastPeriod[] | null | undefined;
  config?: EngineConfig | null | undefined;
}): ReconciliationResidualSummary {
  const recastData = params.recastData ?? [];
  const warningThreshold = params.config?.structural_residual_warning ?? 0.005;
  const criticalThreshold = params.config?.structural_residual_critical ?? 0.02;
  const checks = recastData.flatMap((period, index) => {
    const previous = index > 0 ? recastData[index - 1] : null;

    // Tautological identity guards — debug-only, NOT residual checks.
    // These hold by construction in PenmanNissimEngine; if any of these
    // assertions fire it's an engine regression, not a data issue.
    console.assert(
      Math.abs((period.bs.OA + period.bs.FA) - period.bs.TA) < 1e-6,
      "engine invariant violated: OA + FA != TA",
    );
    console.assert(
      Math.abs((period.bs.CSE + period.bs.MI + period.bs.FO + period.bs.OL) - period.bs.TA) < 1e-6,
      "engine invariant violated: CSE + MI + FO + OL != TA",
    );
    console.assert(
      Math.abs(period.bs.NOA - period.bs.NFO - period.bs.CSE - period.bs.MI) < 1e-6,
      "engine invariant violated: NOA - NFO - CSE - MI != 0",
    );
    console.assert(
      Math.abs(period.is.CNI - (period.is.OI - period.is.NFE - period.is.MII)) < 1e-6,
      "engine invariant violated: CNI != OI - NFE - MII",
    );
    console.assert(
      Math.abs(period.cu.CoreOI + period.cu.UOI - period.is.OI) < 1e-6,
      "engine invariant violated: CoreOI + UOI != OI",
    );
    console.assert(
      Math.abs(period.cu.CoreNFE + period.cu.UFE - period.is.NFE) < 1e-6,
      "engine invariant violated: CoreNFE + UFE != NFE",
    );

    const shareCapital = period.shareCountInput?.shareCapital ?? null;
    const faceValue = period.shareCountInput?.faceValue ?? null;
    const endPeriodShares = period.shareCountInput?.endPeriodShares ?? null;
    const capitalDerivedShares = shareCapital != null && faceValue != null && faceValue > 0
      ? shareCapital / faceValue
      : null;
    const cashDistributionResidual = previous
      ? period.cf.d_t - period.cf.d_t_formula
      : null;
    const cashDistributionBasis = previous
      ? Math.max(Math.abs(period.cf.d_t), Math.abs(period.cf.d_t_formula), 1)
      : null;
    const currentBridgeDebt = readTraceValue(period, "BS.BridgeDebt.Total");
    const previousBridgeDebt = previous ? readTraceValue(previous, "BS.BridgeDebt.Total") : null;
    const debtFlowResidual = previousBridgeDebt != null && currentBridgeDebt != null
      ? (currentBridgeDebt - previousBridgeDebt) - ((period.cf.BridgeDebtProceeds ?? 0) + (period.cf.BridgeDebtRepayment ?? 0))
      : null;
    const debtFlowBasis = previousBridgeDebt != null && currentBridgeDebt != null
      ? Math.max(
        Math.abs(currentBridgeDebt - previousBridgeDebt),
        Math.abs((period.cf.BridgeDebtProceeds ?? 0) + (period.cf.BridgeDebtRepayment ?? 0)),
        1,
      )
      : null;
    const hasDebtFlowInputs = previousBridgeDebt != null
      && (
        readTraceValue(period, "BS.BridgeDebt.Total") != null
        || (previous ? readTraceValue(previous, "BS.BridgeDebt.Total") != null : false)
        || hasTraceEvidence(period, "CF.BridgeDebtProceeds")
        || hasTraceEvidence(period, "CF.BridgeDebtRepayment")
      );
    const currentCashBank = readTraceValue(period, "BS.FA.CashBank");
    const previousCashBank = previous ? readTraceValue(previous, "BS.FA.CashBank") : null;
    const currentCashInvestments = (readTraceValue(period, "BS.FA.CashBank") ?? 0)
      + (readTraceValue(period, "BS.FA.CurrentInvestmentsTop") ?? 0)
      + (readTraceValue(period, "BS.FA.CurrentInvestmentsAlt") ?? 0)
      + (readTraceValue(period, "BS.FA.LongTermInvestmentsDirect") ?? 0)
      + (readTraceValue(period, "BS.FA.TotalInvestmentsFallback") ?? 0);
    const previousCashInvestments = previous
      ? (readTraceValue(previous, "BS.FA.CashBank") ?? 0)
        + (readTraceValue(previous, "BS.FA.CurrentInvestmentsTop") ?? 0)
        + (readTraceValue(previous, "BS.FA.CurrentInvestmentsAlt") ?? 0)
        + (readTraceValue(previous, "BS.FA.LongTermInvestmentsDirect") ?? 0)
        + (readTraceValue(previous, "BS.FA.TotalInvestmentsFallback") ?? 0)
      : null;
    const investmentFlow = (period.cf.PurchaseInvestments ?? 0) + (period.cf.SaleInvestments ?? 0);
    const hasMaterialInvestmentFlow = Math.abs(investmentFlow) > 1;
    const hasInvestmentBalanceEvidence = previous != null && (
      hasTraceEvidence(period, "BS.FA.CurrentInvestmentsTop")
      || hasTraceEvidence(period, "BS.FA.CurrentInvestmentsAlt")
      || hasTraceEvidence(period, "BS.FA.LongTermInvestmentsDirect")
      || hasTraceEvidence(period, "BS.FA.TotalInvestmentsFallback")
      || hasTraceEvidence(previous, "BS.FA.CurrentInvestmentsTop")
      || hasTraceEvidence(previous, "BS.FA.CurrentInvestmentsAlt")
      || hasTraceEvidence(previous, "BS.FA.LongTermInvestmentsDirect")
      || hasTraceEvidence(previous, "BS.FA.TotalInvestmentsFallback")
    );
    const endingCashExpected =
      period.cf.CFO
      - period.cf.Capex
      - period.cf.DividendPaid
      + period.cf.EquityIssued
      - period.cf.ShareBuybacks
      + period.cf.InterestReceived
      + period.cf.DividendReceived
      + (period.cf.DebtProceeds ?? 0)
      + (period.cf.DebtRepayment ?? 0)
      + (period.cf.SaleFixedAssets ?? 0)
      + investmentFlow;
    const endingCashResidual = hasMaterialInvestmentFlow && hasInvestmentBalanceEvidence && previousCashInvestments != null
      ? (currentCashInvestments - previousCashInvestments) - endingCashExpected
      : currentCashBank != null && previousCashBank != null
        ? (currentCashBank - previousCashBank) - endingCashExpected
        : null;
    const endingCashBasis = hasMaterialInvestmentFlow && hasInvestmentBalanceEvidence && previousCashInvestments != null
      ? Math.max(
        Math.abs(currentCashInvestments - previousCashInvestments),
        Math.abs(endingCashExpected),
        1,
      )
      : currentCashBank != null && previousCashBank != null
        ? Math.max(
          Math.abs(currentCashBank - previousCashBank),
          Math.abs(endingCashExpected),
          1,
        )
        : null;
    const hasInvestmentTraceEvidence = hasTraceEvidence(period, "CF.PurchaseInvestments") || hasTraceEvidence(period, "CF.SaleInvestments");
    const hasEndingCashInputs = previous != null
      && (
        (hasMaterialInvestmentFlow && hasInvestmentTraceEvidence && hasInvestmentBalanceEvidence)
        || (
          (hasTraceEvidence(period, "BS.FA.CashBank") || readTraceValue(period, "BS.FA.CashBank") != null)
          && (hasTraceEvidence(previous, "BS.FA.CashBank") || (previous ? readTraceValue(previous, "BS.FA.CashBank") != null : false))
        )
      )
      && hasTraceEvidence(period, "CF.CFO")
      && hasTraceEvidence(period, "CF.Capex");
    const comprehensiveIncomeResidual = hasTraceEvidence(period, "IS.TCI")
      ? period.is.TCI - (period.is.PAT + period.is.OCI)
      : null;
    const comprehensiveIncomeBasis = comprehensiveIncomeResidual != null
      ? Math.max(Math.abs(period.is.TCI), Math.abs(period.is.PAT + period.is.OCI), 1)
      : null;
    const operatingCostBridge = period.is.operatingCostBridge;
    const hasOperatingCostBridgeInputs = (operatingCostBridge?.coverageRatio ?? 0) >= MIN_OPERATING_COST_BRIDGE_COVERAGE;
    const reportedBridgeCoreOi = operatingCostBridge != null
      ? period.cu.CoreOI - period.is.OtherItems
      : null;
    const operatingCostBridgeResidual = hasOperatingCostBridgeInputs && operatingCostBridge != null && reportedBridgeCoreOi != null
      ? operatingCostBridge.bridgeCoreOI - reportedBridgeCoreOi
      : null;
    const operatingCostBridgeBasis = operatingCostBridgeResidual != null && operatingCostBridge != null && reportedBridgeCoreOi != null
      ? Math.max(Math.abs(operatingCostBridge.bridgeCoreOI), Math.abs(reportedBridgeCoreOi), 1)
      : null;

    // ── Phase 1.1 promoted/new residuals ─────────────────────────
    // external-equity-bridge: recast (CSE+MI) vs raw "Total Equity"
    // (promoted from PenmanNissimEngine.ts:341-342 separationScore input).
    const debug = period.recastDebug;
    const rawTotalEquity = debug?.rawTotalEquity ?? null;
    const externalEquityResidual = rawTotalEquity != null && rawTotalEquity > 0
      ? (period.bs.CSE + period.bs.MI) - rawTotalEquity
      : null;
    const externalEquityBasis = rawTotalEquity != null && rawTotalEquity > 0 && period.bs.TA > 0
      ? period.bs.TA
      : null;

    // ol-coverage-bridge: explicit-OL components / OL ∈ [0.7, 1.3]
    // (promoted from olRatio at PenmanNissimEngine.ts:338-339).
    const explicitOL = debug?.explicitOL ?? 0;
    // Express the residual as a deviation from 1.0 expressed in OL units so
    // existing classification thresholds are usable. Skip when OL ≤ 0.
    let olCoverageResidual: number | null = null;
    let olCoverageBasis: number | null = null;
    if (period.bs.OL > 0 && explicitOL > 0) {
      const olRatio = explicitOL / period.bs.OL;
      // Map ratio to a residual-of-OL: |1 - ratio| × OL gives the OL units
      // missing/excess. Critical threshold 0.30 mirrors the historic
      // 0.7-1.3 band.
      olCoverageResidual = (olRatio - 1) * period.bs.OL;
      olCoverageBasis = Math.max(period.bs.OL, 1);
    }

    // recast-ta-vs-raw: recast bs.TA vs the SUM of independently-reported asset
    // subtotals (Total Current Assets + Total Non-Current Assets). This is the
    // asset-side analog of ol-coverage-bridge — both sides come from distinct
    // raw lines, so it is genuinely non-tautological (the prior bs.TA-vs-raw-TA
    // form read the same cell twice and was identically 0). Diverges when a
    // subtotal is misparsed/corrupted or an asset line silently lands in the
    // OA_Other plug. Skip honestly when either subtotal is absent.
    const rawCurrentAssets = debug?.rawCurrentAssets ?? null;
    const rawNonCurrentAssets = debug?.rawNonCurrentAssets ?? null;
    const reportedAssetComposition =
      rawCurrentAssets != null && rawNonCurrentAssets != null
        ? rawCurrentAssets + rawNonCurrentAssets
        : null;
    const recastTaVsRawResidual = reportedAssetComposition != null && reportedAssetComposition > 0
      ? period.bs.TA - reportedAssetComposition
      : null;
    const recastTaVsRawBasis = reportedAssetComposition != null && reportedAssetComposition > 0
      ? Math.max(Math.abs(period.bs.TA), Math.abs(reportedAssetComposition), 1)
      : null;

    // recast-equity-side-vs-raw: CSE+MI+FO+OL vs raw "Total Equity and Liabilities".
    const rawTLE = debug?.rawTotalLiabilitiesAndEquity ?? null;
    const recastEquitySideTotal = period.bs.CSE + period.bs.MI + period.bs.FO + period.bs.OL;
    const recastEquitySideResidual = rawTLE != null && rawTLE > 0
      ? recastEquitySideTotal - rawTLE
      : null;
    const recastEquitySideBasis = rawTLE != null && rawTLE > 0
      ? Math.max(Math.abs(recastEquitySideTotal), Math.abs(rawTLE), 1)
      : null;

    const olCoverageStatusOverride: ReconciliationResidualStatus | null = (() => {
      if (olCoverageResidual == null || olCoverageBasis == null || olCoverageBasis <= 0) return null;
      // Apply consistency band 0.7-1.3 explicitly: anything outside this is
      // critical, mild deviations 0.9-1.1 confirm, in-between is degraded.
      const olRatio = explicitOL / period.bs.OL;
      if (olRatio < 0.7 || olRatio > 1.3) return "failed";
      if (olRatio < 0.9 || olRatio > 1.1) return "degraded";
      return "confirmed";
    })();

    const olCoverageCheck = (() => {
      if (olCoverageResidual == null || olCoverageBasis == null) return null;
      const built = buildCheck({
        key: "ol-coverage-bridge",
        label: "Explicit OL components ÷ OL ∈ [0.7, 1.3]",
        periodEnd: period.period_end,
        residual: olCoverageResidual,
        denominator: olCoverageBasis,
        warningThreshold: 0.10,
        criticalThreshold: 0.30,
      });
      if (olCoverageStatusOverride != null) {
        return { ...built, status: olCoverageStatusOverride };
      }
      return built;
    })();

    const kwConsistencyCheck = buildKwConsistencyCheck(period);

    return [
      buildOptionalCheck({
        key: "cash-distribution-bridge",
        label: "d_t = FCF - NFE + ΔNFO",
        periodEnd: period.period_end,
        residual: cashDistributionResidual,
        denominator: cashDistributionBasis,
        warningThreshold,
        criticalThreshold,
      }),
      buildOptionalCheck({
        key: "gross-debt-flow-bridge",
        label: "Δ Bridge Debt = Bridge Debt Proceeds + Bridge Debt Repayment",
        periodEnd: period.period_end,
        residual: hasDebtFlowInputs ? debtFlowResidual : null,
        denominator: hasDebtFlowInputs ? debtFlowBasis : null,
        warningThreshold,
        criticalThreshold,
      }),
      buildOptionalCheck({
        key: "ending-cash-bridge",
        label: "Δ Cash and Bank = CFO - Capex - Distributions + Equity/Financing/Investment Flows",
        periodEnd: period.period_end,
        residual: hasEndingCashInputs ? endingCashResidual : null,
        denominator: hasEndingCashInputs ? endingCashBasis : null,
        warningThreshold,
        criticalThreshold,
      }),
      buildOptionalCheck({
        key: "comprehensive-income-bridge",
        label: "PAT + OCI = TCI",
        periodEnd: period.period_end,
        residual: comprehensiveIncomeResidual,
        denominator: comprehensiveIncomeBasis,
        warningThreshold,
        criticalThreshold,
      }),
      buildOptionalCheck({
        key: "operating-cost-bridge",
        label: `Bridge Core OI = Reported Core OI ex Other Items (coverage >= ${formatPct(MIN_OPERATING_COST_BRIDGE_COVERAGE)})`,
        periodEnd: period.period_end,
        residual: operatingCostBridgeResidual,
        denominator: operatingCostBridgeBasis,
        warningThreshold,
        criticalThreshold,
      }),
      buildOptionalCheck({
        key: "share-capital-face-value",
        label: "Share Capital ÷ Face Value = End-Period Shares",
        periodEnd: period.period_end,
        residual: capitalDerivedShares != null && endPeriodShares != null
          ? capitalDerivedShares - endPeriodShares
          : null,
        denominator: capitalDerivedShares != null && endPeriodShares != null
          ? Math.max(Math.abs(capitalDerivedShares), Math.abs(endPeriodShares), 1)
          : null,
        warningThreshold,
        criticalThreshold,
      }),
      // ── Phase 1.1 first-class promoted/new residuals ─────────────
      buildOptionalCheck({
        key: "external-equity-bridge",
        label: "Recast (CSE + MI) = Raw Total Equity",
        periodEnd: period.period_end,
        residual: externalEquityResidual,
        denominator: externalEquityBasis,
        warningThreshold: EXTERNAL_EQUITY_WARNING_THRESHOLD,
        criticalThreshold: EXTERNAL_EQUITY_CRITICAL_THRESHOLD,
      }),
      olCoverageCheck,
      buildOptionalCheck({
        key: "recast-ta-vs-raw",
        label: "Recast TA = Reported (Current + Non-Current Assets)",
        periodEnd: period.period_end,
        residual: recastTaVsRawResidual,
        denominator: recastTaVsRawBasis,
        warningThreshold: RAW_RECAST_WARNING_THRESHOLD,
        criticalThreshold: RAW_RECAST_CRITICAL_THRESHOLD,
      }),
      buildOptionalCheck({
        key: "recast-equity-side-vs-raw",
        label: "CSE + MI + FO + OL = Raw Total Equity and Liabilities",
        periodEnd: period.period_end,
        residual: recastEquitySideResidual,
        denominator: recastEquitySideBasis,
        warningThreshold: RAW_RECAST_WARNING_THRESHOLD,
        criticalThreshold: RAW_RECAST_CRITICAL_THRESHOLD,
      }),
      // ── Phase 1.2 S-9.4C kw-consistency residual (warning-only) ──
      kwConsistencyCheck,
    ].filter((check): check is ReconciliationResidualCheck => Boolean(check));
  });

  if (checks.length === 0) {
    if (recastData.length === 0) {
      return {
        status: "failed",
        summary: "No recast periods were available for reconciliation residual checks.",
        warningCount: 0,
        errorCount: 0,
        maxResidualRatio: 0,
        checks,
      };
    }
    // Periods exist but no residual check had its inputs (e.g. single
    // synthetic period with no prior, no trace evidence, and no
    // recastDebug). Pre-Phase-1.1 the six deleted tautological identities
    // always produced a check; with them gone, this branch must report
    // "confirmed" because absence of evidence is not evidence of failure.
    return {
      status: "confirmed",
      summary: "No applicable residual checks for the available data.",
      warningCount: 0,
      errorCount: 0,
      maxResidualRatio: 0,
      checks,
    };
  }

  const warningCount = checks.filter((check) => check.status === "degraded").length;
  const errorCount = checks.filter((check) => check.status === "failed").length;
  const maxResidualRatio = checks.reduce((max, check) => Math.max(max, check.ratio), 0);
  const worstCheck = [...checks].sort((left, right) => right.ratio - left.ratio)[0]!;
  const status: ReconciliationResidualStatus = errorCount > 0
    ? "failed"
    : warningCount > 0
      ? "degraded"
      : "confirmed";

  const summary = status === "failed"
    ? `${errorCount} reconciliation residual check(s) breached the critical threshold. Worst check: ${worstCheck.label} in ${worstCheck.periodEnd} at ${formatPct(worstCheck.ratio)}.`
    : status === "degraded"
      ? `${warningCount} reconciliation residual check(s) are above the warning threshold, but none are critical. Worst check: ${worstCheck.label} in ${worstCheck.periodEnd} at ${formatPct(worstCheck.ratio)}.`
      : `All ${checks.length} reconciliation residual checks stayed within the ${formatPct(warningThreshold)} warning threshold. Worst check: ${worstCheck.label} in ${worstCheck.periodEnd} at ${formatPct(worstCheck.ratio)}.`;

  return {
    status,
    summary,
    warningCount,
    errorCount,
    maxResidualRatio,
    checks,
  };
}
