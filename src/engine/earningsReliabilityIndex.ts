/**
 * Earnings Reliability Index (ERI)
 *
 * Unified earnings quality score combining:
 *   - Accrual quality (Sloan 1996)
 *   - Cash conversion
 *   - Manipulation probability (Beneish M-Score distance)
 *   - Persistence (earnings predictability)
 *   - Conservatism signal
 *
 * ERI modulates the fade rate: unreliable earnings → haircut ω.
 *
 * Academic basis:
 *   - Sloan (1996): accrual vs cash component persistence
 *   - Beneish (1999): M-Score manipulation detection
 *   - Dechow & Dichev (2002): accrual quality
 *   - Penman & Zhang (2002): accounting conservatism
 */

import type { RecastPeriod } from "./types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ERIResult {
  // Composite score (0-100)
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  confidence: "high" | "medium" | "low";

  // Component scores (each 0-100)
  components: {
    accrualQuality: number;
    cashConversion: number;
    manipulationDistance: number;
    persistence: number;
    conservatism: number;
  };

  // Weights used
  weights: {
    accrualQuality: number;
    cashConversion: number;
    manipulationDistance: number;
    persistence: number;
    conservatism: number;
  };

  // Valuation adjustment
  omegaHaircut: number;       // multiplier to apply to ω (0.5 to 1.0)
  valuationApproach: "earnings-based" | "hybrid" | "asset-based";

  // Flags
  flags: string[];            // specific concerns identified
  nPeriods: number;           // data points used
}

// ─── Core Implementation ───────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  accrualQuality: 0.25,
  cashConversion: 0.20,
  manipulationDistance: 0.25,
  persistence: 0.20,
  conservatism: 0.10,
};

/**
 * Compute the Earnings Reliability Index from recast data.
 */
