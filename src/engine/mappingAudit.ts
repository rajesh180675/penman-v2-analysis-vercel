import { EngineConfig, RawPeriodData, RecastPeriod } from "./types";
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
import {
  Statement,
  unresolvedCriticalKeysByStatement,
  flattenSpecKeys,
  extractYamlKeys,
  datasetKeysByStatement,
  countDatasetKeysByStatement,
} from "./mappingAudit/specKeys";

export { flattenSpecKeys, extractYamlKeys, datasetKeysByStatement } from "./mappingAudit/specKeys";
export { evaluateGranularityChecklist } from "./mappingAudit/checklist";
export type { GranularityChecklistItem, GranularityChecklistReport } from "./mappingAudit/checklist";

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
      const [statement, key] = scopedKey.split("||") as [string, string];
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
  recastPeriods?: RecastPeriod[] | null | undefined,
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
