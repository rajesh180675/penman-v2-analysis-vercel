/* ================================================================
   PenmanNissimEngine decomposition — recast layer (balance sheet,
   income statement, cash flow) plus missing-line flagging and the
   reconciliation-residuals debug capture.

   Lifted verbatim from src/engine/PenmanNissimEngine.ts. Imports DOWN
   from ./picking (pick/trace primitives), ../types, and ../mappingSpec.
   The parent re-exports recastBalanceSheet/recastIncome/recastCashFlow
   so external import paths are unchanged. Behaviour byte-for-byte identical.
================================================================ */

import {
  RawPeriodData,
  CanonicalBalanceSheet,
  CanonicalIncome,
  CoreUnusual,
  CashFlowData,
  RecastDebug,
  EngineConfig,
  TraceMap,
  Severity,
  SpecFlag,
} from "../types";
import { CapitalineMappingSpec as M } from "../mappingSpec";
import {
  pushTrace,
  sumWithDistinctSource,
  valBS,
  valPL,
  valCF,
  sumPLWithTrace,
} from "./picking";

export function recastBalanceSheet(data: RawPeriodData, cfg: EngineConfig, trace?: TraceMap): CanonicalBalanceSheet {
  const bs = (line: string, keys: readonly string[]) => valBS(data, keys, line, trace);
  const sumBs = (line: string, keys: readonly string[]) => sumWithDistinctSource(data, keys, "BalanceSheet", line, trace);

  const TA = bs("BS.TA", M.balanceSheet.totalAssets);
  const totalSE = bs("BS.TotalStockholdersEquity", M.balanceSheet.totalStockholdersEquity);
  const totalEq = bs("BS.TotalEquity", M.balanceSheet.totalEquity);
  const MI = bs("BS.MI", M.balanceSheet.minorityInterest);
  const CSE = totalSE > 0 ? totalSE : totalEq - MI;
  pushTrace(trace, "BS.CSE", { statement: "Derived", key: "TotalSE or TotalEq-MI", value: CSE, matchType: "derived" });

  const cashBank = sumBs("BS.FA.CashBank", M.balanceSheet.financialAssets.cashAndBank);
  const curInvTop = bs("BS.FA.CurrentInvestmentsTop", [M.balanceSheet.financialAssets.currentInvestments[0]]);
  const curInvAlt = sumBs("BS.FA.CurrentInvestmentsAlt", M.balanceSheet.financialAssets.currentInvestments.slice(1));
  const curInv = curInvTop > 0 ? curInvTop : curInvAlt;
  const ltInvDirect = bs("BS.FA.LongTermInvestmentsDirect", M.balanceSheet.financialAssets.longTermInvestments);
  const totalInvestmentsFallback = bs("BS.FA.TotalInvestmentsFallback", ["Total Investments"]);
  const ltInv = ltInvDirect > 0 ? ltInvDirect : Math.max(0, totalInvestmentsFallback - curInv);
  const depAndRestricted = sumBs("BS.FA.DepositsRestricted", M.balanceSheet.financialAssets.depositsAndRestricted);
  const otherFA_base = bs("BS.FA.OtherFA_LT", ["Others Financial Assets - Long-term"]) + bs("BS.FA.OtherFA_ST", ["Others Financial Assets - Short-term"]);
  const interestRec = bs("BS.FA.TotalInterestReceivable", ["Total Interest Receivable"]) || bs("BS.FA.InterestReceivable", ["Interest Receivable"]);
  const divRec = bs("BS.FA.DividendReceivable", ["Dividend Receivable"]);
  const derivRec = bs("BS.FA.DerivativeReceivable", ["Derivative Receivables / Forward Contract Receivable"]) || bs("BS.FA.ForwardContractReceivable", ["Forward Contract Receivable"]);
  const otherFA = otherFA_base > 0 ? otherFA_base : (interestRec + divRec + derivRec);
  let FA = cashBank + curInv + ltInv + depAndRestricted + otherFA;
  if (cfg.financial_institution_mode) FA = 0;
  pushTrace(trace, "BS.FA", { statement: "Derived", key: "cash+curInv+ltInv+deposits+otherFA", value: FA, matchType: "derived" });

  const longBorrow = bs("BS.FO.LongBorrow", ["Long Term Borrowings"]);
  const shortBorrow = bs("BS.FO.ShortBorrow", ["Short Term Borrowings"]);
  const leaseLiab = bs("BS.FO.LeaseLiabilities", ["Lease Liabilities"]);
  const otherFinLiab = bs("BS.FO.OtherFinLiabLT", ["Others Financial Liabilities - Long-term"]) + bs("BS.FO.OtherFinLiabST", ["Others Financial Liabilities - Short-term"]);
  const hybrid = cfg.hybrid_perpetual_as_debt ? bs("BS.FO.Hybrid", ["Hybrid Perpetual Securities"]) : 0;
  const financialDebtExLease = longBorrow + shortBorrow + otherFinLiab + hybrid;
  const bridgeDebtLongTerm = sumBs("BS.BridgeDebt.LongTerm", M.balanceSheet.bridgeDebt.longTermBorrowings);
  const bridgeDebtShortTerm = sumBs("BS.BridgeDebt.ShortTerm", M.balanceSheet.bridgeDebt.shortTermBorrowings);
  const bridgeDebtDebentures = sumBs("BS.BridgeDebt.Debentures", M.balanceSheet.bridgeDebt.debentures);
  const bridgeDebtCurrentMaturities = sumBs("BS.BridgeDebt.CurrentMaturities", M.balanceSheet.bridgeDebt.currentMaturities);
  const bridgeDebtTotal = bridgeDebtLongTerm + bridgeDebtShortTerm + bridgeDebtDebentures + bridgeDebtCurrentMaturities;
  pushTrace(trace, "BS.BridgeDebt.Total", {
    statement: "Derived",
    key: "long+short+debentures+currentMaturities",
    value: bridgeDebtTotal,
    matchType: "derived",
  });
  const FO_uncapped = longBorrow + shortBorrow + otherFinLiab + hybrid + leaseLiab;

  const OA = TA - FA;
  const TotalLiabilities = TA - (CSE + MI);
  const FO = Math.min(Math.max(0, FO_uncapped), Math.max(0, TotalLiabilities));
  pushTrace(trace, "BS.FO", { statement: "Derived", key: "borrow+otherFinLiab+hybrid+lease (capped)", value: FO, matchType: "derived", note: FO_uncapped > FO ? "Capped at TotalLiabilities" : undefined });
  const OL = Math.max(0, TotalLiabilities - FO);
  const NOA = OA - OL;
  const NFO = FO - FA;
  pushTrace(trace, "BS.OA", { statement: "Derived", key: "TA-FA", value: OA, matchType: "derived" });
  pushTrace(trace, "BS.OL", { statement: "Derived", key: "TotalLiabilities-FO", value: OL, matchType: "derived" });
  pushTrace(trace, "BS.NOA", { statement: "Derived", key: "OA-OL", value: NOA, matchType: "derived" });
  pushTrace(trace, "BS.NFO", { statement: "Derived", key: "FO-FA", value: NFO, matchType: "derived" });

  const DTL = Math.max(0, bs("BS.DTL", M.balanceSheet.dtl));
  const PensionObl = 0;
  const OL_ex_DTL = Math.max(0, OL - DTL - PensionObl);

  const Goodwill = bs("BS.Goodwill", M.balanceSheet.goodwill);
  const CurrentAssets = bs("BS.CurrentAssets", M.balanceSheet.currentAssets);
  const CurrentLiabilities = bs("BS.CurrentLiabilities", M.balanceSheet.currentLiabilities);
  const invTop = bs("BS.InventoryTop", M.balanceSheet.inventoryTop);
  const invRaw = bs("BS.InventoryRaw", ["Raw Materials and Components"]);
  const invWip = bs("BS.InventoryWip", ["Work-in-Progress"]) || bs("BS.InventoryWipAlt", ["Work-in-progress"]);
  const invFinished = bs("BS.InventoryFinished", ["Finished Goods / Traded Goods"]) || bs("BS.InventoryFinishedAlt", ["Finished Goods"]);
  const invStockTrade = bs("BS.InventoryStockTrade", ["Stock-in-trade"]);
  const invStores = bs("BS.InventoryStores", ["Stores and Spares"]);
  const invPack = bs("BS.InventoryPacking", ["Packing Materials"]);
  const invTransit = bs("BS.InventoryTransit", ["Goods in Transit"]);
  const Inventory = invTop || (invRaw + invWip + invFinished + invStockTrade + invStores + invPack + invTransit);
  const TradeReceivables = bs("BS.TradeReceivables", M.balanceSheet.tradeReceivables);
  const TradePayables = bs("BS.TradePayables", M.balanceSheet.tradePayables);
  const PPE = bs("BS.PPE", M.balanceSheet.ppe);

  const explicitOL =
    bs("BS.OLComp.TradePayables", M.balanceSheet.olComponents.tradePayables)
    + bs("BS.OLComp.OtherCurrentLiabilities", M.balanceSheet.olComponents.otherCurrentLiabilities)
    + bs("BS.OLComp.ProvisionsCurrent", M.balanceSheet.olComponents.provisionsCurrent)
    + bs("BS.OLComp.ProvisionsLongTerm", M.balanceSheet.olComponents.provisionsLongTerm)
    + bs("BS.OLComp.CurrentTaxLiabilities", M.balanceSheet.olComponents.currentTaxLiabilities)
    + bs("BS.OLComp.NonCurrentTaxLiabilities", M.balanceSheet.olComponents.nonCurrentTaxLiabilities)
    + bs("BS.OLComp.DeferredTaxLiabilitiesNet", M.balanceSheet.olComponents.deferredTaxLiabilitiesNet)
    + bs("BS.OLComp.OtherNonCurrentLiabilities", M.balanceSheet.olComponents.otherNonCurrentLiabilities);
  const olRatio = OL > 0 ? explicitOL / OL : 1;
  const olConsistent = OL === 0 ? true : olRatio >= 0.7 && olRatio <= 1.3;

  const externalEquity = bs("BS.ExternalEquity", ["Total Equity"]);
  const externalEquityOk = TA > 0 && externalEquity > 0 && Math.abs(externalEquity - (CSE + MI)) / TA < 0.01;
  const score = Math.min(100,
    (FA > 0 ? 20 : 0)
    + (FO > 0 ? 25 : 0)
    + (valPL(data, M.profitLoss.financeCostTop) > 0 ? 15 : 0)
    + (olConsistent ? 15 : 5)
    + (externalEquityOk ? 25 : 10)
  );

  // S-2.4 OA sub-component decomposition
  const OA_PPE   = PPE;
  const OA_ROU   = bs("BS.OA.ROU", ["Right of Use Assets", "Right-of-Use Assets"]);
  const OA_Goodwill = Goodwill;
  const OA_TelecomSpectrumLicenses = sumBs("BS.OA.TelecomSpectrumLicenses", M.balanceSheet.telecomSpectrumLicenseAssets);
  const genericOtherIntangibles = bs("BS.OA.OtherIntangibles", M.balanceSheet.intangibleAssets);
  // Capitaline sometimes exposes telecom spectrum/licence rights as a detailed
  // line rather than a generic intangible subtotal. Treat those rights as
  // operating intangibles (spectrum is productive operating capacity), but avoid
  // double-counting when the generic Intangible Assets subtotal is present.
  const OA_OtherIntangibles = genericOtherIntangibles > 0 ? genericOtherIntangibles : OA_TelecomSpectrumLicenses;
  const OA_UtilityRegulatoryDeferrals = sumBs("BS.OA.UtilityRegulatoryDeferrals", [
    "Regulatory Deferral Account - Debit Balance",
    "Regulatory Deferral Account Debit Balance",
    "Regulatory Assets",
  ]);
  const OA_Inventory = Inventory;
  const OA_TradeReceivables = TradeReceivables;
  const OA_DTA   = bs("BS.OA.DTA", ["Deferred Tax Assets", "Net Deferred Tax Assets"]);
  const OA_CWIP  = bs("BS.OA.CWIP", ["Capital Work in Progress", "Capital Work-in-Progress"]);
  const OA_Other = OA - OA_PPE - OA_ROU - OA_Goodwill - OA_OtherIntangibles
                  - OA_UtilityRegulatoryDeferrals - OA_Inventory - OA_TradeReceivables - OA_DTA - OA_CWIP;

  return {
    TA, CSE, MI, FA, FO, OA, OL, NOA, NFO,
    BridgeDebtLongTerm: bridgeDebtLongTerm,
    BridgeDebtShortTerm: bridgeDebtShortTerm,
    BridgeDebtDebentures: bridgeDebtDebentures,
    BridgeDebtCurrentMaturities: bridgeDebtCurrentMaturities,
    BridgeDebtTotal: bridgeDebtTotal,
    FO_LeaseLiabilities: leaseLiab,
    FO_FinancialDebtExLease: financialDebtExLease,
    OL_TradePayables: bs("BS.OLComp.TradePayablesOut", M.balanceSheet.olComponents.tradePayables),
    OL_OtherCurrentLiabilities: bs("BS.OLComp.OtherCurrentLiabilitiesOut", M.balanceSheet.olComponents.otherCurrentLiabilities),
    OL_ProvisionsCurrent: bs("BS.OLComp.ProvisionsCurrentOut", M.balanceSheet.olComponents.provisionsCurrent),
    OL_ProvisionsLongTerm: bs("BS.OLComp.ProvisionsLongTermOut", M.balanceSheet.olComponents.provisionsLongTerm),
    OL_CurrentTaxLiabilities: bs("BS.OLComp.CurrentTaxLiabilitiesOut", M.balanceSheet.olComponents.currentTaxLiabilities),
    OL_NonCurrentTaxLiabilities: bs("BS.OLComp.NonCurrentTaxLiabilitiesOut", M.balanceSheet.olComponents.nonCurrentTaxLiabilities),
    OL_DeferredTaxLiabilitiesNet: bs("BS.OLComp.DeferredTaxLiabilitiesNetOut", M.balanceSheet.olComponents.deferredTaxLiabilitiesNet),
    OL_OtherNonCurrentLiabilities: bs("BS.OLComp.OtherNonCurrentLiabilitiesOut", M.balanceSheet.olComponents.otherNonCurrentLiabilities),
    DTL, PensionObl, OL_ex_DTL,
    Goodwill, CurrentAssets, CurrentLiabilities, Inventory, TradeReceivables, TradePayables,
    PPE, LIFO_reserve: 0,
    separationScore: score,
    OA_PPE, OA_ROU, OA_Goodwill, OA_OtherIntangibles,
    OA_TelecomSpectrumLicenses,
    OA_UtilityRegulatoryDeferrals,
    OA_Inventory, OA_TradeReceivables, OA_DTA, OA_CWIP, OA_Other,
  };
}

