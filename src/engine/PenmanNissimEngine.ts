import {
  RawPeriodData,
  CanonicalBalanceSheet,
  CanonicalIncome,
  CoreUnusual,
  CashFlowData,
  Ratios,
  ResidualIncome,
  QualityMetrics,
  RecastPeriod,
  EngineConfig,
} from "./types";
import { CapitalineMappingSpec as M } from "./mappingSpec";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();

function pick(data: RawPeriodData, keys: readonly string[], stmt?: "BalanceSheet" | "ProfitLoss" | "CashFlow"): number {
  const rv = data.raw_metric_values;
  for (const key of keys) {
    if (stmt) {
      const direct = rv[`${key}__${stmt}`];
      if (direct != null && Number.isFinite(direct)) return direct;
    }
    const base = rv[key];
    if (base != null && Number.isFinite(base)) return base;

    const nk = norm(key);
    let best: number | null = null;
    let bestP = -1;
    for (const [k, v] of Object.entries(rv)) {
      if (v == null || !Number.isFinite(v)) continue;
      const i = k.lastIndexOf("__");
      const b = i >= 0 ? k.slice(0, i) : k;
      const st = i >= 0 ? (k.slice(i + 2) as "BalanceSheet" | "ProfitLoss" | "CashFlow") : undefined;
      if (norm(b) !== nk) continue;
      const p = stmt && st === stmt ? 10 : st === "BalanceSheet" ? 3 : st === "ProfitLoss" ? 2 : st === "CashFlow" ? 1 : 0;
      if (p > bestP) {
        bestP = p;
        best = v;
      }
    }
    if (best != null) return best;
  }
  return 0;
}

const valBS = (d: RawPeriodData, k: readonly string[]) => pick(d, k, "BalanceSheet");
const valPL = (d: RawPeriodData, k: readonly string[]) => pick(d, k, "ProfitLoss");
const valCF = (d: RawPeriodData, k: readonly string[]) => pick(d, k, "CashFlow");

function sumBS(d: RawPeriodData, keys: readonly string[]) {
  return keys.reduce((s, k) => s + valBS(d, [k]), 0);
}
function sumPL(d: RawPeriodData, keys: readonly string[]) {
  return keys.reduce((s, k) => s + valPL(d, [k]), 0);
}
function sumCF(d: RawPeriodData, keys: readonly string[]) {
  return keys.reduce((s, k) => s + valCF(d, [k]), 0);
}

