import { processCompanyData } from "./pipeline";
import { evaluateQualityGate } from "./mappingAudit";
import { getAnalysisPolicyVersions } from "./policyVersions";
import { DEFAULT_CONFIG, EngineConfig } from "./types";
import { resolveValuationReadiness } from "./valuationPolicy";
import { GoldenCompanyCase, GoldenCompanyResult } from "./goldenCompanySuite/types";

export type {
  GoldenCompanyExpectation,
  GoldenCompanyCase,
  GoldenCompanyResult,
} from "./goldenCompanySuite/types";
export { GOLDEN_COMPANY_CASES } from "./goldenCompanySuite/cases";

export function runGoldenCompanyCase(testCase: GoldenCompanyCase, config: EngineConfig = DEFAULT_CONFIG): GoldenCompanyResult {
  const effectiveConfig = testCase.config ?? config;
  const periods = processCompanyData(testCase.rawData, effectiveConfig);
  const qualityGate = evaluateQualityGate(testCase.rawData, null, periods);
  const valuationReadiness = resolveValuationReadiness(periods);
  const latestPeriod = periods[periods.length - 1]!;

  return {
    companyId: testCase.companyId,
    source: testCase.source,
    periods,
    qualityGate,
    valuationReadiness,
    latestPeriod,
    policyVersions: getAnalysisPolicyVersions(),
  };
}
