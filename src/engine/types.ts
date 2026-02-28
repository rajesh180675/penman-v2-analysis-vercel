/* ================================================================
   Penman–Nissim Engine — Canonical Type Definitions v2
   Nissim & Penman (2001) — Full V2 Design Specification
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
}

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
}

export interface CoreUnusual {
  UOI: number; CoreOI: number;
  UFE: number; CoreNFE: number;
  ExceptionalItemsAfterTax: number; OCITotal: number;
}

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

export interface Ratios {
  // §5.1
  ROCE: number|null; RNOA: number|null; NBC: number|null; SPREAD: number|null;
  // §5.2
  FLEV: number|null;
  // §5.3
  PM: number|null; ATO: number|null; SalesPM: number|null;
  ATO_star: number|null;
  OtherItemsRatio: number|null; ROCE_bridge_residual: number|null;
  // §5.4 OpLiab Leverage
  io: number; ROOA: number|null; OLLEV: number|null; OLSPREAD: number|null; RNOA_check: number|null;
  // §Eq.6 MI
  ROTCE: number|null; MSR: number|null;
  // Eq.16 Full Bridge
  CoreSalesPM: number|null; CoreOtherItems_OA: number|null;
  UOI_OA: number|null; CoreNBC: number|null; UFE_NFO: number|null;
  CoreSPREAD: number|null;
  ROCE_eq16_reconstructed: number|null; ROCE_eq16_error: number|null;
  // Eq.10
  required_return_per_sales: number|null; value_creating_margin: number|null;
  // Eq.8
  CSE_eq8_check: number|null; CSE_eq8_error_pct: number|null;
  // Working capital
  current_ratio: number|null; quick_ratio: number|null;
  days_receivable: number|null; days_payable: number|null;
  days_inventory: number|null; cash_conversion_cycle: number|null;
  // Earnings quality
  accrual_ratio_bs: number|null; accrual_ratio_cf: number|null;
  cash_conversion_ratio: number|null;
  interest_coverage: number|null;
  // Growth
  NOA_growth: number|null; CNI_growth: number|null; OI_growth: number|null;
  Sales_growth: number|null;
  // Quality flags
  noaSmall: boolean; separationScore: number;
}

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
  // Zmijewski (1984)
  zmijewski_roa?: number;
  zmijewski_leverage?: number;
  zmijewski_liquidity?: number;
  zmijewski_xscore?: number;
  zmijewski_prob_distress?: number;
  // Ohlson (1980)
  ohlson_size?: number;
  ohlson_leverage?: number;
  ohlson_liquidity?: number;
  ohlson_roe_neg?: boolean;
  ohlson_chin?: number;
  ohlson_oscore?: number;
  ohlson_prob_distress?: number;
  // Sloan / Richardson accrual decomposition
  sloan_wc_accruals?: number;
  sloan_lt_accruals?: number;
  sloan_total_accruals?: number;
  accrual_reliability_score?: number;
  // Additional quality overlays
  operating_leverage?: number | null;
  cash_earnings_quality_index?: number | null;
  conservative_accounting_score?: number | null;
  revenue_quality_flags?: string[];
}

export interface ResidualIncome {
  RE: number|null; ReOI: number|null;
}

export interface RecastPeriod {
  period_end: string;
  bs: CanonicalBalanceSheet;
  is: CanonicalIncome;
  cu: CoreUnusual;
  cf: CashFlowData;
  ratios?: Ratios;
  ri?: ResidualIncome;
  quality?: QualityMetrics;
  trace?: TraceMap;
}

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
  EV_FCFF: number;
  V_FCFE: number;
  CV_FCFF: number;
  CV_FCFE: number;
}

export interface AEGValuation {
  aeg_series: Array<{ period: string; CNI: number; AEG: number; PV_AEG: number }>;
  V_AEG: number;
  implied_pe: number | null;
  normalised_pe: number | null;
}

export interface MultiCompanyRecord {
  id: string;
  label: string;
  rawData: RawPeriodData[];
  recastData: RecastPeriod[];
}

export interface CompanyRegistry {
  companies: Record<string, MultiCompanyRecord>;
}

export interface ForecastPeriod {
  year_offset: number; period_label: string;
  sales_growth_assumption: number;
  core_sales_pm_assumption: number;
  ato_assumption: number;
  flev_assumption: number;
  nbc_assumption: number;
  Sales_f: number; NOA_f: number; OI_f: number;
  NFE_f: number; CNI_f: number; CSE_f: number; NFO_f: number;
  ΔNOA_f: number; FCF_f: number; RE_f: number; ReOI_f: number;
  source: 'user'|'fade'|'mean_reversion'|'flat';
}

export interface ForecastScenario {
  name: 'bull'|'base'|'bear'|'custom';
  probability: number;
  horizonT: number;
  drivers: {
    sales_growth: number[];
    core_sales_pm: number[];
    ato: number[];
    flev: number[];
    nbc: number[];
    g_terminal: number;
    ke: number; kw: number;
  };
  periods?: ForecastPeriod[];
  valuationResult?: ValuationResult;
}

export interface EngineConfig {
  risk_free_rate: number;
  equity_risk_premium: number;
  tax_rate_mode: "effective"|"statutory";
  statutory_tax_rate: number;
  oci_treated_as_unusual: boolean;
  hybrid_perpetual_as_debt: boolean;
  investment_in_subsidiaries_as_operating: boolean;
  financial_institution_mode: boolean;
  noa_epsilon_ratio_of_ta: number;
  separation_confidence_threshold: number;
  shares_outstanding?: number;
  market_price?: number;
  ticker?: string;
}

// N&P (2001) Table 1 historical benchmarks
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

// Fade parameters (N&P Table 3)
export const FADE_PARAMS: Record<string, number> = {
  ROCE: 0.85, RNOA: 0.80, CoreSalesPM: 0.87, ATO: 0.95,
  FLEV: 0.93, OLLEV: 0.90, NOA_growth: 0.30, Sales_growth: 0.70,
};

export const DEFAULT_CONFIG: EngineConfig = {
  risk_free_rate: 0.07,
  equity_risk_premium: 0.06,
  tax_rate_mode: "effective",
  statutory_tax_rate: 0.2517,
  oci_treated_as_unusual: true,
  hybrid_perpetual_as_debt: true,
  investment_in_subsidiaries_as_operating: true,
  financial_institution_mode: false,
  noa_epsilon_ratio_of_ta: 0.01,
  separation_confidence_threshold: 70,
};