export function recastBalanceSheet(data: RawPeriodData, cfg: EngineConfig): CanonicalBalanceSheet {
  const TA = valBS(data, M.balanceSheet.totalAssets);
  const totalSE = valBS(data, M.balanceSheet.totalStockholdersEquity);
  const totalEq = valBS(data, M.balanceSheet.totalEquity);
  const MI = valBS(data, M.balanceSheet.minorityInterest);
  const CSE = totalSE > 0 ? totalSE : Math.max(0, totalEq - MI);

  const cashBank = sumBS(data, M.balanceSheet.financialAssets.cashAndBank);
  const curInvTop = valBS(data, [M.balanceSheet.financialAssets.currentInvestments[0]]);
  const curInvAlt = sumBS(data, M.balanceSheet.financialAssets.currentInvestments.slice(1));
  const curInv = curInvTop > 0 ? curInvTop : curInvAlt;
  const ltInvTop = valBS(data, M.balanceSheet.financialAssets.longTermInvestments);
  const ltInv = ltInvTop > 0 ? ltInvTop : 0;
  const depAndRestricted = sumBS(data, M.balanceSheet.financialAssets.depositsAndRestricted);
  const otherFA = sumBS(data, M.balanceSheet.financialAssets.otherFinancialAssets);
  let FA = cashBank + curInv + ltInv + depAndRestricted + otherFA;
  if (cfg.financial_institution_mode) FA = 0;

  const FO = sumBS(data, M.balanceSheet.financialObligations) - (cfg.hybrid_perpetual_as_debt ? 0 : valBS(data, [M.balanceSheet.financialObligations[5]]));

  const OA = TA - FA;
  const TotalLiabilities = TA - (CSE + MI);
  const OL = Math.max(0, TotalLiabilities - FO);
  const NOA = OA - OL;
  const NFO = FO - FA;

  const DTL = Math.max(0, valBS(data, M.balanceSheet.dtl));
  const PensionObl = 0;
  const OL_ex_DTL = Math.max(0, OL - DTL - PensionObl);

  const Goodwill = valBS(data, M.balanceSheet.goodwill);
  const CurrentAssets = valBS(data, M.balanceSheet.currentAssets);
  const CurrentLiabilities = valBS(data, M.balanceSheet.currentLiabilities);
  const Inventory = valBS(data, M.balanceSheet.inventoryTop) || sumBS(data, M.balanceSheet.inventoryComponents);
  const TradeReceivables = valBS(data, M.balanceSheet.tradeReceivables);
  const TradePayables = valBS(data, M.balanceSheet.tradePayables);
  const PPE = valBS(data, M.balanceSheet.ppe);

  const score = Math.min(100,
    (FA > 0 ? 20 : 0)
    + (FO > 0 ? 30 : 0)
    + (valPL(data, M.profitLoss.financeCostTop) > 0 ? 20 : 0)
    + (TA > 0 && Math.abs((CSE + MI) - (NOA - NFO)) / TA < 0.01 ? 30 : 10)
  );

  return {
    TA, CSE, MI, FA, FO, OA, OL, NOA, NFO,
    OL_TradePayables: valBS(data, M.balanceSheet.olComponents.tradePayables),
    OL_OtherCurrentLiabilities: valBS(data, M.balanceSheet.olComponents.otherCurrentLiabilities),
    OL_ProvisionsCurrent: valBS(data, M.balanceSheet.olComponents.provisionsCurrent),
    OL_ProvisionsLongTerm: valBS(data, M.balanceSheet.olComponents.provisionsLongTerm),
    OL_CurrentTaxLiabilities: valBS(data, M.balanceSheet.olComponents.currentTaxLiabilities),
    OL_NonCurrentTaxLiabilities: valBS(data, M.balanceSheet.olComponents.nonCurrentTaxLiabilities),
    OL_DeferredTaxLiabilitiesNet: valBS(data, M.balanceSheet.olComponents.deferredTaxLiabilitiesNet),
    OL_OtherNonCurrentLiabilities: valBS(data, M.balanceSheet.olComponents.otherNonCurrentLiabilities),
    DTL, PensionObl, OL_ex_DTL,
    Goodwill, CurrentAssets, CurrentLiabilities, Inventory, TradeReceivables, TradePayables,
    PPE, LIFO_reserve: 0,
    separationScore: score,
  };
}

