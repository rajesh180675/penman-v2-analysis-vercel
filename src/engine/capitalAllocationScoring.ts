/**
 * Capital Allocation Scoring Module
 *
 * Scores management's capital allocation quality using purely financial
 * evidence from recast data. No qualitative inputs required.
 *
 * Five dimensions:
 *   1. Dividend Consistency   — stable, growing dividends vs erratic cuts
 *   2. Buyback Quality        — buybacks when SPREAD > 0 (value-accretive) vs dilutive issuance
 *   3. Reinvestment ROIC      — incremental NOA earns above kw?
 *   4. FCF Conversion         — CFO → FCF conversion quality over time
 *   5. Payout Sustainability  — dividends + buybacks covered by FCF?
 *
 * For banks: uses ROE-based reinvestment quality (retained earnings → ROE vs ke).
 *
 * Composite score 0–100. Grade: A (≥80), B (60–79), C (40–59), D (<40).
 */

import { RecastPeriod, EngineConfig, ke_from_config, deriveKwFromConfig } from "./types";
import { BankPeriodMetrics } from "./bankPipeline";

// ─── Output Types ─────────────────────────────────────────────────────────────

export type CapAllocGrade = "A" | "B" | "C" | "D";

export interface CapAllocDimension {
  name: string;
  score: number;        // 0–100
  weight: number;       // contribution weight in composite
  evidence: string[];   // human-readable evidence lines
  rawValues: Array<{ period: string; value: number | null }>;
}

export interface CapAllocScoreResult {
  /** Composite capital allocation score 0–100 */
  compositeScore: number;
  /** Letter grade */
  grade: CapAllocGrade;
  /** Individual dimension scores */
  dimensions: CapAllocDimension[];
  /** Median payout ratio (dividends / CNI) */
  medianPayoutRatio: number | null;
  /** Median FCF conversion (FCF / CNI) */
  medianFCFConversion: number | null;
  /** Median incremental ROIC on new NOA */
  medianIncrementalROIC: number | null;
  /** Periods where buybacks occurred with positive SPREAD */
  buybacksValueAccretive: number;
  /** Periods where equity was issued with negative SPREAD (dilutive) */
  dilutiveIssuances: number;
  /** Total periods analyzed */
  totalPeriods: number;
  /** Trend: improving or deteriorating allocation quality */
  trend: "improving" | "stable" | "deteriorating" | "insufficient-data";
  /** Notes on data quality or caveats */
  notes: string[];
}

