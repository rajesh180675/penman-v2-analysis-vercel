import { EngineConfig, RawPeriodData, RecastPeriod } from "./types";
import { CapitalineMappingSpec as SPEC } from "./mappingSpec";
import { evaluateMappingCoverageSummary, MappingCoverageSummary } from "./mappingPolicy";
import { resolveValuationReadiness } from "./valuationPolicy";
import {
  MappingBacklogEntry,
  MappingBacklogSummary,
  summarizeMappingBacklog,
  triageOutOfSpecLabel,
} from "./mappingBacklogPolicy";
import { CAPITALINE_MAPPING_SPEC_VERSION, MAPPING_POLICY_VERSION } from "./policyVersions";
import { assessAnalysisScope, ScopeAssessment } from "./scopePolicy";
import { clusterUnknownLabels, findCorrelationMatches, UnmappedLabel } from "./mappingClusterEngine";
import { buildMappingPromotionCandidates, MappingPromotionCandidate } from "./mappingPromotion";
import mappingYamlRaw from "../../CapitalineIndASDetailedMappingSpec.yaml?raw";
import { trace } from "../lib/traceLogger";

type Statement = "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Unknown";

export type OutOfSpecLabel = MappingBacklogEntry;

export interface MappingAuditReport {
  mappingSpecVersion: string;
  policyVersion: string;
  usedKeysNotInYaml: string[];
  yamlKeysNotInDataset: string[];
  unresolvedCriticalByStatement: Record<"BalanceSheet" | "ProfitLoss" | "CashFlow", string[]>;
  datasetKeyCounts: Record<Statement, number>;
  coverageSummary: MappingCoverageSummary;
  outOfSpecLabels: OutOfSpecLabel[];
  backlogSummary: MappingBacklogSummary;
  clusterSuggestions: ReturnType<typeof clusterUnknownLabels>;
  correlationSuggestions: ReturnType<typeof findCorrelationMatches>;
  promotionCandidates: MappingPromotionCandidate[];
}
export interface QualityGateReport {
  tier: "Tier 1" | "Tier 2" | "Tier 3";
  valuationBlocked: boolean;
  missingMinimum: string[];
  missingCore: string[];
  blockingReasons: string[];
  policyVersion: string;
  coverageSummary: MappingCoverageSummary;
  valuationCriticalGaps: string[];
  ratioCriticalGaps: string[];
  scopeAssessment: ScopeAssessment;
}

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

