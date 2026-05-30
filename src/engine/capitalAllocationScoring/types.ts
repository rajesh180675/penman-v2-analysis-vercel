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
  /**
   * Phase I robustness — was the underlying data sufficient to produce a
   * meaningful score? False when company has fewer than 3 periods of
   * positive CNI (loss-makers, turnarounds), in which case the composite
   * score should be treated as advisory and the UI should surface the
   * skip reason rather than displaying the score as authoritative.
   */
  dataSufficient: boolean;
  /** When dataSufficient is false, the human-readable reason. null otherwise. */
  skipReason: string | null;
  /** Number of periods with positive CNI (profitable periods). */
  profitablePeriods: number;
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
