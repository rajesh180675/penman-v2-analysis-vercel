import { CapitalineMappingSpec as SPEC } from "./mappingSpec";
import { RawPeriodData } from "./types";
import { MAPPING_POLICY_VERSION } from "./policyVersions";

export type MappingStatement = "BalanceSheet" | "ProfitLoss" | "CashFlow";
export type MappingTier = "Tier A" | "Tier B" | "Tier C" | "Tier D";
export type MappingSeverity = "critical" | "warning" | "info";

export interface MappingCoverageGroup {
  id: string;
  title: string;
  statement: MappingStatement;
  tier: MappingTier;
  severity: MappingSeverity;
  rationale: string;
  keys: readonly string[];
}

export interface MappingCoverageIssue {
  id: string;
  title: string;
  statement: MappingStatement;
  tier: MappingTier;
  severity: MappingSeverity;
  rationale: string;
  matchedKeys: string[];
  missingKeys: string[];
  status: "resolved" | "unresolved";
}

export interface MappingCoverageSummary {
  policyVersion: string;
  issues: MappingCoverageIssue[];
  unresolvedBySeverity: Record<MappingSeverity, MappingCoverageIssue[]>;
  unresolvedByTier: Record<MappingTier, MappingCoverageIssue[]>;
  totalsByTier: Record<MappingTier, { total: number; resolved: number; unresolved: number }>;
}

export interface MappingIssueClassification {
  policyVersion: string;
  groupId: string | null;
  groupTitle: string;
  tier: MappingTier;
  severity: MappingSeverity;
  rationale: string;
}

function uniq(values: string[]) {
  return Array.from(new Set(values));
}

