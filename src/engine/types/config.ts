/* ================================================================
   Engine configuration (S-0.1)
   EngineConfig + sector defaults + ke/kw derivation + validation.
   The single source of truth consumed by every valuation surface.
================================================================ */

import type { CompanyType } from "./company";
import { PercentFraction, CroreShares, INRAbsolute } from "./units";

export type ValuationSectorTemplate =
  | "auto"
  | "consumer-staples"
  | "paint"
  | "industrials"
  | "commodities"
  | "retail"
  | "services"
  | "telecom"
  | "utility";

export type StructuralBreakWindowPolicy = "auto-post-break" | "manual" | "keep-all";
export type GreenfieldAdjustmentMode = "as-reported-only" | "adjusted-with-audit";

export interface EngineConfig {
  ke                  : PercentFraction;
  /**
   * Phase rigor-2 — explicit equity beta (β) for CAPM.
   * When set (>0), `ke_from_config` uses ke = rf + β × erp.
   * When null/unset, falls back to a sector-default beta from `company_type`
   * (see SECTOR_BETAS), then to the legacy build-up rf+erp.
   * Range: typically 0.5 (utility) – 1.5 (cyclical).
   */
  beta                ?: number | null | undefined;
  /**
   * Phase rigor-3 — explicit equity weight for WACC computation.
   * When set (>0), `deriveKwFromConfig` uses we = clamp(equity_weight, 0.1, 0.99).
   * When null/unset, falls back to a sector-default from `company_type`
   * (see SECTOR_EQUITY_WEIGHTS), then to the legacy 0.80 fallback.
   * For best results, callers should compute totalEquity / (totalEquity + totalDebt)
   * from the latest balance sheet and pass it here.
   */
  equity_weight       ?: number | null | undefined;
  kd_pretax           : number;
  tax_rate_for_kd     : number;
  risk_free_rate      : number;
  equity_risk_premium : number;
  tax_rate_mode       : "effective"|"statutory";
  statutory_tax_rate  : number;
  oci_treated_as_unusual              : boolean;
  hybrid_perpetual_as_debt            : boolean;
  investment_in_subsidiaries_as_operating: boolean;
  financial_institution_mode          : boolean;
  /**
   * Phase D2 — explicit company type classification.
   * When set (not "auto"), this overrides the label-based scope auto-detection
   * and gates the company directly to the correct pipeline.
   * "auto" or null = legacy behaviour (heuristic label detection).
   */
  company_type?: CompanyType | null | undefined;
  /**
   * Phase I — explicit override for mixed-financial-conglomerate routing.
   * When set, companies with material insurance + bank/NBFC signals
   * (ICICI Bank, Reliance with Jio Financial pre-spinoff, etc.) are
   * routed to the named pipeline instead of fail-closing. The user takes
   * responsibility for the consolidation distortion.
   *
   * Values:
   *   "bank"        — route to bank pipeline (treats insurance subsidiary as immaterial)
   *   "nbfc"        — route to NBFC pipeline
   *   "industrial"  — route to Penman-Nissim (treats financial subs as non-core)
   *   null/unset    — default fail-close behaviour
   */
  mixed_conglomerate_route_to?: "bank" | "nbfc" | "industrial" | null | undefined;
  /**
   * Phase B5 — Folder name under public/data/companies/ where the
   * bank's quality_indicators.json sidecar lives. Set this to opt the
   * bank into the asset-quality surface (NPA, CRAR, PCR, slippage,
   * CASA, growth signals). null/unset = no fetch attempted; the bank
   * pipeline still runs without quality data.
   *
   * Example: "HDFC Bank" → fetches
   *   /data/companies/HDFC%20Bank/quality_indicators.json
   *
   * Distinct from `ticker` because the URL-safe folder name differs
   * from the symbol (ticker "HDFCBANK" vs folder "HDFC Bank").
   */
  quality_data_folder?: string | null | undefined;
  /** Vercel Blob URL for quality_indicators.json — preferred over local path on Vercel deploy. */
  quality_indicators_blob_url?: string | null | undefined;
  /**
   * Phase I9 — period exclusions for demerger / M&A confirmation flow.
   * List of period_end strings (YYYY-MM-DD) to exclude from the pipeline.
   * Typically set by the user after the UI surfaces a structural-break
   * warning (S-5.1 STRUCTURAL_EVENT) and they confirm "exclude pre-break
   * periods". Applied before recast, ratios, anomaly detection, and
   * valuation — the entire pipeline sees only the clean post-break window.
   *
   * Example: ["2019-03-31", "2020-03-31"] excludes the two pre-demerger
   * periods from an ITC-style demerger in FY21.
   */
  excluded_periods?: string[] | undefined;
  /** Greenfield L3 policy: whether structural-break periods are auto-excluded from the adjusted analysis window. */
  structural_break_window_policy?: StructuralBreakWindowPolicy | undefined;
  /** Greenfield L4 policy: compute audited adjusted lens or keep as-reported only. */
  greenfield_adjustment_mode?: GreenfieldAdjustmentMode | undefined;
  noa_epsilon_ratio_of_ta             : number;
  separation_confidence_threshold     : number;
  g_terminal_override ?: number | null | undefined;
  g_terminal_floor    ?: number | undefined;
  g_terminal_cap      ?: number | undefined;
  /** Insurance EV-based valuation multiples.
   * vnb_multiple: VNB × multiple added to EV. Default 12x (private insurer).
   * ev_multiple: EV × multiple when VNB unavailable. Default 2.0x.
   * PSU insurers (LIC) trade at ~1.0x EV; private (HDFC Life) at ~3.5x. */
  insurance_vnb_multiple ?: number | undefined;
  insurance_ev_multiple  ?: number | undefined;
  g_ke_floor_spread   ?: number | undefined;
  np_PM_median        ?: number | undefined;
  np_ATO_median       ?: number | undefined;
  np_ROCE_median      ?: number | undefined;
  np_RNOA_median      ?: number | undefined;
  np_SPREAD_median    ?: number | undefined;
  np_SalesGrowth_median?: number | undefined;
  shares_outstanding  ?: CroreShares | undefined;
  market_price        ?: INRAbsolute | undefined;
  ticker              ?: string | undefined;
  /** Terminal growth rate used by bank valuation DDM/Gordon and industrial TV. */
  terminal_growth_rate?: number | undefined;
  sector_template     ?: ValuationSectorTemplate | undefined;
  market_data_symbol  ?: string | undefined;
  market_data_instrument_key?: string | undefined;
  market_data_provider?: "manual" | "upstox-readonly" | "alphavantage" | "nse" | "yahoo" | "disabled" | undefined;
  market_data_refresh_seconds?: number | undefined;
  DS_warning_pct      ?: number | undefined;
  DS_critical_pct     ?: number | undefined;
  div_disc_pct        ?: number | undefined;
  metric_z_warning    ?: number | undefined;
  metric_z_critical   ?: number | undefined;
  incr_margin_upper   ?: number | undefined;
  incr_margin_lower   ?: number | undefined;
  comp_decline_pct    ?: number | undefined;
  comp_decline_abs_pct?: number | undefined;
  reclassif_pct       ?: number | undefined;
  other_oa_residual   ?: number | undefined;
  dta_pct             ?: number | undefined;
  eq16_residual_warning ?: number | undefined;
  eq16_residual_critical?: number | undefined;
  re_anchor_jump      ?: number | undefined;
  re_anchor_median    ?: number | undefined;
  identity_gap_warning?: number | undefined;
  identity_gap_critical?: number | undefined;
  tv_grade_a          ?: number | undefined;
  tv_grade_b          ?: number | undefined;
  tv_grade_c          ?: number | undefined;
  dirty_surplus_material    ?: number | undefined;
  dirty_surplus_compromised ?: number | undefined;
  structural_residual_warning?: number | undefined;
  structural_residual_critical?: number | undefined;
  pm_zscore_warning   ?: number | undefined;
  pm_zscore_critical  ?: number | undefined;
  // Phase 2 extensions
  sotp_preset          ?: string | undefined;
  ev_ebitda_peers      ?: Array<{ company: string; evEbitda: number | null }>;
}

