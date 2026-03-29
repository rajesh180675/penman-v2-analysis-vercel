import { MappingCoverageGroup, MappingSeverity, MappingStatement, classifyMappingIssue, listMappingCoverageGroups } from "./mappingPolicy";
import { MAPPING_POLICY_VERSION } from "./policyVersions";

export type BacklogTriageAction = "add-to-spec" | "group-to-existing" | "ignore-non-core" | "review";
export type BacklogPriority = "blocking" | "diagnostic" | "optional";

export interface MappingBacklogCandidate {
  statement: MappingStatement | "Unknown";
  key: string;
  periodsObserved: number;
  nonZeroPeriods: number;
  latestValue: number | null;
  maxAbsValue: number;
}

export interface MappingBacklogDecision {
  policyVersion: string;
  action: BacklogTriageAction;
  priority: BacklogPriority;
  rationale: string;
  targetLine: string | null;
  targetGroupId: string | null;
  targetGroupTitle: string | null;
  suggestedSpecPath: string | null;
}

export interface MappingBacklogEntry extends MappingBacklogCandidate {
  triage: MappingBacklogDecision;
}

export interface MappingBacklogSummary {
  policyVersion: string;
  totalsByAction: Record<BacklogTriageAction, number>;
  totalsByPriority: Record<BacklogPriority, number>;
  actionableCount: number;
  ignoredCount: number;
  topActionable: MappingBacklogEntry[];
}

type ExactRule = {
  statement: MappingStatement;
  key: string;
  action: Exclude<BacklogTriageAction, "review">;
  rationale: string;
  targetLine?: string;
  targetGroupId?: string;
  suggestedSpecPath?: string;
};

type PatternRule = {
  statement?: MappingStatement | "Unknown";
  pattern: RegExp;
  action: Exclude<BacklogTriageAction, "review">;
  rationale: string;
  targetLine?: string;
  targetGroupId?: string;
  suggestedSpecPath?: string;
};

function mapPriority(severity: MappingSeverity | null | undefined): BacklogPriority {
  if (severity === "critical") return "blocking";
  if (severity === "warning") return "diagnostic";
  return "optional";
}

function normalizeKey(key: string) {
  return key.trim().toLowerCase();
}

const EXACT_RULES: ExactRule[] = [
  {
    statement: "ProfitLoss",
    key: "Total Revenue from Operations",
    action: "add-to-spec",
    rationale: "Clear revenue alias for the existing sales anchor without changing line semantics.",
    targetGroupId: "is-sales",
    targetLine: "IS.Sales",
    suggestedSpecPath: "profitLoss.sales",
  },
  {
    statement: "ProfitLoss",
    key: "Total Interest Expenses",
    action: "add-to-spec",
    rationale: "Clear top-line finance cost alias used by Capitaline in place of Finance Cost.",
    targetGroupId: "is-finance-cost",
    targetLine: "IS.FinanceCost.Top",
    suggestedSpecPath: "profitLoss.financeCostTop",
  },
  {
    statement: "BalanceSheet",
    key: "Sundry Creditors",
    action: "add-to-spec",
    rationale: "Legacy trade-payables alias that should resolve directly into operating liabilities.",
    targetGroupId: "bs-trade-payables",
    targetLine: "BS.TradePayables",
    suggestedSpecPath: "balanceSheet.tradePayables",
  },
  {
    statement: "BalanceSheet",
    key: "Profit and Loss Account Closing Balance",
    action: "add-to-spec",
    rationale: "Retained-earnings style balance used in quality diagnostics when Other Equity is sparse.",
    targetGroupId: "bs-retained-earnings-proxy",
    targetLine: "Quality.RetainedEarningsProxy",
    suggestedSpecPath: "profitLoss.retainedEarningsProxy",
  },
  {
    statement: "ProfitLoss",
    key: "Other Comprehensive Income That Will Be Reclassified to Profit Or Loss :",
    action: "add-to-spec",
    rationale: "Colon-terminated variant of the existing OCI reclassification line.",
    targetGroupId: "is-oci-and-tci",
    targetLine: "IS.OCI.Reclass",
    suggestedSpecPath: "profitLoss.ociReclass",
  },
  {
    statement: "ProfitLoss",
    key: "Other Comprehensive Income no Specification :",
    action: "add-to-spec",
    rationale: "Colon-terminated variant of the existing OCI unspecified line.",
    targetGroupId: "is-oci-and-tci",
    targetLine: "IS.OCI.Unspecified",
    suggestedSpecPath: "profitLoss.ociUnspecified",
  },
];