const GROUPS: MappingCoverageGroup[] = [
  {
    id: "bs-total-assets",
    title: "Balance sheet total assets",
    statement: "BalanceSheet",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required for reformulation identities, NOA, and valuation base.",
    keys: SPEC.balanceSheet.totalAssets,
  },
  {
    id: "bs-common-equity",
    title: "Common equity anchor",
    statement: "BalanceSheet",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required for clean surplus checks and residual earnings valuation.",
    keys: uniq([...SPEC.balanceSheet.totalStockholdersEquity, ...SPEC.balanceSheet.totalEquity]),
  },
  {
    id: "bs-cash-bank",
    title: "Cash and bank balances",
    statement: "BalanceSheet",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required to separate financial assets from operating assets.",
    keys: SPEC.balanceSheet.financialAssets.cashAndBank,
  },
  {
    id: "bs-current-investments",
    title: "Current investments",
    statement: "BalanceSheet",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required to separate surplus liquidity from operations.",
    keys: SPEC.balanceSheet.financialAssets.currentInvestments,
  },
  {
    id: "bs-core-borrowings",
    title: "Core borrowings and financial liabilities",
    statement: "BalanceSheet",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required to measure NFO, leverage, and financing structure.",
    keys: uniq([
      "Long Term Borrowings",
      "Short Term Borrowings",
      "Others Financial Liabilities - Short-term",
      ...SPEC.balanceSheet.financialObligations,
    ]),
  },
  {
    id: "is-sales",
    title: "Revenue from operations",
    statement: "ProfitLoss",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required for operating margin, turnover, and forecast base.",
    keys: SPEC.profitLoss.sales,
  },
  {
    id: "is-pbt",
    title: "Profit before tax",
    statement: "ProfitLoss",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required to anchor tax and unusual item reformulation.",
    keys: SPEC.profitLoss.pbt,
  },
  {
    id: "is-tax-expense",
    title: "Tax expense",
    statement: "ProfitLoss",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required to normalize after-tax operating and financing flows.",
    keys: SPEC.profitLoss.taxExpense,
  },
  {
    id: "is-pat",
    title: "Profit after tax",
    statement: "ProfitLoss",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required for CNI and residual earnings construction.",
    keys: SPEC.profitLoss.pat,
  },
  {
    id: "is-finance-cost",
    title: "Finance cost",
    statement: "ProfitLoss",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required to compute NFE and distinguish operating from financing profitability.",
    keys: uniq([...SPEC.profitLoss.financeCostTop, ...SPEC.profitLoss.financeCostGranular]),
  },
  {
    id: "cf-cfo",
    title: "Operating cash flow",
    statement: "CashFlow",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required for cash conversion, FCF, and quality diagnostics.",
    keys: SPEC.cashFlow.cfo,
  },
  {
    id: "cf-capex",
    title: "Capital expenditure",
    statement: "CashFlow",
    tier: "Tier A",
    severity: "critical",
    rationale: "Required for FCF and NOA reinvestment diagnostics.",
    keys: SPEC.cashFlow.capex,
  },
  {
    id: "bs-current-liabilities",
    title: "Total current liabilities",
    statement: "BalanceSheet",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for liquidity and operating liability diagnostics.",
    keys: SPEC.balanceSheet.currentLiabilities,
  },
  {
    id: "bs-trade-receivables",
    title: "Trade receivables",
    statement: "BalanceSheet",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for working-capital and turnover ratios.",
    keys: SPEC.balanceSheet.tradeReceivables,
  },
  {
    id: "bs-inventory-top",
    title: "Top-level inventory",
    statement: "BalanceSheet",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for working-capital and operating cycle analysis.",
    keys: SPEC.balanceSheet.inventoryTop,
  },
  {
    id: "bs-trade-payables",
    title: "Trade payables",
    statement: "BalanceSheet",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for operating liability decomposition and DPO.",
    keys: SPEC.balanceSheet.tradePayables,
  },
  {
    id: "bs-ppe",
    title: "Property plant and equipment",
    statement: "BalanceSheet",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for asset intensity, turnover, and anomaly detection.",
    keys: SPEC.balanceSheet.ppe,
  },
  {
    id: "is-oci-and-tci",
    title: "OCI and total comprehensive income",
    statement: "ProfitLoss",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for clean-surplus integrity and unusual item treatment.",
    keys: uniq([
      ...SPEC.profitLoss.ociNotReclass,
      ...SPEC.profitLoss.ociReclass,
      ...SPEC.profitLoss.ociUnspecified,
      ...SPEC.profitLoss.tciGroup,
      ...SPEC.profitLoss.tciNci,
    ]),
  },
  {
    id: "is-finance-income-support",
    title: "Finance income support ladder",
    statement: "ProfitLoss",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for clean NFE/NBC estimation when direct finance income is sparse.",
    keys: uniq([...SPEC.profitLoss.financeIncomeDirect, ...SPEC.profitLoss.otherIncome]),
  },
  {
    id: "cf-distributions-and-equity",
    title: "Dividends and equity issuance",
    statement: "CashFlow",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for payout analysis and equity flow interpretation.",
    keys: uniq([...SPEC.cashFlow.dividendPaid, ...SPEC.cashFlow.equityIssued, ...SPEC.cashFlow.shareBuybacks]),
  },
  {
    id: "cf-debt-movements",
    title: "Debt proceeds and repayments",
    statement: "CashFlow",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for funding diagnostics and financing reconstruction.",
    keys: uniq([...SPEC.cashFlow.debtProceeds, ...SPEC.cashFlow.debtRepayments]),
  },
  {
    id: "cf-investment-movements",
    title: "Investment purchase and sale flows",
    statement: "CashFlow",
    tier: "Tier B",
    severity: "warning",
    rationale: "Important for classifying financial asset movements and treasury activity.",
    keys: uniq([...SPEC.cashFlow.purchaseInvestments, ...SPEC.cashFlow.saleInvestments, ...SPEC.cashFlow.saleFixedAssets]),
  },
  {
    id: "is-depreciation",
    title: "Depreciation support",
    statement: "ProfitLoss",
    tier: "Tier C",
    severity: "info",
    rationale: "Improves quality diagnostics and operating cost bridge reliability.",
    keys: uniq([...SPEC.profitLoss.depreciationAmortization, ...SPEC.cashFlow.depreciation]),
  },
  {
    id: "is-employee-cost",
    title: "Employee cost",
    statement: "ProfitLoss",
    tier: "Tier C",
    severity: "info",
    rationale: "Improves operating cost decomposition and forecast detail.",
    keys: SPEC.profitLoss.employeeExpense,
  },
  {
    id: "is-other-expenses",
    title: "Other expenses",
    statement: "ProfitLoss",
    tier: "Tier C",
    severity: "info",
    rationale: "Improves bridge completeness and quality diagnostics.",
    keys: SPEC.profitLoss.otherExpenses,
  },
  {
    id: "bs-retained-earnings-proxy",
    title: "Retained earnings proxy",
    statement: "BalanceSheet",
    tier: "Tier C",
    severity: "info",
    rationale: "Improves Altman and balance-sheet quality interpretation.",
    keys: SPEC.profitLoss.retainedEarningsProxy,
  },
  {
    id: "bs-inventory-components",
    title: "Detailed inventory components",
    statement: "BalanceSheet",
    tier: "Tier D",
    severity: "info",
    rationale: "Optional detail for richer inventory diagnostics.",
    keys: SPEC.balanceSheet.inventoryComponents,
  },
  {
    id: "bs-other-financial-assets",
    title: "Other financial asset detail",
    statement: "BalanceSheet",
    tier: "Tier D",
    severity: "info",
    rationale: "Optional detail that improves treasury decomposition.",
    keys: uniq([
      ...SPEC.balanceSheet.financialAssets.longTermInvestments,
      ...SPEC.balanceSheet.financialAssets.depositsAndRestricted,
      ...SPEC.balanceSheet.financialAssets.otherFinancialAssets,
    ]),
  },
  {
    id: "bs-operating-liability-detail",
    title: "Detailed operating liability buckets",
    statement: "BalanceSheet",
    tier: "Tier D",
    severity: "info",
    rationale: "Optional detail for richer liability decomposition.",
    keys: uniq([
      ...SPEC.balanceSheet.olComponents.tradePayables,
      ...SPEC.balanceSheet.olComponents.otherCurrentLiabilities,
      ...SPEC.balanceSheet.olComponents.provisionsCurrent,
      ...SPEC.balanceSheet.olComponents.provisionsLongTerm,
      ...SPEC.balanceSheet.olComponents.currentTaxLiabilities,
      ...SPEC.balanceSheet.olComponents.nonCurrentTaxLiabilities,
      ...SPEC.balanceSheet.olComponents.deferredTaxLiabilitiesNet,
      ...SPEC.balanceSheet.olComponents.otherNonCurrentLiabilities,
    ]),
  },
  {
    id: "is-sga-detail",
    title: "Detailed SG&A buckets",
    statement: "ProfitLoss",
    tier: "Tier D",
    severity: "info",
    rationale: "Optional detail for forecast bridge richness and operating diagnostics.",
    keys: uniq([
      ...SPEC.profitLoss.sgaAds,
      ...SPEC.profitLoss.sgaLegal,
      ...SPEC.profitLoss.sgaRent,
      ...SPEC.profitLoss.sgaFreight,
      ...SPEC.profitLoss.sgaRepairs,
      ...SPEC.profitLoss.sgaPower,
    ]),
  },
  {
    id: "is-other-items-aliases",
    title: "Other items aliases",
    statement: "ProfitLoss",
    tier: "Tier D",
    severity: "info",
    rationale: "Optional detail used mainly for audit trails and special cases.",
    keys: SPEC.profitLoss.otherItemsAliases,
  },
];