/* ── Default Config ─────────────────────────────────────────────── */

export const DEFAULT_CONFIG: EngineConfig = {
  ke: PercentFraction(0.13),
  kd_pretax: 0.08,
  tax_rate_for_kd: 0.2517,
  risk_free_rate: 0.07,
  equity_risk_premium: 0.06,
  tax_rate_mode: "effective",
  statutory_tax_rate: 0.2517,
  oci_treated_as_unusual: true,
  hybrid_perpetual_as_debt: true,
  investment_in_subsidiaries_as_operating: true,
  financial_institution_mode: false,
  company_type: "auto",
  structural_break_window_policy: "auto-post-break",
  greenfield_adjustment_mode: "adjusted-with-audit",
  mixed_conglomerate_route_to: null,
  quality_data_folder: null,
  noa_epsilon_ratio_of_ta: 0.10,
  separation_confidence_threshold: 70,
  g_terminal_override: null,
  g_terminal_floor: 0.02,
  g_terminal_cap: 0.06,
  insurance_vnb_multiple: 12,
  insurance_ev_multiple: 2.0,
  g_ke_floor_spread: 0.02,
  np_PM_median: 0.055,
  np_ATO_median: 1.18,
  np_ROCE_median: 0.122,
  np_RNOA_median: 0.100,
  np_SPREAD_median: 0.040,
  np_SalesGrowth_median: 0.038,
  sector_template: "auto",
  market_data_symbol: undefined,
  market_data_instrument_key: undefined,
  market_data_provider: "manual",
  market_data_refresh_seconds: 300,
  DS_warning_pct: 0.05,
  DS_critical_pct: 0.10,
  div_disc_pct: 0.20,
  metric_z_warning: 2.0,
  metric_z_critical: 3.0,
  incr_margin_upper: 1.00,
  incr_margin_lower: -0.50,
  comp_decline_pct: 0.15,
  comp_decline_abs_pct: 0.02,
  reclassif_pct: 0.10,
  other_oa_residual: 0.30,
  dta_pct: 0.03,
  eq16_residual_warning: 0.05,
  eq16_residual_critical: 0.15,
  re_anchor_jump: 2.0,
  re_anchor_median: 2.5,
  identity_gap_warning: 0.10,
  identity_gap_critical: 0.20,
  tv_grade_a: 0.25,
  tv_grade_b: 0.40,
  tv_grade_c: 0.60,
  dirty_surplus_material: 0.10,
  dirty_surplus_compromised: 0.20,
  structural_residual_warning: 0.005,
  structural_residual_critical: 0.02,
};

