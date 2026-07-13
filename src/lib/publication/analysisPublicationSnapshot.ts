import { AnalysisStatusSummary, deriveAnalysisStatus } from "../../engine/analysisStatus";
import { buildAnalysisTraceability, AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import { buildValuationTraceabilitySurfaceSummary } from "../../engine/valuationTraceabilitySummary";
import { auditMappingCoverage, evaluateGranularityChecklist, evaluateQualityGate, MappingAuditReport, QualityGateReport } from "../../engine/mappingAudit";
import { getAnalysisPolicyVersions } from "../../engine/policyVersions";
import { buildProvenanceAuditRows } from "../../engine/provenanceAudit";
import { resolveValuationReadiness } from "../../engine/valuationPolicy";
import { EngineConfig, RawPeriodData, RecastPeriod } from "../../engine/types";
import { assessAnalysisScope } from "../../engine/scopePolicy";
import type { AnalysisFamily } from "../../engine/analysisFamily";
import type { AnalysisRunV1 } from "../../engine/analysisRun";
import { AuditSubmissionMeta } from "../audit";

export interface AnalysisPublicationRunIdentity {
  readonly runId: AnalysisRunV1["runId"];
  readonly reproducibilityHash: AnalysisRunV1["reproducibilityHash"];
  readonly schemaVersion: AnalysisRunV1["schemaVersion"];
  readonly executorVersion: AnalysisRunV1["executorVersion"];
  readonly analysisWindowRef: AnalysisRunV1["analysisWindowRef"];
  readonly marketSnapshotRef: AnalysisRunV1["marketSnapshotRef"];
  readonly assumptionSetRef: AnalysisRunV1["assumptionSetRef"];
  readonly modelResultRefs: AnalysisRunV1["modelResultRefs"];
}

export interface AnalysisPublicationSnapshot {
  /** Immutable analytical identity shared by every publication surface. */
  runIdentity: AnalysisPublicationRunIdentity | null;
  family: AnalysisFamily;
  companyId: string | null;
  latestRawPeriod: string | null;
  latestRecastPeriod: string | null;
  policyVersions: ReturnType<typeof getAnalysisPolicyVersions>;
  qualityGate: QualityGateReport | null;
  mappingAudit: MappingAuditReport | null;
  mappingPromotionCandidates: MappingAuditReport["promotionCandidates"];
  valuationReadiness: ReturnType<typeof resolveValuationReadiness>;
  analysisStatus: AnalysisStatusSummary;
  traceability: AnalysisTraceabilityEnvelope;
  traceabilitySummary: ReturnType<typeof buildValuationTraceabilitySurfaceSummary>;
  provenanceRows: ReturnType<typeof buildProvenanceAuditRows>;
  granularityChecklist: ReturnType<typeof evaluateGranularityChecklist> | null;
}

export function buildAnalysisPublicationSnapshot(params: {
  data: RecastPeriod[];
  config: EngineConfig;
  rawData?: RawPeriodData[] | null | undefined;
  auditMeta?: AuditSubmissionMeta | null | undefined;
  sharedTraceability?: AnalysisTraceabilityEnvelope | null | undefined;
  qualityGate?: QualityGateReport | null | undefined;
  mappingAudit?: MappingAuditReport | null | undefined;
  policyVersions?: ReturnType<typeof getAnalysisPolicyVersions> | undefined;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
  family?: AnalysisFamily | null | undefined;
  analysisRun?: AnalysisRunV1 | null | undefined;
}): AnalysisPublicationSnapshot {
  const {
    data,
    config,
    rawData = null,
    auditMeta = null,
    sharedTraceability = null,
    qualityGate: precomputedQualityGate = null,
    mappingAudit: precomputedMappingAudit = null,
    policyVersions: precomputedPolicyVersions,
    analysisStatus: precomputedAnalysisStatus = null,
    family: precomputedFamily = null,
    analysisRun = null,
  } = params;
  const valuationReadiness = resolveValuationReadiness(data);
  const policyVersions = precomputedPolicyVersions ?? getAnalysisPolicyVersions();
  const qualityGate = precomputedQualityGate ?? (rawData?.length ? evaluateQualityGate(rawData, config, data) : null);
  const mappingAudit = precomputedMappingAudit ?? (rawData?.length ? auditMappingCoverage(rawData) : null);
  const family: AnalysisFamily = precomputedFamily ?? assessAnalysisScope(rawData, config).analysisFamily;
  const analysisStatus = precomputedAnalysisStatus ?? deriveAnalysisStatus(qualityGate, valuationReadiness, mappingAudit);
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
    runIdentity: analysisRun
      ? {
          runId: analysisRun.runId,
          reproducibilityHash: analysisRun.reproducibilityHash,
          schemaVersion: analysisRun.schemaVersion,
          executorVersion: analysisRun.executorVersion,
          analysisWindowRef: analysisRun.analysisWindowRef,
          marketSnapshotRef: analysisRun.marketSnapshotRef,
          assumptionSetRef: analysisRun.assumptionSetRef,
          modelResultRefs: analysisRun.modelResultRefs,
        }
      : null,
    family,
    companyId: rawData?.[0]?.company_id ?? null,
    latestRawPeriod,
    latestRecastPeriod: data[data.length - 1]?.period_end ?? null,
    policyVersions,
    qualityGate,
    mappingAudit,
    mappingPromotionCandidates: mappingAudit?.promotionCandidates ?? [],
    valuationReadiness,
    analysisStatus,
    traceability,
    traceabilitySummary: buildValuationTraceabilitySurfaceSummary(traceability),
    provenanceRows: buildProvenanceAuditRows(data),
    granularityChecklist: rawData?.length ? evaluateGranularityChecklist(rawData) : null,
  };
}