export function recastIncome(data: RawPeriodData, bs: CanonicalBalanceSheet, cfg: EngineConfig, trace?: TraceMap): { is_: CanonicalIncome; cu: CoreUnusual } {
  const pl = (line: string, keys: readonly string[]) => valPL(data, keys, line, trace);
  const cf = (line: string, keys: readonly string[]) => valCF(data, keys, line, trace);

  const Sales = pl("IS.Sales", M.profitLoss.sales);
  const TaxExpense = pl("IS.TaxExpense", M.profitLoss.taxExpense);
  const PBT = pl("IS.PBT", M.profitLoss.pbt);
  const PAT = pl("IS.PAT", M.profitLoss.pat);

  let taxRate = cfg.statutory_tax_rate;
  if (cfg.tax_rate_mode === "effective" && PBT > 0) {
    const eff = TaxExpense / PBT;
    if (Number.isFinite(eff) && eff > 0.01 && eff < 0.55) taxRate = eff;
  }

  const OCI = pl("IS.OCI.NotReclass", M.profitLoss.ociNotReclass) + pl("IS.OCI.Reclass", M.profitLoss.ociReclass) + pl("IS.OCI.Unspecified", M.profitLoss.ociUnspecified);
  const TCI = pl("IS.TCI", M.profitLoss.tciGroup);
  const TCI_NCI = pl("IS.TCI_NCI", M.profitLoss.tciNci);
  const PreferredDividend = pl("IS.PreferredDividend", M.profitLoss.preferredDividend);
  const CNI = (TCI !== 0 ? (TCI - TCI_NCI) : (PAT + OCI)) - PreferredDividend;
  pushTrace(trace, "IS.CNI", { statement: "Derived", key: "TCI-TCI_NCI-PrefDiv or PAT+OCI-PrefDiv", value: CNI, matchType: "derived" });

  const financeCostTop = pl("IS.FinanceCost.Top", M.profitLoss.financeCostTop);
  const FinanceCost = financeCostTop || sumPLWithTrace(data, M.profitLoss.financeCostGranular, "IS.FinanceCost.Granular", trace);
  if (!financeCostTop) {
    pushTrace(trace, "IS.FinanceCost", { statement: "Derived", key: "sum(financeCostGranular)", value: FinanceCost, matchType: "derived" });
  }
  const OtherIncome = pl("IS.OtherIncome", M.profitLoss.otherIncome);
  let FinanceIncome = pl("IS.FinanceIncome.Direct", M.profitLoss.financeIncomeDirect);
  let FinanceIncomeRung: 1 | 2 | 3 | 4 = 1;
  if (!FinanceIncome) {
    FinanceIncome = Math.abs(cf("IS.FinanceIncome.CF.InterestReceived", M.cashFlow.interestReceived)) + Math.abs(cf("IS.FinanceIncome.CF.DividendReceived", M.cashFlow.dividendReceived));
    FinanceIncomeRung = 2;
  }
  if (!FinanceIncome) {
    const intNet = cf("IS.FinanceIncome.CF.InterestNet", M.cashFlow.interestNet);
    if (intNet !== 0) {
      FinanceIncome = Math.max(0, FinanceCost - intNet);
      FinanceIncomeRung = 3;
    }
  }
  if (!FinanceIncome) {
    const faRatio = bs.TA > 0 ? Math.max(0.2, Math.min(0.85, bs.FA / bs.TA)) : 0.2;
    FinanceIncome = OtherIncome * faRatio;
    FinanceIncomeRung = 4;
  }

  const UFE = -valCF(data, M.cashFlow.plSaleInvest) * (1 - taxRate);
  const CoreNFE = (FinanceCost - FinanceIncome) * (1 - taxRate) + PreferredDividend;
  const NFE = CoreNFE + UFE;
  const MII = TCI_NCI;
  const OI = CNI + NFE + MII;
  pushTrace(trace, "IS.OI", { statement: "Derived", key: "(TCI or PAT+OCI)-PrefDiv+NFE", value: OI, matchType: "derived" });

  const OtherItems = pl("IS.OtherItems", M.profitLoss.otherItemsAliases);
  const OI_from_sales = OI - OtherItems;

  const exceptionalPretax = pl("IS.ExceptionalPreTax", M.profitLoss.exceptionalItems) + pl("IS.ExtraordinaryPreTax", M.profitLoss.extraordinaryItems);
  const discontinuedRaw = pl("IS.DiscontinuedRaw", M.profitLoss.discontinuedItems);
  const discontinuedTax = pl("IS.DiscontinuedTax", ["Tax Expense of Discontinuing Operations"]);
  // If a dedicated discontinued tax line is present and smaller than the discontinued line,
  // treat discontinuedRaw as pre-tax and tax-adjust it once. Otherwise, assume already after-tax.
  const discontinuedAfterTax =
    discontinuedTax !== 0 && Math.abs(discontinuedTax) <= Math.abs(discontinuedRaw)
      ? (discontinuedRaw - discontinuedTax)
      : discontinuedRaw;
  const exceptionalOperatingAfterTax = exceptionalPretax * (1 - taxRate);
  const ExceptionalItemsAfterTax = exceptionalOperatingAfterTax + discontinuedAfterTax;
  const COGS = pl("IS.COGS.Material", M.profitLoss.cogsMaterial)
    + pl("IS.COGS.Purchases", M.profitLoss.cogsPurchases)
    - pl("IS.COGS.InventoryChange", M.profitLoss.cogsInventoryChange);
  const employeeCost = pl("IS.EmployeeCost", M.profitLoss.employeeExpense);
  const depreciation = pl("IS.Depreciation", M.profitLoss.depreciationAmortization) || Math.abs(cf("IS.Depreciation.CF", M.cashFlow.depreciation));
  const sgaAdvertising = pl("IS.SGA.Advertising", M.profitLoss.sgaAds);
  const sgaLegalProfessional = pl("IS.SGA.Legal", M.profitLoss.sgaLegal);
  const sgaRent = pl("IS.SGA.Rent", M.profitLoss.sgaRent);
  const sgaFreight = pl("IS.SGA.Freight", M.profitLoss.sgaFreight);
  const sgaRepairs = sumPLWithTrace(data, M.profitLoss.sgaRepairs, "IS.SGA.Repairs", trace);
  const sgaPowerFuel = pl("IS.SGA.Power", M.profitLoss.sgaPower);
  const sgaDetailed =
    sgaAdvertising
    + sgaLegalProfessional
    + sgaRent
    + sgaFreight
    + sgaRepairs
    + sgaPowerFuel;
  const otherExpenses = pl("IS.OtherExpenses", M.profitLoss.otherExpenses);
  const telecomNetworkOpex = sumPLWithTrace(data, M.profitLoss.telecomNetworkOpex, "IS.Telecom.NetworkOpex", trace);
  const licenseFeeOperationCharges = sumPLWithTrace(data, M.profitLoss.licenseFeeOperationCharges, "IS.Sector.LicenseFeeOperationCharges", trace);
  const sectorSpecificOperatingExpense = telecomNetworkOpex + licenseFeeOperationCharges;
  const sgaResidual = otherExpenses > sgaDetailed + sectorSpecificOperatingExpense
    ? otherExpenses - sgaDetailed - sectorSpecificOperatingExpense
    : 0;
  const sgaTotal = sgaDetailed;
  const otherOperatingExpense = Math.max(0, otherExpenses - sgaDetailed - sectorSpecificOperatingExpense);
  const otherOperatingIncome = Math.max(0, OtherIncome - (FinanceIncomeRung === 4 ? Math.min(OtherIncome, FinanceIncome) : 0));
  const grossProfit = Sales - COGS;
  const operatingCosts = employeeCost + depreciation + sgaTotal + sectorSpecificOperatingExpense + otherOperatingExpense;
  const OCITotal = cfg.oci_treated_as_unusual ? OCI : 0;
  const UOI = ExceptionalItemsAfterTax + OCITotal;
  const CoreOI = OI - UOI;
  const bridgeCoreOI = grossProfit - employeeCost - depreciation - sgaTotal - sectorSpecificOperatingExpense - otherOperatingExpense + otherOperatingIncome;
  const bridgeCoverageDenominator = Math.abs(OI_from_sales) > 1 ? Math.abs(OI_from_sales) : Math.abs(Sales);
  const coverageNumerator = Math.abs(COGS) + Math.abs(employeeCost) + Math.abs(depreciation) + Math.abs(sgaTotal) + Math.abs(sectorSpecificOperatingExpense) + Math.abs(otherOperatingExpense) + Math.abs(otherOperatingIncome);
  const bridgeCoverageRatio = bridgeCoverageDenominator > 0
    ? Math.min(1, coverageNumerator / Math.max(Math.abs(Sales), 1))
    : null;
  pushTrace(trace, "IS.Bridge.CoreOIFromBridge", {
    statement: "Derived",
    key: "Sales-COGS-Employee-Depreciation-SGA-OtherOpex+OtherOperatingIncome",
    value: bridgeCoreOI,
    matchType: "derived",
  });

  return {
    is_: {
      Sales, TaxExpense, taxRate, PAT, OCI, TCI, TCI_NCI,
      CNI, FinanceCost, FinanceIncome, FinanceIncomeRung,
      PreferredDividend, NFE, OI, OtherItems, OI_from_sales, MII,
      COGS,
      operatingCostBridge: {
        materialCost: COGS,
        employeeCost,
        depreciation,
        sgaAdvertising,
        sgaLegalProfessional,
        sgaRent,
        sgaFreight,
        sgaRepairs,
        sgaPowerFuel,
        sgaDetailed,
        sgaResidual,
        sgaTotal,
        telecomNetworkOpex,
        licenseFeeOperationCharges,
        sectorSpecificOperatingExpense,
        otherOperatingExpense,
        otherOperatingIncome,
        grossProfit,
        operatingCosts,
        bridgeCoreOI,
        bridgeGapToReportedCoreOI: bridgeCoreOI - (CoreOI - OtherItems),
        coverageRatio: bridgeCoverageRatio,
        driverRatios: {
          materialCostPct: Sales !== 0 ? COGS / Sales : null,
          employeeCostPct: Sales !== 0 ? employeeCost / Sales : null,
          depreciationPct: Sales !== 0 ? depreciation / Sales : null,
          sgaPct: Sales !== 0 ? sgaTotal / Sales : null,
          otherOperatingExpensePct: Sales !== 0 ? otherOperatingExpense / Sales : null,
          otherOperatingIncomePct: Sales !== 0 ? otherOperatingIncome / Sales : null,
          bridgeCoreSalesPm: Sales !== 0 ? bridgeCoreOI / Sales : null,
        },
      },
    },
    cu: {
      UOI,
      CoreOI,
      UFE,
      CoreNFE,
      ExceptionalItemsAfterTax,
      OCITotal,
      ExceptionalOperatingItemsAfterTax: exceptionalOperatingAfterTax,
      DiscontinuedOperationsAfterTax: discontinuedAfterTax,
    },
  };
}

