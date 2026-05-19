import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DebugPanel from "../DebugPanel";
import { CapitalineParseDebug } from "../../engine/capitalineParser";
import { getAnalysisPolicyVersions } from "../../engine/policyVersions";
import { QualityGateReport } from "../../engine/mappingAudit";

const versions = getAnalysisPolicyVersions();

function mkDebugInfo(): CapitalineParseDebug {
  return {
    companyId: "BANK",
    files: [{ name: "BalanceSheet.xlsx", statementGuess: "BalanceSheet" }],
    detectedPeriods: ["2025-03-31"],
    rawGrids: [],
    metrics: {
      totalCompositeKeys: 1,
      totalBaseKeys: 1,
      baseKeyCollisions: [],
        byStatement: {
          BalanceSheet: 2,
          ProfitLoss: 4,
          CashFlow: 2,
          Unknown: 0,
          Segment: 0,
        },
    },
    warnings: [],
    sample: { firstRows: [] },
    rawMetricKeys: ["Deposits"],
  };
}

function mkQualityGate(): QualityGateReport {
  return {
    tier: "Tier 1",
    valuationBlocked: true,
    missingMinimum: [],
    missingCore: [],
    blockingReasons: ["Terminal anchor remains guarded."],
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
      classification: "unsupported-financial-company",
      analysisFamily: "financial-institution",
      blocked: true,
      label: "Unsupported scope",
      reasons: ["Banking issuer is outside current supported scope."],
      recommendedAction: "Do not proceed",
      signals: [
        {
          kind: "banking",
          key: "Deposits",
          periodsObserved: 1,
        },
      ],
    },
  };
}

describe("DebugPanel mapping coverage audit", () => {
  it("labels raw counts as mapping counts when blocked trust gates exceed mapping blockers", () => {
    const html = renderToStaticMarkup(
      <DebugPanel
        debugInfo={mkDebugInfo()}
        rawData={[
          {
            company_id: "BANK",
            period_end: "2025-03-31",
            raw_metric_values: {
              "Deposits__BalanceSheet": 1000,
            },
          },
        ]}
        recastData={[]}
        qualityGate={mkQualityGate()}
        engineError={null}
      />,
    );

    expect(html).toContain("Mapping blocking");
    expect(html).toContain("Mapping diagnostic");
    expect(html).toContain("Mapping optional");
    expect(html).not.toContain(">Blocking<");
    expect(html).not.toContain(">Diagnostic<");
    expect(html).not.toContain(">Optional<");
  });
});
