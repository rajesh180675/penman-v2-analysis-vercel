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
  valBSFirstNonZero,
  valPL,
  valCF,
  sumPLWithTrace,
} from "./picking";

export function recastBalanceSheet(data: RawPeriodData, cfg: EngineConfig, trace?: TraceMap): CanonicalBalanceSheet {
  const bs = (line: string, keys: readonly string[]) => valBS(data, keys, line, trace);
  const sumBs = (line: string, keys: readonly string[]) => sumWithDistinctSource(data, keys, "BalanceSheet", line, trace);
  // OL components: each key list holds one line's alternative labels, and the
  // unused one is often exported as 0, so a zero must not end the search.
  const olBs = (line: string, keys: readonly string[]) => valBSFirstNonZero(data, keys, line, trace);
  // The current-liabilities "Trade Payables" row is the total that "Sundry
  // Creditors" and "Other Trade Payables" sit under (HUL FY25: 11,315 ⊇ 263 +
  // 10,898); the same label under non-current liabilities is the long-term
  // part. Without the current row, the itemized lines are summed as before.
  const tradePayablesTotal = (line: string) => {
    const currentTotal = bs(`${line}.CurrentTotal`, ["Trade Payables - Current"]);
    if (currentTotal !== 0) return currentTotal + bs(`${line}.NonCurrent`, ["Trade Payables"]);
    // The netted layout files one figure under three labels (Paytm FY10:
    // Trade Payables = Sundry Creditors = Creditors for Others = 20.82).
    const filedTotal = nettedCurrentLiabilities > 0 ? bs(`${line}.NettedTotal`, ["Trade Payables"]) : 0;
    return filedTotal !== 0 ? filedTotal : sumBs(line, M.balanceSheet.olComponents.tradePayables);
  };

  // The pre-2012 Schedule VI layout deducts current liabilities and provisions
  // from current assets: "Total Assets" is capital employed, with "Net Current
  // Assets" = Total Current Assets − Total Current Liabilities and no "Total
  // Equity and Liabilities". Read as filed, OL came out ≈ 0 while the itemized
  // liabilities were real (Paytm FY10: 0.2 against 56.8). Grossing up by the
  // netted liabilities adds them to OA and OL alike, so NOA is unchanged.
  // Paytm FY09–16 and FY19 are the library's only such years (to 0.01).
  const filedTotalCurrentLiabilities = bs("BS.Netted.TotalCurrentLiabilities", ["Total Current Liabilities"]);
  const filedNetCurrentAssets = bs("BS.Netted.NetCurrentAssets", ["Net Current Assets"]);
  const nettedCurrentLiabilities =
    bs("BS.Netted.TotalEquityAndLiabilities", ["Total Equity and Liabilities"]) === 0
    && filedTotalCurrentLiabilities > 0
    && filedNetCurrentAssets !== 0
    && Math.abs(filedNetCurrentAssets - (bs("BS.Netted.TotalCurrentAssets", ["Total Current Assets"]) - filedTotalCurrentLiabilities)) <= 0.5
      ? filedTotalCurrentLiabilities
      : 0;
  const TA = bs("BS.TA", M.balanceSheet.totalAssets) + nettedCurrentLiabilities;
  // That layout itemizes only trade payables inside its "Current Liabilities"
  // subtotal (customer advances, deposits and the rest have no line of their
  // own), so the other current liabilities are the subtotal less them.
  const otherCurrentLiabilities = (line: string) => {
    const filed = olBs(line, M.balanceSheet.olComponents.otherCurrentLiabilities);
    if (filed !== 0 || nettedCurrentLiabilities === 0) return filed;
    return Math.max(0, bs(`${line}.NettedSubtotal`, ["Current Liabilities"]) - tradePayablesTotal(`${line}.NettedTradePayables`));
  };
  if (nettedCurrentLiabilities > 0) {
    pushTrace(trace, "BS.TA", { statement: "Derived", key: "Total Assets + netted Total Current Liabilities", value: TA, matchType: "derived" });
  }
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
  // Non-current plus current: the parser keeps the current row under
  // "Lease Liabilities - Current" (it shares the label with the non-current one).
  const leaseLiab = bs("BS.FO.LeaseLiabilities", ["Lease Liabilities"])
    + bs("BS.FO.LeaseLiabilitiesCurrent", ["Lease Liabilities - Current"]);
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
  const TradePayables = tradePayablesTotal("BS.TradePayables");
  const PPE = bs("BS.PPE", M.balanceSheet.ppe);

  const explicitOL =
    tradePayablesTotal("BS.OLComp.TradePayables")
    + otherCurrentLiabilities("BS.OLComp.OtherCurrentLiabilities")
    + olBs("BS.OLComp.ProvisionsCurrent", M.balanceSheet.olComponents.provisionsCurrent)
    + olBs("BS.OLComp.ProvisionsLongTerm", M.balanceSheet.olComponents.provisionsLongTerm)
    + olBs("BS.OLComp.CurrentTaxLiabilities", M.balanceSheet.olComponents.currentTaxLiabilities)
    + olBs("BS.OLComp.NonCurrentTaxLiabilities", M.balanceSheet.olComponents.nonCurrentTaxLiabilities)
    + olBs("BS.OLComp.DeferredTaxLiabilitiesNet", M.balanceSheet.olComponents.deferredTaxLiabilitiesNet)
    + sumBs("BS.OLComp.OtherNonCurrentLiabilities", M.balanceSheet.olComponents.otherNonCurrentLiabilities);
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
    OL_TradePayables: tradePayablesTotal("BS.OLComp.TradePayablesOut"),
    OL_OtherCurrentLiabilities: otherCurrentLiabilities("BS.OLComp.OtherCurrentLiabilitiesOut"),
    OL_ProvisionsCurrent: olBs("BS.OLComp.ProvisionsCurrentOut", M.balanceSheet.olComponents.provisionsCurrent),
    OL_ProvisionsLongTerm: olBs("BS.OLComp.ProvisionsLongTermOut", M.balanceSheet.olComponents.provisionsLongTerm),
    OL_CurrentTaxLiabilities: olBs("BS.OLComp.CurrentTaxLiabilitiesOut", M.balanceSheet.olComponents.currentTaxLiabilities),
    OL_NonCurrentTaxLiabilities: olBs("BS.OLComp.NonCurrentTaxLiabilitiesOut", M.balanceSheet.olComponents.nonCurrentTaxLiabilities),
    OL_DeferredTaxLiabilitiesNet: olBs("BS.OLComp.DeferredTaxLiabilitiesNetOut", M.balanceSheet.olComponents.deferredTaxLiabilitiesNet),
    OL_OtherNonCurrentLiabilities: sumBs("BS.OLComp.OtherNonCurrentLiabilitiesOut", M.balanceSheet.olComponents.otherNonCurrentLiabilities),
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
  // Capitaline convention, verified against as-filed XBRL (L&T FY23: owners'
  // TCI ₹9,716 Cr, NCI share ₹1,856 Cr): "Total Comprehensive Income for the
  // Year" is ALREADY the owners' share, and "Non-Controlling Interests" is the
  // minority's share as a SIGNED DEDUCTION from group income — negative when
  // minorities share a profit, positive when they absorb a loss (group TCI =
  // TCI − TCI_NCI). Treating TCI as group and TCI_NCI as a positive share
  // added the minority's income back into CNI (Grasim FY25: ₹8,181 Cr against
  // ₹3,811 Cr owners') and took it out of OI.
  const CNI = (TCI !== 0 ? TCI : (PAT + OCI + TCI_NCI)) - PreferredDividend;
  pushTrace(trace, "IS.CNI", { statement: "Derived", key: "TCI(owners)-PrefDiv or PAT+OCI+TCI_NCI-PrefDiv", value: CNI, matchType: "derived" });

  const financeCostTop = pl("IS.FinanceCost.Top", M.profitLoss.financeCostTop);
  const FinanceCost = financeCostTop || sumPLWithTrace(data, M.profitLoss.financeCostGranular, "IS.FinanceCost.Granular", trace);
  if (!financeCostTop) {
    pushTrace(trace, "IS.FinanceCost", { statement: "Derived", key: "sum(financeCostGranular)", value: FinanceCost, matchType: "derived" });
  }
  const OtherIncome = pl("IS.OtherIncome", M.profitLoss.otherIncome);
  // "P/L on Sales of Invest" is the operating-cash-flow adjustment, so a gain
  // is already negative — the sign of a financial expense. The filed
  // adjustments tie to their filed total with it as signed in all 331 library
  // company-years. Negating it booked gains as expenses and lifted Core OI by
  // twice the after-tax gain. The gain sits in Other Income, so it is kept out
  // of the rung-4 proxy (UFE books it once) and out of the bridge below.
  const exceptionalPretax = pl("IS.ExceptionalPreTax", M.profitLoss.exceptionalItems) + pl("IS.ExtraordinaryPreTax", M.profitLoss.extraordinaryItems);
  const filedInvestmentPl = valCF(data, M.cashFlow.plSaleInvest);
  // Unless the exceptional items already carry it: UOI then removes it, and
  // booking it in UFE too moved it out of Core OI twice. A loss is there when
  // the exceptional losses can contain it (Asian Paints FY25: the 83.71
  // Indonesia divestment inside −363.10; Paytm FY20, TCS FY26 — each bridge
  // gap was the loss to the rupee); a gain only when it IS the exceptional
  // gain (Britannia FY23 375.6, Tata Steel FY12 3,361.9), since gains sit in
  // Other Income in every other library year.
  const investmentPlInExceptional = filedInvestmentPl > 0
    ? exceptionalPretax <= -filedInvestmentPl + 0.5
    : filedInvestmentPl < 0 && Math.abs(exceptionalPretax + filedInvestmentPl) <= 0.5;
  const investmentPl = investmentPlInExceptional ? 0 : filedInvestmentPl;
  const investmentGain = Math.max(0, -investmentPl);
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
    FinanceIncome = Math.max(0, OtherIncome - investmentGain) * faRatio;
    FinanceIncomeRung = 4;
  }

  const UFE = investmentPl * (1 - taxRate);
  const CoreNFE = (FinanceCost - FinanceIncome) * (1 - taxRate) + PreferredDividend;
  const NFE = CoreNFE + UFE;
  // Minority interest in income: the minority's share, positive when it
  // shares a profit (the sign flip of Capitaline's deduction line). OI is then
  // the whole group's, matching NOA, which carries every subsidiary in full.
  const MII = -TCI_NCI;
  const OI = CNI + NFE + MII;
  pushTrace(trace, "IS.OI", { statement: "Derived", key: "(TCI or PAT+OCI)-PrefDiv+NFE", value: OI, matchType: "derived" });

  const OtherItems = pl("IS.OtherItems", M.profitLoss.otherItemsAliases);
  const OI_from_sales = OI - OtherItems;

  const discontinuedRaw = pl("IS.DiscontinuedRaw", M.profitLoss.discontinuedItems);
  const discontinuedTax = pl("IS.DiscontinuedTax", ["Tax Expense of Discontinuing Operations"]);
  // Capitaline signs the discontinued tax line as an adjustment (negative =
  // expense), so it is ADDED: pre-tax + tax equals the filed after-tax
  // "Discontinued Operations" line in all 331 library company-years. The old
  // subtraction overstated the result by twice the tax (L&T FY21 13,343.08 vs
  // 8,237.92 filed; ITC FY25 16,293.29 vs 15,016.01), which Core OI absorbed.
  const discontinuedAfterTax = discontinuedRaw + discontinuedTax;
  const exceptionalOperatingAfterTax = exceptionalPretax * (1 - taxRate);
  const ExceptionalItemsAfterTax = exceptionalOperatingAfterTax + discontinuedAfterTax;
  // Capitaline's "Changes in Inventories…" line is already signed as an
  // expense (negative when inventory builds), so it is ADDED: the filed cost
  // lines tie to the filed Total Expenses within 0.5% in all 229 library
  // company-years with a non-zero change when added, and in 47 when
  // subtracted. Subtracting it misstated COGS by twice the change.
  const COGS = pl("IS.COGS.Material", M.profitLoss.cogsMaterial)
    + pl("IS.COGS.Purchases", M.profitLoss.cogsPurchases)
    + pl("IS.COGS.InventoryChange", M.profitLoss.cogsInventoryChange)
    + pl("IS.COGS.InternalComponents", M.profitLoss.cogsInternalComponents);
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
  // Finance income is inside Other Income on every rung (Capitaline lists
  // Interest Income as a sub-line of it), and OI = CNI + NFE excludes it, so
  // the bridge must too. Netting it only on the proxy rung counted a cash-rich
  // company's interest as operating income — TCS and Infosys missed the
  // reported core OI by a steady ~5%. Gains on sale of investments sit in
  // Other Income as well and are financial (UFE), so they are netted too.
  const otherOperatingIncome = Math.max(0, OtherIncome - Math.min(OtherIncome, FinanceIncome + investmentGain));
  const grossProfit = Sales - COGS;
  const operatingCosts = employeeCost + depreciation + sgaTotal + sectorSpecificOperatingExpense + otherOperatingExpense;
  const OCITotal = cfg.oci_treated_as_unusual ? OCI : 0;
  const UOI = ExceptionalItemsAfterTax + OCITotal;
  const CoreOI = OI - UOI;
  // Core OI carries the associates' share (it is inside PBT), so the bridge
  // must too: Maruti FY24's whole gap was it plus the internal-components line.
  const associatesShare = pl("IS.AssociatesShareBeforeTax", M.profitLoss.associatesShareBeforeTax);
  const extraordinaryAfterTax = pl("IS.ExtraordinaryAfterTax", M.profitLoss.extraordinaryAfterTax);
  const bridgeCoreOI = grossProfit - employeeCost - depreciation - sgaTotal - sectorSpecificOperatingExpense - otherOperatingExpense + otherOperatingIncome + associatesShare;
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
        associatesShare,
        extraordinaryAfterTax,
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
    DebtProceeds: Math.abs(sumCf("CF.DebtProceeds", M.cashFlow.debtProceeds)),
    DebtRepayment: -Math.abs(sumCf("CF.DebtRepayment", M.cashFlow.debtRepayments)),
    BridgeDebtProceeds: Math.abs(sumCf("CF.BridgeDebtProceeds", M.cashFlow.bridgeDebtProceeds)),
    BridgeDebtRepayment: -Math.abs(sumCf("CF.BridgeDebtRepayment", M.cashFlow.bridgeDebtRepayments)),
    SaleFixedAssets: Math.abs(cf("CF.SaleFixedAssets", M.cashFlow.saleFixedAssets)),
    PurchaseInvestments: -Math.abs(cf("CF.PurchaseInvestments", M.cashFlow.purchaseInvestments)),
    SaleInvestments: Math.abs(cf("CF.SaleInvestments", M.cashFlow.saleInvestments)),
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
  // The OL coverage check needs the explicit-OL sum: the recast's own
  // component reads (mapping-spec labels and aliases, same pick helper), so
  // the check compares OL with what the recast actually found. This used to
  // re-read a hard-coded label list, four of whose labels Capitaline does not
  // use ("Provisions - Current" for "Provisions", "Current Tax Liabilities"
  // for "Current Tax Liabilities - Short-term", …) and without the "Sundry
  // Creditors" alias, so it under-counted OL and failed the 0.7 floor for
  // every library company.
  const explicitOL = bs.OL_TradePayables + bs.OL_OtherCurrentLiabilities + bs.OL_ProvisionsCurrent
    + bs.OL_ProvisionsLongTerm + bs.OL_CurrentTaxLiabilities + bs.OL_NonCurrentTaxLiabilities
    + bs.OL_DeferredTaxLiabilitiesNet + bs.OL_OtherNonCurrentLiabilities;
  // Capitaline's "Profit After Tax" stops before discontinued operations,
  // extraordinary items and associates, but the filed TCI includes them, so the
  // owners'-income identity broke by exactly those lines (M&M FY20: discontinued
  // −3,033.82; NTPC FY20: extraordinary +4,872.01). "Profit Attributable to
  // Shareholders" less "Minority Interest After Net Profit" is PAT on TCI's
  // basis: M&M FY20 127.04 − 448.04 = −321.00 = PAT 2,712.82 − 3,033.82.
  // Without the minority line it is only usable when there is no minority.
  const readPl = (key: string): number | null => {
    const value = data.raw_metric_values[`${key}__ProfitLoss`];
    return value != null && Number.isFinite(value) ? value : null;
  };
  const profitAttributable = readPl("Profit Attributable to Shareholders");
  const minorityAfterProfit = readPl("Minority Interest After Net Profit");
  const fullPeriodProfit = profitAttributable != null && (minorityAfterProfit != null || !readPl("Non-Controlling Interests"))
    ? profitAttributable - (minorityAfterProfit ?? 0)
    : null;
  const otherProfitBelowPat = fullPeriodProfit != null
    ? (readPl("Extraordinary Items After Tax") ?? 0) + (readPl("Share of Profits / Loss of Associated Companies") ?? 0)
    : null;
  return {
    rawTotalAssets,
    rawTotalLiabilitiesAndEquity,
    rawTotalEquity,
    rawCurrentAssets,
    rawNonCurrentAssets,
    explicitOL,
    olOutsideSections: readRaw("Other Liabilities Excluding Equity, Non-Current and Current Liabilities") ?? 0,
    fullPeriodProfit,
    otherProfitBelowPat,
  };
}