function unresolvedCriticalKeysByStatement(coverageSummary: MappingCoverageSummary) {
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

function countDatasetKeysByStatement(periods: RawPeriodData[]) {
  const counts = new Map<string, {
    periodsObserved: number;
    nonZeroPeriods: number;
    latestValue: number | null;
    maxAbsValue: number;
  }>();
  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i];
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

export function auditMappingCoverage(periods: RawPeriodData[]): MappingAuditReport {
  const specKeys = flattenSpecKeys();
  const yamlKeys = extractYamlKeys(mappingYamlRaw);
  const byStmt = datasetKeysByStatement(periods);
  const datasetCounts = countDatasetKeysByStatement(periods);
  const datasetUnion = new Set<string>();
  for (const set of Object.values(byStmt)) {
    for (const k of set) datasetUnion.add(k);
  }
  const coverageSummary = evaluateMappingCoverageSummary(periods);

  const usedKeysNotInYaml = Array.from(specKeys).filter((k) => !yamlKeys.has(k)).sort();
  const yamlKeysNotInDataset = Array.from(yamlKeys).filter((k) => !datasetUnion.has(k)).sort();
  const outOfSpecLabels = Array.from(datasetCounts.entries())
    .map(([scopedKey, stats]) => {
      const [statement, key] = scopedKey.split("||");
      const candidate = {
        statement: statement as Statement,
        key,
        periodsObserved: stats.periodsObserved,
        nonZeroPeriods: stats.nonZeroPeriods,
        latestValue: stats.latestValue,
        maxAbsValue: stats.maxAbsValue,
      };
      return {
        ...candidate,
        triage: triageOutOfSpecLabel(candidate),
      };
    })
    .filter((entry) => !specKeys.has(entry.key) && !yamlKeys.has(entry.key))
    .sort((a, b) => {
      const actionRank = {
        review: 3,
        "add-to-spec": 2,
        "group-to-existing": 1,
        "ignore-non-core": 0,
      } as const;
      return (
        actionRank[b.triage.action] - actionRank[a.triage.action]
        || b.nonZeroPeriods - a.nonZeroPeriods
        || b.periodsObserved - a.periodsObserved
        || b.maxAbsValue - a.maxAbsValue
        || a.statement.localeCompare(b.statement)
        || a.key.localeCompare(b.key)
      );
    });
  const backlogSummary = summarizeMappingBacklog(outOfSpecLabels);

  const clusterInputs: UnmappedLabel[] = outOfSpecLabels
    .filter((entry) => entry.triage.action !== "ignore-non-core")
    .map((entry) => ({
      key: entry.key,
      statement: entry.statement === "Unknown" ? "Unknown" : entry.statement,
      values: [entry.latestValue ?? 0],
    }));
  const clusterSuggestions = clusterUnknownLabels(clusterInputs);
  const correlationSuggestions = [] as ReturnType<typeof findCorrelationMatches>;
  const promotionCandidates = buildMappingPromotionCandidates({
    outOfSpecLabels,
    clusterSuggestions,
  });

  const unresolvedCriticalByStatement = unresolvedCriticalKeysByStatement(coverageSummary);
  return {
    mappingSpecVersion: CAPITALINE_MAPPING_SPEC_VERSION,
    policyVersion: MAPPING_POLICY_VERSION,
    usedKeysNotInYaml,
    yamlKeysNotInDataset,
    unresolvedCriticalByStatement,
    datasetKeyCounts: {
      BalanceSheet: byStmt.BalanceSheet.size,
      ProfitLoss: byStmt.ProfitLoss.size,
      CashFlow: byStmt.CashFlow.size,
      Unknown: byStmt.Unknown.size,
    },
    coverageSummary,
    outOfSpecLabels,
    backlogSummary,
    clusterSuggestions,
    correlationSuggestions,
    promotionCandidates,
  };
}

function hasAny(byStmt: Record<Statement, Set<string>>, stmt: Statement, keys: string[]) {
  const set = byStmt[stmt];
  return keys.some((k) => set.has(k));
}

function hasKey(byStmt: Record<Statement, Set<string>>, stmt: Statement, key: string) {
  return byStmt[stmt].has(key);
}

export function evaluateQualityGate(
  periods: RawPeriodData[],
  config?: Pick<EngineConfig, "financial_institution_mode"> | null,
  recastPeriods?: RecastPeriod[] | null,
): QualityGateReport {
  const scopeAssessment = assessAnalysisScope(periods, config ?? null);
  if (!periods || periods.length === 0) {
    return {
      tier: "Tier 3",
      valuationBlocked: true,
      missingMinimum: ["No periods parsed"],
      missingCore: ["No periods parsed"],
      blockingReasons: ["Dataset is empty."],
      policyVersion: MAPPING_POLICY_VERSION,
      coverageSummary: evaluateMappingCoverageSummary([]),
      valuationCriticalGaps: [],
      ratioCriticalGaps: [],
      scopeAssessment,
    };
  }

  const byStmt = datasetKeysByStatement(periods);
  const audit = auditMappingCoverage(periods);

  const missingMinimum: string[] = [];
  const missingCore: string[] = [];

  // Tier 3 minimum: TA, CSE (or Total Equity), PAT
  if (!hasKey(byStmt, "BalanceSheet", "Total Assets")) {
    missingMinimum.push("Total Assets (BalanceSheet)");
  }
  if (!hasAny(byStmt, "BalanceSheet", ["Total Stockholders' Equity", "Total Equity"])) {
    missingMinimum.push("Total Stockholders' Equity or Total Equity (BalanceSheet)");
  }
  if (!hasKey(byStmt, "ProfitLoss", "Profit After Tax")) {
    missingMinimum.push("Profit After Tax (ProfitLoss)");
  }

  // Tier 2 core additions: Sales, CFO, Capex, Finance Cost
  if (!hasAny(byStmt, "ProfitLoss", ["Revenue From Operations(Net)", "Revenue From Operations", "Total Revenue"])) {
    missingCore.push("Sales (Revenue From Operations(Net)/Revenue From Operations/Total Revenue)");
  }
  if (!hasKey(byStmt, "CashFlow", "Net Cash from Operating Activities")) {
    missingCore.push("Net Cash from Operating Activities (CashFlow)");
  }
  if (!hasAny(byStmt, "CashFlow", ["Purchased of Fixed Assets", "Purchase of Fixed Assets"])) {
    missingCore.push("Purchased of Fixed Assets (CashFlow)");
  }
  if (!hasKey(byStmt, "ProfitLoss", "Finance Cost")) {
    missingCore.push("Finance Cost (ProfitLoss)");
  }

  const unresolvedCriticalCount =
    audit.unresolvedCriticalByStatement.BalanceSheet.length +
    audit.unresolvedCriticalByStatement.ProfitLoss.length +
    audit.unresolvedCriticalByStatement.CashFlow.length;
  const valuationCriticalGaps = audit.coverageSummary.unresolvedBySeverity.critical.map((issue) => issue.title);
  const ratioCriticalGaps = audit.coverageSummary.unresolvedBySeverity.warning.map((issue) => issue.title);

  let tier: QualityGateReport["tier"] = "Tier 3";
  if (missingMinimum.length === 0 && missingCore.length === 0 && valuationCriticalGaps.length === 0 && ratioCriticalGaps.length === 0) {
    tier = "Tier 1";
  } else if (missingMinimum.length === 0 && valuationCriticalGaps.length === 0) {
    tier = "Tier 2";
  } else if (missingMinimum.length === 0) {
    tier = "Tier 3";
  }
  if (scopeAssessment.blocked) {
    tier = "Tier 3";
  }

  // Fail-fast: valuation-critical mapping gaps must block valuation.
  const valuationReadiness = recastPeriods?.length ? resolveValuationReadiness(recastPeriods) : null;
  const valuationBlocked =
    missingMinimum.length > 0 ||
    missingCore.length > 0 ||
    unresolvedCriticalCount > 0 ||
    valuationCriticalGaps.length > 0 ||
    valuationReadiness?.status === "guarded";
  const blockingReasons: string[] = [];
  if (valuationCriticalGaps.length > 0) {
    blockingReasons.push(`Valuation-critical coverage gaps: ${valuationCriticalGaps.join(", ")}`);
  }
  if (unresolvedCriticalCount > 0) {
    blockingReasons.push(
      `Critical key gaps: BS ${audit.unresolvedCriticalByStatement.BalanceSheet.length}, PL ${audit.unresolvedCriticalByStatement.ProfitLoss.length}, CF ${audit.unresolvedCriticalByStatement.CashFlow.length}`
    );
  }
  if (missingMinimum.length > 0) {
    blockingReasons.push(`Minimum set missing (${missingMinimum.length}).`);
  }
  if (missingCore.length > 0) {
    blockingReasons.push(`Core set missing (${missingCore.length}).`);
  }
  if (scopeAssessment.blocked) {
    blockingReasons.push(...scopeAssessment.reasons);
  }
  if (valuationReadiness?.status === "guarded") {
    blockingReasons.push(valuationReadiness.reasons[0] ?? "Latest period is not safe for terminal valuation.");
  }

  trace("mapping", "auditComplete", {
    tier,
    valuationBlocked: valuationBlocked || scopeAssessment.blocked,
    missingMinimumCount: missingMinimum.length,
    missingCoreCount: missingCore.length,
    blockingCount: blockingReasons.length,
    actionableBacklog: audit.backlogSummary?.actionableCount ?? 0,
    reviewBacklog: audit.backlogSummary?.totalsByAction?.review ?? 0,
  });

  return {
    tier,
    valuationBlocked: valuationBlocked || scopeAssessment.blocked,
    missingMinimum,
    missingCore,
    blockingReasons,
    policyVersion: MAPPING_POLICY_VERSION,
    coverageSummary: audit.coverageSummary,
    valuationCriticalGaps,
    ratioCriticalGaps,
    scopeAssessment,
  };
}