function collectDatasetKeys(periods: RawPeriodData[]) {
  const byStatement: Record<MappingStatement, Set<string>> = {
    BalanceSheet: new Set<string>(),
    ProfitLoss: new Set<string>(),
    CashFlow: new Set<string>(),
  };

  for (const period of periods) {
    for (const compositeKey of Object.keys(period.raw_metric_values)) {
      const idx = compositeKey.lastIndexOf("__");
      if (idx < 0) continue;
      const baseKey = compositeKey.slice(0, idx);
      const statement = compositeKey.slice(idx + 2) as MappingStatement;
      if (statement in byStatement) {
        byStatement[statement].add(baseKey);
      }
    }
  }

  return byStatement;
}

function findGroupForKey(key: string, statement?: string | null) {
  const statementMatch = statement && (statement === "BalanceSheet" || statement === "ProfitLoss" || statement === "CashFlow")
    ? statement
    : null;

  const exact = GROUPS.find((group) => {
    if (statementMatch && group.statement !== statementMatch) return false;
    return group.keys.includes(key);
  });
  if (exact) return exact;

  if (statementMatch) {
    return GROUPS.find((group) => group.statement === statementMatch && group.keys.some((candidate) => candidate.toLowerCase() === key.toLowerCase()));
  }

  return GROUPS.find((group) => group.keys.some((candidate) => candidate.toLowerCase() === key.toLowerCase())) ?? null;
}

