import { EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { CapitalineParseDebug } from "../engine/capitalineParser";
import { QualityGateReport } from "../engine/mappingAudit";

export function buildAnalysisSnapshot(params: {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  debugInfo: CapitalineParseDebug | null;
  qualityGate: QualityGateReport | null;
  engineError: string | null;
}) {
  const { rawData, recastData, config, debugInfo, qualityGate, engineError } = params;

  return {
    companyId: rawData?.[0]?.company_id ?? null,
    periodCount: rawData?.length ?? 0,
    latestPeriod: rawData?.[rawData.length - 1]?.period_end ?? null,
    config,
    qualityGate,
    engineError,
    debugInfo,
    rawData,
    recastData,
  };
}