/** Derive kd_aftertax — NEVER a config parameter (Invariant 5) */
export function kd_aftertax(cfg: EngineConfig): number {
  return cfg.kd_pretax * (1 - cfg.tax_rate_for_kd);
}

/** Derive ke: prefer explicit cfg.ke, fall back to beta-CAPM, then rf+erp.
 *
 *  Resolution order (Phase rigor-2):
 *    1. cfg.ke (explicit user override) — highest precedence
 *    2. CAPM with explicit cfg.beta: ke = rf + beta * erp
 *    3. CAPM with sector-default beta from cfg.company_type
 *    4. Sector-neutral fallback: rf + erp (legacy behaviour)
 *
 *  Sector betas calibrated against 5-yr NSE-200 regressions (May 2026):
 *  banks ~1.10, NBFCs ~1.30, insurance ~1.05, IT-services ~0.85, consumer ~0.70,
 *  utility ~0.60, telecom ~0.90, industrial ~1.10, cyclical ~1.40. These match
 *  the stylized facts that retail Indian analysts use as defaults.
 */
export const SECTOR_BETAS: Record<CompanyType, number> = {
  bank:          1.10,
  nbfc:          1.30,
  insurance:     1.05,
  "it-services": 0.85,
  consumer:      0.70,
  utility:       0.60,
  telecom:       0.90,
  industrial:    1.10,
  cyclical:      1.40,
  "loss-maker":  1.00,
  conglomerate:  1.10,
  auto:          1.00,  // sector-neutral when type unknown
};

export function ke_from_config(cfg: EngineConfig): number {
  // 1. Explicit ke override wins
  if (cfg.ke > 0) return cfg.ke;
  // 2/3. CAPM (with explicit beta or sector default)
  const rf = cfg.risk_free_rate;
  const erp = cfg.equity_risk_premium;
  if (cfg.beta != null && cfg.beta > 0) {
    return rf + cfg.beta * erp;
  }
  if (cfg.company_type && cfg.company_type !== "auto") {
    const sectorBeta = SECTOR_BETAS[cfg.company_type];
    if (sectorBeta != null && sectorBeta > 0) {
      return rf + sectorBeta * erp;
    }
  }
  // 4. Legacy fallback: sector-neutral build-up
  return rf + erp;
}