export function recastCashFlow(data: RawPeriodData, is_: CanonicalIncome, bs: CanonicalBalanceSheet, prev?: CanonicalBalanceSheet | undefined, trace?: TraceMap): CashFlowData {
  const cf = (line: string, keys: readonly string[]) => valCF(data, keys, line, trace);
  const sumCf = (line: string, keys: readonly string[]) => sumWithDistinctSource(data, keys, "CashFlow", line, trace);

  const CFO = cf("CF.CFO", M.cashFlow.cfo);
  const Capex = Math.abs(sumCf("CF.Capex", M.cashFlow.capex));
  const DividendPaid = Math.abs(cf("CF.DividendPaid", M.cashFlow.dividendPaid));
  const EquityIssued = cf("CF.EquityIssued", M.cashFlow.equityIssued);
  const ShareBuybacks = Math.abs(sumCf("CF.ShareBuybacks", M.cashFlow.shareBuybacks));
  const InterestReceived = Math.abs(cf("CF.InterestReceived", M.cashFlow.interestReceived));
  const DividendReceived = Math.abs(cf("CF.DividendReceived", M.cashFlow.dividendReceived));

  const dNOA = prev ? (bs.NOA - prev.NOA) : 0;
  const dNFO = prev ? (bs.NFO - prev.NFO) : 0;
  const FCF_accounting = prev ? (is_.OI - dNOA) : 0;
  const FCF_cash = CFO - Capex;
  // Net distribution to owners: dividends and buybacks are BOTH cash returned to
  // owners (same positive sign), equity issuance is cash received. Storage above
  // makes all three positive magnitudes (DividendPaid/ShareBuybacks via Math.abs,
  // EquityIssued is raw positive proceeds), so d_t = Div + Buyback - Issued.
  // (Previously subtracted ShareBuybacks — wrong sign; latent only because the
  // Capitaline CF template carries no buyback row, so the term was always 0.)
  // d_t_formula below is Penman's net-distribution identity (FCF - NFE + dNFO),
  // which already expects this positive-out convention — do NOT change it.
  const d_t = DividendPaid + ShareBuybacks - EquityIssued;
  const d_t_formula = prev ? (FCF_accounting - is_.NFE + dNFO) : 0;
  const d_t_discrepancy = prev ? d_t - d_t_formula : 0;

  const da = valPL(data, M.profitLoss.depreciationAmortization, "CF.EBITDA.DepreciationPL", trace)
    || cf("CF.EBITDA.DepreciationCF", M.cashFlow.depreciation);

  return {
    CFO,
    Capex,
    DividendPaid,
    EquityIssued,
    ShareBuybacks,
    InterestReceived,
    DividendReceived,
    DebtProceeds: sumCf("CF.DebtProceeds", M.cashFlow.debtProceeds),
    DebtRepayment: sumCf("CF.DebtRepayment", M.cashFlow.debtRepayments),
    BridgeDebtProceeds: sumCf("CF.BridgeDebtProceeds", M.cashFlow.bridgeDebtProceeds),
    BridgeDebtRepayment: sumCf("CF.BridgeDebtRepayment", M.cashFlow.bridgeDebtRepayments),
    SaleFixedAssets: cf("CF.SaleFixedAssets", M.cashFlow.saleFixedAssets),
    PurchaseInvestments: cf("CF.PurchaseInvestments", M.cashFlow.purchaseInvestments),
    SaleInvestments: cf("CF.SaleInvestments", M.cashFlow.saleInvestments),
    FCF_accounting,
    FCF_cash,
    d_t,
    d_t_formula,
    d_t_discrepancy,
    // EBITDA: OI is NOPAT (after-tax), so EBIT = OI/(1-t), then EBITDA = EBIT + D&A.
    // Adding NFE here was wrong — OI is already the full after-tax operating income.
    // Clamp effective tax rate to avoid grossup blow-up at extreme values.
    EBITDA: is_.taxRate < 0.50
      ? (is_.OI / (1 - is_.taxRate) + da)
      : (is_.OI / (1 - Math.min(is_.taxRate, 0.45)) + da),
  };
}

