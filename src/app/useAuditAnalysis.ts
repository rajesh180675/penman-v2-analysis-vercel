import { useMemo } from "react";
import { RawPeriodData, RecastPeriod, EngineConfig, CompanyRegistry } from "../engine/types";
import { processCompanyDataFull } from "../engine/pipeline";
import { processScopeAwareData, type ScopeAwareResult } from "../engine/scopeAwareLoader";
import type { FinancialInstitutionAnalysisResult } from "../engine/analysisFamily";
import { trace } from "../lib/traceLogger";
import { deriveAnalysisStatus } from "../engine/analysisStatus";
import { CapitalineParseDebug } from "../engine/capitalineParser";
import { auditMappingCoverage, evaluateQualityGate } from "../engine/mappingAudit";
import { resolveValuationReadiness } from "../engine/valuationPolicy";
import { selectPrimaryValuationData } from "../engine/valuationDataPolicy";
import { AuditSubmissionMeta } from "../lib/audit";
import { buildAnalysisTraceability } from "../engine/analysisTraceability";
import { buildAnalysisPublicationSnapshot } from "../lib/publication/analysisPublicationSnapshot";
import { buildComparisonPublicationSnapshot } from "../lib/publication/comparisonPublicationSnapshot";
import { getAnalysisPolicyVersions } from "../engine/policyVersions";
import { SourceParserDiagnostics } from "../engine/parserDiagnostics";
import { buildValuationCommandCenter } from "../engine/valuationCommandCenter";

export interface AuditAnalysisInputs {
  rawData: RawPeriodData[] | null;
  standaloneRawData: RawPeriodData[] | null;
  config: EngineConfig;
  bankQuality: Parameters<typeof processCompanyDataFull>[2];
  debugInfo: CapitalineParseDebug | null;
  parserDiagnostics: SourceParserDiagnostics | null;
  auditMeta: AuditSubmissionMeta | null;
  registry: CompanyRegistry;
}

/**
 * The reactive derivation chain extracted verbatim from App.tsx. Every value
 * here is a pure `useMemo` of the inputs above — no local state, no effects.
 * Returned object preserves the exact names the App shell consumed.
 */
