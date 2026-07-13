import type { AdjustmentAuditEntry, AdjustmentValidationReport, ConfidenceScore, NormalizedPeriod, TriageResult } from "./types";

function severityPenalty(severity: string): number {
  if (severity === "CRITICAL") return 25;
  if (severity === "BLOCKING") return 20;
  if (severity === "WARNING") return 10;
  if (severity === "INFO") return 5;
  return 0;
}

function level(score: number, blocked: boolean): ConfidenceScore["level"] {
  if (blocked) return "blocked";
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function monthsSince(periodEnd: string, asOf: Date): number | null {
  const end = new Date(periodEnd).getTime();
  if (!Number.isFinite(end)) return null;
  return (asOf.getTime() - end) / (30.4375 * 86_400_000);
}

function staleCap(periods: readonly NormalizedPeriod[], asOf: Date): { cap: number; reason: string } | null {
  const latest = periods.length > 0 ? periods[periods.length - 1]! : null;
  if (!latest) return null;
  const months = monthsSince(latest.periodEnd, asOf);
  if (months == null || months <= 12) return null;
  if (months > 18) return { cap: 40, reason: `Latest financials are ${months.toFixed(1)} months old (>18mo stale cap).` };
  return { cap: 55, reason: `Latest financials are ${months.toFixed(1)} months old (>12mo stale cap).` };
}

function acceptedTransformationGroups(auditTrail: readonly AdjustmentAuditEntry[]): Array<{
  adjusterId: AdjustmentAuditEntry["adjusterId"];
  period: string;
  signalIds: string[];
}> {
  const groups = new Map<string, { adjusterId: AdjustmentAuditEntry["adjusterId"]; period: string; signalIds: Set<string> }>();
  for (const entry of auditTrail) {
    if (entry.validationStatus !== "accepted") continue;
    const key = `${entry.adjusterId}:${entry.period}`;
    const group = groups.get(key) ?? { adjusterId: entry.adjusterId, period: entry.period, signalIds: new Set<string>() };
    for (const evidence of entry.driven_by) group.signalIds.add(evidence.signalId);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({
    adjusterId: group.adjusterId,
    period: group.period,
    signalIds: Array.from(group.signalIds),
  }));
}

function scoreOne(
  periods: readonly NormalizedPeriod[],
  triage: TriageResult,
  validation: AdjustmentValidationReport,
  auditTrail: readonly AdjustmentAuditEntry[],
  asOf: Date,
  adjusted: boolean,
): ConfidenceScore {
  let score = 60;
  const penalties: ConfidenceScore["penalties"] = [];
  const bonuses: ConfidenceScore["bonuses"] = [];
  const caps: ConfidenceScore["caps"] = [];
  let blocked = false;

  for (const signal of triage.activeSignals) {
    const realness = Math.max(0, 1 - signal.p_artifact);
    const points = Math.round(severityPenalty(signal.severity) * realness);
    if (points > 0) {
      penalties.push({ reason: `${signal.label}: ${signal.message}`, points, signalId: signal.id });
      score -= points;
    }
    if ((signal.severity === "CRITICAL" || signal.severity === "BLOCKING") && signal.p_artifact < 0.5 && signal.blocksValuation) blocked = true;
  }

  // A detector suggestion is not evidence that an accounting issue was
  // resolved. Only an applied transformation that survived validation can
  // increase adjusted-view confidence.
  if (adjusted && validation.status !== "rejected") {
    for (const transformation of acceptedTransformationGroups(auditTrail)) {
      const drivingSignals = triage.activeSignals.filter((signal) => transformation.signalIds.includes(signal.id));
      const hasBlockingDriver = drivingSignals.some((signal) => signal.severity === "BLOCKING" || signal.severity === "CRITICAL");
      const bonus = hasBlockingDriver ? 15 : 10;
      bonuses.push({
        reason: `Accepted validated transformation ${transformation.adjusterId} for ${transformation.period}.`,
        points: bonus,
        signalId: drivingSignals[0]?.id,
      });
      score += bonus;
    }
  }

  if (validation.rejectedCount > 0) {
    const points = Math.min(20, validation.rejectedCount * 5);
    penalties.push({ reason: `${validation.rejectedCount} adjustment(s) rejected by validation.`, points });
    score -= points;
  }

  const cap = staleCap(periods, asOf);
  if (cap) {
    caps.push(cap);
    score = Math.min(score, cap.cap);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { level: level(score, blocked), score, penalties, bonuses, caps };
}

export function scoreGreenfieldConfidence(params: { asReported: readonly NormalizedPeriod[]; adjusted: readonly NormalizedPeriod[]; triage: TriageResult; validation: AdjustmentValidationReport; auditTrail?: readonly AdjustmentAuditEntry[] | undefined; asOf?: Date | string | undefined }): { asReported: ConfidenceScore; adjusted: ConfidenceScore } {
  const asOf = params.asOf instanceof Date ? params.asOf : new Date(params.asOf ?? Date.now());
  const auditTrail = params.auditTrail ?? [];
  return {
    asReported: scoreOne(params.asReported, params.triage, params.validation, auditTrail, asOf, false),
    adjusted: scoreOne(params.adjusted, params.triage, params.validation, auditTrail, asOf, true),
  };
}