const GROUP_RULES: PatternRule[] = [
  {
    statement: "BalanceSheet",
    pattern: /capital work(?: |-)?in(?: |-)?progress/i,
    action: "group-to-existing",
    rationale: "CWIP already belongs to the existing operating-asset decomposition and should not stay as free-form backlog noise.",
    targetLine: "BS.OA.CWIP",
  },
  {
    statement: "BalanceSheet",
    pattern: /right(?: |-)?of(?: |-)?use|^rou_/i,
    action: "group-to-existing",
    rationale: "ROU assets already flow through the operating-asset bridge and need grouping, not a separate backlog queue.",
    targetLine: "BS.OA.ROU",
  },
  {
    statement: "BalanceSheet",
    pattern: /intangible|computer software|technical know how|brands? ?\/ trademark|customer contracts?|goodwill on consolidation/i,
    action: "group-to-existing",
    rationale: "These labels are subcomponents of the existing intangible/goodwill operating-asset bridge.",
    targetLine: "BS.OA.OtherIntangibles",
  },
  {
    statement: "BalanceSheet",
    pattern: /cash and bank balances|total cash and cash equivalents|cash on hand|balances with banks|cheques, drafts on hand|in current accounts|in deposits with less than 3 months maturity|other bank balances|margin money/i,
    action: "group-to-existing",
    rationale: "Cash-bank detail should be grouped into the cash bucket, but not added as direct aliases because that would risk double counting component lines.",
    targetLine: "BS.FA.CashBank",
    targetGroupId: "bs-cash-bank",
  },
  {
    statement: "BalanceSheet",
    pattern: /trade advance received|advance-customers|credit balances/i,
    action: "group-to-existing",
    rationale: "Customer advances belong under operating-liability detail and should be grouped there rather than treated as free-form backlog debt.",
    targetLine: "BS.OLComp.OtherCurrentLiabilities",
    targetGroupId: "bs-operating-liability-detail",
  },
  {
    statement: "BalanceSheet",
    pattern: /debtor more than 6 month|debtor less than 6 month|allowance for doubtful|considered doubtful|trade debtors/i,
    action: "group-to-existing",
    rationale: "Receivable aging and allowance detail belongs under the trade-receivables bucket rather than the unmapped backlog.",
    targetLine: "BS.TradeReceivables",
    targetGroupId: "bs-trade-receivables",
  },
  {
    statement: "ProfitLoss",
    pattern: /salaries and incentives|provident|staff welfare|employee recruitment|other employee benefit/i,
    action: "group-to-existing",
    rationale: "Employee-cost detail already belongs in the operating-cost bridge and should be grouped there.",
    targetLine: "IS.OpBridge.EmployeeCost",
    targetGroupId: "is-employee-cost",
  },
  {
    statement: "ProfitLoss",
    pattern: /opening stock|closing stock|purchases of raw material|total raw material consumed|consumption of stores|job work|processing charges|manufacturing ?\/ direct expenses/i,
    action: "group-to-existing",
    rationale: "Detailed production-cost lines belong in the existing COGS and operating-cost bridge rather than remaining out-of-spec.",
    targetLine: "IS.COGS",
  },
  {
    statement: "ProfitLoss",
    pattern: /selling and distribution|sales promotion|business promotion|advertising|commission on sales|packing and forwarding|clearing and forwarding|royalty|csr expenditure|travelling and conveyance/i,
    action: "group-to-existing",
    rationale: "Company-specific selling and administrative disclosures should land inside the SGA bridge instead of remaining as unmapped noise.",
    targetLine: "IS.OpBridge.SGA",
    targetGroupId: "is-sga-detail",
  },
  {
    statement: "ProfitLoss",
    pattern: /export incentive|government grant|operating subsidy|duty drawback|scrap sales|miscellaneous operating income/i,
    action: "group-to-existing",
    rationale: "Operating-support income should be grouped into other operating income rather than treated as an unmapped disclosure.",
    targetLine: "IS.OpBridge.OtherOperatingIncome",
    targetGroupId: "is-other-expenses",
  },
  {
    statement: "ProfitLoss",
    pattern: /income from investment activities|other non operating income|dividend income|other interest income|fvtpl|fvtoci|amortised cost - financial assets/i,
    action: "group-to-existing",
    rationale: "These are finance-income support lines that should feed the existing finance-income ladder, not sit in the review queue.",
    targetLine: "IS.FinanceIncome.Support",
    targetGroupId: "is-finance-income-support",
  },
  {
    statement: "CashFlow",
    pattern: /cash generated from\/\(used in\) operations|op\. profit before working capital changes|trade & 0th receivables|total adjustments \(pbt & extraordinary items\)/i,
    action: "group-to-existing",
    rationale: "Cash-flow bridge support lines should be grouped as diagnostic bridge detail instead of backlog misses.",
    targetLine: "CF.CFOBridge",
  },
];

