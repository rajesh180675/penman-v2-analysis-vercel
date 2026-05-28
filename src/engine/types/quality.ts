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
  altman_re_proxy_low_confidence?: boolean;
  zmijewski_roa?: number; zmijewski_leverage?: number;
  zmijewski_liquidity?: number; zmijewski_xscore?: number;
  zmijewski_prob_distress?: number;
  ohlson_size?: number; ohlson_leverage?: number;
  ohlson_liquidity?: number; ohlson_roe_neg?: boolean;
  ohlson_chin?: number; ohlson_oscore?: number;
  ohlson_prob_distress?: number;
  sloan_wc_accruals?: number; sloan_lt_accruals?: number;
  sloan_total_accruals?: number; accrual_reliability_score?: number;
  operating_leverage?: number | null;
  cash_earnings_quality_index?: number | null;
  conservative_accounting_score?: number | null;
  revenue_quality_flags?: string[];
}
