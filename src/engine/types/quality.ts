/* ================================================================
   Quality, severity, and contamination diagnostics
   Spec S-5.x flag system, S-10.2 contamination tiers, and the
   per-period quality metrics surface (Piotroski, Beneish, Altman,
   Zmijewski, Ohlson, Sloan).
================================================================ */

/* ── Spec S-5.x Flag System ─────────────────────────────────────── */

export enum Severity {
  INFO     = 1,
  WARNING  = 2,
  CRITICAL = 3,
}

export interface SpecFlag {
  spec_id          : string;
  severity         : Severity;
  label            : string;
  message          : string;
  affects_terminal : boolean;
  period           : string;
}

/* ── Contamination Tiers (S-10.2) ───────────────────────────────── */
export type ContaminationTier = "CLEAN" | "CAUTION" | "GUARDED" | "COMPROMISED";

export interface ContaminationResult {
  tier         : ContaminationTier;
  score        : number;
  n_flags      : number;
  n_critical   : number;
  n_warning    : number;
  primary_anchor: "RE_T" | "RE_T_MINUS_1_GROWN";
  message      : string;
  flag_labels  : string[];
}

/* ── Quality Metrics ────────────────────────────────────────────── */

export interface QualityMetrics {
  piotroski_roa: number; piotroski_delta_roa: number;
  piotroski_cfo: number; piotroski_accrual: number;
  piotroski_leverage: number; piotroski_liquidity: number;
  piotroski_dilution: number; piotroski_margin: number;
  piotroski_turnover: number; piotroski_total: number;
  beneish_dsri: number; beneish_gmi: number; beneish_aqi: number;
  beneish_sgi: number; beneish_depi: number; beneish_sgai: number;
  beneish_lvgi: number; beneish_tata: number; beneish_mscore: number;
  altman_wc_ta: number; altman_re_ta: number; altman_ebit_ta: number;
  altman_bve_tl: number; altman_s_ta: number; altman_zprime: number;
  altman_re_proxy_low_confidence?: boolean | undefined;
  zmijewski_roa?: number | undefined; zmijewski_leverage?: number | undefined;
  zmijewski_liquidity?: number | undefined; zmijewski_xscore?: number | undefined;
  zmijewski_prob_distress?: number | undefined;
  ohlson_size?: number | undefined; ohlson_leverage?: number | undefined;
  ohlson_liquidity?: number | undefined; ohlson_roe_neg?: boolean | undefined;
  ohlson_chin?: number | undefined; ohlson_oscore?: number | undefined;
  ohlson_prob_distress?: number | undefined;
  sloan_wc_accruals?: number | undefined; sloan_lt_accruals?: number | undefined;
  sloan_total_accruals?: number | undefined; accrual_reliability_score?: number | undefined;
  operating_leverage?: number | null | undefined;
  cash_earnings_quality_index?: number | null | undefined;
  conservative_accounting_score?: number | null | undefined;
  revenue_quality_flags?: string[] | undefined;
}
