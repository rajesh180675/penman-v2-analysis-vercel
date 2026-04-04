import type { AnalysisTraceabilityEnvelope } from "./analysisTraceability";

/* ================================================================
   Penman–Nissim Engine — Canonical Type Definitions V2-FINAL
   Nissim & Penman (2001) — Full V2 Design Specification
   Jurisdiction: Indian companies reporting under Ind AS
================================================================ */

export interface RawPeriodData {
  company_id: string;
  period_end: string;
  raw_metric_values: Record<string, number | null>;
}

export type TraceStatement = "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Derived" | "Fallback";

export interface TraceEntry {
  statement: TraceStatement;
  key: string;
  value: number;
  matchType: "exact_composite" | "exact_base" | "fuzzy" | "derived";
  note?: string;
}

export type TraceMap = Record<string, TraceEntry[]>;

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

/* ── Balance Sheet ──────────────────────────────────────────────── */

export interface CanonicalBalanceSheet {
  TA: number; CSE: number; MI: number;
  FA: number; FO: number;
  OA: number; OL: number;
  OL_TradePayables: number;
  OL_OtherCurrentLiabilities: number;
  OL_ProvisionsCurrent: number;
  OL_ProvisionsLongTerm: number;
  OL_CurrentTaxLiabilities: number;
  OL_NonCurrentTaxLiabilities: number;
  OL_DeferredTaxLiabilitiesNet: number;
  OL_OtherNonCurrentLiabilities: number;
  NOA: number; NFO: number;
  DTL: number; PensionObl: number; OL_ex_DTL: number;
  Goodwill: number;
  CurrentAssets: number; CurrentLiabilities: number;
  Inventory: number; TradeReceivables: number; TradePayables: number;
  PPE: number; LIFO_reserve: number;
  separationScore: number;
  OA_PPE: number; OA_ROU: number; OA_Goodwill: number;
  OA_OtherIntangibles: number; OA_Inventory: number;
  OA_TradeReceivables: number; OA_DTA: number;
  OA_CWIP: number; OA_Other: number;
}

/* ── Income ─────────────────────────────────────────────────────── */

export interface CanonicalIncome {
  Sales: number; TaxExpense: number; taxRate: number;
  PAT: number; OCI: number; TCI: number; TCI_NCI: number;
  CNI: number;
  FinanceCost: number; FinanceIncome: number;
  FinanceIncomeRung: 1|2|3|4;
  PreferredDividend: number;
  NFE: number; OI: number;
  OtherItems: number; OI_from_sales: number; MII: number;
  COGS: number;
  operatingCostBridge?: OperatingCostBridge;
}

export interface CoreUnusual {
  UOI: number; CoreOI: number;
  UFE: number; CoreNFE: number;
  ExceptionalItemsAfterTax: number; OCITotal: number;
  ExceptionalOperatingItemsAfterTax?: number;
  DiscontinuedOperationsAfterTax?: number;
  policy?: UnusualItemPolicySummary;
}

export interface OperatingCostBridge {
  materialCost: number;
  employeeCost: number;
  depreciation: number;
  sgaAdvertising: number;
  sgaLegalProfessional: number;
  sgaRent: number;
  sgaFreight: number;
  sgaRepairs: number;
  sgaPowerFuel: number;
  sgaDetailed: number;
  sgaResidual: number;
  sgaTotal: number;
  otherOperatingExpense: number;
  otherOperatingIncome: number;
  grossProfit: number;
  operatingCosts: number;
  bridgeCoreOI: number;
  bridgeGapToReportedCoreOI: number;
  coverageRatio: number | null;
  driverRatios: {
    materialCostPct: number | null;
    employeeCostPct: number | null;
    depreciationPct: number | null;
    sgaPct: number | null;
    otherOperatingExpensePct: number | null;
    otherOperatingIncomePct: number | null;
    bridgeCoreSalesPm: number | null;
  };
}

export type UnusualBucketType =
  | "operating_exceptional"
  | "discontinued_operations"
  | "oci_reclassified"
  | "financial_unusual"
  | "capital_transaction_signal"
  | "material_operating_noise";

export interface UnusualItemBucket {
  type: UnusualBucketType;
  label: string;
  amount: number;
  recurring: boolean;
  affectsCoreOI: boolean;
  affectsCoreNFE: boolean;
  blocksTerminalValuation: boolean;
  reason: string;
}

export interface UnusualItemPolicySummary {
  policyVersion: string;
  operatingBuckets: UnusualItemBucket[];
  financialBuckets: UnusualItemBucket[];
  operatingTotal: number;
  financialTotal: number;
  terminalBlocker: boolean;
  blockerReasons: string[];
}

/* ── Cash Flow ──────────────────────────────────────────────────── */