export function computeERI(data: RecastPeriod[]): ERIResult | null {
  if (data.length < 3) return null;

  const flags: string[] = [];

  // ── Component 1: Accrual Quality ──
  // Lower |accrual ratio| = higher quality
  const accrualRatios = data
    .map(p => p.ratios?.accrual_ratio_cf ?? p.ratios?.accrual_ratio_bs)
    .filter((v): v is number => v != null);

  let accrualScore: number;
  if (accrualRatios.length >= 3) {
    const avgAbsAccrual = accrualRatios.reduce((s, v) => s + Math.abs(v), 0) / accrualRatios.length;
    // Score: 100 when accrual=0, 0 when |accrual|≥0.15
    accrualScore = Math.max(0, Math.min(100, 100 * (1 - avgAbsAccrual / 0.15)));
    if (avgAbsAccrual > 0.10) flags.push("High accrual ratio — earnings may not be sustainable");
  } else {
    accrualScore = 50; // neutral when insufficient data
  }

  // ── Component 2: Cash Conversion ──
  // CFO/NI close to 100% = high quality
  const cashConversions: number[] = [];
  for (const p of data) {
    const cfo = p.cf?.CFO;
    const ni = p.is?.PAT;
    if (cfo != null && ni != null && ni !== 0) {
      cashConversions.push(cfo / ni);
    }
  }

  let cashScore: number;
  if (cashConversions.length >= 3) {
    const medianCC = sortedMedian(cashConversions);
    // Score: 100 when CCR≥1.0, scales down when below, penalize if >2 (unusual)
    if (medianCC >= 1.0 && medianCC <= 2.0) {
      cashScore = 100;
    } else if (medianCC >= 0) {
      cashScore = Math.max(0, Math.min(100, medianCC * 100));
    } else {
      cashScore = 0;
      flags.push("Negative cash conversion — reported profits not generating cash");
    }
  } else {
    cashScore = 50;
  }

  // ── Component 3: Manipulation Distance (from Beneish M-Score) ──
  // Distance from -1.78 threshold (further below = safer)
  const mScores = data
    .map(p => p.quality?.beneish_mscore)
    .filter((v): v is number => v != null);

  let manipScore: number;
  if (mScores.length >= 2) {
    const latestM = mScores[mScores.length - 1]!;
    // Distance from threshold: -1.78
    // If M = -3.0, distance = 1.22 (safe); if M = -1.0, distance = -0.78 (dangerous)
    const distance = -1.78 - latestM; // positive = safe
    // Score: 100 when distance≥2, 0 when distance≤-1
    manipScore = Math.max(0, Math.min(100, (distance + 1) * 100 / 3));
    if (latestM > -1.78) flags.push("M-Score above threshold — elevated manipulation risk");
  } else {
    manipScore = 50;
  }

  // ── Component 4: Persistence ──
  // How predictable are earnings? Use coefficient of variation of NI
  const niSeries = data
    .map(p => p.is?.PAT)
    .filter((v): v is number => v != null && v !== 0);

  let persistenceScore: number;
  if (niSeries.length >= 5) {
    const mean = niSeries.reduce((s, v) => s + v, 0) / niSeries.length;
    const std = Math.sqrt(niSeries.reduce((s, v) => s + (v - mean) ** 2, 0) / niSeries.length);
    const cv = mean !== 0 ? std / Math.abs(mean) : 1;
    // Score: 100 when CV≤0.1 (very stable), 0 when CV≥0.6 (very volatile)
    persistenceScore = Math.max(0, Math.min(100, 100 * (1 - (cv - 0.1) / 0.5)));
    if (cv > 0.5) flags.push("High earnings volatility — low predictability");
  } else {
    persistenceScore = 50;
  }

  // ── Component 5: Conservatism ──
  // Conservative accounting = book value understates economic value
  // Proxy: consistent depreciation > capex (running down assets below replacement cost)
  // OR: reserves growing faster than revenue (building hidden value)
  const conservatismSignals: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const noa = data[i]!.bs?.NOA ?? 0;
    const prevNoa = data[i - 1]!.bs?.NOA ?? 0;
    const oi = data[i]!.is?.OI ?? 0;
    if (prevNoa > 0 && oi > 0) {
      // Penman-Zhang conservatism: NOA growth < earnings growth suggests conservative accounting
      const noaGrowth = (noa - prevNoa) / prevNoa;
      const oiNormalized = oi / prevNoa;
      conservatismSignals.push(oiNormalized - noaGrowth);
    }
  }

  let conservatismScore: number;
  if (conservatismSignals.length >= 3) {
    const avgSignal = conservatismSignals.reduce((s, v) => s + v, 0) / conservatismSignals.length;
    // Positive signal = conservative (earnings not capitalized into assets)
    conservatismScore = Math.max(0, Math.min(100, 50 + avgSignal * 500));
  } else {
    conservatismScore = 50;
  }

  // ── Composite ──
  const w = DEFAULT_WEIGHTS;
  const score = Math.round(
    w.accrualQuality * accrualScore +
    w.cashConversion * cashScore +
    w.manipulationDistance * manipScore +
    w.persistence * persistenceScore +
    w.conservatism * conservatismScore
  );

  // Grade
  let grade: ERIResult["grade"];
  if (score >= 80) grade = "A";
  else if (score >= 65) grade = "B";
  else if (score >= 50) grade = "C";
  else if (score >= 35) grade = "D";
  else grade = "F";

  // Omega haircut: ω_adjusted = ω × (0.5 + 0.5 × ERI/100)
  const omegaHaircut = 0.5 + 0.5 * score / 100;

  // Valuation approach recommendation
  let valuationApproach: ERIResult["valuationApproach"];
  if (score >= 60) valuationApproach = "earnings-based";
  else if (score >= 40) valuationApproach = "hybrid";
  else valuationApproach = "asset-based";

  // Confidence
  const nPeriods = data.length;
  let confidence: ERIResult["confidence"];
  if (nPeriods >= 10 && accrualRatios.length >= 5 && mScores.length >= 3) confidence = "high";
  else if (nPeriods >= 5) confidence = "medium";
  else confidence = "low";

  return {
    score,
    grade,
    confidence,
    components: {
      accrualQuality: Math.round(accrualScore),
      cashConversion: Math.round(cashScore),
      manipulationDistance: Math.round(manipScore),
      persistence: Math.round(persistenceScore),
      conservatism: Math.round(conservatismScore),
    },
    weights: w,
    omegaHaircut,
    valuationApproach,
    flags,
    nPeriods,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sortedMedian(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}
