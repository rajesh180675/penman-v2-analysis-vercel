import type { AdjusterId, AdjustmentAuditEntry, AdjustmentPipelineResult, AnalysisWindow, AnomalySignal, NormalizedPeriod, TriageResult } from "../types";

function clonePeriods(periods: readonly NormalizedPeriod[]): NormalizedPeriod[] {
  return periods.map((period) => ({
    ...period,
    standardAdoptions: { ...period.standardAdoptions, adoptionDateEvidence: { ...period.standardAdoptions.adoptionDateEvidence } },
    industry: { ...period.industry },
    values: { ...period.values },
    derived: { ...period.derived },
    lineage: period.lineage.map((entry) => ({ ...entry })),
  }));
}

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function byPeriod(signals: readonly AnomalySignal[], period: string, adjusterId: AdjusterId): Array<{ detectorId: AnomalySignal["detectorId"]; signalId: string }> {
  return signals
    .filter((signal) => signal.period === period && signal.suggestedAdjusters.includes(adjusterId))
    .map((signal) => ({ detectorId: signal.detectorId, signalId: signal.id }));
}

function audit(adjusterId: AdjusterId, period: string, field: string, before: number | string | boolean | null, after: number | string | boolean | null, reason: string, drivenBy: Array<{ detectorId: AnomalySignal["detectorId"]; signalId: string }>): AdjustmentAuditEntry | null {
  if (before === after) return null;
  return {
    adjusterId,
    field,
    period,
    before,
    after,
    delta: typeof before === "number" && typeof after === "number" ? after - before : null,
    reason,
    driven_by: drivenBy,
    validationStatus: "pending",
    rejectedBy: [],
  };
}

function applyLeaseAdjuster(periods: NormalizedPeriod[], signals: readonly AnomalySignal[]): AdjustmentAuditEntry[] {
  const audits: AdjustmentAuditEntry[] = [];
  for (const period of periods) {
    const drivenBy = byPeriod(signals, period.periodEnd, "A1_LEASE_ADJUSTER");
    if (drivenBy.length === 0) continue;
    if (finite(period.values.cse) && finite(period.values.leaseLiabilities) && finite(period.values.rightOfUseAssets)) {
      const before = period.values.leaseNeutralEquity;
      const after = period.values.cse + period.values.leaseLiabilities - period.values.rightOfUseAssets;
      period.values.leaseNeutralEquity = after;
      const entry = audit("A1_LEASE_ADJUSTER", period.periodEnd, "values.leaseNeutralEquity", before, after, "Compute lease-neutral equity lens without overwriting reported CSE.", drivenBy);
      if (entry) audits.push(entry);
    }
    if (finite(period.values.nfo) && finite(period.values.leaseLiabilities)) {
      const before = period.values.nfoExLease;
      const after = period.values.nfo - period.values.leaseLiabilities;
      period.values.nfoExLease = after;
      const entry = audit("A1_LEASE_ADJUSTER", period.periodEnd, "values.nfoExLease", before, after, "Separate lease liabilities from financial leverage / NFO stress lens.", drivenBy);
      if (entry) audits.push(entry);
    }
  }
  return audits;
}

function buildAnalysisWindow(periods: readonly NormalizedPeriod[], triage: TriageResult): AnalysisWindow {
  const periodEnds = periods.map((period) => period.periodEnd);
  if (triage.userPolicy.structuralBreakWindowPolicy === "keep-all") {
    return { mode: "keep-all", excludedPeriods: [], includedPeriods: periodEnds, reason: "User selected keep-all structural-break policy.", minHistorySatisfied: periodEnds.length >= 10 };
  }
  const breakPeriods = triage.activeSignals
    .filter((signal) => signal.detectorId === "D6_STRUCTURAL_BREAK_DEMERGER" || signal.label.includes("ADOPTION"))
    .map((signal) => signal.period)
    .sort();
  if (breakPeriods.length === 0) {
    return { mode: triage.userPolicy.structuralBreakWindowPolicy, excludedPeriods: [], includedPeriods: periodEnds, reason: "No structural break requiring truncation was active.", minHistorySatisfied: periodEnds.length >= 10 };
  }
  const latestBreak = breakPeriods[breakPeriods.length - 1]!;
  const includedPeriods = periodEnds.filter((period) => period >= latestBreak);
  const excludedPeriods = periodEnds.filter((period) => period < latestBreak);
  return {
    mode: triage.userPolicy.structuralBreakWindowPolicy,
    excludedPeriods,
    includedPeriods,
    reason: `Auto post-break window starts at ${latestBreak}. As-reported periods are preserved; valuation confidence uses the clean window metadata.`,
    minHistorySatisfied: includedPeriods.length >= 10,
  };
}

function applyPreBreakTruncator(periods: readonly NormalizedPeriod[], triage: TriageResult): AnalysisWindow {
  return buildAnalysisWindow(periods, triage);
}

export function applyAdjustments(asReported: readonly NormalizedPeriod[], triage: TriageResult): AdjustmentPipelineResult {
  const adjusted = clonePeriods(asReported);
  const auditTrail: AdjustmentAuditEntry[] = [];
  let analysisWindow = buildAnalysisWindow(adjusted, triage);

  for (const adjuster of triage.adjusterOrder) {
    if (adjuster === "A1_LEASE_ADJUSTER") auditTrail.push(...applyLeaseAdjuster(adjusted, triage.activeSignals));
    if (adjuster === "A3_PRE_BREAK_TRUNCATOR") analysisWindow = applyPreBreakTruncator(adjusted, triage);
  }

  return { adjusted, auditTrail, analysisWindow };
}