const IGNORE_RULES: PatternRule[] = [
  {
    pattern: /insurance business|policy holders?|reinsurance|linked liabilities|discontinued funds/i,
    action: "ignore-non-core",
    rationale: "Insurance-only disclosures are outside the industrial mapping scope and should not pollute the industrial backlog.",
  },
  {
    pattern: /number of equity shares|weighted average number of shares|earning per share|dividend per share|dividend percentage|face value/i,
    action: "ignore-non-core",
    rationale: "Per-share capital schedule detail is non-core for the current industrial engine.",
  },
  {
    pattern: /authorised|issued|subscribed fully paid up|paid up capital|book value|bonus in equity/i,
    action: "ignore-non-core",
    rationale: "Share-capital administration labels are not part of the operating/financing mapping spine.",
  },
  {
    pattern: /appropriation|available for appropriation|opening balance of profit and loss account|interim dividend|final dividend amount|prior year equity dividend paid|payment of final dividend/i,
    action: "ignore-non-core",
    rationale: "Appropriation schedule lines are informational but not part of the current reformulation model.",
  },
  {
    pattern: /associate companies|subsidiary companies|joint venture companies|quoted|unquoted/i,
    action: "ignore-non-core",
    rationale: "Investment schedule headings and listing detail are non-core disclosure scaffolding.",
  },
  {
    pattern: /:$|^a\) owners of the company$|^b\) non controlling interest$/i,
    action: "ignore-non-core",
    rationale: "Section headers and presentation-only rows should not enter the actionable mapping backlog.",
  },
];

function buildDecision(
  _candidate: MappingBacklogCandidate,
  action: BacklogTriageAction,
  rationale: string,
  targetLine?: string,
  targetGroupId?: string,
  suggestedSpecPath?: string,
) {
  const classification = targetGroupId ? classifyMappingIssueFromGroup(targetGroupId) : null;
  return {
    policyVersion: MAPPING_POLICY_VERSION,
    action,
    priority: mapPriority(classification?.severity ?? null),
    rationale,
    targetLine: targetLine ?? null,
    targetGroupId: classification?.groupId ?? targetGroupId ?? null,
    targetGroupTitle: classification?.groupTitle ?? null,
    suggestedSpecPath: suggestedSpecPath ?? null,
  } satisfies MappingBacklogDecision;
}

function findCoverageGroup(groupId: string): MappingCoverageGroup | null {
  return listMappingCoverageGroups().find((group) => group.id === groupId) ?? null;
}

function classifyMappingIssueFromGroup(groupId: string) {
  const group = findCoverageGroup(groupId);
  if (!group) return null;
  return {
    policyVersion: MAPPING_POLICY_VERSION,
    groupId: group.id,
    groupTitle: group.title,
    tier: group.tier,
    severity: group.severity,
    rationale: group.rationale,
  };
}

