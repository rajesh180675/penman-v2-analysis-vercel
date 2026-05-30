import { RawPeriodData } from "../types";
import { CapitalineMappingSpec as SPEC } from "../mappingSpec";
import { MappingCoverageSummary } from "../mappingPolicy";

export type Statement = "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Unknown";

export function unresolvedCriticalKeysByStatement(coverageSummary: MappingCoverageSummary) {
  return coverageSummary.issues.reduce<Record<"BalanceSheet" | "ProfitLoss" | "CashFlow", string[]>>((acc, issue) => {
    if (issue.tier !== "Tier A" || issue.severity !== "critical" || issue.status !== "unresolved") {
      return acc;
    }
    const statement = issue.statement as "BalanceSheet" | "ProfitLoss" | "CashFlow";
    acc[statement].push(...issue.missingKeys);
    return acc;
  }, {
    BalanceSheet: [],
    ProfitLoss: [],
    CashFlow: [],
  });
}

function addAll(target: Set<string>, keys: readonly string[]) {
  for (const k of keys) target.add(k);
}

export function flattenSpecKeys(): Set<string> {
  const out = new Set<string>();

  addAll(out, SPEC.balanceSheet.totalAssets);
  addAll(out, SPEC.balanceSheet.totalStockholdersEquity);
  addAll(out, SPEC.balanceSheet.totalEquity);
  addAll(out, SPEC.balanceSheet.minorityInterest);
  addAll(out, SPEC.balanceSheet.dtl);
  addAll(out, SPEC.balanceSheet.goodwill);
  addAll(out, SPEC.balanceSheet.currentAssets);
  addAll(out, SPEC.balanceSheet.currentLiabilities);
  addAll(out, SPEC.balanceSheet.inventoryTop);
  addAll(out, SPEC.balanceSheet.inventoryComponents);
  addAll(out, SPEC.balanceSheet.tradeReceivables);
  addAll(out, SPEC.balanceSheet.tradePayables);
  addAll(out, SPEC.balanceSheet.ppe);
  addAll(out, SPEC.balanceSheet.financialObligations);

  addAll(out, SPEC.balanceSheet.financialAssets.cashAndBank);
  addAll(out, SPEC.balanceSheet.financialAssets.currentInvestments);
  addAll(out, SPEC.balanceSheet.financialAssets.longTermInvestments);
  addAll(out, SPEC.balanceSheet.financialAssets.depositsAndRestricted);
  addAll(out, SPEC.balanceSheet.financialAssets.otherFinancialAssets);

  addAll(out, SPEC.balanceSheet.olComponents.tradePayables);
  addAll(out, SPEC.balanceSheet.olComponents.otherCurrentLiabilities);
  addAll(out, SPEC.balanceSheet.olComponents.provisionsCurrent);
  addAll(out, SPEC.balanceSheet.olComponents.provisionsLongTerm);
  addAll(out, SPEC.balanceSheet.olComponents.currentTaxLiabilities);
  addAll(out, SPEC.balanceSheet.olComponents.nonCurrentTaxLiabilities);
  addAll(out, SPEC.balanceSheet.olComponents.deferredTaxLiabilitiesNet);
  addAll(out, SPEC.balanceSheet.olComponents.otherNonCurrentLiabilities);

  addAll(out, SPEC.profitLoss.sales);
  addAll(out, SPEC.profitLoss.taxExpense);
  addAll(out, SPEC.profitLoss.pbt);
  addAll(out, SPEC.profitLoss.pat);
  addAll(out, SPEC.profitLoss.ociNotReclass);
  addAll(out, SPEC.profitLoss.ociReclass);
  addAll(out, SPEC.profitLoss.ociUnspecified);
  addAll(out, SPEC.profitLoss.tciGroup);
  addAll(out, SPEC.profitLoss.tciNci);
  addAll(out, SPEC.profitLoss.preferredDividend);
  addAll(out, SPEC.profitLoss.financeCostTop);
  addAll(out, SPEC.profitLoss.financeIncomeDirect);
  addAll(out, SPEC.profitLoss.otherIncome);
  addAll(out, SPEC.profitLoss.financeCostGranular);
  addAll(out, SPEC.profitLoss.exceptionalItems);
  addAll(out, SPEC.profitLoss.extraordinaryItems);
  addAll(out, SPEC.profitLoss.discontinuedItems);
  addAll(out, SPEC.profitLoss.cogsMaterial);
  addAll(out, SPEC.profitLoss.cogsPurchases);
  addAll(out, SPEC.profitLoss.cogsInventoryChange);
  addAll(out, SPEC.profitLoss.totalExpenses);
  addAll(out, SPEC.profitLoss.employeeExpense);
  addAll(out, SPEC.profitLoss.otherExpenses);
  addAll(out, SPEC.profitLoss.depreciationAmortization);
  addAll(out, SPEC.profitLoss.sgaAds);
  addAll(out, SPEC.profitLoss.sgaLegal);
  addAll(out, SPEC.profitLoss.sgaRent);
  addAll(out, SPEC.profitLoss.sgaFreight);
  addAll(out, SPEC.profitLoss.sgaRepairs);
  addAll(out, SPEC.profitLoss.sgaPower);
  addAll(out, SPEC.profitLoss.retainedEarningsProxy);
  addAll(out, SPEC.profitLoss.otherItemsAliases);

  addAll(out, SPEC.cashFlow.cfo);
  addAll(out, SPEC.cashFlow.capex);
  addAll(out, SPEC.cashFlow.dividendPaid);
  addAll(out, SPEC.cashFlow.equityIssued);
  addAll(out, SPEC.cashFlow.shareBuybacks);
  addAll(out, SPEC.cashFlow.interestReceived);
  addAll(out, SPEC.cashFlow.dividendReceived);
  addAll(out, SPEC.cashFlow.interestNet);
  addAll(out, SPEC.cashFlow.depreciation);
  addAll(out, SPEC.cashFlow.plSaleInvest);
  addAll(out, SPEC.cashFlow.saleFixedAssets);
  addAll(out, SPEC.cashFlow.purchaseInvestments);
  addAll(out, SPEC.cashFlow.saleInvestments);
  addAll(out, SPEC.cashFlow.debtProceeds);
  addAll(out, SPEC.cashFlow.debtRepayments);

  return out;
}

