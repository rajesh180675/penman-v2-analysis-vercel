/**
 * IT-Services Detector — Phase E1
 *
 * Identifies IT-services companies (TCS, Infosys, Wipro, HCL Tech, etc.)
 * from recast data using two financial fingerprints:
 *
 *   1. Employee cost ratio > 40% of revenue  (human-capital intensity)
 *   2. PPE / Total Assets < 10%              (asset-light model)
 *
 * Both conditions must hold in the MEDIAN period to avoid false positives
 * from single-year anomalies (e.g. a manufacturing company in a capex trough).
 *
 * Why this matters:
 *   - RNOA/ATO decomposition is misleading for IT: NOA is tiny (mostly
 *     receivables + cash), so RNOA looks astronomically high and ATO
 *     is meaningless. The real value driver is revenue per employee,
 *     margin durability, and FCFE yield.
 *   - Moat scoring based on RNOA persistence overstates the moat width
 *     because the denominator (NOA) is structurally small.
 *   - Terminal value anchored on RNOA mean-reversion is wrong — IT
 *     companies don't revert to industrial RNOA norms.
 *
 * Output is advisory — the industrial pipeline still runs, but the UI
 * surfaces a caveat banner and the moat scorer notes the limitation.
 */

import type { RecastPeriod } from "./types";

export interface ITServicesSignal {
  /** True when both fingerprints fire in the median period. */
  isITServices: boolean;
  /** Median employee cost as a fraction of revenue (0–1). */
  medianEmployeeCostRatio: number | null;
  /** Median PPE as a fraction of total assets (0–1). */
  medianPPERatio: number | null;
  /** Human-readable reason string. */
  reason: string;
  /** Number of periods analysed. */
  periodsAnalysed: number;
}

/** Thresholds — conservative to avoid false positives. */
const EMPLOYEE_COST_RATIO_THRESHOLD = 0.40; // > 40% of revenue
const PPE_RATIO_THRESHOLD           = 0.10; // < 10% of total assets
const MIN_PERIODS                   = 2;    // need at least 2 periods

function medianOf(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v) && v >= 0);
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Detect whether a company is an IT-services business from recast periods.
 *
 * @param periods  Sorted recast periods (oldest → newest). Needs ≥2 periods.
 */
export function detectITServices(periods: RecastPeriod[]): ITServicesSignal {
  const UNKNOWN: ITServicesSignal = {
    isITServices: false,
    medianEmployeeCostRatio: null,
    medianPPERatio: null,
    reason: "Insufficient data to classify",
    periodsAnalysed: 0,
  };

  if (!periods || periods.length < MIN_PERIODS) return UNKNOWN;

  const employeeCostRatios: number[] = [];
  const ppeRatios: number[] = [];

  for (const p of periods) {
    const sales = p.is?.Sales;
    const employeeCost = p.is?.operatingCostBridge?.employeeCost;
    const ppe = p.bs?.PPE;
    const ta = p.bs?.TA;

    if (
      sales != null && sales > 0 &&
      employeeCost != null && Number.isFinite(employeeCost)
    ) {
      employeeCostRatios.push(employeeCost / sales);
    }

    if (
      ta != null && ta > 0 &&
      ppe != null && Number.isFinite(ppe) && ppe >= 0
    ) {
      ppeRatios.push(ppe / ta);
    }
  }

  const medianEmployeeCostRatio = medianOf(employeeCostRatios);
  const medianPPERatio = medianOf(ppeRatios);
  const periodsAnalysed = periods.length;

  // Need both signals to fire
  if (medianEmployeeCostRatio == null || medianPPERatio == null) {
    return {
      isITServices: false,
      medianEmployeeCostRatio,
      medianPPERatio,
      reason: "Missing employee cost or PPE data — cannot classify",
      periodsAnalysed,
    };
  }

  const highEmployeeCost = medianEmployeeCostRatio > EMPLOYEE_COST_RATIO_THRESHOLD;
  const assetLight       = medianPPERatio < PPE_RATIO_THRESHOLD;
  const isITServices     = highEmployeeCost && assetLight;

  if (isITServices) {
    return {
      isITServices: true,
      medianEmployeeCostRatio,
      medianPPERatio,
      reason: `IT-services fingerprint: employee cost ${(medianEmployeeCostRatio * 100).toFixed(1)}% of revenue (>${(EMPLOYEE_COST_RATIO_THRESHOLD * 100).toFixed(0)}%) and PPE ${(medianPPERatio * 100).toFixed(1)}% of assets (<${(PPE_RATIO_THRESHOLD * 100).toFixed(0)}%)`,
      periodsAnalysed,
    };
  }

  const reasons: string[] = [];
  if (!highEmployeeCost) {
    reasons.push(`employee cost ${(medianEmployeeCostRatio * 100).toFixed(1)}% ≤ ${(EMPLOYEE_COST_RATIO_THRESHOLD * 100).toFixed(0)}% threshold`);
  }
  if (!assetLight) {
    reasons.push(`PPE ${(medianPPERatio * 100).toFixed(1)}% ≥ ${(PPE_RATIO_THRESHOLD * 100).toFixed(0)}% threshold`);
  }

  return {
    isITServices: false,
    medianEmployeeCostRatio,
    medianPPERatio,
    reason: `Not IT-services: ${reasons.join("; ")}`,
    periodsAnalysed,
  };
}
