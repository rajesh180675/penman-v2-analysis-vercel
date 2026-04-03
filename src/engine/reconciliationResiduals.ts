import { EngineConfig, RecastPeriod } from "./types";

export type ReconciliationResidualStatus = "confirmed" | "degraded" | "failed";

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

export function evaluateReconciliationResiduals(params: {
  recastData?: RecastPeriod[] | null;
  config?: EngineConfig | null;
}): ReconciliationResidualSummary {
  const recastData = params.recastData ?? [];
  const warningThreshold = params.config?.structural_residual_warning ?? 0.005;
  const criticalThreshold = params.config?.structural_residual_critical ?? 0.02;
  const checks = recastData.flatMap((period) => {
    const assetResidual = (period.bs.OA + period.bs.FA) - period.bs.TA;
    const capitalResidual = (period.bs.CSE + period.bs.MI + period.bs.FO + period.bs.OL) - period.bs.TA;
    const noaResidual = period.bs.NOA - period.bs.NFO - period.bs.CSE - period.bs.MI;

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
    ];
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
