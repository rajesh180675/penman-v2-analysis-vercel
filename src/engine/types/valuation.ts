/* ================================================================
   Valuation outputs
   Residual-Earnings, ReOI, FCF, AEG, per-share results, and the
   growth-accounting decomposition. Inputs (EngineConfig) live in
   ./config; recast inputs in ./recast.
================================================================ */

import type { ContaminationResult } from "./quality";

/* ── S-17.2: Growth Accounting ──────────────────────────────────── */

export interface GrowthAccounting {
  /** No-growth value: CSE0 + (RNOA_T - kw)*NOA_T / kw — value from existing assets */
  noGrowthValue: number;
  /** Growth value: totalValue - noGrowthValue */
  growthValue: number;
  /** Fraction of total value attributable to growth: growthValue / totalValue */
  growthFromExistingAssets: number;  // % from existing assets
  growthFromReinvestment: number;     // % from growth/reinvestment
}

/* ── Valuation ──────────────────────────────────────────────────── */

export interface ValuationResult {
  reSeries: Array<{period:string;RE:number;ReOI:number}>;
  pvRE: number; pvReOI: number;
  CV_RE: number; CV_ReOI: number; EV_ReOI: number;
  /** Phase J2: equity-side values are null when latest CSE ≤ 0 (negative
   *  net worth). Enterprise-side V_ReOI_* remain published since they
   *  anchor on NOA/NFO, not CSE, and stay economically meaningful. */
  V_RE_CV1: number | null; V_RE_CV2: number | null; V_RE_CV3: number | null;
  V_ReOI_CV01: number; V_ReOI_CV02: number; V_ReOI_CV03: number;
  CSE0: number; NOA0: number; NFO_latest: number;
  ke: number; kw: number; g: number;
  separationScore: number; lowConfidence: boolean;
  /** Phase J2: true when equity-side models could not be computed due
   *  to negative latest CSE; consumers should display skip-with-reason
   *  cards instead of plotting V_RE_CV3 on intrinsic-value charts. */
  equityModelsBlocked?: boolean | undefined;
  /** Plain-language reason when equityModelsBlocked is true. */
  equityBlockedReason?: string | null | undefined;
  impliedGrowthRE?: number | undefined;
  // S-11.1: AR(1) reversion continuing values
  CV_RE_reversion?: number | undefined;
  CV_ReOI_reversion?: number | undefined;
  RE_phi?: number | undefined;
  ReOI_phi?: number | undefined;
  RE_phi_r_squared?: number | undefined;
  ReOI_phi_r_squared?: number | undefined;
  RE_CV_divergence?: number | undefined;
  ReOI_CV_divergence?: number | undefined;
  // S-17.2: Growth accounting decomposition
  // Phase J2: also nullable when equity-side blocked (uses CSE0).
  V_no_growth?: number | null | undefined;
  growthValue?: number | null | undefined;
  growthFraction?: number | null | undefined;
  growthAccountingPerShare?: {
    vNoGrowthPerShare: number | null;
    growthValuePerShare: number | null;
    growthFraction: number | null;
    noGrowthFraction: number | null;
  } | undefined;
  fcf?: FCFValuation | undefined;
  aeg?: AEGValuation | undefined;
  perShare?: PerShareResult | undefined;
}

export interface PerShareResult {
  intrinsic_re_per_share: number | null;
  intrinsic_reoi_per_share: number | null;
  intrinsic_fcff_per_share: number | null;
  intrinsic_fcfe_per_share: number | null;
  intrinsic_ddm_per_share: number | null;
  intrinsic_aeg_per_share: number | null;
  implied_pb_re: number | null;
  implied_pe_re: number | null;
  margin_of_safety_re: number | null;
  implied_growth_rate: number | null;
}

export interface FCFValuation {
  fcff_series: Array<{ period: string; NOPAT: number; dNOA: number; FCFF: number; PV_FCFF: number }>;
  fcfe_series: Array<{ period: string; CNI: number; dCSE: number; FCFE: number; PV_FCFE: number }>;
  EV_FCFF: number; V_FCFE: number; CV_FCFF: number; CV_FCFE: number;
}

export interface AEGValuation {
  aeg_series: Array<{ period: string; CNI: number; AEG: number; PV_AEG: number }>;
  V_AEG: number; implied_pe: number | null; normalised_pe: number | null;
}

/* ── V3 Valuation Extension ─────────────────────────────────────── */

export interface V3ValuationExtension {
  anchor_method: string;
  selected_RE_anchor: number;
  selected_ReOI_anchor: number;
  RE_anchor_1: number; RE_anchor_2: number | null; RE_anchor_3: number | null;
  g_terminal: number; g_source: string;
  tv_share: number | null;
  tv_grade: "GRADE_A" | "GRADE_B" | "GRADE_C" | "GRADE_D";
  tv_label: string;
  identity_gap: number; identity_gap_pct: number;
  identity_flag: "CONVERGED" | "WARNING" | "CRITICAL";
  confidence_composite: number;
  confidence_class: "HIGH" | "MODERATE" | "LOW" | "VERY_LOW";
  V_anchor_1: number; V_anchor_2: number | null; V_anchor_3: number | null;
  contamination: ContaminationResult;
}

/* ── N&P Benchmarks ─────────────────────────────────────────────── */

export const NP_BENCHMARKS: Record<string, {median:number;p25:number;p75:number;label:string}> = {
  ROCE:      {median:.122, p25:.063, p75:.176, label:"ROCE"},
  RNOA:      {median:.100, p25:.060, p75:.156, label:"RNOA"},
  NBC:       {median:.052, p25:.033, p75:.085, label:"NBC"},
  SPREAD:    {median:.040, p25:-.005,p75:.103, label:"SPREAD"},
  PM:        {median:.055, p25:.028, p75:.095, label:"PM (OI/Sales)"},
  ATO:       {median:1.18, p25:.38,  p75:1.94, label:"ATO"},
  FLEV:      {median:.40,  p25:.05,  p75:1.73, label:"FLEV"},
  OLLEV:     {median:.35,  p25:.16,  p75:.52,  label:"OLLEV"},
  OLSPREAD:  {median:.034, p25:.001, p75:.069, label:"OLSPREAD"},
  NOA_growth:{median:.089, p25:-.086,p75:.206, label:"NOA Growth"},
  Sales_growth:{median:.072,p25:-.033,p75:.177,label:"Sales Growth"},
};

export const FADE_PARAMS: Record<string, number> = {
  ROCE: 0.85, RNOA: 0.80, CoreSalesPM: 0.87, ATO: 0.95,
  FLEV: 0.50, NBC: 0.50, NOA_growth: 0.30, Sales_growth: 0.70,
};
