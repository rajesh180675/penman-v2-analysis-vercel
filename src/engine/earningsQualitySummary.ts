/**
 * Schema v22 — envelope-facing view of the earnings-quality card.
 *
 * The card (`buildEarningsQualityCard`) already scores four Dechow-et-al
 * dimensions and is rendered on the Quality tab. What it did not do is take a
 * position the rigor ladder can act on, for two reasons this module fixes:
 *
 *  1. It scores every dimension whether or not the input existed, defaulting to
 *     a neutral mid-band value. An all-null card reports 51/100 and labels
 *     itself "moderate" — a composite built entirely from placeholders. The card
 *     now reports which dimensions were measured; this summary refuses to
 *     publish a composite when none were.
 *  2. Its label is advisory prose. The ladder needs a discrete status.
 */

import type { EarningsQualityCard } from "./earningsQuality";
import type {
  EarningsQualityCheck,
  EarningsQualityDimension,
  EarningsQualityStatus,
  EarningsQualitySummary,
} from "./types/earningsQualitySummary";

/**
 * The card's own boundary for "unreliable for valuation purposes" (see its
 * label bands). Deliberately not a fresh cutoff invented here: the gate asserts
 * what the scorecard already asserts in prose.
 */
export const EARNINGS_QUALITY_UNRELIABLE_SCORE = 40;

/**
 * Minimum measured dimensions before the composite may block a run. Placeholder
 * points sum to 51, so a score below 40 always implies at least one genuinely
 * bad measured dimension — but with only one measured input the composite is
 * still mostly filler, and a release claim should not turn on filler. Below this
 * the run is reported `watch`: visible to a reviewer, not blocking.
 */
export const EARNINGS_QUALITY_MIN_MEASURED_TO_BLOCK = 2;

function statusFor(
  measuredCount: number,
  totalScore: number,
  flaggedCount: number,
  remFlag: boolean,
): EarningsQualityStatus {
  if (measuredCount === 0) return "absent";
  if (totalScore < EARNINGS_QUALITY_UNRELIABLE_SCORE && measuredCount >= EARNINGS_QUALITY_MIN_MEASURED_TO_BLOCK) {
    return "unreliable";
  }
  // Real earnings management is reported, never blocking on its own. The
  // Roychowdhury proxy here is a sales-growth divergence heuristic with an
  // uncalibrated 10%-of-sales threshold; it belongs in a reviewer's eyeline, not
  // in a fail-closed gate.
  if (flaggedCount > 0 || remFlag) return "watch";
  return "confirmed";
}

function summaryLine(
  status: EarningsQualityStatus,
  measuredCount: number,
  totalScore: number,
  flagged: readonly EarningsQualityDimension[],
  remFlag: boolean,
): string {
  const measuredNote = `${measuredCount} of 4 quality dimensions measured`;
  switch (status) {
    case "absent":
      return "No earnings-quality dimension had inputs, so the scorecard reports no assessment. Its composite would be placeholder points only.";
    case "unreliable":
      return `Earnings quality scores ${totalScore}/100 — inside the scorecard's unreliable-for-valuation band (${measuredNote}). Flagged: ${flagged.join(", ")}.`;
    case "watch":
      return `Earnings quality scores ${totalScore}/100 with ${measuredNote}.${flagged.length ? ` Flagged: ${flagged.join(", ")}.` : ""}${remFlag ? " Real earnings management signals are present." : ""}`;
    case "confirmed":
    default:
      return `Earnings quality scores ${totalScore}/100 with ${measuredNote}; no measured dimension is flagged.`;
  }
}

/**
 * Project the card onto the envelope. `null` in (no valuation ran) yields
 * `absent` — silence about earnings quality must not read as a clean bill.
 */
export function buildEarningsQualitySummary(
  card: EarningsQualityCard | null | undefined,
): EarningsQualitySummary {
  if (card == null) {
    return {
      status: "absent",
      summary: "No valuation ran, so no earnings-quality scorecard was produced.",
      totalScore: null,
      measuredCount: 0,
      flaggedDimensions: [],
      remFlag: false,
      flags: [],
      checks: [],
    };
  }

  const checks: EarningsQualityCheck[] = card.dimensions.map((dimension) => ({ ...dimension }));
  const measuredCount = checks.filter((check) => check.measured).length;
  const flaggedDimensions = checks.filter((check) => check.flagged).map((check) => check.key);
  const status = statusFor(measuredCount, card.totalScore, flaggedDimensions.length, card.remFlag);

  return {
    status,
    summary: summaryLine(status, measuredCount, card.totalScore, flaggedDimensions, card.remFlag),
    // Null when nothing was measured: the composite would be placeholder points,
    // and a placeholder is not a low score.
    totalScore: measuredCount > 0 ? card.totalScore : null,
    measuredCount,
    flaggedDimensions,
    remFlag: card.remFlag,
    flags: [...card.flags],
    checks,
  };
}
