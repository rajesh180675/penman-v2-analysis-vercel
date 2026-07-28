import { useMemo } from "react";
import { deriveAnalysisStatus, type AnalysisStatusSummary } from "../engine/analysisStatus";
import type { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import type { FinancialInstitutionAnalysisResult } from "../engine/analysisFamily";
import type { BankQualityIndicators } from "../engine/bankQualityIndicators";
import type { CapitalineParseDebug } from "../engine/capitalineParser";
import type { LiveMarketDataSnapshot } from "../engine/marketData";
import type { CanonicalFactIngestionBundle } from "../engine/facts";
import type { MappingAuditReport, QualityGateReport } from "../engine/mappingAudit";
import type { SourceParserDiagnostics } from "../engine/parserDiagnostics";
import type { PipelineResult } from "../engine/pipeline";
import { getAnalysisPolicyVersions } from "../engine/policyVersions";
import { processScopeAwareData, type ScopeAwareResult } from "../engine/scopeAwareLoader";
import type { AllSegmentData } from "../engine/segmentParser";
import type { EngineConfig, CompanyRegistry, RawPeriodData } from "../engine/types";
import type { ValuationCommandCenterOutput } from "../engine/valuationCommandCenter";
import type { ValuationReadiness } from "../engine/valuationPolicy";
import type { SourcedAssumptionSet, UnifiedAnalysisWindow } from "../engine/analysisCase";
import type { IndustrialForecastResult, ScenarioOrderingReport } from "../engine/forecastState";
import type { ScenarioGovernanceReport } from "../engine/valuationEvidence";
import { selectPrimaryValuationData } from "../engine/valuationDataPolicy";
import type { AuditSubmissionMeta } from "../lib/audit";
import { buildAnalysisPublicationSnapshot } from "../lib/publication/analysisPublicationSnapshot";
import { buildComparisonPublicationSnapshot } from "../lib/publication/comparisonPublicationSnapshot";
import { trace } from "../lib/traceLogger";
import { useAnalysisRunExecution } from "./analysisRun";
import type { LegacyAnalysisRunInputV1 } from "../engine/analysisRun";
import type { ScenarioCalibrationObservation, ScenarioCalibrationPolicy } from "../engine/scenarioCalibration";
import type { GovernedSectorSidecarApproval } from "../engine/sectorCases";

const POLICY_VERSIONS = getAnalysisPolicyVersions();

interface LegacyUiRunProjection {
  readonly pipelineResult: PipelineResult | null;
  readonly commandCenter: ValuationCommandCenterOutput | null;
  readonly qualityGate: QualityGateReport | null;
  readonly mappingAudit: MappingAuditReport | null;
  readonly analysisStatus: AnalysisStatusSummary | null;
  readonly valuationReadiness: ValuationReadiness | null;
  readonly analysisWindow: UnifiedAnalysisWindow | null;
  readonly sourcedAssumptionSet: SourcedAssumptionSet | null;
  readonly forecastResults: readonly IndustrialForecastResult[];
  readonly scenarioOrdering: ScenarioOrderingReport | null;
  readonly scenarioGovernance: ScenarioGovernanceReport | null;
}

export interface RunBackedAuditAnalysisInputs {
  readonly rawData: RawPeriodData[] | null;
  readonly standaloneRawData: RawPeriodData[] | null;
  readonly config: EngineConfig;
  readonly bankQuality: BankQualityIndicators | null;
  readonly debugInfo: CapitalineParseDebug | null;
  readonly parserDiagnostics: SourceParserDiagnostics | null;
  readonly auditMeta: AuditSubmissionMeta | null;
  readonly registry: CompanyRegistry;
  readonly liveMarketData: LiveMarketDataSnapshot | null;
  readonly segmentData: AllSegmentData | null;
  readonly canonicalFacts: CanonicalFactIngestionBundle | null;
  readonly scenarioCalibration?: { readonly observations: readonly ScenarioCalibrationObservation[]; readonly policy: ScenarioCalibrationPolicy } | null;
  readonly sectorSidecar?: GovernedSectorSidecarApproval | null;
  readonly advancedModels?: LegacyAnalysisRunInputV1["advancedModels"];
}

/**
 * Transitional UI projection over the immutable AnalysisRun.
 *
 * Existing tabs still declare mutable legacy contracts. Structured cloning is
 * confined to this strangler seam; it does no analysis and prevents a tab from
 * mutating the verified run held by the store.
 */
function buildLegacyUiProjection(value: unknown): LegacyUiRunProjection | null {
  if (!value) return null;
  return structuredClone(value) as LegacyUiRunProjection;
}

/** Run-backed replacement for the former render-time analytical memo chain. */
export function useRunBackedAuditAnalysis(inputs: RunBackedAuditAnalysisInputs) {
  const valuationDataSelection = useMemo(
    () => selectPrimaryValuationData(inputs.rawData, inputs.standaloneRawData),
    [inputs.rawData, inputs.standaloneRawData],
  );
  const valuationRawData = valuationDataSelection?.primaryData ?? inputs.rawData;
  const execution = useAnalysisRunExecution({
    rawData: valuationRawData,
    config: inputs.config,
    bankQuality: inputs.bankQuality,
    debugInfo: inputs.debugInfo,
    parserDiagnostics: inputs.parserDiagnostics,
    auditMeta: inputs.auditMeta,
    marketSnapshot: inputs.liveMarketData,
    segmentData: inputs.segmentData?.business ?? null,
    canonicalFacts: inputs.canonicalFacts,
    scenarioCalibration: inputs.scenarioCalibration ?? null,
    sectorSidecar: inputs.sectorSidecar ?? null,
    advancedModels: inputs.advancedModels ?? null,
  });
  const projection = useMemo(
    () => buildLegacyUiProjection(execution.stored?.materialization ?? null),
    [execution.stored],
  );

  const pipelineResult = projection?.pipelineResult ?? null;
  const allRecastData = pipelineResult?.periods.length ? pipelineResult.periods : null;
  const analysisWindow = projection?.analysisWindow ?? null;
  // Always expose the full recast history to the tabs. The analysis window
  // only governs the valuation command center / forecast anchor — statements,
  // ratios, quality, dashboard, etc. all need the full period range even when
  // the window-selection gate blocks or narrows the valuation anchor.
  // (Previously this filtered by analysisWindow.includedPeriods, which left
  // recastData empty whenever the window was blocked → tabs disappeared.)
  const recastData = allRecastData;
  const qualityGate = projection?.qualityGate ?? null;
  const qualityGateWithRecast = qualityGate;
  const scopeGate = qualityGate;
  const mappingAudit = projection?.mappingAudit ?? null;
  const valuationReadiness = projection?.valuationReadiness ?? null;
  const analysisStatus = projection?.analysisStatus ?? deriveAnalysisStatus(qualityGate, valuationReadiness, mappingAudit);
  const traceability = useMemo(
    () => execution.run
      ? structuredClone(execution.run.trustEnvelope) as AnalysisTraceabilityEnvelope
      : null,
    [execution.run],
  );
  const engineError = execution.error;

  // Dual-scope decomposition remains an explicit overlay until it becomes its
  // own AnalysisRun family artifact. It does not feed the authoritative
  // consolidated valuation or trust decision.
  const scopeAwareResult = useMemo<ScopeAwareResult | null>(() => {
    if (!inputs.rawData?.length || !inputs.standaloneRawData?.length) return null;
    if (scopeGate?.scopeAssessment.blocked) return null;
    try {
      return processScopeAwareData(inputs.rawData, inputs.standaloneRawData, inputs.config, inputs.bankQuality);
    } catch (scopeError) {
      trace("scope", "scopeAwareAnalysis:error", {
        error: String(scopeError),
        stack: (scopeError as Error)?.stack,
      }, null, { level: "error" });
      return null;
    }
  }, [inputs.bankQuality, inputs.config, inputs.rawData, inputs.standaloneRawData, scopeGate]);

  const bankResult: FinancialInstitutionAnalysisResult | null = pipelineResult?.analysisFamily === "financial-institution"
    ? pipelineResult.bankResult ?? null
    : null;
  const structuralBreakPeriods = pipelineResult?.structuralBreakPeriods ?? [];
  const lossMakerResult = pipelineResult?.lossMaker ?? null;
  const itServicesSignal = pipelineResult?.itServices ?? null;
  const cyclicalitySignal = pipelineResult?.cyclicality ?? null;
  const ratioSanity = pipelineResult?.ratioSanity ?? null;
  const latestPeriod = valuationRawData?.at(-1)?.period_end ?? null;
  const publication = useMemo(
    () => recastData?.length && traceability
      ? buildAnalysisPublicationSnapshot({
          data: recastData,
          config: inputs.config,
          rawData: valuationRawData,
          auditMeta: inputs.auditMeta,
          sharedTraceability: traceability,
          qualityGate: qualityGateWithRecast,
          mappingAudit,
          policyVersions: POLICY_VERSIONS,
          analysisStatus,
          family: qualityGateWithRecast?.scopeAssessment.analysisFamily ?? null,
          analysisRun: execution.run,
        })
      : null,
    [analysisStatus, execution.run, inputs.auditMeta, inputs.config, mappingAudit, qualityGateWithRecast, recastData, traceability, valuationRawData],
  );
  const comparisonPublication = useMemo(
    () => buildComparisonPublicationSnapshot(inputs.registry),
    [inputs.registry],
  );
  const portfolioRunComparison = useMemo(() => execution.store.selectPortfolioComparison({
    maximumAsOfSkewDays: 120,
    requireSameRunSchema: true,
    requireSamePolicyBundle: true,
    maximumIssuerWeight: 0.25,
    maximumFamilyWeight: 0.5,
    // `execution.run` is an invalidation key, not a value this callback reads.
    // The store object identity is stable for the session, so without it the
    // comparison would be computed once and never again — while its inputs are
    // the runs inside that store, which change exactly when a new run lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [execution.run, execution.store]);

  return {
    valuationDataSelection,
    valuationRawData,
    qualityGate,
    scopeGate,
    mappingAudit,
    pipelineResult,
    scopeAwareResult,
    bankResult,
    structuralBreakPeriods,
    lossMakerResult,
    itServicesSignal,
    cyclicalitySignal,
    ratioSanity,
    recastData,
    engineError,
    qualityGateWithRecast,
    valuationReadiness,
    analysisStatus,
    policyVersions: POLICY_VERSIONS,
    latestPeriod,
    traceability,
    publication,
    comparisonPublication,
    portfolioRunComparison,
    commandCenter: projection?.commandCenter ?? null,
    analysisWindow,
    sourcedAssumptionSet: projection?.sourcedAssumptionSet ?? null,
    forecastResults: projection?.forecastResults ?? null,
    scenarioOrdering: projection?.scenarioOrdering ?? null,
    scenarioGovernance: projection?.scenarioGovernance ?? null,
    analysisRun: execution.run,
    analysisRunState: execution.state,
    analysisRunProgress: execution.progress,
    analysisRunStore: execution.store,
  };
}