export function extractYamlKeys(yamlText: string): Set<string> {
  const out = new Set<string>();

  const quoted = yamlText.match(/"([^"]+)"/g) ?? [];
  for (const q of quoted) out.add(q.slice(1, -1));

  const lines = yamlText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    const val = line.slice(2).trim();
    if (!val) continue;
    const cleaned = val.replace(/^['"]|['"]$/g, "");
    if (cleaned && !cleaned.includes(":")) out.add(cleaned);
  }

  return out;
}

export function datasetKeysByStatement(periods: RawPeriodData[]) {
  const byStmt: Record<Statement, Set<string>> = {
    BalanceSheet: new Set<string>(),
    ProfitLoss: new Set<string>(),
    CashFlow: new Set<string>(),
    Unknown: new Set<string>(),
  };

  for (const p of periods) {
    for (const k of Object.keys(p.raw_metric_values)) {
      const idx = k.lastIndexOf("__");
      if (idx < 0) continue;
      const base = k.slice(0, idx);
      const stmt = k.slice(idx + 2) as Statement;
      if (byStmt[stmt]) byStmt[stmt].add(base);
      else byStmt.Unknown.add(base);
    }
  }
  return byStmt;
}

export function countDatasetKeysByStatement(periods: RawPeriodData[]) {
  const counts = new Map<string, {
    periodsObserved: number;
    nonZeroPeriods: number;
    latestValue: number | null;
    maxAbsValue: number;
  }>();
  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i]!;
    const isLatest = i === periods.length - 1;
    for (const compositeKey of Object.keys(period.raw_metric_values)) {
      const idx = compositeKey.lastIndexOf("__");
      if (idx < 0) continue;
      const base = compositeKey.slice(0, idx);
      const statement = compositeKey.slice(idx + 2) as Statement;
      const scopedKey = `${statement}||${base}`;
      const value = period.raw_metric_values[compositeKey];
      const existing = counts.get(scopedKey) ?? {
        periodsObserved: 0,
        nonZeroPeriods: 0,
        latestValue: null,
        maxAbsValue: 0,
      };
      existing.periodsObserved += 1;
      if (value != null && Number.isFinite(value) && value !== 0) {
        existing.nonZeroPeriods += 1;
        existing.maxAbsValue = Math.max(existing.maxAbsValue, Math.abs(value));
      }
      if (isLatest) {
        existing.latestValue = value != null && Number.isFinite(value) ? value : null;
      }
      counts.set(scopedKey, existing);
    }
  }
  return counts;
}