export function buildMissingRequiredLineFlags(trace: TraceMap, periodEnd: string): SpecFlag[] {
  const CRITICAL_LINES = [
    "BS.TA",
    "BS.TotalStockholdersEquity",
    "IS.Sales",
    "IS.PAT",
    "IS.PBT",
  ];
  const WARNING_LINES = [
    "IS.FinanceCost.Top",
    "IS.OtherIncome",
    "IS.TaxExpense",
    "BS.FA.CashBank",
    "BS.FO.LongBorrow",
    "BS.FO.ShortBorrow",
    "BS.TradeReceivables",
    "BS.TradePayables",
    "BS.PPE",
    "BS.CurrentAssets",
    "BS.CurrentLiabilities",
    "CF.OperatingCF",
    "CF.InvestingCF",
    "CF.FinancingCF",
  ];

  const flags: SpecFlag[] = [];

  for (const line of CRITICAL_LINES) {
    if (trace[line]?.some((entry) => entry.note === "unmatched")) {
      flags.push({
        spec_id: `MISSING_REQUIRED_${line.replace(/\W+/g, "_")}`,
        severity: Severity.CRITICAL,
        label: "MAPPING_MISS_CRITICAL",
        message: `Critical line "${line}" returned 0 — no matching key in source data. Downstream calculations may be invalid.`,
        affects_terminal: true,
        period: periodEnd,
      });
    }
  }

  for (const line of WARNING_LINES) {
    if (trace[line]?.some((entry) => entry.note === "unmatched")) {
      flags.push({
        spec_id: `MAPPING_MISS_${line.replace(/\W+/g, "_")}`,
        severity: Severity.WARNING,
        label: "MAPPING_MISS",
        message: `Line "${line}" returned 0 — no matching key in source data.`,
        affects_terminal: false,
        period: periodEnd,
      });
    }
  }

  return flags;
}

