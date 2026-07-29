/**
 * Economic Moat Scoring — output types.
 */

// ─── Output Types ─────────────────────────────────────────────────────────────

export type MoatWidth = "wide" | "narrow" | "none" | "insufficient-data";

export interface MoatDimension {
  name: string;
  score: number;          // 0–100
  weight: number;         // contribution weight in composite
  evidence: string[];     // human-readable evidence lines
  rawValues: Array<{ period: string; value: number | null }>;
}

export interface CAPEstimate {
  /** Estimated years until RNOA fades to kw (competitive advantage period) */
  years: number | null;
  /** AR(1) phi used for fade estimation */
  phi: number | null;
  /** Latest RNOA */
  latestRNOA: number | null;
  /** Cost of capital (kw) used as fade target */
  kw: number;
  /** Confidence in CAP estimate */
  confidence: "high" | "medium" | "low";
  /** Method used */
  method: "ar1-fade" | "linear-extrapolation" | "insufficient-data";
}

export interface MoatScoreResult {
  /** Composite moat score 0–100 */
  compositeScore: number;
  /** Moat width classification */
  moatWidth: MoatWidth;
  /** Individual dimension scores */
  dimensions: MoatDimension[];
  /** Competitive advantage period estimate */
  cap: CAPEstimate;
  /** Number of periods with SPREAD > 0 */
  periodsAboveCostOfCapital: number;
  /** Number of periods with SPREAD > 5% */
  periodsWithStrongSpread: number;
  /**
   * Periods carrying a finite SPREAD — the population both counts above are
   * drawn from, and always smaller than `totalPeriods`: the pipeline computes
   * ratios only from the second period onward (pipeline.ts:285), so the oldest
   * period never has one. Reported separately because
   * `periodsAboveCostOfCapital / totalPeriods` reads as periods that failed to
   * clear kw when some of them were never measured.
   */
  spreadMeasuredPeriods: number;
  /** Total periods analyzed */
  totalPeriods: number;
  /** Median RNOA across history */
  medianRNOA: number | null;
  /** Median SPREAD across history */
  medianSPREAD: number | null;
  /** Median CoreSalesPM across history */
  medianCorePM: number | null;
  /** Trend: is moat strengthening or eroding? */
  moatTrend: "strengthening" | "stable" | "eroding" | "insufficient-data";
  /** Notes on data quality */
  notes: string[];
  /**
   * Phase I robustness — was the underlying data sufficient to produce a
   * meaningful moat assessment? False when company has fewer than 3
   * periods of positive RNOA (loss-makers, structurally unprofitable
   * businesses). The "moat" framework's premise is RNOA durability above
   * cost of capital — incoherent for a company that has never earned
   * positive operating returns.
   */
  dataSufficient: boolean;
  /** When dataSufficient is false, the human-readable reason. null otherwise. */
  skipReason: string | null;
  /** Number of periods with positive RNOA. */
  positiveRNOAPeriods: number;
}

/** Bank-specific moat result (ROE-based) */
export interface BankMoatResult {
  compositeScore: number;
  moatWidth: MoatWidth;
  medianROE: number | null;
  medianROESpread: number | null;  // ROE − ke
  periodsAboveKe: number;
  totalPeriods: number;
  cap: CAPEstimate;
  moatTrend: "strengthening" | "stable" | "eroding" | "insufficient-data";
  notes: string[];
}
