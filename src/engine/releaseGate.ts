import { DEFAULT_CONFIG, EngineConfig } from "./types";
import { GOLDEN_COMPANY_CASES, runGoldenCompanyCase } from "./goldenCompanySuite";
import { getAnalysisPolicyVersions } from "./policyVersions";

export interface ReleaseGateCaseResult {
  id: string;
  companyId: string;
  source: string;
  passed: boolean;
  qualityGateTier: string;
  valuationStatus: string;
  notes: string[];
}

export interface ReleaseGateSummary {
  generatedAt: string;
  passed: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  policyVersions: ReturnType<typeof getAnalysisPolicyVersions>;
  cases: ReleaseGateCaseResult[];
}

export function evaluateGoldenReleaseGate(config: EngineConfig = DEFAULT_CONFIG): ReleaseGateSummary {
  const cases = GOLDEN_COMPANY_CASES.map((testCase) => {
    const result = runGoldenCompanyCase(testCase, config);
    const notes = [
      `tier=${result.qualityGate.tier}`,
      `valuation=${result.valuationReadiness.status}`,
      `persistence=${result.valuationReadiness.persistenceStatus}`,
    ];
    const passed =
      result.qualityGate.tier === testCase.expectation.qualityGateTier
      && result.qualityGate.valuationBlocked === testCase.expectation.valuationBlocked
      && result.valuationReadiness.status === testCase.expectation.valuationStatus
      && (!testCase.expectation.persistenceStatus || result.valuationReadiness.persistenceStatus === testCase.expectation.persistenceStatus);

    return {
      id: testCase.id,
      companyId: testCase.companyId,
      source: testCase.source,
      passed,
      qualityGateTier: result.qualityGate.tier,
      valuationStatus: result.valuationReadiness.status,
      notes,
    } satisfies ReleaseGateCaseResult;
  });

  const passedCases = cases.filter((item) => item.passed).length;
  return {
    generatedAt: new Date().toISOString(),
    passed: passedCases === cases.length,
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    policyVersions: getAnalysisPolicyVersions(),
    cases,
  };
}
