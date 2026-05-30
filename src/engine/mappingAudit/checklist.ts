import { RawPeriodData } from "../types";
import { CapitalineMappingSpec as SPEC } from "../mappingSpec";
import { Statement, datasetKeysByStatement } from "./specKeys";

export interface GranularityChecklistItem {
  id: string;
  title: string;
  status: "pass" | "partial" | "fail";
  coveragePct: number;
  matchedKeys: string[];
  missingKeys: string[];
  note: string;
}

export interface GranularityChecklistReport {
  items: GranularityChecklistItem[];
  summary: {
    pass: number;
    partial: number;
    fail: number;
  };
}

type ChecklistSpec = {
  id: string;
  title: string;
  note: string;
  keys: Array<{ stmt: Statement; key: string }>;
  critical: Array<{ stmt: Statement; key: string }>;
};

function hasStmtKey(byStmt: Record<Statement, Set<string>>, stmt: Statement, key: string) {
  return byStmt[stmt]?.has(key) ?? false;
}

function buildChecklistSpecs(): ChecklistSpec[] {
  return [
    {
      id: "fa",
      title: "1) Financial Assets granularity",
      note: "Cash/bank, investments (incl FVTPL/FVTOCI), deposits/restricted and other financial assets.",
      keys: [
        ...SPEC.balanceSheet.financialAssets.cashAndBank.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.financialAssets.currentInvestments.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.financialAssets.longTermInvestments.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.financialAssets.depositsAndRestricted.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.financialAssets.otherFinancialAssets.map((key) => ({ stmt: "BalanceSheet" as const, key })),
      ],
      critical: [
        { stmt: "BalanceSheet", key: "Cash and Cash Equivalents" },
        { stmt: "BalanceSheet", key: "Current Investments" },
      ],
    },
    {
      id: "fo",
      title: "2) Financial Obligations granularity",
      note: "Borrowings, lease liabilities, other financial liabilities and hybrids.",
      keys: SPEC.balanceSheet.financialObligations.map((key) => ({ stmt: "BalanceSheet" as const, key })),
      critical: [
        { stmt: "BalanceSheet", key: "Long Term Borrowings" },
        { stmt: "BalanceSheet", key: "Short Term Borrowings" },
        { stmt: "BalanceSheet", key: "Others Financial Liabilities - Short-term" },
      ],
    },
    {
      id: "ol",
      title: "3) Operating Liabilities decomposition",
      note: "Explicit OL components used for diagnostics alongside identity-based OL.",
      keys: [
        ...SPEC.balanceSheet.olComponents.tradePayables.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.olComponents.otherCurrentLiabilities.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.olComponents.provisionsCurrent.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.olComponents.provisionsLongTerm.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.olComponents.currentTaxLiabilities.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.olComponents.nonCurrentTaxLiabilities.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.olComponents.otherNonCurrentLiabilities.map((key) => ({ stmt: "BalanceSheet" as const, key })),
      ],
      critical: [
        { stmt: "BalanceSheet", key: "Trade Payables" },
        { stmt: "BalanceSheet", key: "Other Current Liabilities" },
      ],
    },
    {
      id: "cogs_opex",
      title: "4) COGS / OpEx granularity",
      note: "Material, purchases, inventory change + key operating expense buckets.",
      keys: [
        ...SPEC.profitLoss.cogsMaterial.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.cogsPurchases.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.cogsInventoryChange.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.employeeExpense.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.sgaPower.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.sgaRepairs.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.sgaRent.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.sgaAds.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.sgaLegal.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.sgaFreight.map((key) => ({ stmt: "ProfitLoss" as const, key })),
      ],
      critical: [
        { stmt: "ProfitLoss", key: "Cost of Material Consumed" },
        { stmt: "ProfitLoss", key: "Purchases of Stock-in-Trade" },
        { stmt: "ProfitLoss", key: "Changes in Inventories of Finished Goods, Work-in-Progress and Stock-in-Trade" },
      ],
    },
    {
      id: "finance_cost",
      title: "5) Finance Cost breakdown",
      note: "Top-line Finance Cost and granular interest/borrowing items.",
      keys: [
        ...SPEC.profitLoss.financeCostTop.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.financeCostGranular.map((key) => ({ stmt: "ProfitLoss" as const, key })),
      ],
      critical: [{ stmt: "ProfitLoss", key: "Finance Cost" }],
    },
    {
      id: "finance_income",
      title: "6) Finance income ladder support",
      note: "Direct PL finance income + CF proxies + Other Income heuristic source.",
      keys: [
        ...SPEC.profitLoss.financeIncomeDirect.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.cashFlow.interestReceived.map((key) => ({ stmt: "CashFlow" as const, key })),
        ...SPEC.cashFlow.dividendReceived.map((key) => ({ stmt: "CashFlow" as const, key })),
        ...SPEC.cashFlow.interestNet.map((key) => ({ stmt: "CashFlow" as const, key })),
        ...SPEC.profitLoss.otherIncome.map((key) => ({ stmt: "ProfitLoss" as const, key })),
      ],
      critical: [
        { stmt: "ProfitLoss", key: "Other Income" },
        { stmt: "CashFlow", key: "Interest Received" },
      ],
    },
    {
      id: "depr",
      title: "7) Depreciation disambiguation",
      note: "PL depreciation/amortization and CF depreciation both present.",
      keys: [
        ...SPEC.profitLoss.depreciationAmortization.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.cashFlow.depreciation.map((key) => ({ stmt: "CashFlow" as const, key })),
      ],
      critical: [
        { stmt: "ProfitLoss", key: "Depreciation and Amortization" },
        { stmt: "CashFlow", key: "Depreciation" },
      ],
    },
    {
      id: "wc_inventory",
      title: "8) Working capital inventory granularity",
      note: "Top inventory plus detailed components (raw, WIP, FG, stores, packing, transit).",
      keys: [
        ...SPEC.balanceSheet.inventoryTop.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.inventoryComponents.map((key) => ({ stmt: "BalanceSheet" as const, key })),
      ],
      critical: [
        { stmt: "BalanceSheet", key: "Inventories" },
        { stmt: "BalanceSheet", key: "Raw Materials and Components" },
      ],
    },
    {
      id: "quality_inputs",
      title: "9) Quality model inputs (Piotroski/Beneish)",
      note: "Sales, COGS, SGA proxies, TA/CA/PPE/CFO and retained earnings proxy available.",
      keys: [
        ...SPEC.profitLoss.sales.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.cogsMaterial.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.cogsPurchases.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.cogsInventoryChange.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.employeeExpense.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.otherExpenses.map((key) => ({ stmt: "ProfitLoss" as const, key })),
        ...SPEC.profitLoss.retainedEarningsProxy.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.totalAssets.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.currentAssets.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.balanceSheet.ppe.map((key) => ({ stmt: "BalanceSheet" as const, key })),
        ...SPEC.cashFlow.cfo.map((key) => ({ stmt: "CashFlow" as const, key })),
      ],
      critical: [
        { stmt: "ProfitLoss", key: "Revenue From Operations" },
        { stmt: "BalanceSheet", key: "Total Assets" },
        { stmt: "CashFlow", key: "Net Cash from Operating Activities" },
      ],
    },
    {
      id: "cf_granular",
      title: "10) Cash flow movement granularity",
      note: "Sale/purchase of assets/investments and granular debt proceeds/repayments incl typo variants.",
      keys: [
        ...SPEC.cashFlow.saleFixedAssets.map((key) => ({ stmt: "CashFlow" as const, key })),
        ...SPEC.cashFlow.purchaseInvestments.map((key) => ({ stmt: "CashFlow" as const, key })),
        ...SPEC.cashFlow.saleInvestments.map((key) => ({ stmt: "CashFlow" as const, key })),
        ...SPEC.cashFlow.debtProceeds.map((key) => ({ stmt: "CashFlow" as const, key })),
        ...SPEC.cashFlow.debtRepayments.map((key) => ({ stmt: "CashFlow" as const, key })),
        ...SPEC.cashFlow.shareBuybacks.map((key) => ({ stmt: "CashFlow" as const, key })),
      ],
      critical: [
        { stmt: "CashFlow", key: "Sale of Fixed Assets" },
        { stmt: "CashFlow", key: "Purchase of Investments" },
        { stmt: "CashFlow", key: "Sale of Investments" },
      ],
    },
  ];
}

