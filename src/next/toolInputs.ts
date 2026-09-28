/**
 * The inputs the Record and Lab tools take, derived from a company's shared
 * run — the one the Case reads — the same way the classic shell derives them
 * (useRunBackedAuditAnalysis, AppShell), so a tool shows the same numbers in
 * both interfaces.
 */
import type { LegacyAnalysisRunExecutionResult } from "../engine/analysisRun";
import { deriveAnalysisStatus, type AnalysisStatusSummary } from "../engine/analysisStatus";
import type { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import type { CapitalineParseDebug } from "../engine/capitalineParser/types";
import type { MappingAuditReport, QualityGateReport } from "../engine/mappingAudit";
import type { PipelineResult } from "../engine/pipeline";
import { getAnalysisPolicyVersions } from "../engine/policyVersions";
import type { EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { CroreShares } from "../engine/types/units";
import type { ValuationReadiness } from "../engine/valuationPolicy";
import { buildAnalysisPublicationSnapshot } from "../lib/publication/analysisPublicationSnapshot";

export interface ToolInputs {
  /** Null when the run has no industrial reformulation (a bank, or a failed run). */
  readonly recastData: RecastPeriod[] | null;
  readonly rawData: RawPeriodData[];
  readonly config: EngineConfig;
  readonly companyId: string | null;
  readonly pipelineResult: PipelineResult | null;
  readonly qualityGate: QualityGateReport | null;
  readonly analysisStatus: AnalysisStatusSummary;
  readonly traceability: AnalysisTraceabilityEnvelope | null;
  readonly publication: ReturnType<typeof buildAnalysisPublicationSnapshot> | null;
  readonly debugInfo: CapitalineParseDebug | null;
  readonly engineError: string | null;
}

/** The mutable view of the materialization the classic panels declare. */
interface Projection {
  readonly rawData: RawPeriodData[];
  readonly config: EngineConfig;
  readonly pipelineResult: PipelineResult | null;
  readonly qualityGate: QualityGateReport | null;
  readonly mappingAudit: MappingAuditReport | null;
  readonly analysisStatus: AnalysisStatusSummary | null;
  readonly valuationReadiness: ValuationReadiness | null;
}

/**
 * The classic shell fills `shares_outstanding` from the latest recast share
 * count when none is set (AppShell), and the tools' per-share figures read it,
 * so the tools do the same.
 */
export function withDerivedShares(config: EngineConfig, periods: readonly RecastPeriod[] | null): EngineConfig {
  if (config.shares_outstanding != null || !periods?.length) return config;
  const snap = periods[periods.length - 1]!.shareCountInput;
  const shares = snap?.weightedAverageDilutedShares ?? snap?.weightedAverageBasicShares ?? snap?.endPeriodShares ?? null;
  return shares != null && shares > 0 ? { ...config, shares_outstanding: CroreShares(shares) } : config;
}

export function buildToolInputs(result: LegacyAnalysisRunExecutionResult, debug: CapitalineParseDebug | null = null): ToolInputs {
  // One copy for the tools: the classic panels declare mutable props, and the
  // run is shared with every Case section (the classic shell's seam does the same).
  const m = structuredClone(result.materialization) as unknown as Projection;
  const periods = m.pipelineResult?.periods ?? [];
  const recastData = periods.length ? periods : null;
  const analysisStatus = m.analysisStatus ?? deriveAnalysisStatus(m.qualityGate, m.valuationReadiness, m.mappingAudit);
  const traceability = result.run ? (structuredClone(result.run.trustEnvelope) as AnalysisTraceabilityEnvelope) : null;
  const config = withDerivedShares(m.config, recastData);
  const publication = recastData && traceability
    ? buildAnalysisPublicationSnapshot({
        data: recastData,
        config,
        rawData: m.rawData,
        auditMeta: null,
        sharedTraceability: traceability,
        qualityGate: m.qualityGate,
        mappingAudit: m.mappingAudit,
        policyVersions: getAnalysisPolicyVersions(),
        analysisStatus,
        family: m.qualityGate?.scopeAssessment.analysisFamily ?? null,
        analysisRun: result.run,
      })
    : null;
  return {
    recastData,
    rawData: m.rawData,
    config,
    companyId: m.rawData[0]?.company_id ?? null,
    pipelineResult: m.pipelineResult,
    qualityGate: m.qualityGate,
    analysisStatus,
    traceability,
    publication,
    debugInfo: debug,
    engineError: result.status === "failed" ? result.message : null,
  };
}
