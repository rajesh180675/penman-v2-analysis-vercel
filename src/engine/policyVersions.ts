export const ENGINE_VERSION = "2026-03-phase4";
export const CAPITALINE_MAPPING_SPEC_VERSION = "2026-03-capitaline-indas-v1";
export const MAPPING_POLICY_VERSION = "2026-03-phase4";
export const ANOMALY_POLICY_VERSION = "2026-03-phase4";
export const VALUATION_POLICY_VERSION = "2026-03-phase4";
export const GOLDEN_COMPANY_SUITE_VERSION = "2026-03-phase4";

export interface AnalysisPolicyVersions {
  engineVersion: string;
  mappingSpecVersion: string;
  mappingPolicyVersion: string;
  anomalyPolicyVersion: string;
  valuationPolicyVersion: string;
  goldenCompanySuiteVersion: string;
}

export function getAnalysisPolicyVersions(): AnalysisPolicyVersions {
  return {
    engineVersion: ENGINE_VERSION,
    mappingSpecVersion: CAPITALINE_MAPPING_SPEC_VERSION,
    mappingPolicyVersion: MAPPING_POLICY_VERSION,
    anomalyPolicyVersion: ANOMALY_POLICY_VERSION,
    valuationPolicyVersion: VALUATION_POLICY_VERSION,
    goldenCompanySuiteVersion: GOLDEN_COMPANY_SUITE_VERSION,
  };
}