export function recastIncome(data: RawPeriodData, bs: CanonicalBalanceSheet, cfg: EngineConfig): { is_: CanonicalIncome; cu: CoreUnusual } {
  const Sales = valPL(data, M.profitLoss.sales);
  const TaxExpense = valPL(data, M.profitLoss.taxExpense);
  const PBT = valPL(data, M.profitLoss.pbt);
  const PAT = valPL(data, M.profitLoss.pat);

  let taxRate = cfg.statutory_tax_rate;
  if (cfg.tax_rate_mode === "effective" && PBT > 0) {
    const eff = TaxExpense / PBT;
    if (Number.isFinite(eff) && eff > 0.01 && eff < 0.55) taxRate = eff;
  }

  const OCI = valPL(data, M.profitLoss.ociNotReclass) + valPL(data, M.profitLoss.ociReclass) + valPL(data, M.profitLoss.ociUnspecified);
  const TCI = valPL(data, M.profitLoss.tciGroup);
  const TCI_NCI = valPL(data, M.profitLoss.tciNci);
  const PreferredDividend = valPL(data, M.profitLoss.preferredDividend);
  const CNI = (TCI !== 0 ? (TCI - TCI_NCI) : (PAT + OCI)) - PreferredDividend;

  const FinanceCost = valPL(data, M.profitLoss.financeCostTop) || sumPL(data, M.profitLoss.financeCostGranular);
  let FinanceIncome = valPL(data, M.profitLoss.financeIncomeDirect);
  let FinanceIncomeRung: 1 | 2 | 3 | 4 = 1;
  if (!FinanceIncome) {
    FinanceIncome = Math.abs(valCF(data, M.cashFlow.interestReceived)) + Math.abs(valCF(data, M.cashFlow.dividendReceived));
    FinanceIncomeRung = 2;
  }
  if (!FinanceIncome) {
    const intNet = valCF(data, M.cashFlow.interestNet);
    if (intNet < 0) {
      FinanceIncome = -intNet;
      FinanceIncomeRung = 3;
    }
  }
  if (!FinanceIncome) {
    const oi = valPL(data, M.profitLoss.otherIncome);
    const faRatio = bs.TA > 0 ? Math.max(0.2, Math.min(0.85, bs.FA / bs.TA)) : 0.2;
    FinanceIncome = oi * faRatio;
    FinanceIncomeRung = 4;
  }

  const UFE = -valCF(data, M.cashFlow.plSaleInvest) * (1 - taxRate);
  const CoreNFE = (FinanceCost - FinanceIncome) * (1 - taxRate) + PreferredDividend;
  const NFE = CoreNFE + UFE;
  const MII = TCI_NCI;
  const OI = CNI + NFE + MII;

  const OtherItems = valPL(data, M.profitLoss.otherItemsAliases);
  const OI_from_sales = OI - OtherItems;

  const ExceptionalItemsAfterTax = (valPL(data, M.profitLoss.exceptionalItems) + valPL(data, M.profitLoss.extraordinaryItems) + valPL(data, M.profitLoss.discontinuedItems)) * (1 - taxRate);
  const OCITotal = cfg.oci_treated_as_unusual ? OCI : 0;
  const UOI = ExceptionalItemsAfterTax + OCITotal;
  const CoreOI = OI - UOI;

  return {
    is_: {
      Sales, TaxExpense, taxRate, PAT, OCI, TCI, TCI_NCI,
      CNI, FinanceCost, FinanceIncome, FinanceIncomeRung,
      PreferredDividend, NFE, OI, OtherItems, OI_from_sales, MII,
    },
    cu: { UOI, CoreOI, UFE, CoreNFE, ExceptionalItemsAfterTax, OCITotal },
  };
}

export function recastCashFlow(data: RawPeriodData, is_: CanonicalIncome, bs: CanonicalBalanceSheet, prev?: CanonicalBalanceSheet): CashFlowData {
  const CFO = valCF(data, M.cashFlow.cfo);
  const Capex = Math.abs(valCF(data, M.cashFlow.capex));
  const DividendPaid = Math.abs(valCF(data, M.cashFlow.dividendPaid));
  const EquityIssued = valCF(data, M.cashFlow.equityIssued);
  const ShareBuybacks = 0;
  const InterestReceived = Math.abs(valCF(data, M.cashFlow.interestReceived));
  const DividendReceived = Math.abs(valCF(data, M.cashFlow.dividendReceived));

  const dNOA = prev ? (bs.NOA - prev.NOA) : 0;
  const dNFO = prev ? (bs.NFO - prev.NFO) : 0;
  const FCF_accounting = prev ? (is_.OI - dNOA) : 0;
  const FCF_cash = CFO - Capex;
  const d_t = DividendPaid - EquityIssued - ShareBuybacks;
  const d_t_formula = prev ? (FCF_accounting - is_.NFE + dNFO) : 0;
  const d_t_discrepancy = prev ? d_t - d_t_formula : 0;

  const da = valPL(data, M.profitLoss.depreciationAmortization) || valCF(data, M.cashFlow.depreciation);

  return {
    CFO,
    Capex,
    DividendPaid,
    EquityIssued,
    ShareBuybacks,
    InterestReceived,
    DividendReceived,
    DebtProceeds: sumCF(data, M.cashFlow.debtProceeds),
    DebtRepayment: sumCF(data, M.cashFlow.debtRepayments),
    SaleFixedAssets: valCF(data, M.cashFlow.saleFixedAssets),
    PurchaseInvestments: valCF(data, M.cashFlow.purchaseInvestments),
    SaleInvestments: valCF(data, M.cashFlow.saleInvestments),
    FCF_accounting,
    FCF_cash,
    d_t,
    d_t_formula,
    d_t_discrepancy,
    EBITDA: is_.OI + da,
  };
}