export function evaluateGranularityChecklist(periods: RawPeriodData[]): GranularityChecklistReport {
  const byStmt = datasetKeysByStatement(periods);
  const specs = buildChecklistSpecs();

  const items: GranularityChecklistItem[] = specs.map((spec) => {
    const matched = spec.keys
      .filter(({ stmt, key }) => hasStmtKey(byStmt, stmt, key))
      .map(({ stmt, key }) => `${stmt}:${key}`);
    const missing = spec.keys
      .filter(({ stmt, key }) => !hasStmtKey(byStmt, stmt, key))
      .map(({ stmt, key }) => `${stmt}:${key}`);

    const criticalMatched = spec.critical.filter(({ stmt, key }) => hasStmtKey(byStmt, stmt, key)).length;
    const criticalTotal = spec.critical.length || 1;
    const allCritical = criticalMatched === spec.critical.length;

    const coveragePct = spec.keys.length > 0 ? (matched.length / spec.keys.length) * 100 : 0;
    let status: GranularityChecklistItem["status"] = "fail";
    if (allCritical || (criticalMatched / criticalTotal >= 0.67 && coveragePct >= 45)) {
      status = "pass";
    } else if (criticalMatched > 0 || coveragePct >= 20) {
      status = "partial";
    }

    return {
      id: spec.id,
      title: spec.title,
      status,
      coveragePct,
      matchedKeys: matched,
      missingKeys: missing,
      note: spec.note,
    };
  });

  return {
    items,
    summary: {
      pass: items.filter((i) => i.status === "pass").length,
      partial: items.filter((i) => i.status === "partial").length,
      fail: items.filter((i) => i.status === "fail").length,
    },
  };
}