/** Derive WACC (kw) from config using standard capital structure approximation.
 *  Phase rigor-3 (May 2026): replaced hardcoded 80/20 with config-aware weights.
 *
 *  Resolution order:
 *    1. Explicit cfg.equity_weight (clamped to [0.1, 0.99])
 *    2. Sector-default weight from cfg.company_type (TCS-like 0.95, Tata-Steel-like 0.55)
 *    3. Legacy 0.80 fallback (preserved for back-compat with existing fixtures)
 *
 *  Used consistently across all valuation modules (moat, EPV, capital
 *  allocation) per S-9.4C. For the cleanest production deploy, callers
 *  with access to a balance sheet should compute the actual weight from
 *  totalEquity / (totalEquity + totalDebt) and pass it via cfg.equity_weight.
 */
export const SECTOR_EQUITY_WEIGHTS: Record<CompanyType, number> = {
  bank:          0.85,  // banks: low debt at parent level (deposits ≠ debt)
  nbfc:          0.20,  // NBFCs: high financial leverage by design
  insurance:     0.85,  // insurance: float ≠ debt
  "it-services": 0.95,  // TCS / Infosys: near-zero debt
  consumer:      0.85,  // ITC, HUL: cash-rich
  utility:       0.50,  // Power Grid, NTPC: rate-base regulated leverage
  telecom:       0.55,  // Bharti, Vi: AGR + spectrum debt
  industrial:    0.70,  // mixed
  cyclical:      0.55,  // Tata Steel, JSW: high leverage at trough
  "loss-maker":  0.80,  // neutral default
  conglomerate:  0.70,  // similar to industrial
  auto:          0.80,  // sector-neutral default
};

export function deriveKwFromConfig(cfg: EngineConfig): number {
  const ke = ke_from_config(cfg);
  const kd_pretax = cfg.kd_pretax ?? 0.08;
  const tax_rate_for_kd = cfg.tax_rate_for_kd ?? 0.25;
  const kd_aftertax = kd_pretax * (1 - tax_rate_for_kd);

  // 1. Explicit override (clamped to plausible range)
  let we: number;
  if (cfg.equity_weight != null && cfg.equity_weight > 0) {
    we = Math.max(0.1, Math.min(0.99, cfg.equity_weight));
  } else if (cfg.company_type && cfg.company_type !== "auto") {
    // 2. Sector-default
    we = SECTOR_EQUITY_WEIGHTS[cfg.company_type] ?? 0.80;
  } else {
    // 3. Legacy fallback
    we = 0.80;
  }
  const wd = 1 - we;

  return ke * we + kd_aftertax * wd;
}

/**
 * Where a resolved cost-of-operating-capital (kw) value came from.
 * `structural` is the S-9.4C-compliant source (pipeline-stamped
 * deriveKwFromStructure); `config` means a caller fell back to the
 * sector/weight-derived approximation because no structural kw was
 * available — which the kw-consistency residual treats as a defect for
 * any period that *should* have one.
 */
export type KwSource = "override" | "structural" | "config" | "fallback";

/**
 * S-9.4C single resolution seam for kw. Every module that needs an
 * operating capital charge resolves it here so the precedence is derived
 * once, not re-hand-rolled per call site. Returns both the value AND the
 * rung it landed on — the rung is the genuine (non-tautological) signal
 * the kw-consistency residual checks: a non-first period that resolves to
 * `config` instead of `structural` means the pipeline failed to stamp a
 * structural kw and the consumer silently used the config approximation.
 *
 * Precedence: explicit caller override → pipeline-stamped structural →
 * caller-supplied fallback (e.g. reverseDCF's costOfCapital) → config.
 */
export function resolveKw(
  kwStructural: number | null | undefined,
  config: EngineConfig,
  opts?: { override?: number | null | undefined; fallback?: number | null | undefined },
): { kw: number; source: KwSource } {
  const override = opts?.override;
  if (override != null && Number.isFinite(override) && override > 0) {
    return { kw: override, source: "override" };
  }
  if (kwStructural != null && Number.isFinite(kwStructural) && kwStructural > 0) {
    return { kw: kwStructural, source: "structural" };
  }
  const fallback = opts?.fallback;
  if (fallback != null && Number.isFinite(fallback) && fallback > 0) {
    return { kw: fallback, source: "fallback" };
  }
  return { kw: deriveKwFromConfig(config), source: "config" };
}