export function computeRecastPeriod(data: RawPeriodData, cfg: EngineConfig, prevPeriod?: RecastPeriod): RecastPeriod {
  const bs = recastBalanceSheet(data, cfg);
  const { is_, cu } = recastIncome(data, bs, cfg);
  const cf = recastCashFlow(data, is_, bs, prevPeriod?.bs);
  return { period_end: data.period_end, bs, is: is_, cu, cf };
}

export function computeRatios(cur: RecastPeriod, prev: RecastPeriod, cfg: EngineConfig): Ratios {
  const avg = (a: number, b: number) => (a + b) / 2;
  const avgCSE = avg(cur.bs.CSE, prev.bs.CSE);
  const avgNOA = avg(cur.bs.NOA, prev.bs.NOA);
  const avgNFO = avg(cur.bs.NFO, prev.bs.NFO);
  const avgOA = avg(cur.bs.OA, prev.bs.OA);
  const avgTA = avg(cur.bs.TA, prev.bs.TA);
  const noaSmall = Math.abs(avgNOA) < Math.max(cfg.noa_epsilon_ratio_of_ta * Math.max(cur.bs.TA, 1), 1);

  const ROCE = avgCSE > 0 ? cur.is.CNI / avgCSE : null;
  const RNOA = !noaSmall ? cur.is.OI / avgNOA : null;
  const NBC = Math.abs(avgNFO) > 1 ? cur.is.NFE / avgNFO : null;
  const SPREAD = RNOA != null && NBC != null ? RNOA - NBC : null;
  const FLEV = cur.bs.CSE > 0 ? cur.bs.NFO / cur.bs.CSE : null;

  const PM = cur.is.Sales > 0 ? cur.is.OI / cur.is.Sales : null;
  const ATO = !noaSmall ? cur.is.Sales / avgNOA : null;
  const ATO_star = avgOA > 0 ? cur.is.Sales / avgOA : null;
  const SalesPM = cur.is.Sales > 0 ? cur.is.OI_from_sales / cur.is.Sales : null;
  const OtherItemsRatio = !noaSmall ? cur.is.OtherItems / avgNOA : null;
  const ROCE_bridge_residual =
    ROCE != null && SalesPM != null && ATO != null && OtherItemsRatio != null && FLEV != null && SPREAD != null
      ? ROCE - (SalesPM * ATO + OtherItemsRatio + FLEV * SPREAD)
      : null;

  const io = cfg.risk_free_rate * cur.bs.OL_ex_DTL;
  const ROOA = avgOA > 0 ? (cur.is.OI + io) / avgOA : null;
  const OLLEV = !noaSmall && avgNOA !== 0 ? cur.bs.OL / avgNOA : null;
  const OLSPREAD = ROOA != null && cur.bs.OL > 0 ? ROOA - io / cur.bs.OL : null;
  const RNOA_check = ROOA != null && OLLEV != null && OLSPREAD != null ? ROOA + OLLEV * OLSPREAD : null;

  const avgTCE = avg(cur.bs.NOA + cur.bs.MI, prev.bs.NOA + prev.bs.MI);
  const ROTCE = avgTCE > 0 ? cur.is.OI / avgTCE : null;
  const MSR = cur.bs.CSE > 0 && (cur.is.CNI + cur.is.MII) !== 0
    ? (cur.is.CNI / (cur.is.CNI + cur.is.MII)) / (cur.bs.CSE / (cur.bs.CSE + cur.bs.MI))
    : null;

  const CoreSalesPM = cur.is.Sales > 0 ? cur.cu.CoreOI / cur.is.Sales : null;
  const CoreOtherItems_OA = avgOA > 0 ? cur.is.OtherItems / avgOA : null;
  const UOI_OA = avgOA > 0 ? cur.cu.UOI / avgOA : null;
  const CoreNBC = Math.abs(avgNFO) > 1 ? cur.cu.CoreNFE / avgNFO : null;
  const UFE_NFO = Math.abs(avgNFO) > 1 ? cur.cu.UFE / avgNFO : null;
  const CoreSPREAD = RNOA != null && CoreNBC != null ? RNOA - CoreNBC : null;
  let ROCE_eq16_reconstructed: number | null = null;
  if (CoreSalesPM != null && ATO_star != null && CoreOtherItems_OA != null && UOI_OA != null && OLLEV != null && OLSPREAD != null && FLEV != null && CoreSPREAD != null && UFE_NFO != null) {
    ROCE_eq16_reconstructed = (CoreSalesPM * ATO_star) + CoreOtherItems_OA + UOI_OA + (OLLEV * OLSPREAD) + (FLEV * (CoreSPREAD + UOI_OA - UFE_NFO));
  }
  const ROCE_eq16_error = ROCE != null && ROCE_eq16_reconstructed != null ? ROCE - ROCE_eq16_reconstructed : null;

  const required_return_per_sales = ATO != null && ATO !== 0 ? cfg.risk_free_rate / ATO : null;
  const value_creating_margin = PM != null && required_return_per_sales != null ? PM - required_return_per_sales : null;

  const CSE_eq8_check = cur.is.Sales > 0 && ATO != null && FLEV != null ? cur.is.Sales / ATO / (1 + FLEV) : null;
  const CSE_eq8_error_pct = CSE_eq8_check != null && cur.bs.CSE > 0 ? Math.abs(cur.bs.CSE - CSE_eq8_check) / cur.bs.CSE : null;

  const current_ratio = cur.bs.CurrentLiabilities > 0 ? cur.bs.CurrentAssets / cur.bs.CurrentLiabilities : null;
  const quick_ratio = cur.bs.CurrentLiabilities > 0 ? (cur.bs.CurrentAssets - cur.bs.Inventory) / cur.bs.CurrentLiabilities : null;
  const days_receivable = cur.is.Sales > 0 ? avg(cur.bs.TradeReceivables, prev.bs.TradeReceivables) / cur.is.Sales * 365 : null;
  const days_payable = cur.is.Sales > 0 ? avg(cur.bs.TradePayables, prev.bs.TradePayables) / cur.is.Sales * 365 : null;
  const days_inventory = cur.is.Sales > 0 ? avg(cur.bs.Inventory, prev.bs.Inventory) / cur.is.Sales * 365 : null;
  const cash_conversion_cycle = days_receivable != null && days_payable != null && days_inventory != null ? days_receivable + days_inventory - days_payable : null;

  const accrual_ratio_bs = avgTA > 0 ? (cur.bs.NOA - prev.bs.NOA) / avgTA : null;
  const accrual_ratio_cf = avgTA > 0 ? (cur.is.PAT - cur.cf.CFO) / avgTA : null;
  const cash_conversion_ratio = cur.is.OI !== 0 ? cur.cf.CFO / cur.is.OI : null;
  const interest_coverage = Math.abs(cur.is.NFE) > 0.1 ? cur.is.OI / Math.abs(cur.is.NFE) : null;

  const NOA_growth = prev.bs.NOA !== 0 ? (cur.bs.NOA - prev.bs.NOA) / Math.abs(prev.bs.NOA) : null;
  const CNI_growth = prev.is.CNI !== 0 ? (cur.is.CNI - prev.is.CNI) / Math.abs(prev.is.CNI) : null;
  const OI_growth = prev.is.OI !== 0 ? (cur.is.OI - prev.is.OI) / Math.abs(prev.is.OI) : null;
  const Sales_growth = prev.is.Sales !== 0 ? (cur.is.Sales - prev.is.Sales) / Math.abs(prev.is.Sales) : null;

  return {
    ROCE, RNOA, NBC, SPREAD, FLEV,
    PM, ATO, ATO_star, SalesPM, OtherItemsRatio, ROCE_bridge_residual,
    io, ROOA, OLLEV, OLSPREAD, RNOA_check,
    ROTCE, MSR,
    CoreSalesPM, CoreOtherItems_OA, UOI_OA, CoreNBC, UFE_NFO, CoreSPREAD,
    ROCE_eq16_reconstructed, ROCE_eq16_error,
    required_return_per_sales, value_creating_margin,
    CSE_eq8_check, CSE_eq8_error_pct,
    current_ratio, quick_ratio,
    days_receivable, days_payable, days_inventory, cash_conversion_cycle,
    accrual_ratio_bs, accrual_ratio_cf, cash_conversion_ratio,
    interest_coverage,
    NOA_growth, CNI_growth, OI_growth, Sales_growth,
    noaSmall,
    separationScore: cur.bs.separationScore,
  };
}