export function useAuditAnalysis(inputs: AuditAnalysisInputs) {
  const { rawData, standaloneRawData, config, bankQuality, debugInfo, parserDiagnostics, auditMeta, registry } = inputs;

  const valuationDataSelection = useMemo(
    () => selectPrimaryValuationData(rawData, standaloneRawData),
    [rawData, standaloneRawData],
  );
  const valuationRawData = valuationDataSelection?.primaryData ?? rawData;

  const qualityGate = useMemo(() => {
    if (!valuationRawData || valuationRawData.length === 0) return null;
    return evaluateQualityGate(valuationRawData, config);
  }, [config, valuationRawData]);

  const scopeGate = qualityGate;

  const mappingAudit = useMemo(() => {
    if (!valuationRawData || valuationRawData.length === 0) return null;
    return auditMappingCoverage(valuationRawData);
  }, [valuationRawData]);

  // M2 perf fix: config is a new object on every setConfig call. Use a stable
  // serialized fingerprint so the memo only re-runs when config VALUES change,
  // not just the object reference. This eliminates ~100+ redundant pipeline runs
  // during the multi-setConfig initialization sequence.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const configFingerprint = useMemo(() => JSON.stringify(config), [config]);
  const pipelineResult = useMemo(() => {
    if (!valuationRawData || valuationRawData.length === 0) return null;
    if (scopeGate?.scopeAssessment.blocked) return null;
    try {
      return processCompanyDataFull(valuationRawData, config, bankQuality);
    } catch (err) {
      trace("pipeline", "processCompanyDataFull:error", { error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
      console.error("[App] engine error:", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configFingerprint, valuationRawData, scopeGate, bankQuality]);

  // Phase A — Scope-aware analysis. When standalone data is also loaded,
  // compute the consolidated − standalone gap (subsidiary contribution).
  const scopeAwareResult = useMemo<ScopeAwareResult | null>(() => {
    if (!rawData || rawData.length === 0) return null;
    if (!standaloneRawData || standaloneRawData.length === 0) return null;
    if (scopeGate?.scopeAssessment.blocked) return null;
    try {
      return processScopeAwareData(rawData, standaloneRawData, config, bankQuality);
    } catch (err) {
      trace("scope", "scopeAwareAnalysis:error", { error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
      console.error("[App] scope-aware analysis error:", err);
      return null;
    }
  }, [rawData, standaloneRawData, config, scopeGate, bankQuality]);

  // Bank/NBFC pipeline result. Carries Phase B4 valuation bundle.
  const bankResult = useMemo<FinancialInstitutionAnalysisResult | null>(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    if (pipelineResult.analysisFamily !== "financial-institution") return null;
    return pipelineResult.bankResult ?? null;
  }, [pipelineResult]);

  // Phase I9 — structural break periods from S-5.1 STRUCTURAL_EVENT flags.
  const structuralBreakPeriods = useMemo<string[]>(() => {
    if (!pipelineResult || "error" in pipelineResult) return [];
    return pipelineResult.structuralBreakPeriods ?? [];
  }, [pipelineResult]);

  // Phase I3 — loss-maker valuation anchors.
  const lossMakerResult = useMemo(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    return pipelineResult.lossMaker ?? null;
  }, [pipelineResult]);

  // Phase E1 — IT-services fingerprint.
  const itServicesSignal = useMemo(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    return pipelineResult.itServices ?? null;
  }, [pipelineResult]);

  // Phase F — Cyclicality assessment.
  const cyclicalitySignal = useMemo(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    return pipelineResult.cyclicality ?? null;
  }, [pipelineResult]);

  // Phase 9 — anchor ratio bands.
  const ratioSanity = useMemo(() => {
    if (!pipelineResult || "error" in pipelineResult) return null;
    return pipelineResult.ratioSanity ?? null;
  }, [pipelineResult]);

  // Derive recastData reactively. Any config change immediately re-computes.
  const recastOutcome = useMemo<{ data: RecastPeriod[] | null; error: string | null }>(() => {
    if (!valuationRawData || valuationRawData.length === 0) return { data: null, error: null };
    if (scopeGate?.scopeAssessment.blocked) {
      return {
        data: null,
        error: scopeGate.scopeAssessment.reasons[0] ?? "Unsupported dataset scope for the industrial Penman-Nissim engine.",
      };
    }
    if (!pipelineResult) return { data: null, error: null };
    if ("error" in pipelineResult) return { data: null, error: pipelineResult.error };
    return {
      data: pipelineResult.periods.length > 0 ? pipelineResult.periods : null,
      error: null,
    };
  }, [pipelineResult, valuationRawData, scopeGate]);

  const recastData = recastOutcome.data;
  const engineError = recastOutcome.error;
  const qualityGateWithRecast = useMemo(() => {
    if (!valuationRawData || valuationRawData.length === 0) return null;
    return evaluateQualityGate(valuationRawData, config, recastData);
  }, [config, valuationRawData, recastData]);
  const valuationReadiness = useMemo(() => (recastData?.length ? resolveValuationReadiness(recastData) : null), [recastData]);
  const analysisStatus = useMemo(
    () => deriveAnalysisStatus(qualityGateWithRecast, valuationReadiness, mappingAudit),
    [mappingAudit, qualityGateWithRecast, valuationReadiness],
  );
  const valuationTriangulation = useMemo(() => {
    if (!recastData?.length) return null;
    try {
      return buildValuationCommandCenter({
        data: recastData,
        config,
        analysisStatus,
      }).valuationTriangulation;
    } catch (err) {
      trace("valuation", "valuationTriangulation:error", { error: String(err), stack: (err as Error)?.stack }, null, { level: "warn" });
      return null;
    }
  }, [analysisStatus, config, recastData]);
  const policyVersions = useMemo(() => getAnalysisPolicyVersions(), []);
  const latestPeriod = valuationRawData && valuationRawData.length > 0 ? valuationRawData[valuationRawData.length - 1]!.period_end : null;
  const traceability = useMemo(
    () => buildAnalysisTraceability({
      runId: auditMeta?.runId ?? null,
      companyId: valuationRawData?.[0]?.company_id ?? rawData?.[0]?.company_id ?? null,
      sourceMode: auditMeta?.sourceMode ?? null,
      rawData: valuationRawData,
      recastData,
      config,
      periodCount: valuationRawData?.length ?? 0,
      recastPeriodCount: recastData?.length ?? 0,
      latestPeriod,
      qualityGate: qualityGateWithRecast,
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
      bankMetrics: bankResult?.bankMetrics ?? null,
      bankSubtype: bankResult?.subtype ?? null,
      valuationTriangulation,
    }),
    [analysisStatus, auditMeta, config, debugInfo, engineError, latestPeriod, mappingAudit, parserDiagnostics, policyVersions, qualityGateWithRecast, valuationRawData, rawData, recastData, bankResult, valuationTriangulation],
  );
  const publication = useMemo(
    () => (recastData?.length
      ? buildAnalysisPublicationSnapshot({
        data: recastData,
        config,
        rawData: valuationRawData,
        auditMeta,
        sharedTraceability: traceability,
        qualityGate: qualityGateWithRecast,
        mappingAudit,
        policyVersions,
        analysisStatus,
        family: qualityGateWithRecast?.scopeAssessment.analysisFamily ?? null,
      })
      : null),
    [analysisStatus, auditMeta, config, mappingAudit, policyVersions, qualityGateWithRecast, valuationRawData, recastData, traceability],
  );
  const comparisonPublication = useMemo(
    () => buildComparisonPublicationSnapshot(registry),
    [registry],
  );

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
    policyVersions,
    latestPeriod,
    traceability,
    publication,
    comparisonPublication,
  };
}