/** Bank-specific capital allocation result */
export interface BankCapAllocResult {
  compositeScore: number;
  grade: CapAllocGrade;
  medianPayoutRatio: number | null;
  medianRetentionROE: number | null;  // ROE earned on retained earnings
  retentionValueAccretive: number;    // periods where retained ROE > ke
  totalPeriods: number;
  trend: "improving" | "stable" | "deteriorating" | "insufficient-data";
  notes: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function medianOf(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear score: value at or above `good` → 100, at or below `bad` → 0 */
function linearScore(value: number, bad: number, good: number): number {
  if (good === bad) return value >= good ? 100 : 0;
  return clamp(((value - bad) / (good - bad)) * 100, 0, 100);
}

function gradeFromScore(score: number): CapAllocGrade {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function trendFromSeries(scores: number[]): "improving" | "stable" | "deteriorating" | "insufficient-data" {
  if (scores.length < 4) return "insufficient-data";
  const half = Math.floor(scores.length / 2);
  const early = medianOf(scores.slice(0, half)) ?? 0;
  const late  = medianOf(scores.slice(-half)) ?? 0;
  const delta = late - early;
  if (delta > 8)  return "improving";
  if (delta < -8) return "deteriorating";
  return "stable";
}

// ─── Dimension 1: Dividend Consistency ───────────────────────────────────────

/**
 * Score dividend policy consistency.
 * - Stable or growing dividends over time → high score
 * - Cuts or zero dividends → lower score
 * - Erratic (high CV) → penalized
 */
function scoreDividendConsistency(
  periods: RecastPeriod[]
): CapAllocDimension {
  const rawValues: Array<{ period: string; value: number | null }> = [];
  const divs: number[] = [];

  for (const p of periods) {
    const div = p.cf.DividendPaid ?? 0;
    rawValues.push({ period: p.period_end, value: div });
    divs.push(div);
  }

  const evidence: string[] = [];

  if (divs.length < 2) {
    return {
      name: "Dividend Consistency",
      score: 50,
      weight: 0.20,
      evidence: ["Insufficient periods to assess dividend consistency"],
      rawValues,
    };
  }

  // Pct of periods with non-zero dividend
  const nonZero = divs.filter(d => d > 0).length;
  const nonZeroPct = nonZero / divs.length;

  // Coefficient of variation (lower = more consistent)
  const mean = divs.reduce((a, b) => a + b, 0) / divs.length;
  const variance = divs.reduce((s, d) => s + (d - mean) ** 2, 0) / divs.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;

  // Trend: count YoY increases
  let increases = 0, decreases = 0;
  for (let i = 1; i < divs.length; i++) {
    if (divs[i] > divs[i - 1] * 1.01) increases++;
    else if (divs[i] < divs[i - 1] * 0.99) decreases++;
  }
  const trendRatio = (increases - decreases) / (divs.length - 1);

  // Score components
  const presenceScore  = linearScore(nonZeroPct, 0.3, 1.0) * 0.4;
  const stabilityScore = linearScore(1 - cv, 0, 0.8) * 0.35;
  const trendScore     = linearScore(trendRatio, -1, 1) * 0.25;
  const score = clamp(presenceScore + stabilityScore + trendScore, 0, 100);

  evidence.push(`Dividends paid in ${nonZero}/${divs.length} periods (${(nonZeroPct * 100).toFixed(0)}%)`);
  evidence.push(`Coefficient of variation: ${cv.toFixed(2)} (lower = more consistent)`);
  evidence.push(`YoY increases: ${increases}, decreases: ${decreases}`);
  if (nonZeroPct < 0.5) evidence.push("Warning: dividends absent in majority of periods");
  if (cv > 0.5) evidence.push("Warning: high dividend volatility — erratic payout policy");

  return { name: "Dividend Consistency", score, weight: 0.20, evidence, rawValues };
}

// ─── Dimension 2: Buyback Quality ────────────────────────────────────────────

/**
 * Score buyback quality.
 * - Buybacks when SPREAD > 0 → value-accretive (good)
 * - Equity issuance when SPREAD < 0 → dilutive (bad)
 * - Buybacks when SPREAD < 0 → destroys value (bad)
 *
 * Review notes (W2):
 *   - Gross issuance is flagged separately from net issuance. A company that
 *     does ₹100Cr buyback and ₹110Cr issuance in the same year is NOT clean
 *     even though net issuance / buyback ≈ 1.1×. We track grossActivityRatio
 *     and surface it in evidence.
 *   - Periods with a buyback but missing SPREAD no longer silently park at
 *     neutral 50 — they're flagged as low-confidence in evidence and excluded
 *     from the median when the count exceeds 25% of buyback periods.
 *   - Median hides single-year disasters. We surface `worstYearScore` so
 *     reviewers see whether a strong median masks one ruinous decision.
 */
function scoreBuybackQuality(
  periods: RecastPeriod[],
): { dimension: CapAllocDimension; buybacksValueAccretive: number; dilutiveIssuances: number } {
  const rawValues: Array<{ period: string; value: number | null }> = [];
  const evidence: string[] = [];
  let buybacksValueAccretive = 0;
  let dilutiveIssuances = 0;
  let totalBuybackPeriods = 0;
  let totalIssuancePeriods = 0;
  let buybackWithoutSpread = 0;
  let totalGrossBuyback = 0;
  let totalGrossIssuance = 0;
  const periodScores: number[] = [];

  for (const p of periods) {
    const buyback  = p.cf.ShareBuybacks ?? 0;
    const issuance = p.cf.EquityIssued ?? 0;
    const spread   = p.ratios?.SPREAD ?? null;
    rawValues.push({ period: p.period_end, value: buyback - issuance });

    totalGrossBuyback  += Math.abs(buyback);
    totalGrossIssuance += Math.abs(issuance);

    let pScore: number | null = 50; // neutral baseline; null means "skip from median"

    if (buyback > 0) {
      totalBuybackPeriods++;
      if (spread !== null && spread > 0) {
        buybacksValueAccretive++;
        pScore = 80; // buyback with positive spread — good
      } else if (spread !== null && spread < 0) {
        pScore = 20; // buyback destroying value
      } else {
        // Buyback occurred but SPREAD is null — cannot judge value-accretion.
        // Don't pollute median with a fake neutral score.
        buybackWithoutSpread++;
        pScore = null;
      }
    }

    // Dilutive net-issuance check (existing semantics): equity issued
    // exceeds buyback amount by 10%+ in a SPREAD-negative year.
    if (issuance > buyback * 1.1) {
      totalIssuancePeriods++;
      if (spread !== null && spread < 0) {
        dilutiveIssuances++;
        pScore = pScore == null ? 15 : Math.min(pScore, 15); // dilutive issuance — bad
      }
    }

    if (pScore != null) periodScores.push(pScore);
  }

  // Gross-activity sanity check (W2a): big issuance offsetting big buybacks
  // is suspicious even when net is small. Threshold 1.1× chosen for symmetry
  // with the net-issuance test.
  const grossActivityRatio = totalGrossBuyback > 0
    ? totalGrossIssuance / totalGrossBuyback
    : null;

  const worstYearScore = periodScores.length > 0 ? Math.min(...periodScores) : null;
  const score = medianOf(periodScores) ?? 50;

  evidence.push(`Buyback periods: ${totalBuybackPeriods}/${periods.length}`);
  evidence.push(`Value-accretive buybacks (SPREAD > 0): ${buybacksValueAccretive}`);
  if (dilutiveIssuances > 0)
    evidence.push(`Dilutive equity issuances (SPREAD < 0): ${dilutiveIssuances}`);
  if (buybackWithoutSpread > 0)
    evidence.push(`Warning: ${buybackWithoutSpread} buyback period(s) with missing SPREAD — excluded from median (W2)`);
  if (grossActivityRatio != null && grossActivityRatio > 1.1 && totalGrossBuyback > 0)
    evidence.push(`Warning: gross issuance ${grossActivityRatio.toFixed(2)}× gross buyback — token-buyback-then-issue pattern (W2)`);
  if (totalBuybackPeriods === 0)
    evidence.push("No buyback activity detected — neutral score applied");
  if (worstYearScore != null && worstYearScore < 25 && score >= 50)
    evidence.push(`Warning: median ${score.toFixed(0)} masks a single-year disaster — worstYearScore = ${worstYearScore} (W2)`);

  return {
    dimension: {
      name: "Buyback Quality",
      score: clamp(score, 0, 100),
      weight: 0.15,
      evidence,
      rawValues,
    },
    buybacksValueAccretive,
    dilutiveIssuances,
  };
}

// ─── Dimension 3: Reinvestment ROIC ──────────────────────────────────────────

/**
 * Score incremental reinvestment quality.
 * Incremental ROIC = ΔCoreOI(t) / ΔNOA(t-1)
 * Compare against kw. Consistently above kw → high score.
 */
function scoreReinvestmentROIC(
  periods: RecastPeriod[],
  kw: number
): { dimension: CapAllocDimension; medianIncrementalROIC: number | null } {
  const rawValues: Array<{ period: string; value: number | null }> = [];
  const evidence: string[] = [];
  const incrementalROICs: number[] = [];

  for (let i = 1; i < periods.length; i++) {
    const prev = periods[i - 1];
    const curr = periods[i];
    const prevNOA  = Number.isFinite(prev.bs.NOA) ? prev.bs.NOA : null;
    const currNOA  = Number.isFinite(curr.bs.NOA) ? curr.bs.NOA : null;
    const prevCOI  = Number.isFinite(prev.cu.CoreOI ?? NaN) ? (prev.cu.CoreOI as number) : null;
    const currCOI  = Number.isFinite(curr.cu.CoreOI ?? NaN) ? (curr.cu.CoreOI as number) : null;

    let iROIC: number | null = null;
    if (prevNOA != null && currNOA != null && prevCOI != null && currCOI != null) {
      const dNOA     = currNOA - prevNOA;
      const dCoreOI  = currCOI - prevCOI;
      const taxRate  = curr.is.taxRate ?? 0.25;
      const dNOPAT   = dCoreOI * (1 - taxRate);

      // Use *signed* dNOA — same fix applied to moatScoring in commit 8a796f1.
      // When NOA shrinks (divestment), Math.abs would flip the sign of iROIC
      // and disagree with the moat module on the same period (review C6).
      if (Math.abs(dNOA) > 1) {
        iROIC = dNOPAT / dNOA;
      }
    }
    rawValues.push({ period: curr.period_end, value: iROIC });
    if (iROIC !== null && Number.isFinite(iROIC)) incrementalROICs.push(iROIC);
  }

  const medianIncrementalROIC = medianOf(incrementalROICs);

  let score = 50;
  if (medianIncrementalROIC !== null) {
    // Score: iROIC at kw → 50, at 2×kw → 100, at 0 → 0
    score = clamp(((medianIncrementalROIC - 0) / (2 * kw - 0)) * 100, 0, 100);
  }

  const periodsAboveKw = incrementalROICs.filter(r => r > kw).length;
  evidence.push(`Incremental ROIC computed for ${incrementalROICs.length} periods`);
  if (medianIncrementalROIC !== null)
    evidence.push(`Median incremental ROIC: ${(medianIncrementalROIC * 100).toFixed(1)}% vs kw ${(kw * 100).toFixed(1)}%`);
  evidence.push(`Periods with incremental ROIC > kw: ${periodsAboveKw}/${incrementalROICs.length}`);
  if (incrementalROICs.length < 3)
    evidence.push("Warning: fewer than 3 periods — incremental ROIC estimate is low confidence");

  return {
    dimension: {
      name: "Reinvestment ROIC",
      score: clamp(score, 0, 100),
      weight: 0.30,
      evidence,
      rawValues,
    },
    medianIncrementalROIC,
  };
}

// ─── Dimension 4: FCF Conversion ─────────────────────────────────────────────

/**
 * Score FCF conversion quality.
 * FCF conversion = FCF_cash / CNI
 * High, stable conversion → earnings are real cash.
 *
 * Calibration (review W8):
 *   med = 0    → 0  (no cash conversion)
 *   med = 0.6  → 50
 *   med = 1.0  → 83
 *   med = 1.2+ → 100
 *   med < 0    → 0  (FCF actively destroyed; clamped at zero)
 *
 * Previous formula `linearScore(med, 0, 1.2) * 0.8 + 20` floored the score
 * at 20, so deeply-negative-FCF firms could not score below 20. Removing the
 * +20 lets the score reach 0 for genuine cash-burning operations.
 */
function scoreFCFConversion(
  periods: RecastPeriod[]
): { dimension: CapAllocDimension; medianFCFConversion: number | null } {
  const rawValues: Array<{ period: string; value: number | null }> = [];
  const evidence: string[] = [];
  const conversions: number[] = [];

  for (const p of periods) {
    const fcf = p.cf.FCF_cash ?? null;
    const cni = p.is.CNI ?? null;
    let conv: number | null = null;
    if (fcf !== null && cni !== null && Math.abs(cni) > 1) {
      conv = fcf / cni;
    }
    rawValues.push({ period: p.period_end, value: conv });
    if (conv !== null && Number.isFinite(conv) && conv > -5 && conv < 10) {
      conversions.push(conv);
    }
  }

  const medianFCFConversion = medianOf(conversions);

  let score = 50;
  if (medianFCFConversion !== null) {
    // Linear score across [0, 1.2]; floor at 0, cap at 100. No artificial
    // +20 baseline — a structurally-cash-destroying firm scores 0.
    score = clamp(linearScore(medianFCFConversion, 0, 1.2), 0, 100);
  }

  // Penalize high variance
  if (conversions.length >= 3) {
    const mean = conversions.reduce((a, b) => a + b, 0) / conversions.length;
    const cv = mean > 0
      ? Math.sqrt(conversions.reduce((s, v) => s + (v - mean) ** 2, 0) / conversions.length) / mean
      : 1;
    if (cv > 0.5) score = clamp(score - 10, 0, 100);
    evidence.push(`FCF conversion CV: ${cv.toFixed(2)}`);
  }

  if (medianFCFConversion !== null)
    evidence.push(`Median FCF/CNI: ${(medianFCFConversion * 100).toFixed(0)}%`);
  const highConv = conversions.filter(c => c >= 0.8).length;
  evidence.push(`Periods with FCF/CNI ≥ 80%: ${highConv}/${conversions.length}`);

  return {
    dimension: {
      name: "FCF Conversion",
      score: clamp(score, 0, 100),
      weight: 0.20,
      evidence,
      rawValues,
    },
    medianFCFConversion,
  };
}

// ─── Dimension 5: Payout Sustainability ──────────────────────────────────────

/**
 * Score payout sustainability.
 * Total shareholder return (dividends + buybacks) vs FCF.
 * Covered by FCF → sustainable. Funded by debt/issuance → unsustainable.
 */
function scorePayoutSustainability(
  periods: RecastPeriod[]
): { dimension: CapAllocDimension; medianPayoutRatio: number | null } {
  const rawValues: Array<{ period: string; value: number | null }> = [];
  const evidence: string[] = [];
  const payoutRatios: number[] = [];
  const coverageRatios: number[] = [];

  for (const p of periods) {
    const div      = p.cf.DividendPaid ?? 0;
    const buyback  = p.cf.ShareBuybacks ?? 0;
    const cni      = p.is.CNI ?? 0;
    const fcf      = p.cf.FCF_cash ?? null;

    // Payout ratio = (div + buyback) / CNI
    let payoutRatio: number | null = null;
    if (cni > 1) {
      payoutRatio = (div + buyback) / cni;
      payoutRatios.push(payoutRatio);
    }
    rawValues.push({ period: p.period_end, value: payoutRatio });

    // FCF coverage = FCF / (div + buyback)
    const totalReturn = div + buyback;
    if (fcf !== null && totalReturn > 1) {
      coverageRatios.push(fcf / totalReturn);
    }
  }

  const medianPayoutRatio = medianOf(payoutRatios);
  const medianCoverage    = medianOf(coverageRatios);

  let score = 50;
  if (medianCoverage !== null) {
    // Coverage ≥ 1.2 → 100, coverage = 1.0 → 80, coverage < 0.5 → 20
    score = clamp(linearScore(medianCoverage, 0.3, 1.5) * 80 + 20, 0, 100);
  } else if (medianPayoutRatio !== null) {
    // Fallback: payout ratio 30–70% → good, >100% → bad
    score = clamp(linearScore(1 - Math.abs(medianPayoutRatio - 0.5), 0, 0.5) * 60 + 20, 0, 100);
  }

  if (medianPayoutRatio !== null)
    evidence.push(`Median payout ratio (div+buyback)/CNI: ${(medianPayoutRatio * 100).toFixed(0)}%`);
  if (medianCoverage !== null)
    evidence.push(`Median FCF coverage of payouts: ${medianCoverage.toFixed(2)}×`);
  const uncovered = coverageRatios.filter(c => c < 1.0).length;
  if (uncovered > 0)
    evidence.push(`Periods where payouts exceeded FCF: ${uncovered}/${coverageRatios.length}`);

  return {
    dimension: {
      name: "Payout Sustainability",
      score: clamp(score, 0, 100),
      weight: 0.15,
      evidence,
      rawValues,
    },
    medianPayoutRatio,
  };
}

// ─── Main: Industrial ─────────────────────────────────────────────────────────

/**
 * Score capital allocation quality for an industrial company.
 *
 * @param periods    Sorted (oldest→newest) recast periods
 * @param config     Engine config (for ke/kw)
 * @param kwOverride Optional structurally-derived kw to use instead of the
 *                   80/20 fallback in `deriveKwFromConfig`. v3Analytics passes
 *                   the same kw it uses for terminal-value math so capital
 *                   allocation scoring stays consistent across modules
 *                   (review C8, S-9.4C).
 */
export function scoreCapitalAllocation(
  periods: RecastPeriod[],
  config: EngineConfig,
  kwOverride?: number | null,
): CapAllocScoreResult {
  const notes: string[] = [];

  if (periods.length < 3) {
    notes.push("Fewer than 3 periods — scores are low confidence");
  }

  const kw = (kwOverride != null && Number.isFinite(kwOverride) && kwOverride > 0)
    ? kwOverride
    : deriveKwFromConfig(config);

  // Dimension 1: Dividend Consistency
  const divDim = scoreDividendConsistency(periods);

  // Dimension 2: Buyback Quality
  const { dimension: buyDim, buybacksValueAccretive, dilutiveIssuances } =
    scoreBuybackQuality(periods);

  // Dimension 3: Reinvestment ROIC
  const { dimension: reinvDim, medianIncrementalROIC } =
    scoreReinvestmentROIC(periods, kw);

  // Dimension 4: FCF Conversion
  const { dimension: fcfDim, medianFCFConversion } =
    scoreFCFConversion(periods);

  // Dimension 5: Payout Sustainability
  const { dimension: payDim, medianPayoutRatio } =
    scorePayoutSustainability(periods);

  const dimensions = [divDim, buyDim, reinvDim, fcfDim, payDim];

  // Weighted composite
  const compositeScore = clamp(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
    0, 100
  );

  // Trend: use reinvestment ROIC series as proxy (most forward-looking)
  const reinvRaw = reinvDim.rawValues
    .map(r => r.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const trend = trendFromSeries(reinvRaw.map(v => linearScore(v, 0, 2 * kw)));

  if (reinvRaw.length < 3) notes.push("Limited RNOA history — reinvestment ROIC confidence is low");
  if (dilutiveIssuances > 0)
    notes.push(`${dilutiveIssuances} dilutive equity issuance(s) detected when SPREAD was negative`);

  return {
    compositeScore,
    grade: gradeFromScore(compositeScore),
    dimensions,
    medianPayoutRatio,
    medianFCFConversion,
    medianIncrementalROIC,
    buybacksValueAccretive,
    dilutiveIssuances,
    totalPeriods: periods.length,
    trend,
    notes,
  };
}

// ─── Main: Bank ───────────────────────────────────────────────────────────────

/**
 * Score capital allocation quality for a bank.
 * Banks retain earnings to fund loan growth — reinvestment quality is
 * measured as ROE earned on retained earnings vs ke.
 *
 * @param bankMetrics  Per-period bank metrics (from bankPipeline)
 * @param periods      Recast periods (for dividend/buyback data)
 * @param config       Engine config
 */
export function scoreBankCapitalAllocation(
  bankMetrics: BankPeriodMetrics[],
  periods: RecastPeriod[],
  config: EngineConfig
): BankCapAllocResult {
  const notes: string[] = [];
  const ke = ke_from_config(config);

  if (bankMetrics.length < 3) {
    notes.push("Fewer than 3 periods — scores are low confidence");
  }

  // Payout ratio from recast periods
  const payoutRatios: number[] = [];
  for (const p of periods) {
    const div = p.cf.DividendPaid ?? 0;
    const cni = p.is.CNI ?? 0;
    if (cni > 1) payoutRatios.push(div / cni);
  }
  const medianPayoutRatio = medianOf(payoutRatios);

  // Retention ROE: ROE earned on retained earnings
  const retentionROEs: number[] = [];
  let retentionValueAccretive = 0;

  for (const bm of bankMetrics) {
    const roe = bm.roe ?? null;
    if (roe !== null && Number.isFinite(roe)) {
      retentionROEs.push(roe);
      if (roe > ke) retentionValueAccretive++;
    }
  }

  const medianRetentionROE = medianOf(retentionROEs);

  // Score: ROE vs ke
  let compositeScore = 50;
  if (medianRetentionROE !== null) {
    // ROE at ke → 50, at 1.5×ke → 100, at 0 → 0
    compositeScore = clamp(linearScore(medianRetentionROE, 0, 1.5 * ke), 0, 100);
  }

  // Payout adjustment: very high payout (>80%) for a bank is a red flag
  if (medianPayoutRatio !== null && medianPayoutRatio > 0.8) {
    compositeScore = clamp(compositeScore - 10, 0, 100);
    notes.push("High payout ratio (>80%) for a bank — limits capital retention for growth");
  }

  const trend = trendFromSeries(retentionROEs.map(r => linearScore(r, 0, 1.5 * ke) * 100));

  if (medianRetentionROE !== null)
    notes.push(`Median ROE: ${(medianRetentionROE * 100).toFixed(1)}% vs ke ${(ke * 100).toFixed(1)}%`);

  return {
    compositeScore,
    grade: gradeFromScore(compositeScore),
    medianPayoutRatio,
    medianRetentionROE,
    retentionValueAccretive,
    totalPeriods: bankMetrics.length,
    trend,
    notes,
  };
}
