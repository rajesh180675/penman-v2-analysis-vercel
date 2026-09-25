import type { RecastPeriod } from "../types";

export const SELF_CONSISTENT_VALUATION_MODEL_VERSION = "2026-09-scv-v1" as const;

export interface SelfConsistentValuationInput {
  /** Recast history, oldest first. The LAST period is the valuation date. */
  readonly history: readonly RecastPeriod[];
  /** Cost of equity for the issuer as it stands (CAPM on its current structure). */
  readonly ke: number;
  /** Terminal growth of operating assets. */
  readonly g: number;
  /**
   * After-tax rate on net financial obligations, used when the reported
   * NFE/NFO is unusable (tiny NFO, or a ratio outside 0–20%).
   */
  readonly kdFallback: number;
  /** Diluted shares, crore. Per-share output is null without it. */
  readonly shares?: number | null | undefined;
  /** ₹ per share. Enables market-weighted kw and market-implied persistence. */
  readonly marketPrice?: number | null | undefined;
  /**
   * Period ends of detected structural breaks (pipeline `structuralBreakPeriods`).
   * Persistence is estimated after the last one when enough history follows.
   */
  readonly structuralBreakPeriods?: readonly string[] | undefined;
  /** Explicit forecast years. Default 10. */
  readonly horizon?: number | undefined;
}

export interface SelfConsistentForecastYear {
  readonly year: number;
  readonly periodEnd: string;
  readonly noaOpening: number;
  readonly rnoa: number;
  readonly spread: number;
  readonly reoi: number;
  readonly presentValue: number;
}

export interface SelfConsistentSensitivityCell {
  readonly ke: number;
  readonly omega: number;
  readonly kw: number | null;
  readonly equityValue: number | null;
  readonly perShare: number | null;
}

export type OmegaSource = "company-shrunk" | "prior";
export type KdSource = "reported-nfe-over-nfo" | "fallback";

export interface SelfConsistentValuation {
  readonly status: "ok";
  readonly modelVersion: typeof SELF_CONSISTENT_VALUATION_MODEL_VERSION;
  readonly anchorPeriod: string;
  readonly equityValue: number;
  readonly operatingValue: number;
  readonly perShare: number | null;
  readonly marginOfSafety: number | null;
  readonly kw: {
    /** Fixed point of kw = (ke·(V_E + MI) + kd·NFO) / V_op on the model's own values. */
    readonly intrinsic: number;
    /** The same formula on BOOK weights — what deriveKwFromStructure uses. */
    readonly book: number;
    /** On market-cap weights, when a price is supplied. */
    readonly market: number | null;
    readonly kd: number;
    readonly kdSource: KdSource;
    readonly iterations: number;
  };
  readonly fade: {
    /** Persistence of the RNOA spread over kw (Nissim–Penman fade). */
    readonly omega: number;
    readonly omegaSource: OmegaSource;
    /** Raw AR(1) estimate before shrinkage, when there was history for one. */
    readonly omegaRaw: number | null;
    readonly observations: number;
    readonly rnoa0: number;
    readonly spread0: number;
    readonly growth0: number;
  };
  readonly decomposition: {
    readonly noa: number;
    readonly pvExplicitReOI: number;
    readonly pvTerminalReOI: number;
    readonly nfo: number;
    readonly minorityInterest: number;
    /** V_op − NOA: value of abnormal operating profitability. */
    readonly franchiseValue: number;
    /** PV of the post-horizon ReOI as a share of operating value. */
    readonly terminalShare: number;
  };
  readonly forecast: readonly SelfConsistentForecastYear[];
  readonly sensitivity: readonly SelfConsistentSensitivityCell[];
  /** The ω that makes the model's equity value equal market cap (kw at market weights). */
  readonly marketImpliedOmega: number | null;
  readonly warnings: readonly string[];
}

export interface SelfConsistentValuationSkip {
  readonly status: "skipped";
  readonly modelVersion: typeof SELF_CONSISTENT_VALUATION_MODEL_VERSION;
  readonly reason: string;
}

export type SelfConsistentValuationResult = SelfConsistentValuation | SelfConsistentValuationSkip;
