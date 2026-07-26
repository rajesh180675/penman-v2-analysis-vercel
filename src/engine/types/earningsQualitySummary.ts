/**
 * Schema v22 — earnings-quality summary carried on the shared trust envelope.
 *
 * Pure type leaf: imports nothing, so the envelope type and the engine builder
 * can both depend on it without a cycle.
 *
 * The distinction this shape exists to preserve is MEASURED vs PLACEHOLDER.
 * `buildEarningsQualityCard` scores each of its four dimensions even when the
 * underlying input is missing, falling back to a neutral mid-band value — an
 * all-null card still reports 51/100 and calls itself "moderate". Publishing
 * that composite without saying which dimensions were actually observed would
 * put a number with a decimal point on the absence of evidence.
 */

/** The four Dechow-et-al dimensions the card scores, 25 points each. */
export type EarningsQualityDimension =
  | "timeliness"
  | "neutrality"
  | "completeness"
  | "realization";

export type EarningsQualityStatus =
  /** Every measured dimension is inside its clean band. */
  | "confirmed"
  /** At least one measured dimension is flagged, but not the blocking pair. */
  | "watch"
  /** Composite is in the card's own unreliable band, on enough measured input to mean it. */
  | "unreliable"
  /** No valuation ran, or no dimension had inputs — no claim either way. */
  | "absent";

export interface EarningsQualityCheck {
  readonly key: EarningsQualityDimension;
  readonly label: string;
  /** The card's score for this dimension, out of 25. */
  readonly score: number;
  /** False when the input was missing and the score is a neutral placeholder. */
  readonly measured: boolean;
  /** True when a measured dimension sits inside a band the card itself flags. */
  readonly flagged: boolean;
  readonly detail: string;
}

export interface EarningsQualitySummary {
  readonly status: EarningsQualityStatus;
  readonly summary: string;
  /**
   * The card's 0-100 composite, or null when nothing was measured. Null rather
   * than 51 on purpose: a composite assembled entirely from placeholders is not
   * a low score, it is the absence of a score.
   */
  readonly totalScore: number | null;
  /** How many of the four dimensions had real inputs. */
  readonly measuredCount: number;
  /** Keys of measured dimensions sitting in a band the card flags. */
  readonly flaggedDimensions: readonly EarningsQualityDimension[];
  /** Roychowdhury real-earnings-management flag, as reported by the card. */
  readonly remFlag: boolean;
  /** The card's own human-readable flags, carried through verbatim. */
  readonly flags: readonly string[];
  readonly checks: readonly EarningsQualityCheck[];
}
