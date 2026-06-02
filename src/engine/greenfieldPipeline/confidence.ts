import type { AdjustmentValidationReport, ConfidenceScore, NormalizedPeriod, TriageResult } from "./types";

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

function scoreOne(periods: readonly NormalizedPeriod[], triage: TriageResult, validation: AdjustmentValidationReport, asOf: Date, adjusted: boolean): ConfidenceScore {
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
    if (adjusted && signal.p_artifact >= 0.75 && signal.suggestedAdjusters.length > 0) {
      const bonus = signal.severity === "BLOCKING" || signal.severity === "CRITICAL" ? 15 : 10;
      bonuses.push({ reason: `Resolved high-probability accounting artifact: ${signal.label}`, points: bonus, signalId: signal.id });
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

export function scoreGreenfieldConfidence(params: { asReported: readonly NormalizedPeriod[]; adjusted: readonly NormalizedPeriod[]; triage: TriageResult; validation: AdjustmentValidationReport; asOf?: Date | string | undefined }): { asReported: ConfidenceScore; adjusted: ConfidenceScore } {
  const asOf = params.asOf instanceof Date ? params.asOf : new Date(params.asOf ?? Date.now());
  return {
    asReported: scoreOne(params.asReported, params.triage, params.validation, asOf, false),
    adjusted: scoreOne(params.adjusted, params.triage, params.validation, asOf, true),
  };
}
