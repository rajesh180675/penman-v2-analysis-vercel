import { AnalysisStatusSummary, deriveAnalysisStatus } from "../../engine/analysisStatus";
import { buildAnalysisTraceability, AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import { auditMappingCoverage, evaluateGranularityChecklist, evaluateQualityGate, MappingAuditReport, QualityGateReport } from "../../engine/mappingAudit";
import { getAnalysisPolicyVersions } from "../../engine/policyVersions";
import { buildProvenanceAuditRows } from "../../engine/provenanceAudit";
import { resolveValuationReadiness } from "../../engine/valuationPolicy";
import { EngineConfig, RawPeriodData, RecastPeriod } from "../../engine/types";
import { AuditSubmissionMeta } from "../audit";

export interface AnalysisPublicationSnapshot {
  companyId: string | null;
  latestRawPeriod: string | null;
  latestRecastPeriod: string | null;
  policyVersions: ReturnType<typeof getAnalysisPolicyVersions>;
  qualityGate: QualityGateReport | null;
  mappingAudit: MappingAuditReport | null;
  valuationReadiness: ReturnType<typeof resolveValuationReadiness>;
  analysisStatus: AnalysisStatusSummary;
  traceability: AnalysisTraceabilityEnvelope;
  provenanceRows: ReturnType<typeof buildProvenanceAuditRows>;
  granularityChecklist: ReturnType<typeof evaluateGranularityChecklist> | null;
}

export function buildAnalysisPublicationSnapshot(params: {
  data: RecastPeriod[];
  config: EngineConfig;
  rawData?: RawPeriodData[] | null;
  auditMeta?: AuditSubmissionMeta | null;
  sharedTraceability?: AnalysisTraceabilityEnvelope | null;
}): AnalysisPublicationSnapshot {
  const { data, config, rawData = null, auditMeta = null, sharedTraceability = null } = params;
  const valuationReadiness = resolveValuationReadiness(data);
  const policyVersions = getAnalysisPolicyVersions();
  const qualityGate = rawData?.length ? evaluateQualityGate(rawData, config, data) : null;
  const mappingAudit = rawData?.length ? auditMappingCoverage(rawData) : null;
  const analysisStatus = deriveAnalysisStatus(qualityGate, valuationReadiness, mappingAudit);
  const latestRawPeriod = rawData?.[rawData.length - 1]?.period_end ?? null;
  const traceability = sharedTraceability ?? buildAnalysisTraceability({
    generatedAt: new Date().toISOString(),
    runId: auditMeta?.runId ?? null,
    companyId: rawData?.[0]?.company_id ?? null,
    sourceMode: auditMeta?.sourceMode ?? null,
    rawData,
    recastData: data,
    config,
    periodCount: rawData?.length ?? 0,
    recastPeriodCount: data.length,
    latestPeriod: latestRawPeriod,
    qualityGate,
    mappingAudit,
    policyVersions,
    analysisStatus,
    hasDebugInfo: false,
    debugFiles: 0,
    rawMetricKeyCount: 0,
    engineError: null,
    debugInfo: null,
    parserDiagnostics: null,
    contentClass: auditMeta?.contentClass ?? null,
    retentionDays: auditMeta?.retentionDays ?? null,
    runInspectorEnabled: Boolean(auditMeta?.runAccessToken),
  });

  return {
    companyId: rawData?.[0]?.company_id ?? null,
    latestRawPeriod,
    latestRecastPeriod: data[data.length - 1]?.period_end ?? null,
    policyVersions,
    qualityGate,
    mappingAudit,
    valuationReadiness,
    analysisStatus,
    traceability,
    provenanceRows: buildProvenanceAuditRows(data),
    granularityChecklist: rawData?.length ? evaluateGranularityChecklist(rawData) : null,
  };
}