export function computeResidualIncome(cur: RecastPeriod, prev: RecastPeriod, ke: number, kw: number): ResidualIncome {
  return {
    RE: cur.is.CNI - ke * prev.bs.CSE,
    ReOI: cur.is.OI - kw * prev.bs.NOA,
  };
}

export function computeValuation(periods: RecastPeriod[], ke: number, kw: number, g: number, cfg: EngineConfig) {
  const rhoE = 1 + ke;
  const rhoW = 1 + kw;
  const reSeries: Array<{ period: string; RE: number; ReOI: number }> = [];
  for (let i = 1; i < periods.length; i++) {
    const cur = periods[i];
    const prev = periods[i - 1];
    reSeries.push({ period: cur.period_end, RE: cur.is.CNI - ke * prev.bs.CSE, ReOI: cur.is.OI - kw * prev.bs.NOA });
  }
  const pvRE = reSeries.reduce((s, r, i) => s + r.RE / Math.pow(rhoE, i + 1), 0);
  const pvReOI = reSeries.reduce((s, r, i) => s + r.ReOI / Math.pow(rhoW, i + 1), 0);
  const T = reSeries.length;
  const lastRE = T ? reSeries[T - 1].RE : 0;
  const lastReOI = T ? reSeries[T - 1].ReOI : 0;
  const discE = Math.pow(rhoE, T);
  const discW = Math.pow(rhoW, T);

  const CV_RE_1 = 0;
  const CV_RE_2 = rhoE > 1 ? lastRE / (rhoE - 1) : 0;
  const CV_RE_3 = rhoE - 1 - g > 0 ? (lastRE * (1 + g)) / (rhoE - 1 - g) : 0;
  const CV_W_1 = 0;
  const CV_W_2 = rhoW > 1 ? lastReOI / (rhoW - 1) : 0;
  const CV_W_3 = rhoW - 1 - g > 0 ? (lastReOI * (1 + g)) / (rhoW - 1 - g) : 0;

  const CSE0 = periods[0].bs.CSE;
  const NOA0 = periods[0].bs.NOA;
  const NFO_latest = periods[periods.length - 1].bs.NFO;

  return {
    reSeries,
    pvRE,
    pvReOI,
    CV_RE: CV_RE_3,
    CV_ReOI: CV_W_3,
    EV_ReOI: NOA0 + pvReOI + CV_W_3 / discW,
    V_RE_CV1: CSE0 + pvRE + CV_RE_1 / discE,
    V_RE_CV2: CSE0 + pvRE + CV_RE_2 / discE,
    V_RE_CV3: CSE0 + pvRE + CV_RE_3 / discE,
    V_ReOI_CV01: (NOA0 + pvReOI + CV_W_1 / discW) - NFO_latest,
    V_ReOI_CV02: (NOA0 + pvReOI + CV_W_2 / discW) - NFO_latest,
    V_ReOI_CV03: (NOA0 + pvReOI + CV_W_3 / discW) - NFO_latest,
    CSE0,
    NOA0,
    NFO_latest,
    ke,
    kw,
    g,
    separationScore: periods[periods.length - 1].bs.separationScore,
    lowConfidence: periods[periods.length - 1].bs.separationScore < (cfg.separation_confidence_threshold ?? 70),
  };
}

