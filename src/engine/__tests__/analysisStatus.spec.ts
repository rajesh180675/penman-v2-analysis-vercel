import { describe, expect, it } from "vitest";
import { deriveAnalysisStatus } from "../analysisStatus";
import { getAnalysisPolicyVersions } from "../policyVersions";

const versions = getAnalysisPolicyVersions();

describe("analysis status confidence gating", () => {
  it("downgrades to guarded when actionable backlog review remains high", () => {
    const status = deriveAnalysisStatus(
      {
        tier: "Tier 1",
        valuationBlocked: false,
        missingMinimum: [],
        missingCore: [],
        blockingReasons: [],
        policyVersion: versions.mappingPolicyVersion,
        coverageSummary: {
          policyVersion: versions.mappingPolicyVersion,
          issues: [],
          unresolvedBySeverity: { critical: [], warning: [], info: [] },
          unresolvedByTier: { "Tier A": [], "Tier B": [], "Tier C": [], "Tier D": [] },
          totalsByTier: {
            "Tier A": { total: 0, resolved: 0, unresolved: 0 },
            "Tier B": { total: 0, resolved: 0, unresolved: 0 },
            "Tier C": { total: 0, resolved: 0, unresolved: 0 },
            "Tier D": { total: 0, resolved: 0, unresolved: 0 },
          },
        },
        valuationCriticalGaps: [],
        ratioCriticalGaps: [],
        scopeAssessment: {
          policyVersion: versions.scopePolicyVersion,
          classification: "supported-industrial",
          blocked: false,
          label: "Supported industrial/company scope",
          reasons: [],
          recommendedAction: "Proceed",
          signals: [],
        },
      },
      {
        status: "production-ready",
        latestPeriod: "2025-03-31",
        anchorPeriod: "2025-03-31",
        anchorIndex: 0,
        fallbackUsed: false,
        contaminationTier: "CLEAN",
        terminalFlags: [],
        terminalFlagLabels: [],
        reasons: ["Terminal period is clean."],
      },
      {
        mappingSpecVersion: versions.mappingSpecVersion,
        policyVersion: versions.mappingPolicyVersion,
        usedKeysNotInYaml: [],
        yamlKeysNotInDataset: [],
        unresolvedCriticalByStatement: { BalanceSheet: [], ProfitLoss: [], CashFlow: [] },
        datasetKeyCounts: { BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Unknown: 0 },
        coverageSummary: {
          policyVersion: versions.mappingPolicyVersion,
          issues: [],
          unresolvedBySeverity: { critical: [], warning: [], info: [] },
          unresolvedByTier: { "Tier A": [], "Tier B": [], "Tier C": [], "Tier D": [] },
          totalsByTier: {
            "Tier A": { total: 0, resolved: 0, unresolved: 0 },
            "Tier B": { total: 0, resolved: 0, unresolved: 0 },
            "Tier C": { total: 0, resolved: 0, unresolved: 0 },
            "Tier D": { total: 0, resolved: 0, unresolved: 0 },
          },
        },
        outOfSpecLabels: [],
        backlogSummary: {
          policyVersion: versions.mappingPolicyVersion,
          totalsByAction: { "add-to-spec": 2, "group-to-existing": 46, "ignore-non-core": 900, review: 180 },
          totalsByPriority: { blocking: 0, diagnostic: 40, optional: 188 },
          actionableCount: 228,
          ignoredCount: 900,
          topActionable: [],
        },
      },
    );

    expect(status.status).toBe("guarded");
    expect(status.headline).toBe("Coverage breadth still needs review");
    expect(status.reasons.some((reason) => reason.includes("Backlog review volume remains high"))).toBe(true);
  });
});
