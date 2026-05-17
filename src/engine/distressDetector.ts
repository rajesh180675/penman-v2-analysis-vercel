/**
 * Financial Distress Detection — Phase J1
 *
 * Earnings-based and equity-based valuation models (Penman-Nissim residual
 * income, EPV per-share, sustainable DDM, justified P/B) all anchor on
 * common shareholders' equity (CSE / book value). When CSE is negative,
 * these models produce mathematically defined but economically meaningless
 * outputs:
 *
 *   - V_RE = CSE0 + pvRE + CV/discE  →  deeply negative intrinsic value
 *   - epvPerShare = V_EPV / shares    →  positive but interpreted as
 *                                        "fair value of insolvent equity"
 *   - implied_pb = price / book       →  flips sign; ranking becomes wrong
 *   - sustainable DDM                 →  payout × ROE × bookValue collapses
 *
 * The right behaviour is to fail-closed on equity-side models and surface
 * a distress flag to the user. Enterprise-side models (EV/Sales, FCFF on
 * NOA, reverse-DCF) and loss-maker valuation anchors remain meaningful
 * because they don't anchor on equity.
 *
 * Canonical Indian cases (FY2025):
 *   - Vodafone Idea — accumulated losses + AGR liability => CSE < 0 since FY19
 *   - Indiabulls Real Estate (pre-merger) — sustained losses
 *   - Suzlon Energy (pre-restructuring) — defaulted FCCB write-off
 *   - Some PSU banks pre-recap — gross NPA wiped CET1
 *
 * This is a detector, not a normaliser: it doesn't try to "fix" the data,
 * it just tells downstream consumers that equity-side models cannot be
 * trusted on this dataset.
 */

import type { RecastPeriod } from "./types";

/**
 * Severity of the distress signal.
 *
 * - "none": No negative-equity periods detected.
 * - "warning": One isolated negative-equity period (could be one-off, e.g.,
 *   restructuring charge that reverses next year). Equity-side models still
 *   skip on the affected period but trend may be recoverable.
 * - "severe": ≥2 consecutive negative-equity periods OR latest CSE is
 *   negative. Going-concern equity is structurally impaired; equity-side
 *   models must skip.
 * - "critical": ≥3 consecutive negative-equity periods AND latest is
 *   negative AND latest CFO is non-positive (cash burn on top of equity
 *   destruction). Likely zombie / pre-restructuring case.
 */
export type DistressSeverity = "none" | "warning" | "severe" | "critical";

export interface DistressAssessment {
  /** True when latest period or any period has CSE ≤ 0. */
  hasNegativeEquity: boolean;
  /** Number of periods (out of total) where CSE ≤ 0. */
  negativeEquityPeriods: number;
  /** Total periods analysed. */
  totalPeriods: number;
  /** Whether latest period has CSE ≤ 0 (the gate that drives most skips). */
  latestCSENegative: boolean;
  /** Latest CSE in Cr (raw value, may be negative). */
  latestCSE: number | null;
  /** Latest NFO in Cr (positive = net debt; high NFO + negative CSE is the
   *  classic "underwater" signature). */
  latestNFO: number | null;
  /** Latest CFO in Cr. Negative on top of negative equity = critical. */
  latestCFO: number | null;
  /** Approximate runway in years at current cash-burn (null when CFO ≥ 0
   *  or no cash position can be derived). */
  runwayYearsAtCFOBurn: number | null;
  /** Severity bucket for UI banners. */
  severity: DistressSeverity;
  /** Whether equity-side valuation models (RE, per-share EPV, DDM, P/B)
   *  should fail-closed. Convenience flag — equivalent to severity in
   *  ["severe", "critical"] OR latestCSENegative. */
  equityModelsBlocked: boolean;
  /** Plain-language reasons for UI / audit trail. */
  reasons: string[];
}

/**
 * Detect financial distress from a recast period series.
 *
 * The detector is intentionally conservative: a single negative period
 * surfaces a "warning" rather than blocking equity-side models, so that
 * a one-off impairment doesn't disable the whole valuation stack. Latest
 * CSE ≤ 0 always blocks (severity ≥ "severe") because every equity-side
 * model uses latest CSE as its anchor.
 */
