import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { buildAnalysisTraceability } from "../engine/analysisTraceability";
import { EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { CapitalineParseDebug } from "../engine/capitalineParser";
import { MappingAuditReport, QualityGateReport } from "../engine/mappingAudit";
import { AuditSubmissionMeta } from "./audit";
import { SourceParserDiagnostics } from "../engine/parserDiagnostics";
import { buildAnalysisPublicationSnapshot } from "./publication/analysisPublicationSnapshot";
import { buildLineageMap } from "../engine/lineageBuilder";

export function buildAnalysisSnapshot(params: {
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  debugInfo: CapitalineParseDebug | null;
  parserDiagnostics?: SourceParserDiagnostics | null | undefined;
  qualityGate: QualityGateReport | null;
  mappingAudit: MappingAuditReport | null;
  engineError: string | null;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
  auditMeta?: AuditSubmissionMeta | null | undefined;
}) {
  const { rawData, recastData, config, debugInfo, parserDiagnostics, qualityGate, mappingAudit, engineError, analysisStatus, auditMeta } = params;
  const publication = buildAnalysisPublicationSnapshot({
    data: recastData ?? [],
    config,
    rawData,
    auditMeta,
    sharedTraceability: null,
    qualityGate,
    mappingAudit,
    analysisStatus,
    family: qualityGate?.scopeAssessment.analysisFamily ?? null,
  });

  const latestPeriod = rawData && rawData.length > 0 ? rawData[rawData.length - 1]!.period_end : null;
  const traceability = buildAnalysisTraceability({
    generatedAt: new Date().toISOString(),
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
    policyVersions: publication.policyVersions,
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
  });

  return {
    companyId: rawData?.[0]?.company_id ?? null,
    family: publication.family,
    periodCount: rawData?.length ?? 0,
    latestPeriod: publication.latestRawPeriod ?? latestPeriod,
    policyVersions: publication.policyVersions,
    traceability,
    /** Gap 4 / PR-D — lineage sidecar. Lives on the snapshot, not the
     *  envelope. RunInspector / DebugPanel fetch this when a reviewer
     *  drills into a specific number. */
    lineage: buildLineageMap({ recastData, rawData }),
    config,
    qualityGate: publication.qualityGate ?? qualityGate,
    mappingAudit: publication.mappingAudit ?? mappingAudit,
    engineError,
    debugInfo,
    rawData,
    recastData,
    parserDiagnostics,
    analysisStatus: publication.analysisStatus ?? analysisStatus ?? null,
    valuationReadiness: publication.valuationReadiness,
    provenanceRows: publication.provenanceRows,
    granularityChecklist: publication.granularityChecklist,
  };
}
