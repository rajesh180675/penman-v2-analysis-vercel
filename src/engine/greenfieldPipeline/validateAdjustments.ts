import type { AdjustmentAuditEntry, AdjustmentValidationReport, NormalizedPeriod } from "./types";

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function findPeriod(periods: readonly NormalizedPeriod[], periodEnd: string): NormalizedPeriod | null {
  return periods.find((period) => period.periodEnd === periodEnd) ?? null;
}

function setField(period: NormalizedPeriod, field: string, value: number | string | boolean | null): void {
  if (field === "values.leaseNeutralEquity") period.values.leaseNeutralEquity = typeof value === "number" ? value : null;
  if (field === "values.nfoExLease") period.values.nfoExLease = typeof value === "number" ? value : null;
  if (field === "values.financialDebtExLease") period.values.financialDebtExLease = typeof value === "number" ? value : null;
  if (field === "values.fcfCash") period.values.fcfCash = typeof value === "number" ? value : null;
  if (field === "derived.dirtySurplusSeed") period.derived.dirtySurplusSeed = typeof value === "number" ? value : null;
}

function validateEntry(period: NormalizedPeriod | null, entry: AdjustmentAuditEntry): string[] {
  const rejectedBy: string[] = [];
  if (!period) {
    rejectedBy.push("period-not-found");
    return rejectedBy;
  }
  if (entry.field === "values.fcfCash") rejectedBy.push("fcf-is-never-adjusted");
  if (entry.adjusterId === "A1_LEASE_ADJUSTER" && entry.field === "values.financialDebtExLease") {
    rejectedBy.push("ex-lease-debt-must-not-subtract-leases-again");
  }
  if (entry.field === "values.cse" && finite(period.values.totalAssets) && finite(period.values.totalLiabilities) && typeof entry.after === "number") {
    const residual = Math.abs(period.values.totalAssets - (entry.after + period.values.totalLiabilities)) / Math.max(Math.abs(period.values.totalAssets), 1);
    if (residual > 0.005) rejectedBy.push("balance-sheet-identity-failed");
  }
  return rejectedBy;
}

export function validateAdjustments(asReported: readonly NormalizedPeriod[], adjusted: NormalizedPeriod[], auditTrail: readonly AdjustmentAuditEntry[]): { auditTrail: AdjustmentAuditEntry[]; validation: AdjustmentValidationReport } {
  const checks: AdjustmentValidationReport["checks"] = [];
  const nextAudit: AdjustmentAuditEntry[] = [];

  for (const entry of auditTrail) {
    const period = findPeriod(adjusted, entry.period);
    const rejectedBy = validateEntry(period, entry);
    if (rejectedBy.length > 0 && period) setField(period, entry.field, entry.before);
    nextAudit.push({
      ...entry,
      validationStatus: rejectedBy.length > 0 ? "rejected" : "accepted",
      rejectedBy,
    });
  }

  for (const period of adjusted) {
    if (finite(period.derived.rnoa) && (period.derived.rnoa < -0.5 || period.derived.rnoa > 1.5)) {
      checks.push({ key: "rnoa-reasonableness", period: period.periodEnd, status: "warning", message: `RNOA ${(period.derived.rnoa * 100).toFixed(1)}% outside [-50%, 150%].` });
    }
    if (finite(period.derived.rnoa) && finite(period.derived.pm) && finite(period.derived.ato)) {
      const residual = Math.abs(period.derived.rnoa - period.derived.pm * period.derived.ato);
      checks.push({
        key: "rnoa-pm-ato",
        period: period.periodEnd,
        status: residual <= 0.002 ? "passed" : "warning",
        message: residual <= 0.002 ? "RNOA decomposition closed within ±0.2pp." : `RNOA decomposition residual ${(residual * 100).toFixed(2)}pp; may include OtherItemsRatio bridge.`,
      });
    }
  }

  if (checks.length === 0) checks.push({ key: "adjustment-audit", period: null, status: "passed", message: "No identity-breaking adjustments proposed." });
  const acceptedCount = nextAudit.filter((entry) => entry.validationStatus === "accepted").length;
  const rejectedCount = nextAudit.filter((entry) => entry.validationStatus === "rejected").length;
  const diffTable = nextAudit.map((entry) => ({
    period: entry.period,
    field: entry.field,
    before: entry.before,
    after: entry.after,
    delta: entry.delta,
    adjusterId: entry.adjusterId,
    validationStatus: entry.validationStatus === "accepted" ? "accepted" as const : "rejected" as const,
    reason: entry.validationStatus === "rejected" ? `${entry.reason} Rejected: ${entry.rejectedBy.join(", ")}.` : entry.reason,
  }));

  const asReportedPeriods = new Set(asReported.map((period) => period.periodEnd));
  for (const period of adjusted) {
    if (!asReportedPeriods.has(period.periodEnd)) {
      checks.push({ key: "as-reported-preservation", period: period.periodEnd, status: "failed", message: "Adjusted output contains a period not present as reported." });
    }
  }

  const hasFailed = checks.some((check) => check.status === "failed") || rejectedCount === nextAudit.length && nextAudit.length > 0;
  const hasWarning = checks.some((check) => check.status === "warning") || rejectedCount > 0;
  return {
    auditTrail: nextAudit,
    validation: {
      status: hasFailed ? "rejected" : hasWarning ? "degraded" : "accepted",
      checks,
      diffTable,
      acceptedCount,
      rejectedCount,
    },
  };
}
