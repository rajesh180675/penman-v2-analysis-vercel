export const ENGINE_VERSION = "2026-03-phase8-valuation-command-center";
export const CAPITALINE_MAPPING_SPEC_VERSION = "2026-03-capitaline-indas-v2";
export const MAPPING_POLICY_VERSION = "2026-03-phase8";
export const ANOMALY_POLICY_VERSION = "2026-03-phase8";
export const VALUATION_POLICY_VERSION = "2026-03-phase8-dcf";
export const GOLDEN_COMPANY_SUITE_VERSION = "2026-03-phase8";
export const SCOPE_POLICY_VERSION = "2026-03-phase7";
export const TRACEABILITY_SCHEMA_VERSION = "2026-06-traceability-v9";

export interface AnalysisPolicyVersions {
  engineVersion: string;
  mappingSpecVersion: string;
  mappingPolicyVersion: string;
  anomalyPolicyVersion: string;
  valuationPolicyVersion: string;
  goldenCompanySuiteVersion: string;
  scopePolicyVersion: string;
  traceabilitySchemaVersion: string;
}

export function getAnalysisPolicyVersions(): AnalysisPolicyVersions {
  return {
    engineVersion: ENGINE_VERSION,
    mappingSpecVersion: CAPITALINE_MAPPING_SPEC_VERSION,
    mappingPolicyVersion: MAPPING_POLICY_VERSION,
    anomalyPolicyVersion: ANOMALY_POLICY_VERSION,
    valuationPolicyVersion: VALUATION_POLICY_VERSION,
    goldenCompanySuiteVersion: GOLDEN_COMPANY_SUITE_VERSION,
    scopePolicyVersion: SCOPE_POLICY_VERSION,
    traceabilitySchemaVersion: TRACEABILITY_SCHEMA_VERSION,
  };
}