/**
 * Capture raw reads needed by the reconciliation-residuals stage. These reads
 * intentionally use the SAME pick helpers as the recast layer so they can act
 * as an independent comparison: if the recast layer lookup chain produces a
 * different value than a direct read of the canonical raw line, the residual
 * stage flags it. The reads are cheap (one per line) and never throw — they
 * return null when the line is absent or non-finite, and the residual stage
 * skips the check when null.
 */
export function extractRecastDebug(data: RawPeriodData, bs: CanonicalBalanceSheet): RecastDebug {
  const readRaw = (key: string): number | null => {
    const value = data.raw_metric_values[`${key}__BalanceSheet`] ?? data.raw_metric_values[key];
    return value != null && Number.isFinite(value) ? value : null;
  };
  const rawTotalAssets = readRaw("Total Assets");
  const rawTotalLiabilitiesAndEquity = readRaw("Total Equity and Liabilities");
  const rawTotalEquity = readRaw("Total Equity");
  // Independently-reported asset subtotals (read straight from source, NOT
  // derived from Total Assets). Their sum vs reported Total Assets is the
  // non-tautological asset-composition check. The non-current line has two
  // Capitaline label variants; prefer the canonical one, fall back to the alt.
  const rawCurrentAssets = readRaw("Total Current Assets");
  const rawNonCurrentAssets =
    readRaw("Total Non-Current and Other Assets") ?? readRaw("Total Reported Non-current Assets");
  // The OL coverage check needs the explicit-OL sum too. Mirror the
  // calculation in recastBalanceSheet: read each component once, sum.
  const olCompKeys: readonly string[] = [
    "Trade Payables",
    "Other Current Liabilities",
    "Provisions - Current",
    "Provisions - Long-term",
    "Current Tax Liabilities",
    "Non-Current Tax Liabilities",
    "Deferred Tax Liabilities (Net)",
    "Other Non-Current Liabilities",
  ];
  let explicitOL = 0;
  for (const key of olCompKeys) {
    const value = readRaw(key);
    if (value != null) explicitOL += value;
  }
  // bs is unused for now but accepted so future debug fields can reference
  // recast-side derived numbers if needed without re-plumbing the helper.
  void bs;
  return {
    rawTotalAssets,
    rawTotalLiabilitiesAndEquity,
    rawTotalEquity,
    rawCurrentAssets,
    rawNonCurrentAssets,
    explicitOL,
  };
}
