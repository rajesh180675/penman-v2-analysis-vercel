import {
  RawPeriodData,
  CanonicalBalanceSheet,
  CanonicalIncome,
  CoreUnusual,
  CashFlowData,
  QualityMetrics,
  RecastPeriod,
  RecastDebug,
  EngineConfig,
  TraceMap,
  TraceEntry,
  ShareCountInputSnapshot,
  Severity,
  SpecFlag,

} from "./types";
import { CapitalineMappingSpec as M } from "./mappingSpec";

const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/0ther/g, "other")
    .replace(/shorttem/g, "shortterm")
    .replace(/longtem/g, "longterm")
    .replace(/\btem\b/g, "term")
    .replace(/amotisation/g, "amortisation");
const norm = (s: string) => normalizeText(s).replace(/[^a-z0-9]/g, "").trim();
const stdNormCdf = (x: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

type PickResult = {
  value: number;
  key: string;
  statement: "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Fallback";
  matchType: "exact_composite" | "exact_base" | "fuzzy";
  note?: string | undefined;
};
type PickResultWithSource = PickResult & { sourceId: string };

function pushTrace(trace: TraceMap | undefined, line: string | undefined, entry: TraceEntry) {
  if (!trace || !line) return;
  if (!trace[line]) trace[line] = [];
  if (entry.note === undefined) {
    const { note: _note, ...withoutUndefinedNote } = entry;
    trace[line].push(withoutUndefinedNote);
    return;
  }
  trace[line].push(entry);
}

function pickOneWithSource(data: RawPeriodData, key: string, stmt?: "BalanceSheet" | "ProfitLoss" | "CashFlow"): PickResultWithSource | null {
  const rv = data.raw_metric_values;
  if (stmt) {
    const compositeKey = `${key}__${stmt}`;
    const direct = rv[compositeKey];
    if (direct != null && Number.isFinite(direct)) {
      return { value: direct, key, statement: stmt, matchType: "exact_composite", sourceId: compositeKey };
    }
  }
  const base = rv[key];
  if (base != null && Number.isFinite(base)) {
    return { value: base, key, statement: "Fallback", matchType: "exact_base", sourceId: key };
  }

  const nk = norm(key);
  let best: number | null = null;
  let bestKey = key;
  let bestStmt: "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Fallback" = "Fallback";
  let bestRawKey = key;
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
      bestKey = b;
      bestStmt = st ?? "Fallback";
      bestRawKey = k;
    }
  }
  if (best != null) {
    return { value: best, key: bestKey, statement: bestStmt, matchType: "fuzzy", sourceId: bestRawKey };
  }
  return null;
}

function pickWithSource(data: RawPeriodData, keys: readonly string[], stmt?: "BalanceSheet" | "ProfitLoss" | "CashFlow"): PickResult {
  for (const key of keys) {
    const picked = pickOneWithSource(data, key, stmt);
    if (picked) {
      return picked;
    }
  }
  return { value: 0, key: keys[0] ?? "", statement: stmt ?? "Fallback", matchType: "exact_base", note: "unmatched" };
}

function sumWithDistinctSource(
  data: RawPeriodData,
  keys: readonly string[],
  stmt: "BalanceSheet" | "ProfitLoss" | "CashFlow",
  line?: string | undefined,
  trace?: TraceMap | undefined,
) {
  let total = 0;
  const usedSource = new Set<string>();
  for (const key of keys) {
    const picked = pickOneWithSource(data, key, stmt);
    if (!picked) {
      pushTrace(trace, line, {
        statement: stmt,
        key,
        value: 0,
        matchType: "exact_base",
        note: "unmatched",
      });
      continue;
    }
    if (usedSource.has(picked.sourceId)) {
      pushTrace(trace, line, {
        statement: picked.statement,
        key: picked.key,
        value: 0,
        matchType: picked.matchType,
        note: `duplicate_source_ignored:${picked.sourceId}`,
      });
      continue;
    }
    usedSource.add(picked.sourceId);
    total += picked.value;
    pushTrace(trace, line, {
      statement: picked.statement,
      key: picked.key,
      value: picked.value,
      matchType: picked.matchType,
    });
  }
  if (line) {
    pushTrace(trace, line, { statement: "Derived", key: "SUM", value: total, matchType: "derived" });
  }
  return total;
}

const valBS = (d: RawPeriodData, k: readonly string[], line?: string | undefined, trace?: TraceMap) => {
  const r = pickWithSource(d, k, "BalanceSheet");
  pushTrace(trace, line, { statement: r.statement, key: r.key, value: r.value, matchType: r.matchType, note: r.note });
  return r.value;
};
const valPL = (d: RawPeriodData, k: readonly string[], line?: string | undefined, trace?: TraceMap) => {
  const r = pickWithSource(d, k, "ProfitLoss");
  pushTrace(trace, line, { statement: r.statement, key: r.key, value: r.value, matchType: r.matchType, note: r.note });
  return r.value;
};
const valCF = (d: RawPeriodData, k: readonly string[], line?: string | undefined, trace?: TraceMap) => {
  const r = pickWithSource(d, k, "CashFlow");
  pushTrace(trace, line, { statement: r.statement, key: r.key, value: r.value, matchType: r.matchType, note: r.note });
  return r.value;
};

function sumPLWithTrace(d: RawPeriodData, keys: readonly string[], line: string, trace?: TraceMap) {
  return sumWithDistinctSource(d, keys, "ProfitLoss", line, trace);
}

function normalizeShareCountToCrore(value: number): number {
  return value > 1_000_000 ? value / 10_000_000 : value;
}