export interface CashFlowData {
  CFO: number; Capex: number;
  DividendPaid: number; EquityIssued: number; ShareBuybacks: number;
  InterestReceived: number; DividendReceived: number;
  DebtProceeds?: number; DebtRepayment?: number;
  SaleFixedAssets?: number; PurchaseInvestments?: number; SaleInvestments?: number;
  FCF_accounting: number; FCF_cash: number;
  d_t: number; d_t_formula: number; d_t_discrepancy: number;
  EBITDA: number;
}

/* ── Ratios ─────────────────────────────────────────────────────── */

export interface Ratios {
  ROCE: number|null; RNOA: number|null; NBC: number|null; SPREAD: number|null;
  FLEV: number|null;
  PM: number|null; ATO: number|null; SalesPM: number|null;
  ATO_star: number|null;
  OtherItemsRatio: number|null; ROCE_bridge_residual: number|null;
  io: number; ROOA: number|null; OLLEV: number|null; OLSPREAD: number|null; RNOA_check: number|null;
  ROTCE: number|null; MSR: number|null;
  CoreSalesPM: number|null; CoreOtherItems_OA: number|null;
  UOI_OA: number|null; CoreNBC: number|null; UFE_NFO: number|null;
  CoreSPREAD: number|null;
  ROCE_eq16_reconstructed: number|null; ROCE_eq16_error: number|null;
  eq16_step1_residual: number|null; eq16_step2_residual: number|null; eq16_step3_residual: number|null;
  eq16_flag: "OK" | "WARNING" | "CRITICAL";
  eq16_diagnosis: string|null;
  ROOA_spec: number|null;
  imputed_io_spec: number;
  required_return_per_sales: number|null; value_creating_margin: number|null;
  CSE_eq8_check: number|null; CSE_eq8_error_pct: number|null;
  current_ratio: number|null; quick_ratio: number|null;
  days_receivable: number|null; days_payable: number|null;
  days_inventory: number|null; cash_conversion_cycle: number|null;
  accrual_ratio_bs: number|null; accrual_ratio_cf: number|null;
  cash_conversion_ratio: number|null;
  interest_coverage: number|null;
  NOA_growth: number|null; CNI_growth: number|null; OI_growth: number|null;
  Sales_growth: number|null;
  noaSmall: boolean; separationScore: number;
  accrual_regime: "GROWTH_ACCRUAL"|"QUALITY_ACCRUAL"|"CASH_ACCUMULATION"|"ASSET_DISPOSAL"|"CASH_GENERATION"|"NORMAL"|null;
  dirty_surplus: number|null;
  dirty_surplus_pct_cse: number|null;
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

/* ── Residual Income ────────────────────────────────────────────── */

export interface ResidualIncome {
  RE: number|null; ReOI: number|null;
}

/* ── Period ─────────────────────────────────────────────────────── */

export interface RecastPeriod {
  period_end  : string;
  bs          : CanonicalBalanceSheet;
  is          : CanonicalIncome;
  cu          : CoreUnusual;
  cf          : CashFlowData;
  ratios      ?: Ratios;
  ri          ?: ResidualIncome;
  quality     ?: QualityMetrics;
  trace       ?: TraceMap;
  spec_flags  ?: SpecFlag[];
  shareCountInput?: ShareCountInputSnapshot;
}

export interface BusinessModelProfile {
  persistenceScore: number;
  demandStabilityScore: number;
  marginDurabilityScore: number;
  capitalIntensityScore: number;
  workingCapitalDisciplineScore: number;
  reinvestmentQualityScore: number;
  evidence: string[];
  historicalAnchors: {
    salesGrowth: number | null;
    corePm: number | null;
    ato: number | null;
    spread: number | null;
    cashConversion: number | null;
  };
}

export interface ShareCountInputSnapshot {
  endPeriodShares: number | null;
  endPeriodSharesSource: string;
  weightedAverageBasicShares: number | null;
  weightedAverageBasicSource: string;
  weightedAverageDilutedShares: number | null;
  weightedAverageDilutedSource: string;
  faceValue: number | null;
  shareCapital: number | null;
}

/* ── Valuation ──────────────────────────────────────────────────── */

export interface ValuationResult {
  reSeries: Array<{period:string;RE:number;ReOI:number}>;
  pvRE: number; pvReOI: number;
  CV_RE: number; CV_ReOI: number; EV_ReOI: number;
  V_RE_CV1: number; V_RE_CV2: number; V_RE_CV3: number;
  V_ReOI_CV01: number; V_ReOI_CV02: number; V_ReOI_CV03: number;
  CSE0: number; NOA0: number; NFO_latest: number;
  ke: number; kw: number; g: number;
  separationScore: number; lowConfidence: boolean;
  impliedGrowthRE?: number;
  fcf?: FCFValuation;
  aeg?: AEGValuation;
  perShare?: PerShareResult;
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

export interface MultiCompanyRecord {
  id: string; label: string;
  rawData: RawPeriodData[];
  recastData: RecastPeriod[];
  traceability?: AnalysisTraceabilityEnvelope | null;
}

export interface CompanyRegistry {
  companies: Record<string, MultiCompanyRecord>;
}

export interface ForecastPeriod {
  year_offset: number; period_label: string;
  sales_growth_assumption: number; core_sales_pm_assumption: number;
  ato_assumption: number; flev_assumption: number; nbc_assumption: number;
  Sales_f: number; NOA_f: number; OI_f: number;
  NFE_f: number; CNI_f: number; CSE_f: number; NFO_f: number;
  ΔNOA_f: number; FCF_f: number; RE_f: number; ReOI_f: number;
  source: 'user'|'fade'|'mean_reversion'|'flat';
  bridge_mode?: 'margin'|'cost_bridge';
  material_cost_ratio_assumption?: number | null;
  employee_cost_ratio_assumption?: number | null;
  depreciation_ratio_assumption?: number | null;
  sga_ratio_assumption?: number | null;
  other_opex_ratio_assumption?: number | null;
  other_operating_income_ratio_assumption?: number | null;
  MaterialCost_f?: number | null;
  EmployeeCost_f?: number | null;
  Depreciation_f?: number | null;
  SGA_f?: number | null;
  OtherOperatingExpense_f?: number | null;
  OtherOperatingIncome_f?: number | null;
  GrossProfit_f?: number | null;
  CoreOI_bridge_f?: number | null;
}

export interface ForecastScenario {
  name: 'bull'|'base'|'bear'|'custom';
  probability: number;
  horizonT: number;
  drivers: {
    sales_growth: number[]; core_sales_pm: number[];
    ato: number[]; flev: number[]; nbc: number[];
    material_cost_ratio?: number[];
    employee_cost_ratio?: number[];
    depreciation_ratio?: number[];
    sga_ratio?: number[];
    other_opex_ratio?: number[];
    other_operating_income_ratio?: number[];
    g_terminal: number; ke: number; kw: number;
  };
  forecastPolicy?: {
    companyEvidenceWeight?: number;
    persistenceScore?: number;
    templateGuardrailStrength?: number;
    terminalAnchorSource?: 'company-evidence'|'blended'|'template';
    narrative?: string[];
  };
  periods?: ForecastPeriod[];
  valuationResult?: ValuationResult;
}

/* ── Engine Config (S-0.1) ──────────────────────────────────────── */

export type ValuationSectorTemplate =
  | "auto"
  | "consumer-staples"
  | "paint"
  | "industrials"
  | "commodities"
  | "retail"
  | "services";

export interface EngineConfig {
  ke                  : number;
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
  noa_epsilon_ratio_of_ta             : number;
  separation_confidence_threshold     : number;
  g_terminal_override ?: number | null;
  g_terminal_floor    ?: number;
  g_terminal_cap      ?: number;
  g_ke_floor_spread   ?: number;
  np_PM_median        ?: number;
  np_ATO_median       ?: number;
  np_ROCE_median      ?: number;
  np_RNOA_median      ?: number;
  np_SPREAD_median    ?: number;
  np_SalesGrowth_median?: number;
  shares_outstanding  ?: number;
  market_price        ?: number;
  ticker              ?: string;
  sector_template     ?: ValuationSectorTemplate;
  market_data_symbol  ?: string;
  market_data_instrument_key?: string;
  market_data_provider?: "manual" | "upstox-readonly" | "alphavantage" | "disabled";
  market_data_refresh_seconds?: number;
  DS_warning_pct      ?: number;
  DS_critical_pct     ?: number;
  div_disc_pct        ?: number;
  metric_z_warning    ?: number;
  metric_z_critical   ?: number;
  incr_margin_upper   ?: number;
  incr_margin_lower   ?: number;
  comp_decline_pct    ?: number;
  comp_decline_abs_pct?: number;
  reclassif_pct       ?: number;
  other_oa_residual   ?: number;
  dta_pct             ?: number;
  eq16_residual_warning ?: number;
  eq16_residual_critical?: number;
  re_anchor_jump      ?: number;
  re_anchor_median    ?: number;
  identity_gap_warning?: number;
  identity_gap_critical?: number;
  tv_grade_a          ?: number;
  tv_grade_b          ?: number;
  tv_grade_c          ?: number;
  dirty_surplus_material    ?: number;
  dirty_surplus_compromised ?: number;
  structural_residual_warning?: number;
  structural_residual_critical?: number;
  pm_zscore_warning   ?: number;
  pm_zscore_critical  ?: number;
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

/* ── Default Config ─────────────────────────────────────────────── */

export const DEFAULT_CONFIG: EngineConfig = {
  ke: 0.13,
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
  noa_epsilon_ratio_of_ta: 0.10,
  separation_confidence_threshold: 70,
  g_terminal_override: null,
  g_terminal_floor: 0.02,
  g_terminal_cap: 0.06,
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

/** Derive ke: prefer explicit cfg.ke, fall back to rf+erp */
export function ke_from_config(cfg: EngineConfig): number {
  if (cfg.ke > 0) return cfg.ke;
  return cfg.risk_free_rate + cfg.equity_risk_premium;
}
