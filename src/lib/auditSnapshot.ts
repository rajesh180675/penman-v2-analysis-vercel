import { EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { CapitalineParseDebug } from "../engine/capitalineParser";
import { MappingAuditReport, QualityGateReport } from "../engine/mappingAudit";
import { getAnalysisPolicyVersions } from "../engine/policyVersions";
import { buildAnalysisTraceability } from "../engine/analysisTraceability";

export function buildAnalysisSnapshot(params: {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  debugInfo: CapitalineParseDebug | null;
  qualityGate: QualityGateReport | null;
  mappingAudit: MappingAuditReport | null;
  engineError: string | null;
}) {
  const { rawData, recastData, config, debugInfo, qualityGate, mappingAudit, engineError } = params;
  const policyVersions = getAnalysisPolicyVersions();
  const latestPeriod = rawData && rawData.length > 0 ? rawData[rawData.length - 1].period_end : null;

  return {
    companyId: rawData?.[0]?.company_id ?? null,
    periodCount: rawData?.length ?? 0,
    latestPeriod,
    policyVersions,
    traceability: buildAnalysisTraceability({
      companyId: rawData?.[0]?.company_id ?? null,
      periodCount: rawData?.length ?? 0,
      latestPeriod,
      qualityGate,
      mappingAudit,
      policyVersions,
    }),
    config,
    qualityGate,
    mappingAudit,
    engineError,
    debugInfo,
    rawData,
    recastData,
  };
}