function extractShareCountInput(data: RawPeriodData): ShareCountInputSnapshot {
  const firstValid = (keys: readonly string[], stmt: "BalanceSheet" | "ProfitLoss") => {
    for (const key of keys) {
      const picked = pickOneWithSource(data, key, stmt);
      if (picked && picked.value > 0) return picked;
    }
    return null;
  };

  const shareCapitalPick = firstValid(["Share Capital", "Equity Share Capital"], "BalanceSheet");
  const faceValuePick = firstValid([
    "Face Value of Subscribed Shares Fully Paid up",
    "Face Value of Ordinary Shares A - Subscribed Fully Paid up",
    "Face Value of Equity Shares",
  ], "BalanceSheet");
  const shareCapital = shareCapitalPick?.value ?? null;
  const faceValue = faceValuePick?.value ?? null;
  const capitalDerivedShares = shareCapital != null && faceValue != null && faceValue > 0
    ? shareCapital / faceValue
    : null;

  const countCandidates = [
    firstValid(["Number of Equity Shares - Subscribed Fully Paid up"], "BalanceSheet"),
    firstValid(["Number of Equity Shares - Paid Up"], "BalanceSheet"),
    firstValid(["Number of Equity Shares - Issued"], "BalanceSheet"),
    firstValid(["Total Number of Equity Shares - Subscribed"], "BalanceSheet"),
  ].filter((picked): picked is NonNullable<typeof picked> => Boolean(picked));

  const bestCandidate = countCandidates
    .map((picked) => {
      const shares = normalizeShareCountToCrore(picked.value);
      const relErr = capitalDerivedShares && capitalDerivedShares > 0
        ? Math.abs(shares - capitalDerivedShares) / capitalDerivedShares
        : null;
      let score = 0;
      if (/subscribed fully paid up|paid up/i.test(picked.key)) score += 3;
      else if (/issued/i.test(picked.key)) score += 1;
      if (picked.value > 1_000_000) score += 1;
      if (relErr != null) {
        if (relErr <= 0.02) score += 5;
        else if (relErr <= 0.10) score += 3;
        else if (relErr <= 0.25) score += 1;
        else score -= 3;
      }
      const normalizedSource = picked.value > 1_000_000
        ? `${picked.key} (absolute count normalised to crore shares)`
        : `${picked.key} (reported share-count units)`;
      return { shares, source: normalizedSource, score, relErr: relErr ?? Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => (b.score - a.score) || (a.relErr - b.relErr))[0];

  const weightedAverageBasicPick = firstValid(["Weighted Average Number of Shares in Issue - Basic"], "ProfitLoss");
  const weightedAverageDilutedPick = firstValid(["Weighted Average Number of Shares in Issue - Diluted"], "ProfitLoss");

  const endPeriodShares = bestCandidate && bestCandidate.score >= 0
    ? bestCandidate.shares
    : capitalDerivedShares;
  const endPeriodSharesSource = bestCandidate && bestCandidate.score >= 0
    ? bestCandidate.source
    : capitalDerivedShares != null && faceValue != null
    ? `Share Capital ÷ face value ₹${faceValue}`
    : "";

  return {
    endPeriodShares: endPeriodShares ?? null,
    endPeriodSharesSource,
    weightedAverageBasicShares: weightedAverageBasicPick ? normalizeShareCountToCrore(weightedAverageBasicPick.value) : null,
    weightedAverageBasicSource: weightedAverageBasicPick?.key ?? "",
    weightedAverageDilutedShares: weightedAverageDilutedPick ? normalizeShareCountToCrore(weightedAverageDilutedPick.value) : null,
    weightedAverageDilutedSource: weightedAverageDilutedPick?.key ?? "",
    faceValue,
    shareCapital,
  };
}

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
  const OA_OtherIntangibles = bs("BS.OA.OtherIntangibles", ["Other Intangible Assets", "Intangible Assets"]);
  const OA_Inventory = Inventory;
  const OA_TradeReceivables = TradeReceivables;
  const OA_DTA   = bs("BS.OA.DTA", ["Deferred Tax Assets", "Net Deferred Tax Assets"]);
  const OA_CWIP  = bs("BS.OA.CWIP", ["Capital Work in Progress", "Capital Work-in-Progress"]);
  const OA_Other = OA - OA_PPE - OA_ROU - OA_Goodwill - OA_OtherIntangibles
                  - OA_Inventory - OA_TradeReceivables - OA_DTA - OA_CWIP;

  return {
    TA, CSE, MI, FA, FO, OA, OL, NOA, NFO,
    BridgeDebtLongTerm: bridgeDebtLongTerm,
    BridgeDebtShortTerm: bridgeDebtShortTerm,
    BridgeDebtDebentures: bridgeDebtDebentures,
    BridgeDebtCurrentMaturities: bridgeDebtCurrentMaturities,
    BridgeDebtTotal: bridgeDebtTotal,
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
  const sgaResidual = sgaDetailed > 0 && otherExpenses > sgaDetailed ? otherExpenses - sgaDetailed : 0;
  const sgaTotal = sgaDetailed;
  const otherOperatingExpense = sgaDetailed > 0
    ? Math.max(0, otherExpenses - sgaDetailed)
    : Math.max(0, otherExpenses);
  const otherOperatingIncome = Math.max(0, OtherIncome - (FinanceIncomeRung === 4 ? Math.min(OtherIncome, FinanceIncome) : 0));
  const grossProfit = Sales - COGS;
  const operatingCosts = employeeCost + depreciation + sgaTotal + otherOperatingExpense;
  const OCITotal = cfg.oci_treated_as_unusual ? OCI : 0;
  const UOI = ExceptionalItemsAfterTax + OCITotal;
  const CoreOI = OI - UOI;
  const bridgeCoreOI = grossProfit - employeeCost - depreciation - sgaTotal - otherOperatingExpense + otherOperatingIncome;
  const bridgeCoverageDenominator = Math.abs(OI_from_sales) > 1 ? Math.abs(OI_from_sales) : Math.abs(Sales);
  const coverageNumerator = Math.abs(COGS) + Math.abs(employeeCost) + Math.abs(depreciation) + Math.abs(sgaTotal) + Math.abs(otherOperatingExpense) + Math.abs(otherOperatingIncome);
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
  const d_t = DividendPaid - EquityIssued - ShareBuybacks;
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

function buildMissingRequiredLineFlags(trace: TraceMap, periodEnd: string): SpecFlag[] {
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

export function computeRecastPeriod(data: RawPeriodData, cfg: EngineConfig, prevPeriod?: RecastPeriod): RecastPeriod {
  const trace: TraceMap = {};
  const bs = recastBalanceSheet(data, cfg, trace);
  const { is_, cu } = recastIncome(data, bs, cfg, trace);
  const cf = recastCashFlow(data, is_, bs, prevPeriod?.bs, trace);
  const spec_flags = buildMissingRequiredLineFlags(trace, data.period_end);
  const recastDebug = extractRecastDebug(data, bs);
  return {
    period_end: data.period_end,
    bs,
    is: is_,
    cu,
    cf,
    trace,
    shareCountInput: extractShareCountInput(data),
    recastDebug,
    ...(spec_flags.length > 0 ? { spec_flags } : {}),
  };
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
function extractRecastDebug(data: RawPeriodData, bs: CanonicalBalanceSheet): RecastDebug {
  const readRaw = (key: string): number | null => {
    const value = data.raw_metric_values[`${key}__BalanceSheet`] ?? data.raw_metric_values[key];
    return value != null && Number.isFinite(value) ? value : null;
  };
  const rawTotalAssets = readRaw("Total Assets");
  const rawTotalLiabilitiesAndEquity = readRaw("Total Equity and Liabilities");
  const rawTotalEquity = readRaw("Total Equity");
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
    explicitOL,
  };
}

// Post-recast analytical computations (ratios, residual income, AR(1)
// persistence + reversion) moved to ./PenmanNissimEngine/ratiosResidual;
// imported DOWN. Parent re-exports so external import paths are unchanged,
// and computeValuation (below) consumes estimateArPhi + cvReversion as values.
import {
  computeRatios,
  computeResidualIncome,
  estimateArPhi,
  cvReversion,
} from "./PenmanNissimEngine/ratiosResidual";
export { computeRatios, computeResidualIncome, estimateArPhi, cvReversion };

export function deriveKwFromStructure(cur: RecastPeriod, prev: RecastPeriod, ke: number, riskFreeRate: number, cfg?: EngineConfig): number {
  // S-9.4: kw = ke × (CSE+MI)/NOA + kd_aftertax × NFO/NOA
  // kw is ALWAYS derived from balance-sheet weights — NEVER a config input (Invariant 5)
  const NOA_latest = Math.abs(cur.bs.NOA);
  if (NOA_latest <= 0) return ke;

  const weight_CSE_MI = (cur.bs.CSE + cur.bs.MI) / NOA_latest;
  const weight_NFO    = cur.bs.NFO / NOA_latest;

  // kd_aftertax: prefer config (S-9.4 compliance), then infer from finance cost
  let kdAfterTax: number;
  if (cfg && cfg.kd_pretax > 0) {
    kdAfterTax = cfg.kd_pretax * (1 - (cfg.tax_rate_for_kd ?? cfg.statutory_tax_rate ?? 0.2517));
  } else {
    const avgFO = (Math.abs(cur.bs.FO) + Math.abs(prev.bs.FO)) / 2;
    const kdPretax = avgFO > 1
      ? Math.max(0.03, Math.min(0.25, cur.is.FinanceCost / Math.max(avgFO, 1)))
      : Math.max(riskFreeRate * 1.3, 0.04);
    kdAfterTax = kdPretax * (1 - (cur.is.taxRate > 0.01 ? cur.is.taxRate : 0.2517));
  }

  // For net-cash firms (NFO < 0), weight_NFO < 0 => kw > ke. Correct per spec.
  const kwSpec = ke * weight_CSE_MI + kdAfterTax * weight_NFO;

  // Safety: kw must be positive; floor at risk-free rate
  return Math.max(riskFreeRate, kwSpec);
}

export function computeValuation(
  periods: RecastPeriod[], ke: number, kw: number, g: number, cfg: EngineConfig,
  /** §11 terminal RE anchor — if provided, overrides the as-reported lastRE in CV3 computation */
  terminalREAnchor?: number | null | undefined,
  /** §11 terminal ReOI anchor */
  terminalReOIAnchor?: number | null | undefined,
) {
  if (!periods.length) {
    throw new Error("computeValuation requires at least one period.");
  }

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
  // §11: use provided terminal anchor if available, fall back to as-reported lastRE
  const RE_terminal_anchor = terminalREAnchor != null && Number.isFinite(terminalREAnchor) ? terminalREAnchor : lastRE;
  const ReOI_terminal_anchor = terminalReOIAnchor != null && Number.isFinite(terminalReOIAnchor) ? terminalReOIAnchor : lastReOI;
  const CV_RE_3 = rhoE - 1 - g > 0 ? (RE_terminal_anchor * (1 + g)) / (rhoE - 1 - g) : 0;
  const CV_W_1 = 0;
  const CV_W_2 = rhoW > 1 ? lastReOI / (rhoW - 1) : 0;
  const CV_W_3 = rhoW - 1 - g > 0 ? (ReOI_terminal_anchor * (1 + g)) / (rhoW - 1 - g) : 0;

  const CSE0 = periods[0].bs.CSE;
  const NOA0 = periods[0].bs.NOA;
  const NOA_T = periods[periods.length - 1].bs.NOA;
  const NFO_latest = periods[periods.length - 1].bs.NFO;
  const NFO0 = periods[0].bs.NFO;
  const RNOA_T = periods[periods.length - 1].ratios?.RNOA ?? (NOA_T !== 0 ? periods[periods.length - 1].is.OI / NOA_T : 0);

  // Phase J2: equity-side fail-closed gate.
  // Every equity-side intrinsic value is V = CSE0 + pvRE + CV/discE — the
  // anchor is CSE_latest (or CSE0 when working backward). When latest CSE
  // is non-positive (Vodafone Idea since FY19, distressed PSU pre-recap,
  // post-restructuring zombies), V_RE flips deeply negative and the
  // implied per-share value misleads reviewers. We refuse to publish
  // equity-side values in that case but keep enterprise-side V_ReOI
  // (anchored on NOA/NFO, no CSE dependency) so reformulation work,
  // segment SOTP, and EV-based comparables stay usable.
  const latestCSE = periods[periods.length - 1].bs.CSE;
  const equityModelsBlocked = !(Number.isFinite(latestCSE) && latestCSE > 0);
  const equityBlockedReason = equityModelsBlocked
    ? `Latest common shareholders' equity is ${
        Number.isFinite(latestCSE) ? latestCSE.toFixed(0) : "?"
      } Cr (≤ 0). Equity-side residual income, AEG, DDM, and per-share intrinsic values cannot be published — anchor on enterprise-side V_ReOI, FCFF, or loss-maker valuation instead.`
    : null;

  // §1.2: AR(1) phi-based reversion continuing value
  // Estimate phi on the RE and ReOI series separately for more defensible terminal value
  const RE_phi = estimateArPhi(reSeries.map((r) => r.RE));
  const ReOI_phi = estimateArPhi(reSeries.map((r) => r.ReOI));
  const CV_RE_reversion = cvReversion(
    RE_terminal_anchor,
    RE_phi.phi,
    ke,
  );
  const CV_ReOI_reversion = cvReversion(
    ReOI_terminal_anchor,
    ReOI_phi.phi,
    kw,
  );
  // Compute both Gordon and reversion CV side-by-side, flag when they diverge > 20%
  const gordonVsReversionFlag = (gordon: number, reversion: number) => {
    const base = Math.max(Math.abs(gordon), 1);
    return Math.abs(gordon - reversion) / base;
  };
  const RE_CV_divergence = gordonVsReversionFlag(CV_RE_3, CV_RE_reversion);
  const ReOI_CV_divergence = gordonVsReversionFlag(CV_W_3, CV_ReOI_reversion);

  // §1.3: Growth accounting decomposition (Penman's preferred anchor)
  // No-growth value: value from existing assets at current profitability
  // V_no_growth = CSE0 + (RNOA_T - kw) * NOA_T / kw
  // Phase J2: gated on equity-side health since CSE0 is the anchor.
  const V_no_growth = equityModelsBlocked ? null : CSE0 + (RNOA_T - kw) * NOA_T / kw;
  // Use primary valuation (RE CV3) as total value
  const V_total = equityModelsBlocked ? null : CSE0 + pvRE + CV_RE_3 / discE;
  const growthValue =
    equityModelsBlocked || V_total == null || V_no_growth == null
      ? null
      : V_total - V_no_growth;
  const growthFraction =
    equityModelsBlocked || V_total == null || V_total === 0 || growthValue == null
      ? null
      : growthValue / V_total;

  // FCFF / FCFE triangulation
  const fcff_series: Array<{ period: string; NOPAT: number; dNOA: number; FCFF: number; PV_FCFF: number }> = [];
  const fcfe_series: Array<{ period: string; CNI: number; dCSE: number; FCFE: number; PV_FCFE: number }> = [];
  let pvFCFF = 0;
  let pvFCFE = 0;
  for (let i = 1; i < periods.length; i++) {
    const cur = periods[i];
    const prev = periods[i - 1];
    const dNOA = cur.bs.NOA - prev.bs.NOA;
    const dCSE = cur.bs.CSE - prev.bs.CSE;
    const NOPAT = cur.is.OI;
    const FCFF = NOPAT - dNOA;
    const FCFE = cur.is.CNI - dCSE;
    const pvFf = FCFF / Math.pow(rhoW, i);
    const pvFe = FCFE / Math.pow(rhoE, i);
    pvFCFF += pvFf;
    pvFCFE += pvFe;
    fcff_series.push({ period: cur.period_end, NOPAT, dNOA, FCFF, PV_FCFF: pvFf });
    fcfe_series.push({ period: cur.period_end, CNI: cur.is.CNI, dCSE, FCFE, PV_FCFE: pvFe });
  }
  const lastFCFF = fcff_series.length ? fcff_series[fcff_series.length - 1].FCFF : 0;
  const lastFCFE = fcfe_series.length ? fcfe_series[fcfe_series.length - 1].FCFE : 0;
  const CV_FCFF = rhoW - 1 - g > 0 ? (lastFCFF * (1 + g)) / (rhoW - 1 - g) : 0;
  const CV_FCFE = rhoE - 1 - g > 0 ? (lastFCFE * (1 + g)) / (rhoE - 1 - g) : 0;
  const EV_FCFF = pvFCFF + (CV_FCFF / discW);
  const V_FCFE = pvFCFE + (CV_FCFE / discE);

  // AEG valuation (Ohlson-Juettner style short-form proxy)
  const aeg_series: Array<{ period: string; CNI: number; AEG: number; PV_AEG: number }> = [];
  let pvAEG = 0;
  for (let i = 2; i < periods.length; i++) {
    const cur = periods[i];
    const prev = periods[i - 1];
    const aeg = cur.is.CNI - rhoE * prev.is.CNI;
    const pv = aeg / Math.pow(rhoE, i - 1);
    pvAEG += pv;
    aeg_series.push({ period: cur.period_end, CNI: cur.is.CNI, AEG: aeg, PV_AEG: pv });
  }
  const cni1 = periods.length > 1 ? periods[1].is.CNI : periods[0].is.CNI;
  const V_AEG = cni1 / Math.max(rhoE, 1e-6) + pvAEG;

  // Reverse DCF / implied growth for RE CV3
  let impliedGrowthRE: number | undefined;
  // Phase J2: implied-growth bisection compares V(g) = CSE0 + pvRE + cv/discE
  // against marketCap. With CSE0 < 0 the sign relationship inverts and the
  // bisection no longer converges on an economic answer — skip outright.
  if (
    !equityModelsBlocked &&
    cfg.market_price != null &&
    cfg.shares_outstanding &&
    cfg.shares_outstanding > 0
  ) {
    const marketCap = cfg.market_price * cfg.shares_outstanding;
    let lo = 0;
    let hi = Math.max(0.0001, Math.min(ke - 1e-3, 0.15));
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const cvMid = rhoE - 1 - mid > 0 ? (lastRE * (1 + mid)) / (rhoE - 1 - mid) : 0;
      const vMid = CSE0 + pvRE + cvMid / discE;
      if (vMid > marketCap) hi = mid;
      else lo = mid;
    }
    impliedGrowthRE = (lo + hi) / 2;
  }

  const perShare = (() => {
    if (!cfg.shares_outstanding || cfg.shares_outstanding <= 0) return undefined;
    const sh = cfg.shares_outstanding;
    // Phase J2: RE / DDM / AEG / implied-PB / implied-PE / MOS / impliedGrowth
    // all anchor on CSE — null them out when equity-side is blocked.
    // FCFF and FCFE remain meaningful: FCFF is enterprise (NOPAT - dNOA),
    // and FCFE uses dCSE only as the change between periods (the level
    // CSE_T can still be read meaningfully even if it's negative — the
    // distress signal is the user's cue).
    const rePer = equityModelsBlocked
      ? null
      : ((CSE0 + pvRE + CV_RE_3 / discE) / sh);
    const reoiPer = ((NOA0 + pvReOI + CV_W_3 / discW) - NFO0) / sh;
    const fcffPer = (EV_FCFF - NFO0) / sh;
    const fcfePer = equityModelsBlocked ? null : V_FCFE / sh;
    const ddmPer = equityModelsBlocked
      ? null
      : rhoE - 1 - g > 0
        ? ((periods[periods.length - 1].cf.DividendPaid * (1 + g)) / (rhoE - 1 - g)) / sh
        : null;
    const aegPer = equityModelsBlocked ? null : V_AEG / sh;
    const latestCSE_T = periods[periods.length - 1].bs.CSE;
    return {
      intrinsic_re_per_share: rePer,
      intrinsic_reoi_per_share: reoiPer,
      intrinsic_fcff_per_share: fcffPer,
      intrinsic_fcfe_per_share: fcfePer,
      intrinsic_ddm_per_share: ddmPer,
      intrinsic_aeg_per_share: aegPer,
      implied_pb_re: !equityModelsBlocked && rePer != null && latestCSE_T > 0
        ? (rePer * sh) / latestCSE_T
        : null,
      implied_pe_re: !equityModelsBlocked && rePer != null && periods[periods.length - 1].is.CNI !== 0
        ? (rePer * sh) / periods[periods.length - 1].is.CNI
        : null,
      margin_of_safety_re: !equityModelsBlocked && rePer != null && cfg.market_price
        ? (rePer - cfg.market_price) / cfg.market_price
        : null,
      implied_growth_rate: impliedGrowthRE ?? null,
    };
  })();

  // Per-share growth accounting
  const growthAccountingPerShare = (() => {
    if (!cfg.shares_outstanding || cfg.shares_outstanding <= 0) return undefined;
    const sh = cfg.shares_outstanding;
    if (equityModelsBlocked || V_no_growth == null || growthValue == null || growthFraction == null) {
      return {
        vNoGrowthPerShare: null,
        growthValuePerShare: null,
        growthFraction: null,
        noGrowthFraction: null,
      };
    }
    return {
      vNoGrowthPerShare: V_no_growth / sh,
      growthValuePerShare: growthValue / sh,
      growthFraction,
      noGrowthFraction: V_total !== 0 && V_total != null ? 1 - growthFraction : 0,
    };
  })();

  return {
    reSeries,
    pvRE,
    pvReOI,
    CV_RE: CV_RE_3,
    CV_ReOI: CV_W_3,
    EV_ReOI: NOA0 + pvReOI + CV_W_3 / discW,
    // Phase J2: equity-side values nulled when latest CSE ≤ 0.
    V_RE_CV1: equityModelsBlocked ? null : CSE0 + pvRE + CV_RE_1 / discE,
    V_RE_CV2: equityModelsBlocked ? null : CSE0 + pvRE + CV_RE_2 / discE,
    V_RE_CV3: equityModelsBlocked ? null : CSE0 + pvRE + CV_RE_3 / discE,
    V_ReOI_CV01: (NOA0 + pvReOI + CV_W_1 / discW) - NFO0,
    V_ReOI_CV02: (NOA0 + pvReOI + CV_W_2 / discW) - NFO0,
    V_ReOI_CV03: (NOA0 + pvReOI + CV_W_3 / discW) - NFO0,
    CSE0,
    NOA0,
    NFO_latest,
    ke,
    kw,
    g,
    separationScore: periods[periods.length - 1].bs.separationScore,
    lowConfidence: periods[periods.length - 1].bs.separationScore < (cfg.separation_confidence_threshold ?? 70),
    equityModelsBlocked,
    equityBlockedReason,
    impliedGrowthRE,
    // S-11.1: AR(1) reversion continuing values
    CV_RE_reversion,
    CV_ReOI_reversion,
    RE_phi: RE_phi.phi,
    ReOI_phi: ReOI_phi.phi,
    RE_phi_r_squared: RE_phi.r_squared,
    ReOI_phi_r_squared: ReOI_phi.r_squared,
    RE_CV_divergence,
    ReOI_CV_divergence,
    // S-17.2: Growth accounting decomposition
    V_no_growth,
    growthValue,
    growthFraction,
    growthAccountingPerShare,
    fcf: {
      fcff_series,
      fcfe_series,
      EV_FCFF,
      V_FCFE,
      CV_FCFF,
      CV_FCFE,
    },
    aeg: {
      aeg_series,
      V_AEG,
      implied_pe: periods[periods.length - 1].is.CNI !== 0 ? V_AEG / periods[periods.length - 1].is.CNI : null,
      normalised_pe: cni1 !== 0 ? V_AEG / cni1 : null,
    },
    perShare,
  };
}

export function computeQuality(cur: RecastPeriod, prev: RecastPeriod, data: RawPeriodData, prevData: RawPeriodData): QualityMetrics {
  const TL_cur = cur.bs.TA - cur.bs.CSE - cur.bs.MI;
  const TL_prev = prev.bs.TA - prev.bs.CSE - prev.bs.MI;
  const safe = (n: number, d: number, fb = 1) => (d !== 0 && Number.isFinite(n / d) ? n / d : fb);

  const cogs = (d: RawPeriodData) => {
    const direct = valPL(d, M.profitLoss.cogsMaterial) + valPL(d, M.profitLoss.cogsPurchases) - valPL(d, M.profitLoss.cogsInventoryChange);
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

  const cogsCur = cur.is.operatingCostBridge?.materialCost ?? (cur.is.COGS !== 0 ? cur.is.COGS : cogs(data));
  const cogsPrev = prev.is.operatingCostBridge?.materialCost ?? (prev.is.COGS !== 0 ? prev.is.COGS : cogs(prevData));
  const gmCur = cur.is.Sales > 0 ? (cur.is.Sales - cogsCur) / cur.is.Sales : 0;
  const gmPrev = prev.is.Sales > 0 ? (prev.is.Sales - cogsPrev) / prev.is.Sales : 0;

  const roaCur = cur.bs.TA > 0 ? cur.is.PAT / cur.bs.TA : 0;
  const roaPrev = prev.bs.TA > 0 ? prev.is.PAT / prev.bs.TA : 0;
  const p_roa = roaCur > 0 ? 1 : 0;
  const p_delta_roa = roaCur > roaPrev ? 1 : 0;
  const p_cfo = cur.cf.CFO > 0 ? 1 : 0;
  const niCur = cur.is.PAT - cur.cu.ExceptionalItemsAfterTax;
  const roaCurLag = prev.bs.TA > 0 ? niCur / prev.bs.TA : 0;
  const p_accrual = prev.bs.TA > 0 && cur.cf.CFO / prev.bs.TA > roaCurLag ? 1 : 0;
  const ltDebtCur = valBS(data, ["Long Term Borrowings"]);
  const ltDebtPrev = valBS(prevData, ["Long Term Borrowings"]);
  const p_leverage = (cur.bs.TA > 0 ? ltDebtCur / cur.bs.TA : 0) < (prev.bs.TA > 0 ? ltDebtPrev / prev.bs.TA : 0) ? 1 : 0;
  const p_liquidity = (cur.bs.CurrentLiabilities > 0 ? cur.bs.CurrentAssets / cur.bs.CurrentLiabilities : 0) > (prev.bs.CurrentLiabilities > 0 ? prev.bs.CurrentAssets / prev.bs.CurrentLiabilities : 0) ? 1 : 0;
  const p_dilution = cur.cf.EquityIssued <= 0 ? 1 : 0;
  const p_margin = gmCur > gmPrev ? 1 : 0;
  const p_turnover = (cur.bs.TA > 0 ? cur.is.Sales / cur.bs.TA : 0) > (prev.bs.TA > 0 ? prev.is.Sales / prev.bs.TA : 0) ? 1 : 0;
  const piotroski_total = p_roa + p_delta_roa + p_cfo + p_accrual + p_leverage + p_liquidity + p_dilution + p_margin + p_turnover;

  const dsri = safe(safe(cur.bs.TradeReceivables, cur.is.Sales), safe(prev.bs.TradeReceivables, prev.is.Sales));
  const gmi = safe(gmPrev, gmCur);
  const hardAssetsCur = cur.bs.PPE + cur.bs.Goodwill + cur.bs.CurrentAssets;
  const hardAssetsPrev = prev.bs.PPE + prev.bs.Goodwill + prev.bs.CurrentAssets;
  const aqiNum = cur.bs.TA > 0 ? 1 - hardAssetsCur / cur.bs.TA : 0;
  const aqiDen = prev.bs.TA > 0 ? 1 - hardAssetsPrev / prev.bs.TA : 0;
  const aqi = aqiDen !== 0 ? aqiNum / aqiDen : 0;
  const sgi = safe(cur.is.Sales, prev.is.Sales);
  const depi = safe(
    prev.bs.PPE > 0 ? valPL(prevData, M.profitLoss.depreciationAmortization) / prev.bs.PPE : 0,
    cur.bs.PPE > 0 ? valPL(data, M.profitLoss.depreciationAmortization) / cur.bs.PPE : 0
  );
  // SGAI: SGA intensity ratio. Default to 1.0 (neutral) when SGA not measurable to avoid biasing M-Score.
  const sgaCur = cur.is.operatingCostBridge?.sgaTotal ?? sga(data);
  const sgaPrev = prev.is.operatingCostBridge?.sgaTotal ?? sga(prevData);
  const sgaRatioCur = sgaCur > 0 && cur.is.Sales > 0 ? sgaCur / cur.is.Sales : null;
  const sgaRatioPrev = sgaPrev > 0 && prev.is.Sales > 0 ? sgaPrev / prev.is.Sales : null;
  const sgai = sgaRatioCur != null && sgaRatioPrev != null && sgaRatioPrev > 0
    ? sgaRatioCur / sgaRatioPrev
    : 1.0; // neutral when data unavailable
  const lvgi = safe(TL_cur / Math.max(cur.bs.TA, 1), TL_prev / Math.max(prev.bs.TA, 1));
  const tata = prev.bs.TA > 0 ? ((cur.is.PAT - cur.cu.ExceptionalItemsAfterTax) - cur.cf.CFO) / prev.bs.TA : 0;
  // Beneish M-Score (1999) — eight-variable model for earnings manipulation detection.
  // Coefficients from: Beneish, M.D. (1999). "The Detection of Earnings Manipulation."
  // Financial Analysts Journal, 55(5), 24–36. Table 4, Model 1 (probit).
  const beneish_mscore = -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi;

  const wc = cur.bs.CurrentAssets - cur.bs.CurrentLiabilities;
  const re1 = valBS(data, ["Unappropriated Profits Carried Forward"]);
  const re2 = valBS(data, ["Unappropriated Profits Brought Forward"]);
  const re3 = valBS(data, ["Other Equity"]);
  const reProxy = re1 || re2 || re3;
  const reProxyLowConfidence = reProxy !== 0 && re1 === 0 && re2 === 0;
  const pbt = valPL(data, M.profitLoss.pbt);
  const exceptionalPretax = valPL(data, M.profitLoss.exceptionalItems) + valPL(data, M.profitLoss.extraordinaryItems);
  const ebit = pbt > 0
    ? pbt + cur.is.FinanceCost - exceptionalPretax
    : (cur.is.taxRate < 0.99 ? cur.is.OI / (1 - cur.is.taxRate) : cur.is.OI);
  const bve = cur.bs.CSE + cur.bs.MI;
  const z_wc_ta = cur.bs.TA > 0 ? wc / cur.bs.TA : 0;
  const z_re_ta = cur.bs.TA > 0 ? reProxy / cur.bs.TA : 0;
  const z_ebit_ta = cur.bs.TA > 0 ? ebit / cur.bs.TA : 0;
  const z_bve_tl = TL_cur > 0 ? bve / TL_cur : 0;
  const z_s_ta = cur.bs.TA > 0 ? cur.is.Sales / cur.bs.TA : 0;
  // Altman Z'-Score (1993) — revised model for private/non-manufacturing firms.
  // Coefficients from: Altman, E.I. (1993). Corporate Financial Distress and
  // Bankruptcy. 2nd ed., Wiley. Chapter 8 (Z'-Score replaces market cap/TL
  // with BVE/TL for non-public applicability).
  const altman_zprime = 0.717 * z_wc_ta + 0.847 * z_re_ta + 3.107 * z_ebit_ta + 0.420 * z_bve_tl + 0.998 * z_s_ta;

  // Zmijewski (1984)
  const zm_roa = cur.bs.TA > 0 ? cur.is.PAT / cur.bs.TA : 0;
  const zm_lev = cur.bs.TA > 0 ? TL_cur / cur.bs.TA : 0;
  const zm_liq = cur.bs.CurrentLiabilities > 0 ? cur.bs.CurrentAssets / cur.bs.CurrentLiabilities : 0;
  // Zmijewski (1984) — probit bankruptcy prediction model.
  // Coefficients from: Zmijewski, M.E. (1984). "Methodological Issues Related
  // to the Estimation of Financial Distress Prediction Models."
  // Journal of Accounting Research, 22(Supplement), 59–82. Table 2.
  const zm_x = -4.336 - 4.513 * zm_roa + 5.679 * zm_lev + 0.004 * zm_liq;
  const zm_prob = stdNormCdf(zm_x);

  // Ohlson (1980) adapted for India scale
  const wcTa = cur.bs.TA > 0 ? wc / cur.bs.TA : 0;
  const niTa = cur.bs.TA > 0 ? niCur / cur.bs.TA : 0;
  const clCa = cur.bs.CurrentAssets > 0 ? cur.bs.CurrentLiabilities / cur.bs.CurrentAssets : 0;
  const cfoTl = TL_cur > 0 ? cur.cf.CFO / TL_cur : 0;
  const intwo = niCur < 0 && (prev.is.PAT - prev.cu.ExceptionalItemsAfterTax) < 0 ? 1 : 0;
  const oeneg = TL_cur > cur.bs.TA ? 1 : 0;
  const chinDen = Math.abs(niCur) + Math.abs(prev.is.PAT - prev.cu.ExceptionalItemsAfterTax);
  const chin = chinDen > 0 ? (niCur - (prev.is.PAT - prev.cu.ExceptionalItemsAfterTax)) / chinDen : 0;
  const size = Math.log(Math.max(cur.bs.TA, 1));
  // Ohlson O-Score (1980) — logit bankruptcy prediction model, adapted for India.
  // Coefficients from: Ohlson, J.A. (1980). "Financial Ratios and the
  // Probabilistic Prediction of Bankruptcy." Journal of Accounting Research,
  // 18(1), 109–131. Table 4, Model 1.
  const oScore =
    -1.32
    - 0.407 * size
    + 6.03 * (cur.bs.TA > 0 ? TL_cur / cur.bs.TA : 0)
    - 1.43 * wcTa
    + 0.0757 * clCa
    - 2.37 * niTa
    - 1.83 * cfoTl
    + 0.285 * intwo
    - 1.72 * oeneg
    - 0.521 * chin;
  const oProb = 1 / (1 + Math.exp(-oScore));

  // Sloan / Richardson decomposition (approximate with available fields)
  const cashCur = valBS(data, ["Cash and Cash Equivalents", "Bank Balances Other Than Cash and Cash Equivalents"]);
  const cashPrev = valBS(prevData, ["Cash and Cash Equivalents", "Bank Balances Other Than Cash and Cash Equivalents"]);
  const dCA = cur.bs.CurrentAssets - prev.bs.CurrentAssets;
  const dCash = cashCur - cashPrev;
  const dCL = cur.bs.CurrentLiabilities - prev.bs.CurrentLiabilities;
  const stDebtCur = valBS(data, ["Short Term Borrowings"]);
  const stDebtPrev = valBS(prevData, ["Short Term Borrowings"]);
  const dSTDebt = stDebtCur - stDebtPrev;
  const taxPayCur = valBS(data, ["Current Tax Liabilities - Short-term"]);
  const taxPayPrev = valBS(prevData, ["Current Tax Liabilities - Short-term"]);
  const dTaxPay = taxPayCur - taxPayPrev;
  const wcAccr = dCA - dCash - dCL + dSTDebt + dTaxPay;
  const totalAccr = cur.bs.NOA - prev.bs.NOA;
  const ltAccr = totalAccr - wcAccr;
  const reliability = 1 - Math.min(1, Math.abs(ltAccr) / Math.max(Math.abs(totalAccr), 1));

  const ceqiVals = [cur.cf.CFO / Math.max(cur.is.PAT, 1e-6), prev.cf.CFO / Math.max(prev.is.PAT, 1e-6)].filter((v) => Number.isFinite(v));
  const ceqi = ceqiVals.length ? ceqiVals.reduce((s, v) => s + v, 0) / ceqiVals.length : null;
  const salesDelta = prev.is.Sales !== 0 ? (cur.is.Sales - prev.is.Sales) / Math.abs(prev.is.Sales) : null;
  const oiDelta = prev.is.OI !== 0 ? (cur.is.OI - prev.is.OI) / Math.abs(prev.is.OI) : null;
  const dol = salesDelta && salesDelta !== 0 && oiDelta != null ? oiDelta / salesDelta : null;

  // Conservative accounting proxy (India adaptation): lower Net/Gross PPE may indicate more conservative depreciation
  const grossPpeCur = valBS(data, ["Gross Property, plant and equipment"]);
  const netPpeCur = cur.bs.PPE;
  const ppeAgeRatio = grossPpeCur > 0 ? netPpeCur / grossPpeCur : null;
  const conservativeScore = ppeAgeRatio == null ? null : Math.max(0, Math.min(100, (1 - ppeAgeRatio) * 100));

  // Revenue-recognition quality flags
  const dsoCur = cur.ratios?.days_receivable ?? null;
  const dsoPrev = prev.ratios?.days_receivable ?? null;
  const dsoDelta = dsoCur != null && dsoPrev != null ? dsoCur - dsoPrev : null;
  const flags: string[] = [];
  if (dsoDelta != null && dsoDelta > 8 && salesDelta != null && salesDelta < 0.1) {
    flags.push("WARN: DSO rising faster than sales growth; potential revenue-quality/credit-risk signal.");
  }
  if ((cur.ratios?.accrual_ratio_bs ?? 0) > 0.1) {
    flags.push("WARN: BS accrual ratio above 10%; cash conversion risk elevated.");
  }
  if (ceqi != null && ceqi < 0.7) {
    flags.push("WARN: CEQI below 0.7; earnings less cash-confirmable.");
  }

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
    altman_re_proxy_low_confidence: reProxyLowConfidence,
    zmijewski_roa: zm_roa,
    zmijewski_leverage: zm_lev,
    zmijewski_liquidity: zm_liq,
    zmijewski_xscore: zm_x,
    zmijewski_prob_distress: zm_prob,
    ohlson_size: size,
    ohlson_leverage: cur.bs.TA > 0 ? TL_cur / cur.bs.TA : 0,
    ohlson_liquidity: clCa,
    ohlson_roe_neg: intwo === 1,
    ohlson_chin: chin,
    ohlson_oscore: oScore,
    ohlson_prob_distress: oProb,
    sloan_wc_accruals: wcAccr,
    sloan_lt_accruals: ltAccr,
    sloan_total_accruals: totalAccr,
    accrual_reliability_score: reliability,
    operating_leverage: dol,
    cash_earnings_quality_index: ceqi,
    conservative_accounting_score: conservativeScore,
    revenue_quality_flags: flags,
  };
}
