import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { CapitalineParseDebug } from "../engine/capitalineParser";
import { MappingAuditReport, QualityGateReport } from "../engine/mappingAudit";
import { getAnalysisPolicyVersions } from "../engine/policyVersions";
import { buildAnalysisTraceability } from "../engine/analysisTraceability";
import { AuditSubmissionMeta } from "./audit";
import { SourceParserDiagnostics } from "../engine/parserDiagnostics";

export function buildAnalysisSnapshot(params: {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  debugInfo: CapitalineParseDebug | null;
  parserDiagnostics?: SourceParserDiagnostics | null;
  qualityGate: QualityGateReport | null;
  mappingAudit: MappingAuditReport | null;
  engineError: string | null;
  analysisStatus?: AnalysisStatusSummary | null;
  auditMeta?: AuditSubmissionMeta | null;
}) {
  const { rawData, recastData, config, debugInfo, parserDiagnostics, qualityGate, mappingAudit, engineError, analysisStatus, auditMeta } = params;
  const policyVersions = getAnalysisPolicyVersions();
  const latestPeriod = rawData && rawData.length > 0 ? rawData[rawData.length - 1].period_end : null;
  const generatedAt = new Date().toISOString();

  return {
    companyId: rawData?.[0]?.company_id ?? null,
    periodCount: rawData?.length ?? 0,
    latestPeriod,
    policyVersions,
    traceability: buildAnalysisTraceability({
      generatedAt,
      runId: auditMeta?.runId ?? null,
      companyId: rawData?.[0]?.company_id ?? null,
      sourceMode: auditMeta?.sourceMode ?? null,
      rawData,
      recastData,
      config,
      periodCount: rawData?.length ?? 0,
      recastPeriodCount: recastData?.length ?? 0,
      latestPeriod,
      qualityGate,
      mappingAudit,
      policyVersions,
      analysisStatus,
      hasDebugInfo: Boolean(debugInfo),
      debugFiles: debugInfo?.files?.length ?? 0,
      rawMetricKeyCount: debugInfo?.rawMetricKeys?.length ?? 0,
      engineError,
      debugInfo,
      parserDiagnostics,
      contentClass: auditMeta?.contentClass ?? null,
      retentionDays: auditMeta?.retentionDays ?? null,
      runInspectorEnabled: Boolean(auditMeta?.runAccessToken),
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
