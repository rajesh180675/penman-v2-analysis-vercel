import { evaluateQualityGate } from "../mappingAudit";
import { getAnalysisPolicyVersions } from "../policyVersions";
import { RawPeriodData, EngineConfig, RecastPeriod } from "../types";
import { ValuationReadiness } from "../valuationPolicy";

export interface GoldenCompanyExpectation {
  qualityGateTier: "Tier 1" | "Tier 2" | "Tier 3";
  valuationBlocked: boolean;
  valuationStatus: "production-ready" | "warning" | "guarded";
  persistenceStatus?: "durable" | "mixed" | "fragile" | "unknown" | undefined;
  minPeriods: number;
  requiredTerminalFlags?: string[] | undefined;
  forbiddenTerminalFlags?: string[] | undefined;
  ratioRanges?: Partial<Record<"ROCE" | "RNOA" | "NBC" | "FLEV" | "cash_conversion_ratio", [number, number]>>;
}

export interface GoldenCompanyCase {
  id: string;
  companyId: string;
  source: "audited-run" | "curated-contrast" | "real-company-sample";
  note: string;
  rawData: RawPeriodData[];
  /** Optional per-case config override. Defaults to DEFAULT_CONFIG when absent. */
  config?: EngineConfig | undefined;
  expectation: GoldenCompanyExpectation;
}

export interface GoldenCompanyResult {
  companyId: string;
  source: GoldenCompanyCase["source"];
  periods: RecastPeriod[];
  qualityGate: ReturnType<typeof evaluateQualityGate>;
  valuationReadiness: ValuationReadiness;
  latestPeriod: RecastPeriod;
  policyVersions: ReturnType<typeof getAnalysisPolicyVersions>;
}