export function detectDistress(
  periods: RecastPeriod[] | null | undefined,
): DistressAssessment {
  if (!periods || periods.length === 0) {
    return {
      hasNegativeEquity: false,
      negativeEquityPeriods: 0,
      totalPeriods: 0,
      latestCSENegative: false,
      latestCSE: null,
      latestNFO: null,
      latestCFO: null,
      runwayYearsAtCFOBurn: null,
      severity: "none",
      equityModelsBlocked: false,
      reasons: [],
    };
  }

  const sorted = [...periods].sort(
    (a, b) =>
      new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  const latest = sorted[sorted.length - 1];
  const latestCSE = latest?.bs?.CSE ?? null;
  const latestNFO = latest?.bs?.NFO ?? null;
  const latestCFO = latest?.cf?.CFO ?? null;

  // Count negative-equity periods
  const cseSeries = sorted.map((p) => p.bs?.CSE);
  const negativeEquityPeriods = cseSeries.filter(
    (cse) => cse != null && Number.isFinite(cse) && cse <= 0,
  ).length;
  const totalPeriods = sorted.length;
  const hasNegativeEquity = negativeEquityPeriods > 0;

  const latestCSENegative =
    latestCSE != null && Number.isFinite(latestCSE) && latestCSE <= 0;

  // Longest run of consecutive negative-equity periods (useful for severity).
  // Walks the sorted series and tracks the current and best run length.
  let longestNegativeRun = 0;
  let currentRun = 0;
  for (const cse of cseSeries) {
    if (cse != null && Number.isFinite(cse) && cse <= 0) {
      currentRun++;
      if (currentRun > longestNegativeRun) longestNegativeRun = currentRun;
    } else {
      currentRun = 0;
    }
  }

  // Cash-burn runway. Only meaningful when CFO < 0 and we have a positive
  // cash anchor. Use net cash = -NFO when NFO < 0 (net cash position).
  let runwayYearsAtCFOBurn: number | null = null;
  if (
    latestCFO != null &&
    Number.isFinite(latestCFO) &&
    latestCFO < 0 &&
    latestNFO != null &&
    Number.isFinite(latestNFO) &&
    latestNFO < 0
  ) {
    const netCash = -latestNFO;
    runwayYearsAtCFOBurn = netCash / Math.abs(latestCFO);
  }

  // Severity ladder
  const reasons: string[] = [];
  let severity: DistressSeverity = "none";

  if (!hasNegativeEquity) {
    // Clean state — return early
    return {
      hasNegativeEquity: false,
      negativeEquityPeriods: 0,
      totalPeriods,
      latestCSENegative: false,
      latestCSE,
      latestNFO,
      latestCFO,
      runwayYearsAtCFOBurn,
      severity: "none",
      equityModelsBlocked: false,
      reasons: [],
    };
  }

  // Warning: isolated negative period, latest is positive
  if (longestNegativeRun === 1 && !latestCSENegative) {
    severity = "warning";
    reasons.push(
      `One isolated period of negative equity in history (${negativeEquityPeriods}/${totalPeriods}); latest equity is positive but model trust is reduced.`,
    );
  }

  // Severe: latest is negative OR ≥2 consecutive negative periods
  if (latestCSENegative || longestNegativeRun >= 2) {
    severity = "severe";
    if (latestCSENegative) {
      reasons.push(
        `Latest common shareholders' equity is ≤ 0 (${
          latestCSE != null ? latestCSE.toFixed(0) : "?"
        } Cr); equity-side valuation models (RE, DDM, per-share EPV) cannot be trusted.`,
      );
    }
    if (longestNegativeRun >= 2) {
      reasons.push(
        `Longest run of consecutive negative-equity periods is ${longestNegativeRun}; structural rather than one-off.`,
      );
    }
  }

  // Critical: severe + cash burn on top
  if (
    longestNegativeRun >= 3 &&
    latestCSENegative &&
    latestCFO != null &&
    latestCFO <= 0
  ) {
    severity = "critical";
    reasons.push(
      `Cash flow from operations is non-positive (${latestCFO.toFixed(0)} Cr) on top of sustained negative equity — going-concern stress.`,
    );
    if (runwayYearsAtCFOBurn != null) {
      reasons.push(
        `Estimated runway at current burn: ${runwayYearsAtCFOBurn.toFixed(1)} years.`,
      );
    }
  }

  // Equity-side models block when severity is severe or critical.
  // Warning lets them publish — the affected period is in history, latest
  // is positive, so anchoring on latest CSE is still valid.
  const equityModelsBlocked = severity === "severe" || severity === "critical";

  return {
    hasNegativeEquity,
    negativeEquityPeriods,
    totalPeriods,
    latestCSENegative,
    latestCSE,
    latestNFO,
    latestCFO,
    runwayYearsAtCFOBurn,
    severity,
    equityModelsBlocked,
    reasons,
  };
}