export function listMappingCoverageGroups() {
  return GROUPS;
}

export function evaluateMappingCoverageSummary(periods: RawPeriodData[]): MappingCoverageSummary {
  const byStatement = collectDatasetKeys(periods);
  const issues = GROUPS.map<MappingCoverageIssue>((group) => {
    const statementKeys = byStatement[group.statement];
    const matchedKeys = group.keys.filter((key) => statementKeys.has(key));
    const missingKeys = group.keys.filter((key) => !statementKeys.has(key));
    return {
      id: group.id,
      title: group.title,
      statement: group.statement,
      tier: group.tier,
      severity: group.severity,
      rationale: group.rationale,
      matchedKeys,
      missingKeys,
      status: matchedKeys.length > 0 ? "resolved" : "unresolved",
    };
  });

  const unresolvedBySeverity: MappingCoverageSummary["unresolvedBySeverity"] = {
    critical: issues.filter((issue) => issue.status === "unresolved" && issue.severity === "critical"),
    warning: issues.filter((issue) => issue.status === "unresolved" && issue.severity === "warning"),
    info: issues.filter((issue) => issue.status === "unresolved" && issue.severity === "info"),
  };

  const unresolvedByTier: MappingCoverageSummary["unresolvedByTier"] = {
    "Tier A": issues.filter((issue) => issue.status === "unresolved" && issue.tier === "Tier A"),
    "Tier B": issues.filter((issue) => issue.status === "unresolved" && issue.tier === "Tier B"),
    "Tier C": issues.filter((issue) => issue.status === "unresolved" && issue.tier === "Tier C"),
    "Tier D": issues.filter((issue) => issue.status === "unresolved" && issue.tier === "Tier D"),
  };

  const totalsByTier = {
    "Tier A": { total: 0, resolved: 0, unresolved: 0 },
    "Tier B": { total: 0, resolved: 0, unresolved: 0 },
    "Tier C": { total: 0, resolved: 0, unresolved: 0 },
    "Tier D": { total: 0, resolved: 0, unresolved: 0 },
  } as MappingCoverageSummary["totalsByTier"];

  for (const issue of issues) {
    totalsByTier[issue.tier].total += 1;
    if (issue.status === "resolved") totalsByTier[issue.tier].resolved += 1;
    else totalsByTier[issue.tier].unresolved += 1;
  }

  return {
    policyVersion: MAPPING_POLICY_VERSION,
    issues,
    unresolvedBySeverity,
    unresolvedByTier,
    totalsByTier,
  };
}

export function classifyMappingIssue(key: string, statement?: string | null): MappingIssueClassification {
  const group = findGroupForKey(key, statement);
  if (!group) {
    return {
      policyVersion: MAPPING_POLICY_VERSION,
      groupId: null,
      groupTitle: "Unclassified optional detail",
      tier: "Tier D",
      severity: "info",
      rationale: "Label is not yet mapped into a named coverage group.",
    };
  }

  return {
    policyVersion: MAPPING_POLICY_VERSION,
    groupId: group.id,
    groupTitle: group.title,
    tier: group.tier,
    severity: group.severity,
    rationale: group.rationale,
  };
}
