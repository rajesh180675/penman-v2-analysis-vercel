import { EngineConfig, RecastPeriod } from "./types";

export type ReconciliationResidualStatus = "confirmed" | "degraded" | "failed";

const MIN_OPERATING_COST_BRIDGE_COVERAGE = 0.6;

export interface ReconciliationResidualCheck {
  key: string;
  label: string;
  periodEnd: string;
  residual: number;
  ratio: number;
  warningThreshold: number;
  criticalThreshold: number;
  status: ReconciliationResidualStatus;
  detail: string;
}

export interface ReconciliationResidualSummary {
  status: ReconciliationResidualStatus;
  summary: string;
  warningCount: number;
  errorCount: number;
  maxResidualRatio: number;
  checks: ReconciliationResidualCheck[];
}

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
    if (Number.isFinite(value)) return value;
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

export function evaluateReconciliationResiduals(params: {
  recastData?: RecastPeriod[] | null;
  config?: EngineConfig | null;
}): ReconciliationResidualSummary {
  const recastData = params.recastData ?? [];
  const warningThreshold = params.config?.structural_residual_warning ?? 0.005;
  const criticalThreshold = params.config?.structural_residual_critical ?? 0.02;
  const checks = recastData.flatMap((period, index) => {
    const previous = index > 0 ? recastData[index - 1] : null;
    const assetResidual = (period.bs.OA + period.bs.FA) - period.bs.TA;
    const capitalResidual = (period.bs.CSE + period.bs.MI + period.bs.FO + period.bs.OL) - period.bs.TA;
    const noaResidual = period.bs.NOA - period.bs.NFO - period.bs.CSE - period.bs.MI;
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
    const cniResidual = period.is.CNI - (period.is.OI - period.is.NFE - period.is.MII);
    const coreOiResidual = period.cu.CoreOI + period.cu.UOI - period.is.OI;
    const coreNfeResidual = period.cu.CoreNFE + period.cu.UFE - period.is.NFE;
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

    return [
      buildCheck({
        key: "balance-sheet-assets",
        label: "OA + FA = TA",
        periodEnd: period.period_end,
        residual: assetResidual,
        denominator: period.bs.TA,
        warningThreshold,
        criticalThreshold,
      }),
      buildCheck({
        key: "balance-sheet-capital",
        label: "CSE + MI + FO + OL = TA",
        periodEnd: period.period_end,
        residual: capitalResidual,
        denominator: period.bs.TA,
        warningThreshold,
        criticalThreshold,
      }),
      buildCheck({
        key: "noa-financing-identity",
        label: "NOA - NFO - CSE - MI = 0",
        periodEnd: period.period_end,
        residual: noaResidual,
        denominator: Math.max(Math.abs(period.bs.NOA), Math.abs(period.bs.CSE + period.bs.MI), 1),
        warningThreshold,
        criticalThreshold,
      }),
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
      buildCheck({
        key: "cni-operating-financing-bridge",
        label: "CNI = OI - NFE - MII",
        periodEnd: period.period_end,
        residual: cniResidual,
        denominator: Math.max(Math.abs(period.is.CNI), Math.abs(period.is.OI), 1),
        warningThreshold,
        criticalThreshold,
      }),
      buildCheck({
        key: "core-oi-unusual-bridge",
        label: "Core OI + UOI = OI",
        periodEnd: period.period_end,
        residual: coreOiResidual,
        denominator: Math.max(Math.abs(period.cu.CoreOI), Math.abs(period.is.OI), 1),
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
      buildCheck({
        key: "core-nfe-unusual-bridge",
        label: "Core NFE + UFE = NFE",
        periodEnd: period.period_end,
        residual: coreNfeResidual,
        denominator: Math.max(Math.abs(period.cu.CoreNFE), Math.abs(period.is.NFE), 1),
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
    ].filter((check): check is ReconciliationResidualCheck => Boolean(check));
  });

  if (checks.length === 0) {
    return {
      status: "failed",
      summary: "No recast periods were available for reconciliation residual checks.",
      warningCount: 0,
      errorCount: 0,
      maxResidualRatio: 0,
      checks,
    };
  }

  const warningCount = checks.filter((check) => check.status === "degraded").length;
  const errorCount = checks.filter((check) => check.status === "failed").length;
  const maxResidualRatio = checks.reduce((max, check) => Math.max(max, check.ratio), 0);
  const worstCheck = [...checks].sort((left, right) => right.ratio - left.ratio)[0];
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