export function computeQuality(cur: RecastPeriod, prev: RecastPeriod, data: RawPeriodData, prevData: RawPeriodData): QualityMetrics {
  const avgTA = (cur.bs.TA + prev.bs.TA) / 2;
  const TL_cur = cur.bs.TA - cur.bs.CSE - cur.bs.MI;
  const TL_prev = prev.bs.TA - prev.bs.CSE - prev.bs.MI;
  const safe = (n: number, d: number, fb = 1) => (d !== 0 && Number.isFinite(n / d) ? n / d : fb);

  const cogs = (d: RawPeriodData) => {
    const direct = valPL(d, M.profitLoss.cogsMaterial) + valPL(d, M.profitLoss.cogsPurchases) + valPL(d, M.profitLoss.cogsInventoryChange);
    if (direct !== 0) return direct;
    return valPL(d, M.profitLoss.totalExpenses) - valPL(d, M.profitLoss.employeeExpense) - valPL(d, M.profitLoss.otherExpenses) - valPL(d, M.profitLoss.depreciationAmortization);
  };
  const sga = (d: RawPeriodData) => {
    const detailed = valPL(d, M.profitLoss.employeeExpense)
      + valPL(d, M.profitLoss.sgaAds)
      + valPL(d, M.profitLoss.sgaLegal)
      + valPL(d, M.profitLoss.sgaRent)
      + valPL(d, M.profitLoss.sgaFreight)
      + valPL(d, M.profitLoss.sgaRepairs)
      + valPL(d, M.profitLoss.sgaPower);
    return detailed > 0 ? detailed : valPL(d, M.profitLoss.employeeExpense) + valPL(d, M.profitLoss.otherExpenses);
  };

  const cogsCur = cogs(data);
  const cogsPrev = cogs(prevData);
  const gmCur = cur.is.Sales > 0 ? (cur.is.Sales - cogsCur) / cur.is.Sales : 0;
  const gmPrev = prev.is.Sales > 0 ? (prev.is.Sales - cogsPrev) / prev.is.Sales : 0;

  const roaCur = cur.bs.TA > 0 ? cur.is.PAT / cur.bs.TA : 0;
  const roaPrev = prev.bs.TA > 0 ? prev.is.PAT / prev.bs.TA : 0;
  const p_roa = roaCur > 0 ? 1 : 0;
  const p_delta_roa = roaCur > roaPrev ? 1 : 0;
  const p_cfo = cur.cf.CFO > 0 ? 1 : 0;
  const p_accrual = cur.bs.TA > 0 && cur.cf.CFO / cur.bs.TA > roaCur ? 1 : 0;
  const p_leverage = (cur.bs.CSE > 0 ? cur.bs.NFO / cur.bs.CSE : 0) < (prev.bs.CSE > 0 ? prev.bs.NFO / prev.bs.CSE : 0) ? 1 : 0;
  const p_liquidity = (cur.bs.CurrentLiabilities > 0 ? cur.bs.CurrentAssets / cur.bs.CurrentLiabilities : 0) > (prev.bs.CurrentLiabilities > 0 ? prev.bs.CurrentAssets / prev.bs.CurrentLiabilities : 0) ? 1 : 0;
  const p_dilution = cur.cf.EquityIssued <= 0 ? 1 : 0;
  const p_margin = gmCur > gmPrev ? 1 : 0;
  const p_turnover = (cur.bs.TA > 0 ? cur.is.Sales / cur.bs.TA : 0) > (prev.bs.TA > 0 ? prev.is.Sales / prev.bs.TA : 0) ? 1 : 0;
  const piotroski_total = p_roa + p_delta_roa + p_cfo + p_accrual + p_leverage + p_liquidity + p_dilution + p_margin + p_turnover;

  const dsri = safe(safe(cur.bs.TradeReceivables, cur.is.Sales), safe(prev.bs.TradeReceivables, prev.is.Sales));
  const gmi = safe(gmPrev, gmCur);
  const aqi = safe(
    cur.bs.TA > 0 ? 1 - (cur.bs.PPE + cur.bs.CurrentAssets) / cur.bs.TA : 0,
    prev.bs.TA > 0 ? 1 - (prev.bs.PPE + prev.bs.CurrentAssets) / prev.bs.TA : 0
  );
  const sgi = safe(cur.is.Sales, prev.is.Sales);
  const depi = safe(
    prev.bs.PPE > 0 ? valPL(prevData, M.profitLoss.depreciationAmortization) / prev.bs.PPE : 0,
    cur.bs.PPE > 0 ? valPL(data, M.profitLoss.depreciationAmortization) / cur.bs.PPE : 0
  );
  const sgai = safe(safe(sga(data), cur.is.Sales), safe(sga(prevData), prev.is.Sales));
  const lvgi = safe(TL_cur / Math.max(cur.bs.TA, 1), TL_prev / Math.max(prev.bs.TA, 1));
  const tata = avgTA > 0 ? (cur.is.PAT - cur.cf.CFO) / avgTA : 0;
  const beneish_mscore = -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi;

  const wc = cur.bs.CurrentAssets - cur.bs.CurrentLiabilities;
  const reProxy = valBS(data, M.profitLoss.retainedEarningsProxy);
  const ebit = cur.is.OI;
  const bve = cur.bs.CSE + cur.bs.MI;
  const z_wc_ta = cur.bs.TA > 0 ? wc / cur.bs.TA : 0;
  const z_re_ta = cur.bs.TA > 0 ? reProxy / cur.bs.TA : 0;
  const z_ebit_ta = cur.bs.TA > 0 ? ebit / cur.bs.TA : 0;
  const z_bve_tl = TL_cur > 0 ? bve / TL_cur : 0;
  const z_s_ta = cur.bs.TA > 0 ? cur.is.Sales / cur.bs.TA : 0;
  const altman_zprime = 0.717 * z_wc_ta + 0.847 * z_re_ta + 3.107 * z_ebit_ta + 0.420 * z_bve_tl + 0.998 * z_s_ta;

  return {
    piotroski_roa: p_roa,
    piotroski_delta_roa: p_delta_roa,
    piotroski_cfo: p_cfo,
    piotroski_accrual: p_accrual,
    piotroski_leverage: p_leverage,
    piotroski_liquidity: p_liquidity,
    piotroski_dilution: p_dilution,
    piotroski_margin: p_margin,
    piotroski_turnover: p_turnover,
    piotroski_total,
    beneish_dsri: dsri,
    beneish_gmi: gmi,
    beneish_aqi: aqi,
    beneish_sgi: sgi,
    beneish_depi: depi,
    beneish_sgai: sgai,
    beneish_lvgi: lvgi,
    beneish_tata: tata,
    beneish_mscore,
    altman_wc_ta: z_wc_ta,
    altman_re_ta: z_re_ta,
    altman_ebit_ta: z_ebit_ta,
    altman_bve_tl: z_bve_tl,
    altman_s_ta: z_s_ta,
    altman_zprime,
  };
}