export interface ConfigValidationWarning {
  field: string;
  value: number;
  message: string;
  severity: "error" | "warning";
}

/**
 * Validate EngineConfig for common input mistakes.
 *
 * Returns an array of warnings/errors. Empty array = config is clean.
 * Does NOT throw — callers decide how to surface issues.
 *
 * Common mistakes caught:
 *   - ke entered as percentage (e.g. 13 instead of 0.13)
 *   - terminal_growth_rate > ke (Gordon model blows up)
 *   - negative shares_outstanding or market_price
 *   - statutory_tax_rate outside [0, 0.5]
 *   - risk_free_rate or equity_risk_premium entered as percentage
 */
export function validateEngineConfig(cfg: EngineConfig): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // ke sanity: valid range is 0.05–0.30 (5%–30%). Values > 1 almost certainly
  // mean the user typed "13" instead of "0.13".
  const ke = ke_from_config(cfg);
  if (cfg.ke > 1) {
    warnings.push({
      field: "ke",
      value: cfg.ke,
      severity: "error",
      message: `ke = ${cfg.ke.toFixed(2)} looks like a percentage entry. Did you mean ${(cfg.ke / 100).toFixed(4)} (${cfg.ke.toFixed(1)}%)?`,
    });
  } else if (ke < 0.04 || ke > 0.35) {
    warnings.push({
      field: "ke",
      value: ke,
      severity: "warning",
      message: `ke = ${(ke * 100).toFixed(1)}% is outside the typical 4%–35% range for Indian equities.`,
    });
  }

  // risk_free_rate: valid range 0.03–0.12. Values > 0.20 likely entered as %.
  if (cfg.risk_free_rate > 0.20) {
    warnings.push({
      field: "risk_free_rate",
      value: cfg.risk_free_rate,
      severity: "error",
      message: `risk_free_rate = ${cfg.risk_free_rate.toFixed(2)} looks like a percentage entry. Did you mean ${(cfg.risk_free_rate / 100).toFixed(4)}?`,
    });
  }

  // equity_risk_premium: valid range 0.03–0.12.
  if (cfg.equity_risk_premium > 0.20) {
    warnings.push({
      field: "equity_risk_premium",
      value: cfg.equity_risk_premium,
      severity: "error",
      message: `equity_risk_premium = ${cfg.equity_risk_premium.toFixed(2)} looks like a percentage entry. Did you mean ${(cfg.equity_risk_premium / 100).toFixed(4)}?`,
    });
  }

  // terminal_growth_rate must be < ke (Gordon model denominator must be positive).
  const g = cfg.terminal_growth_rate ?? 0.05;
  if (g >= ke) {
    warnings.push({
      field: "terminal_growth_rate",
      value: g,
      severity: "error",
      message: `terminal_growth_rate (${(g * 100).toFixed(1)}%) ≥ ke (${(ke * 100).toFixed(1)}%). Gordon Growth model denominator (ke − g) would be ≤ 0 — valuation will blow up.`,
    });
  } else if (g > 0.10) {
    warnings.push({
      field: "terminal_growth_rate",
      value: g,
      severity: "warning",
      message: `terminal_growth_rate = ${(g * 100).toFixed(1)}% exceeds India's long-run nominal GDP growth proxy (~7%). Consider using ≤ 7%.`,
    });
  }

  // statutory_tax_rate: valid range 0.10–0.40.
  if (cfg.statutory_tax_rate < 0.05 || cfg.statutory_tax_rate > 0.50) {
    warnings.push({
      field: "statutory_tax_rate",
      value: cfg.statutory_tax_rate,
      severity: "warning",
      message: `statutory_tax_rate = ${(cfg.statutory_tax_rate * 100).toFixed(1)}% is outside the typical 10%–40% range.`,
    });
  }

  // shares_outstanding: must be positive when set.
  if (cfg.shares_outstanding != null && cfg.shares_outstanding <= 0) {
    warnings.push({
      field: "shares_outstanding",
      value: cfg.shares_outstanding,
      severity: "error",
      message: `shares_outstanding must be positive (got ${cfg.shares_outstanding}).`,
    });
  }

  // market_price: must be positive when set.
  if (cfg.market_price != null && cfg.market_price <= 0) {
    warnings.push({
      field: "market_price",
      value: cfg.market_price,
      severity: "error",
      message: `market_price must be positive (got ${cfg.market_price}).`,
    });
  }

  return warnings;
}
