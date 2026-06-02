/* ================================================================
   Recast / canonical period shapes
   The pipeline's middle stage: canonical BS, IS, CF, derived ratios,
   residual income, and the RecastPeriod aggregate consumed by every
   downstream surface.
================================================================ */

import type { TraceMap } from "./raw";
import type { SpecFlag, QualityMetrics } from "./quality";
import type { UnusualItemPolicySummary } from "./unusual";

/* ── Balance Sheet ──────────────────────────────────────────────── */

export interface CanonicalBalanceSheet {
  TA: number; CSE: number; MI: number;
  FA: number; FO: number;
  OA: number; OL: number;
  BridgeDebtLongTerm?: number | undefined;
  BridgeDebtShortTerm?: number | undefined;
  BridgeDebtDebentures?: number | undefined;
  BridgeDebtCurrentMaturities?: number | undefined;
  BridgeDebtTotal?: number | undefined;
  /** Explicit Ind AS 116 lease liabilities included in FO; used by greenfield lease-adjusted lens. */
  FO_LeaseLiabilities?: number | undefined;
  /** Financial obligations excluding explicit lease liabilities. */
  FO_FinancialDebtExLease?: number | undefined;
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
  OA_TelecomSpectrumLicenses?: number | undefined;
  OA_TradeReceivables: number; OA_DTA: number;
  OA_CWIP: number; OA_Other: number;
  /* India-specific fields (Phase 2.3) */
  promoterHolding?: number | null | undefined;
  pledgedPromoterShares?: number | null | undefined;
}

/* ── Income ─────────────────────────────────────────────────────── */

export interface CanonicalIncome {
  Sales: number; TaxExpense: number; taxRate: number;
  PAT: number; OCI: number; TCI: number; TCI_NCI: number;
  CNI: number;
  FinanceCost: number; FinanceIncome: number;
  FinanceIncomeRung: 1|2|3|4;
  PreferredDividend: number;
  /* India-specific fields (Phase 2.3) */
  relatedPartyTransactions?: number | undefined;
  auditorChange?: boolean | undefined;
  qualifiedOpinion?: boolean | undefined;
  NFE: number; OI: number;
  OtherItems: number; OI_from_sales: number; MII: number;
  COGS: number;
  operatingCostBridge?: OperatingCostBridge | undefined;
}

export interface CoreUnusual {
  UOI: number; CoreOI: number;
  UFE: number; CoreNFE: number;
  ExceptionalItemsAfterTax: number; OCITotal: number;
  ExceptionalOperatingItemsAfterTax?: number | undefined;
  DiscontinuedOperationsAfterTax?: number | undefined;
  policy?: UnusualItemPolicySummary | undefined;
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
  telecomNetworkOpex?: number | undefined;
  licenseFeeOperationCharges?: number | undefined;
  sectorSpecificOperatingExpense?: number | undefined;
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

/* ── Cash Flow ──────────────────────────────────────────────────── */

export interface CashFlowData {
  CFO: number; Capex: number;
  DividendPaid: number; EquityIssued: number; ShareBuybacks: number;
  InterestReceived: number; DividendReceived: number;
  DebtProceeds?: number | undefined; DebtRepayment?: number | undefined;
  BridgeDebtProceeds?: number | undefined; BridgeDebtRepayment?: number | undefined;
  SaleFixedAssets?: number | undefined; PurchaseInvestments?: number | undefined; SaleInvestments?: number | undefined;
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
  // S-17.1: OLLEV decomposition correctness
  freeOL: number|null;
  interestBearingOL: number|null;
  OLLEV_check: number|null;
  RNOA_vs_OLLEV_residual: number|null;
  /** Phase E2 — IT-services overlay. Employee cost as fraction of revenue. */
  employeeCostRatio: number|null;
}

/* ── Residual Income ────────────────────────────────────────────── */

export interface ResidualIncome {
  RE: number|null; ReOI: number|null;
}

/* ── Recast debug (non-tautological reconciliation inputs) ──────── */

/**
 * Independent reads of raw lines captured during recast so the
 * reconciliation-residuals stage can compare recast outputs against
 * the as-reported raw values. The reads are done inside
 * `recastBalanceSheet` so the residual stage doesn't need to redo the
 * pick-helper logic, and so deletes/typos in the recast layer don't
 * silently flow through.
 */
export interface RecastDebug {
  /** Raw "Total Assets" line, read independently (not the fallback-chained bs.TA pick). */
  rawTotalAssets: number | null;
  /** Raw "Total Equity and Liabilities" line. */
  rawTotalLiabilitiesAndEquity: number | null;
  /** Raw "Total Equity" line — used by the external-equity-bridge residual. */
  rawTotalEquity: number | null;
  /**
   * Independently-reported asset subtotals ("Total Current Assets" and
   * "Total Non-Current and Other Assets"), read directly from source — NOT
   * derived from Total Assets. Their sum vs the reported Total Assets is the
   * non-tautological asset-composition cross-check (mirrors ol-coverage on the
   * liability side): a mapping miss or corrupted line makes the sum diverge.
   */
  rawCurrentAssets: number | null;
  rawNonCurrentAssets: number | null;
  /** Sum of explicit OL components (trade payables, provisions, current/non-current liabilities, taxes). */
  explicitOL: number;
}

/* ── Period ─────────────────────────────────────────────────────── */

export interface RecastPeriod {
  period_end  : string;
  bs          : CanonicalBalanceSheet;
  is          : CanonicalIncome;
  cu          : CoreUnusual;
  cf          : CashFlowData;
  ratios      ?: Ratios | undefined;
  ri          ?: ResidualIncome | undefined;
  quality     ?: QualityMetrics | undefined;
  trace       ?: TraceMap | undefined;
  spec_flags  ?: SpecFlag[] | undefined;
  shareCountInput?: ShareCountInputSnapshot | undefined;
  /** Independent raw reads carried into reconciliationResiduals. */
  recastDebug ?: RecastDebug | undefined;
  /**
   * S-9.4C — kw_structural is the WACC implied by the period's balance-sheet
   * weights via {@link deriveKwFromStructure}. Stamped onto each period in
   * the pipeline once `prev` is available; null for the first period (where
   * kw cannot be derived because deriveKwFromStructure requires two periods).
   */
  kwStructural?: number | null | undefined;
  /**
   * S-9.4C — kw_used is the WACC actually consumed by valuation / scoring
   * paths for this period. Set by valuation-side callers before stamping;
   * compared against kwStructural in the kw-consistency reconciliation
   * residual. Null when no valuation path has stamped a value yet.
   */
  kwUsed?: number | null | undefined;
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