function findRule(candidate: MappingBacklogCandidate) {
  const exact = EXACT_RULES.find(
    (rule) => rule.statement === candidate.statement && normalizeKey(rule.key) === normalizeKey(candidate.key),
  );
  if (exact) return exact;

  const grouped = GROUP_RULES.find(
    (rule) => (!rule.statement || rule.statement === candidate.statement) && rule.pattern.test(candidate.key),
  );
  if (grouped) return grouped;

  const ignored = IGNORE_RULES.find(
    (rule) => (!rule.statement || rule.statement === candidate.statement) && rule.pattern.test(candidate.key),
  );
  return ignored ?? null;
}

export function triageOutOfSpecLabel(candidate: MappingBacklogCandidate): MappingBacklogDecision {
  if (candidate.nonZeroPeriods === 0 || candidate.maxAbsValue === 0) {
    return buildDecision(
      candidate,
      "ignore-non-core",
      "Label never carries a non-zero value across observed periods, so it is not actionable mapping debt.",
    );
  }

  if (candidate.statement === "Unknown") {
    return buildDecision(
      candidate,
      "ignore-non-core",
      "Unknown-statement labels are ignored until they are promoted into a statement-aware parser path.",
    );
  }

  const rule = findRule(candidate);
  if (rule) {
    return buildDecision(
      candidate,
      rule.action,
      rule.rationale,
      rule.targetLine,
      rule.targetGroupId,
      rule.suggestedSpecPath,
    );
  }

  const classification = classifyMappingIssue(candidate.key, candidate.statement);
  return {
    policyVersion: MAPPING_POLICY_VERSION,
    action: "review",
    priority: mapPriority(classification.severity),
    rationale: classification.groupId
      ? `Appears close to existing coverage group "${classification.groupTitle}" but still requires manual triage to avoid alias collisions.`
      : "Material non-zero label is outside the current mapping policy and needs explicit triage.",
    targetLine: null,
    targetGroupId: classification.groupId,
    targetGroupTitle: classification.groupTitle,
    suggestedSpecPath: null,
  };
}

function rankEntry(entry: MappingBacklogEntry) {
  const actionWeight: Record<BacklogTriageAction, number> = {
    review: 24,
    "add-to-spec": 20,
    "group-to-existing": 12,
    "ignore-non-core": 0,
  };
  const priorityWeight: Record<BacklogPriority, number> = {
    blocking: 18,
    diagnostic: 10,
    optional: 2,
  };
  return (
    actionWeight[entry.triage.action] * 1000
    + priorityWeight[entry.triage.priority] * 100
    + entry.nonZeroPeriods * 10
    + entry.periodsObserved
    + Math.min(entry.maxAbsValue, 1000) / 1000
  );
}

export function summarizeMappingBacklog(entries: MappingBacklogEntry[]): MappingBacklogSummary {
  const totalsByAction: MappingBacklogSummary["totalsByAction"] = {
    "add-to-spec": 0,
    "group-to-existing": 0,
    "ignore-non-core": 0,
    review: 0,
  };
  const totalsByPriority: MappingBacklogSummary["totalsByPriority"] = {
    blocking: 0,
    diagnostic: 0,
    optional: 0,
  };

  for (const entry of entries) {
    totalsByAction[entry.triage.action] += 1;
    totalsByPriority[entry.triage.priority] += 1;
  }

  const topActionable = entries
    .filter((entry) => entry.triage.action !== "ignore-non-core")
    .sort((a, b) => rankEntry(b) - rankEntry(a) || a.statement.localeCompare(b.statement) || a.key.localeCompare(b.key))
    .slice(0, 25);

  return {
    policyVersion: MAPPING_POLICY_VERSION,
    totalsByAction,
    totalsByPriority,
    actionableCount: entries.filter((entry) => entry.triage.action !== "ignore-non-core").length,
    ignoredCount: totalsByAction["ignore-non-core"],
    topActionable,
  };
}
