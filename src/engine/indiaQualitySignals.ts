import { RecastPeriod } from "./types";

/** India-specific governance and market quality signals. */
export interface IndiaQualitySignals {
  /** Promoter holding percentage (0-100). Higher is generally better in India. */
  promoterHolding: number | null;
  /** Change in promoter holding (positive = increasing). */
  promoterHoldingChange: number | null;
  /** Pledged promoter shares percentage (0-100). Critical risk signal. */
  pledgedPromoterShares: number | null;
  /** Related Party Transaction intensity relative to revenue. */
  rptIntensity: number | null;
  /** Tax avoidance intensity: (statutory_rate - effective_rate). */
  taxAvoidanceIntensity: number | null;
  /** Auditor change flag (true = changed in recent period). */
  auditorChange: boolean;
  /** Qualified opinion flag. */
  qualifiedOpinion: boolean;
  /** Composite India governance score (0-100). */
  indiaGovernanceScore: number | null;
  /** Human-readable flags. */
  flags: string[];
}

/** Input for computing India quality signals. */
export interface IndiaQualityInput {
  current: RecastPeriod;
  previous: RecastPeriod | null;
}

/**
 * Compute India-specific quality signals.
 *
 * These signals capture India-specific governance, ownership, and regulatory
 * nuances not covered by standard Piotroski/Beneish/Altman scores.
 */
export function computeIndiaQualitySignals(input: IndiaQualityInput): IndiaQualitySignals {
  const { current, previous } = input;
  const flags: string[] = [];

  // --- Promoter holding ---
  const promoterHolding = current.bs.promoterHolding ?? null;
  const prevPromoterHolding = previous?.bs.promoterHolding ?? null;
  const promoterHoldingChange =
    promoterHolding != null && prevPromoterHolding != null
      ? promoterHolding - prevPromoterHolding
      : null;

  if (promoterHoldingChange != null && promoterHoldingChange < -5) {
    flags.push(`Promoter holding fell by ${promoterHoldingChange.toFixed(1)}pp`);
  }
  if (promoterHolding != null && promoterHolding < 25) {
    flags.push("Promoter holding below 25% (minimum public compliance threshold risk)");
  }

  // --- Pledged shares ---
  const pledgedPromoterShares = current.bs.pledgedPromoterShares ?? null;
  if (pledgedPromoterShares != null && pledgedPromoterShares > 20) {
    flags.push(`HIGH RISK: ${pledgedPromoterShares.toFixed(1)}% of promoter shares pledged`);
  } else if (pledgedPromoterShares != null && pledgedPromoterShares > 0) {
    flags.push(`${pledgedPromoterShares.toFixed(1)}% of promoter shares pledged`);
  }

  // --- RPT intensity ---
  const rptAmount = current.is.relatedPartyTransactions ?? 0;
  const revenue = current.is.Sales;
  const rptIntensity = revenue > 0 ? Math.abs(rptAmount) / revenue : null;
  if (rptIntensity != null && rptIntensity > 0.05) {
    flags.push(`RPT intensity ${(rptIntensity * 100).toFixed(1)}% of revenue exceeds 5%`);
  }

  // --- Tax avoidance intensity ---
  const statutoryRate = 0.2518; // Indian corporate tax rate (incl. surcharge/cess ~25.17%)
  const effectiveRate = current.is.taxRate;
  const taxAvoidanceIntensity =
    Number.isFinite(effectiveRate) ? statutoryRate - effectiveRate : null;
  if (taxAvoidanceIntensity != null && taxAvoidanceIntensity > 0.08) {
    flags.push(`Effective tax rate ${(effectiveRate * 100).toFixed(1)}% significantly below statutory ${statutoryRate * 100}%`);
  }

  // --- Auditor/governance events ---
  const auditorChange = current.is.auditorChange ?? false;
  const qualifiedOpinion = current.is.qualifiedOpinion ?? false;

  if (auditorChange) {
    flags.push("Auditor changed in latest period");
  }
  if (qualifiedOpinion) {
    flags.push("Qualified audit opinion reported");
  }

  // --- Composite India Governance Score ---
  // Weighted composite of all India-specific signals
  const indiaGovernanceScore = computeIndiaGovernanceScore({
    promoterHolding,
    promoterHoldingChange,
    pledgedPromoterShares,
    rptIntensity,
    taxAvoidanceIntensity,
    auditorChange,
    qualifiedOpinion,
  });

  return {
    promoterHolding,
    promoterHoldingChange,
    pledgedPromoterShares,
    rptIntensity,
    taxAvoidanceIntensity,
    auditorChange,
    qualifiedOpinion,
    indiaGovernanceScore,
    flags,
  };
}

/** Weighted composite India governance score (0-100, higher = better). */
function computeIndiaGovernanceScore(ctx: {
  promoterHolding: number | null;
  promoterHoldingChange: number | null;
  pledgedPromoterShares: number | null;
  rptIntensity: number | null;
  taxAvoidanceIntensity: number | null;
  auditorChange: boolean;
  qualifiedOpinion: boolean;
}): number | null {
  let score = 50; // Start at neutral

  // Promoter holding (20 pts) — sweet spot 40-70%
  if (ctx.promoterHolding != null) {
    const optDist = Math.min(Math.abs(ctx.promoterHolding - 55), 55);
    score += (1 - optDist / 55) * 20;
  }

  // Promoter holding change (15 pts)
  if (ctx.promoterHoldingChange != null) {
    score += Math.min(ctx.promoterHoldingChange * 3, 15) * 0.5;
  }

  // Pledged shares (30 pts penalty) — very important in India
  if (ctx.pledgedPromoterShares != null && ctx.pledgedPromoterShares > 0) {
    score -= Math.min(ctx.pledgedPromoterShares / 50, 1) * 30;
  }

  // RPT intensity (15 pts penalty)
  if (ctx.rptIntensity != null) {
    score -= Math.min(ctx.rptIntensity / 0.1, 1) * 15;
  }

  // Excessive tax avoidance (10 pts penalty)
  if (ctx.taxAvoidanceIntensity != null && ctx.taxAvoidanceIntensity > 0.08) {
    score -= 10;
  }

  // Auditor change (10 pts penalty)
  if (ctx.auditorChange) {
    score -= 10;
  }

  // Qualified opinion (15 pts penalty)
  if (ctx.qualifiedOpinion) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
