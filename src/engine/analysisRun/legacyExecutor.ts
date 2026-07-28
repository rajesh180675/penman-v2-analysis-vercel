import { deriveAnalysisStatus, type AnalysisStatusSummary } from "../analysisStatus";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { evaluateAnalyticalDepth } from "../analyticalDepth";
import { buildAssumptionProvenance } from "../assumptionProvenance";
import { buildEarningsQualitySummary } from "../earningsQualitySummary";
import type { BankQualityIndicators } from "../bankQualityIndicators";
import type { CapitalineParseDebug, SourceArtifactHash } from "../capitalineParser";
import { auditMappingCoverage, evaluateQualityGate, type MappingAuditReport, type QualityGateReport } from "../mappingAudit";
import type { LiveMarketDataSnapshot } from "../marketData";
import type { SourceParserDiagnostics } from "../parserDiagnostics";
import { processCompanyDataFull, type PipelineResult } from "../pipeline";
import { getAnalysisPolicyVersions } from "../policyVersions";
import type { SegmentData } from "../segmentParser";
import type { AnalysisTraceabilityEnvelope, EngineConfig, RawPeriodData, RecastPeriod } from "../types";
import { validateEngineConfig } from "../types";
import { buildValuationCommandCenter, type ValuationCommandCenterOutput } from "../valuationCommandCenter";
import type { EquityBetaPack, MacroPack } from "../marketPacks";
import {
  adaptLegacyCommandCenterModelResults,
  CURRENT_MODEL_REGISTRY,
  generateModelCatalog,
  type ValuationModelResult as CatalogValuationModelResult,
} from "../modelCatalog";
import {
  buildHoldoutVintageIndex,
  buildScenarioGovernanceReport,
  summarizeAntiTautology,
  type EvidenceWeightedValuationSynthesis,
  type ScenarioGovernanceReport,
} from "../valuationEvidence";
import { resolveValuationReadiness, type ValuationReadiness } from "../valuationPolicy";
import {
  selectUnifiedAnalysisWindow,
  selectFamilyPeriodAnalysisWindow,
  resolveSourcedAssumptionSet,
  resolveAnalysisAssumptions,
  type AssumptionCandidate,
  type AssumptionResolutionOutput,
  type SourcedAssumptionSet,
  type UnifiedAnalysisWindow,
} from "../analysisCase";
import {
  buildIndustrialForecastFromLegacyScenario,
  validateIndustrialScenarioOrdering,
  type IndustrialForecastResult,
  type ScenarioOrderingReport,
} from "../forecastState";
import {
  applyScenarioCalibration,
  calibrateScenarioProbabilities,
  type ScenarioCalibrationObservation,
  type ScenarioCalibrationPolicy,
  type ScenarioCalibrationReport,
} from "../scenarioCalibration";
import { CURRENT_SECTOR_CASE_REGISTRY, executeCatalogSectorCase, type GovernedSectorSidecarApproval, type SectorCaseCatalogExecutionResult } from "../sectorCases";
import { applyRealOptionsCompositionCandidate, evaluateModelPromotion, evaluateRealOptionsCompositionCandidate, executeGovernedAdvancedModel, type ApprovedRealOptionsCompositionPolicy, type GovernedAdvancedModelInput, type GovernedAdvancedModelResult, type ModelPromotionDecision, type ModelPromotionDossier, type RealOptionsCompositionCandidate } from "../advancedModelGovernance";
import {
  adaptLegacyRawPeriodsToFactSet,
  type FactSet,
  type LegacyConceptMapping,
  type LegacyPeriodSource,
  type SourceArtifact,
  TransformationRecorder,
  type TransformationDag,
} from "../facts";
import { snapshotFlags } from "../../lib/featureFlags";
import {
  ANALYSIS_RUN_SCHEMA_VERSION,
  ANALYSIS_STAGE_ORDER,
  type AnalysisFamily,
  type AnalysisRunRelation,
  type AnalysisRunV1,
  type AnalysisStageId,
  type AnalysisStageResult,
  type AnalysisWindow,
  type ContentRef,
  type DeepReadonly,
  type GateCheck,
  type GateResult,
  type Sha256ContentId,
} from "./contracts";
import { createAnalysisContentArtifact, type AnalysisContentArtifact } from "./contentRefs";
import { createAnalysisRunV1 } from "./identity";

export const LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION = "2026-07-legacy-analysis-run-v1" as const;

export interface LegacyAnalysisRunMetadataV1 {
  readonly runId: string;
  readonly issuerId: string;
  /** Valuation/publication cutoff. It is analytical content and participates in the run hash. */
  readonly asOf: string;
  /** Pinned instance timestamp; never read from the executor's clock. */
  readonly createdAt: string;
  /** Pinned envelope timestamp; excluded from reproducibility identity as volatile metadata. */
  readonly generatedAt: string;
  readonly sourceMode: string;
  readonly relation?: AnalysisRunRelation | undefined;
  readonly sourceArtifactIds?: readonly Sha256ContentId[] | undefined;
  readonly contentClass?: string | null | undefined;
  readonly retentionDays?: number | null | undefined;
  readonly runInspectorEnabled?: boolean | null | undefined;
}

/**
 * Fully pinned legacy input. No clock, market fetch, React state, or storage
 * lookup occurs inside the executor.
 */
export interface LegacyAnalysisRunInputV1 {
  readonly rawData: readonly DeepReadonly<RawPeriodData>[];
  readonly config: DeepReadonly<EngineConfig>;
  readonly marketSnapshot?: DeepReadonly<LiveMarketDataSnapshot> | null | undefined;
  readonly segmentData?: DeepReadonly<SegmentData> | null | undefined;
  readonly bankQuality?: DeepReadonly<BankQualityIndicators> | null | undefined;
  readonly sourceArtifactHashes?: readonly DeepReadonly<SourceArtifactHash>[] | null | undefined;
  readonly debugInfo?: DeepReadonly<CapitalineParseDebug> | null | undefined;
  readonly parserDiagnostics?: DeepReadonly<SourceParserDiagnostics> | null | undefined;
  /** Optional native fact materialization; absent inputs remain honestly legacy-derived. */
  readonly canonicalFacts?: {
    readonly sourceArtifacts: readonly DeepReadonly<SourceArtifact>[];
    readonly periodSources: Readonly<Record<string, DeepReadonly<LegacyPeriodSource>>>;
    readonly conceptMappings: readonly DeepReadonly<LegacyConceptMapping>[];
  } | null | undefined;
  readonly scenarioCalibration?: {
    readonly observations: readonly DeepReadonly<ScenarioCalibrationObservation>[];
    readonly policy: DeepReadonly<ScenarioCalibrationPolicy>;
  } | null | undefined;
  /**
   * Pinned macro pack supplying a dated risk-free rate and ERP.
   *
   * Optional and absent by default: with no pack the capital-cost assumptions
   * resolve to engine constants tiered `prior`, which is exactly what every
   * existing run already produced. Supplying one is an opt-in claim that these
   * inputs are dated observations, checked against `metadata.asOf` for staleness
   * and look-ahead before it is honoured.
   *
   * It does not need separate hash treatment: a different pack resolves a
   * different `ke`/`kw`, those are assumption candidates, and the candidate set
   * already feeds `assumptionSetId` and therefore the reproducibility hash.
   */
  readonly macroPack?: MacroPack | null | undefined;
  /**
   * Pinned regressed betas, looked up by `config.ticker`.
   *
   * Same opt-in contract as `macroPack`, and the same hash argument: a different
   * pack resolves a different `ke`/`kw`, those are assumption candidates, and the
   * candidate set already feeds `assumptionSetId` and therefore the run's
   * reproducibility hash. So a run is not reproducible-by-accident across packs.
   */
  readonly betaPack?: EquityBetaPack | null | undefined;
  readonly sectorSidecar?: DeepReadonly<GovernedSectorSidecarApproval> | null | undefined;
  readonly advancedModels?: readonly {
    readonly request: DeepReadonly<GovernedAdvancedModelInput>;
    readonly dossier: DeepReadonly<ModelPromotionDossier> | null;
    readonly dossierHash?: string | null;
    readonly compositionPolicy?: DeepReadonly<ApprovedRealOptionsCompositionPolicy> | null;
  }[] | null | undefined;
  readonly metadata: LegacyAnalysisRunMetadataV1;
}

export interface LegacyAnalysisRunDiagnostic {
  readonly code: string;
  readonly stage: AnalysisStageId;
  readonly severity: "warning" | "blocker" | "error";
  readonly message: string;
}

/** Ephemeral migration payloads. A persistence adapter can store them by `ref`. */
export interface LegacyAnalysisRunMaterializationV1 {
  readonly rawData: readonly DeepReadonly<RawPeriodData>[];
  readonly config: DeepReadonly<EngineConfig>;
  readonly marketSnapshot: DeepReadonly<LiveMarketDataSnapshot> | null;
  readonly segmentData: DeepReadonly<SegmentData> | null;
  readonly bankQuality: DeepReadonly<BankQualityIndicators> | null;
  readonly sourceArtifactHashes: readonly DeepReadonly<SourceArtifactHash>[] | null;
  readonly debugInfo: DeepReadonly<CapitalineParseDebug> | null;
  readonly parserDiagnostics: DeepReadonly<SourceParserDiagnostics> | null;
  readonly factSet: DeepReadonly<FactSet> | null;
  readonly pipelineResult: DeepReadonly<PipelineResult> | null;
  readonly commandCenter: DeepReadonly<ValuationCommandCenterOutput> | null;
  readonly modelResults: readonly DeepReadonly<CatalogValuationModelResult>[];
  readonly qualityGate: DeepReadonly<QualityGateReport> | null;
  readonly mappingAudit: DeepReadonly<MappingAuditReport> | null;
  readonly analysisStatus: DeepReadonly<AnalysisStatusSummary> | null;
  readonly valuationReadiness: DeepReadonly<ValuationReadiness> | null;
  readonly analysisWindow: DeepReadonly<AnalysisWindow> | null;
  readonly transformationDag: DeepReadonly<TransformationDag> | null;
  readonly sourcedAssumptionSet: DeepReadonly<SourcedAssumptionSet> | null;
  readonly forecastResults: readonly DeepReadonly<IndustrialForecastResult>[];
  readonly scenarioOrdering: DeepReadonly<ScenarioOrderingReport> | null;
  readonly scenarioGovernance: DeepReadonly<ScenarioGovernanceReport> | null;
  readonly scenarioCalibration: DeepReadonly<ScenarioCalibrationReport> | null;
  readonly sectorCaseExecution: DeepReadonly<SectorCaseCatalogExecutionResult> | null;
  readonly advancedModelExecutions: readonly DeepReadonly<{
    readonly request: GovernedAdvancedModelInput;
    readonly promotionDossierHash: string | null;
    readonly promotionDossier: ModelPromotionDossier | null;
    readonly promotion: ModelPromotionDecision;
    readonly result: GovernedAdvancedModelResult;
    readonly compositionPolicy: ApprovedRealOptionsCompositionPolicy | null;
    readonly compositionCandidate: RealOptionsCompositionCandidate | null;
  }>[];
}

interface LegacyExecutionResultBase {
  readonly artifacts: readonly AnalysisContentArtifact[];
  readonly diagnostics: readonly LegacyAnalysisRunDiagnostic[];
  readonly materialization: LegacyAnalysisRunMaterializationV1;
}

export type LegacyAnalysisRunExecutionResult =
  | (LegacyExecutionResultBase & {
      readonly status: "completed";
      readonly run: AnalysisRunV1;
    })
  | (LegacyExecutionResultBase & {
      readonly status: "blocked";
      readonly run: AnalysisRunV1;
      readonly reasonCode: string;
    })
  | (LegacyExecutionResultBase & {
      readonly status: "failed";
      readonly run: AnalysisRunV1 | null;
      readonly errorCode: string;
      readonly message: string;
    });

/** @internal Dependency seam used by deterministic contract tests. */
export interface LegacyAnalysisRunExecutorDependencies {
  readonly processPipeline: typeof processCompanyDataFull;
  readonly evaluateQualityGate: typeof evaluateQualityGate;
  readonly auditMappingCoverage: typeof auditMappingCoverage;
  readonly resolveValuationReadiness: typeof resolveValuationReadiness;
  readonly deriveAnalysisStatus: typeof deriveAnalysisStatus;
  readonly buildCommandCenter: typeof buildValuationCommandCenter;
  readonly buildTraceability: typeof buildAnalysisTraceability;
  readonly selectAnalysisWindow: typeof selectUnifiedAnalysisWindow;
  readonly evaluateAnalyticalDepth: typeof evaluateAnalyticalDepth;
  readonly summarizeAntiTautology: typeof summarizeAntiTautology;
  readonly getPolicyVersions: typeof getAnalysisPolicyVersions;
  readonly snapshotFlags: typeof snapshotFlags;
  readonly validateConfig: typeof validateEngineConfig;
  /** P6 Stage 9 — native assumption resolution. */
  readonly resolveAssumptions: typeof resolveAnalysisAssumptions;
}

const DEFAULT_DEPENDENCIES: LegacyAnalysisRunExecutorDependencies = {
  processPipeline: processCompanyDataFull,
  evaluateQualityGate,
  auditMappingCoverage,
  resolveValuationReadiness,
  deriveAnalysisStatus,
  buildCommandCenter: buildValuationCommandCenter,
  buildTraceability: buildAnalysisTraceability,
  selectAnalysisWindow: selectUnifiedAnalysisWindow,
  evaluateAnalyticalDepth,
  summarizeAntiTautology,
  getPolicyVersions: getAnalysisPolicyVersions,
  snapshotFlags,
  validateConfig: validateEngineConfig,
  resolveAssumptions: resolveAnalysisAssumptions,
};

interface TerminalOutcome {
  readonly kind: "blocked" | "failed";
  readonly stage: AnalysisStageId;
  readonly code: string;
  readonly message: string;
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlain(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) clone[key] = clonePlain(nested);
    return clone as T;
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidIsoDate(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function dateOnlyTime(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T23:59:59.999Z`);
    return parsed.toISOString().slice(0, 10) === value ? parsed.getTime() : Number.NaN;
  }
  return Date.parse(value);
}

function sortedRawInput(rawData: readonly DeepReadonly<RawPeriodData>[]): RawPeriodData[] {
  return clonePlain([...rawData] as RawPeriodData[]).sort(
    (left, right) => left.period_end.localeCompare(right.period_end) || left.company_id.localeCompare(right.company_id),
  );
}

function validateInput(
  input: LegacyAnalysisRunInputV1,
  configWarnings: ReturnType<typeof validateEngineConfig>,
): LegacyAnalysisRunDiagnostic[] {
  const diagnostics: LegacyAnalysisRunDiagnostic[] = [];
  const requiredText: Array<[string, string]> = [
    ["RUN_ID_REQUIRED", input.metadata.runId],
    ["ISSUER_ID_REQUIRED", input.metadata.issuerId],
    ["AS_OF_REQUIRED", input.metadata.asOf],
    ["SOURCE_MODE_REQUIRED", input.metadata.sourceMode],
  ];
  for (const [code, value] of requiredText) {
    if (!value?.trim()) diagnostics.push({ code, stage: "request-validation", severity: "blocker", message: `${code.replace(/_/g, " ").toLowerCase()}.` });
  }
  for (const [code, value] of [
    ["CREATED_AT_INVALID", input.metadata.createdAt],
    ["GENERATED_AT_INVALID", input.metadata.generatedAt],
  ] as const) {
    if (!isValidIsoDate(value)) diagnostics.push({ code, stage: "request-validation", severity: "blocker", message: `${code.replace(/_/g, " ").toLowerCase()}: ${value || "<empty>"}.` });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.metadata.asOf) || !Number.isFinite(dateOnlyTime(input.metadata.asOf))) {
    diagnostics.push({ code: "AS_OF_INVALID", stage: "request-validation", severity: "blocker", message: "Run asOf must be a valid YYYY-MM-DD date." });
  }
  const asOfTime = dateOnlyTime(input.metadata.asOf);
  if (input.rawData.some((period) => !Number.isFinite(dateOnlyTime(period.period_end)) || dateOnlyTime(period.period_end) > asOfTime)) {
    diagnostics.push({ code: "RAW_PERIOD_AFTER_AS_OF", stage: "request-validation", severity: "blocker", message: "Raw periods after the pinned run asOf date are prohibited." });
  }
  for (const [code, value] of [
    ["MARKET_PRICE_AFTER_AS_OF", input.marketSnapshot?.priceAsOf],
    ["MARKET_RATE_AFTER_AS_OF", input.marketSnapshot?.rateAsOf],
  ] as const) {
    if (value && (!Number.isFinite(dateOnlyTime(value)) || dateOnlyTime(value) > asOfTime)) diagnostics.push({ code, stage: "request-validation", severity: "blocker", message: `${code.replace(/_/g, " ").toLowerCase()}.` });
  }
  if (input.marketSnapshot?.price != null && !input.marketSnapshot.priceAsOf) diagnostics.push({ code: "MARKET_PRICE_DATE_REQUIRED", stage: "request-validation", severity: "blocker", message: "A market price requires a pinned priceAsOf date." });
  if (input.marketSnapshot?.riskFreeRate != null && !input.marketSnapshot.rateAsOf) diagnostics.push({ code: "MARKET_RATE_DATE_REQUIRED", stage: "request-validation", severity: "blocker", message: "A risk-free rate requires a pinned rateAsOf date." });
  if (input.marketSnapshot?.history?.points.some((point) => !Number.isFinite(dateOnlyTime(point.date)) || dateOnlyTime(point.date) > asOfTime)) {
    diagnostics.push({ code: "MARKET_HISTORY_AFTER_AS_OF", stage: "request-validation", severity: "blocker", message: "Market history contains observations after the pinned run asOf date." });
  }
  if (input.scenarioCalibration && (!Number.isFinite(dateOnlyTime(input.scenarioCalibration.policy.calibrationAsOf)) || dateOnlyTime(input.scenarioCalibration.policy.calibrationAsOf) > asOfTime)) {
    diagnostics.push({ code: "CALIBRATION_AFTER_AS_OF", stage: "request-validation", severity: "blocker", message: "Scenario calibration cutoff cannot be later than the run asOf date." });
  }
  if (input.rawData.length === 0) {
    diagnostics.push({ code: "RAW_INPUT_EMPTY", stage: "request-validation", severity: "blocker", message: "At least one raw period is required." });
  }
  const companyIds = new Set(input.rawData.map((period) => period.company_id).filter(Boolean));
  if (companyIds.size > 1) {
    diagnostics.push({ code: "MULTIPLE_ISSUERS_IN_RAW_INPUT", stage: "request-validation", severity: "blocker", message: "A single AnalysisRun cannot mix raw periods from multiple issuers." });
  }
  if (companyIds.size === 1 && !companyIds.has(input.metadata.issuerId)) {
    diagnostics.push({ code: "ISSUER_ID_MISMATCH", stage: "request-validation", severity: "blocker", message: "Pinned issuerId must match the raw-period issuer identity." });
  }
  for (const warning of configWarnings) {
    diagnostics.push({
      code: `CONFIG_${warning.field.toUpperCase()}_${warning.severity.toUpperCase()}`,
      stage: "request-validation",
      severity: warning.severity === "error" ? "blocker" : "warning",
      message: warning.message,
    });
  }
  const contentIds = input.metadata.sourceArtifactIds ?? [];
  if (contentIds.some((id) => !/^sha256:[0-9a-f]{64}$/i.test(id))) {
    diagnostics.push({ code: "SOURCE_ARTIFACT_ID_INVALID", stage: "request-validation", severity: "blocker", message: "Source artifact identities must be algorithm-prefixed SHA-256 digests." });
  }
  const sourceHashes = [
    ...(input.sourceArtifactHashes ?? []),
    ...(input.debugInfo?.sourceArtifactHashes ?? []),
  ];
  if (sourceHashes.some((artifact) => !/^[0-9a-f]{64}$/i.test(artifact.sha256))) {
    diagnostics.push({ code: "SOURCE_ARTIFACT_HASH_INVALID", stage: "request-validation", severity: "blocker", message: "Parser source-artifact hashes must be 64-character SHA-256 hex digests." });
  }
  return diagnostics;
}

function terminalFromDiagnostics(diagnostics: readonly LegacyAnalysisRunDiagnostic[]): TerminalOutcome | null {
  const blocker = diagnostics.find((diagnostic) => diagnostic.severity === "blocker" || diagnostic.severity === "error");
  if (!blocker) return null;
  return {
    kind: blocker.severity === "error" ? "failed" : "blocked",
    stage: blocker.stage,
    code: blocker.code,
    message: blocker.message,
  };
}

function normalizeSourceArtifactIds(input: LegacyAnalysisRunInputV1): Sha256ContentId[] {
  const ids = new Set<string>();
  for (const id of input.metadata.sourceArtifactIds ?? []) ids.add(id.toLowerCase());
  for (const artifact of input.sourceArtifactHashes ?? []) ids.add(`sha256:${artifact.sha256.toLowerCase()}`);
  for (const artifact of input.debugInfo?.sourceArtifactHashes ?? []) ids.add(`sha256:${artifact.sha256.toLowerCase()}`);
  for (const artifact of input.canonicalFacts?.sourceArtifacts ?? []) ids.add(artifact.artifactId.toLowerCase());
  return [...ids].sort() as Sha256ContentId[];
}

function resolveFamily(pipeline: PipelineResult | null): AnalysisFamily | null {
  if (!pipeline) return null;
  if (pipeline.analysisFamily === "industrial") {
    if (pipeline.pipelineStrategyId === "telecom-v1") return "telecom";
    if (pipeline.pipelineStrategyId === "utility-v1") return "utility";
    return "industrial";
  }
  switch (pipeline.bankResult?.subtype) {
    case "bank": return "bank";
    case "nbfc": return "nbfc";
    case "insurance": return "insurance";
    default: return null;
  }
}

function sectorInputFamily(sidecar: GovernedSectorSidecarApproval): AnalysisFamily {
  switch (sidecar.caseInput.companyType) {
    case "bank": return "bank";
    case "nbfc": return "nbfc";
    case "insurance": return "insurance";
    case "telecom": return "telecom";
    case "utility": return "utility";
    default: return "industrial";
  }
}

function modelTransformationId(modelId: string, caseId: string | null, index: number): string {
  return `legacy-model:${index}:${modelId}:${caseId ?? "consolidated"}`;
}

async function buildLegacyTransformationDag(params: {
  readonly factSet: FactSet;
  readonly pipelineResult: PipelineResult | null;
  readonly modelResults: readonly CatalogValuationModelResult[];
  readonly hasSynthesis: boolean;
  readonly synthesis: EvidenceWeightedValuationSynthesis | null;
  readonly policyRef: ContentRef<"policy-bundle">;
  readonly sourceArtifactIds: readonly Sha256ContentId[];
}): Promise<TransformationDag> {
  const recorder = new TransformationRecorder();
  for (const fact of params.factSet.facts) recorder.addRootFact(fact.factId);
  const recastOutputs = params.pipelineResult?.periods.flatMap((period) => [
    `derived:${period.period_end}:cse`,
    `derived:${period.period_end}:noa`,
    `derived:${period.period_end}:nfo`,
    `derived:${period.period_end}:cni`,
    `derived:${period.period_end}:core-oi`,
  ]) ?? [];
  if (recastOutputs.length) {
    await recorder.record({
      transformationId: "legacy-pipeline:recast",
      functionId: "processCompanyDataFull",
      functionVersion: LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION,
      inputFactIds: params.factSet.facts.map((fact) => fact.factId),
      outputFactIds: recastOutputs,
      policyRefs: [params.policyRef.contentHash],
      evidenceRefs: params.sourceArtifactIds,
      parameters: { derivationMode: "legacy-derived", periodCount: params.pipelineResult?.periods.length ?? 0 },
    });
  }
  const modelOutputs: string[] = [];
  for (const [index, modelResult] of params.modelResults.entries()) {
    if (modelResult.status !== "computed") continue;
    const transformationId = modelTransformationId(modelResult.modelId, modelResult.caseId, index);
    const outputId = `valuation-output:${transformationId}`;
    modelOutputs.push(outputId);
    await recorder.record({
      transformationId,
      functionId: modelResult.modelId,
      functionVersion: modelResult.modelVersion,
      inputFactIds: recastOutputs,
      outputFactIds: [outputId],
      policyRefs: [params.policyRef.contentHash],
      evidenceRefs: modelResult.evidenceRefs.length ? modelResult.evidenceRefs : params.sourceArtifactIds,
      parameters: { caseId: modelResult.caseId, unit: modelResult.unit },
    });
  }
  if (params.hasSynthesis && modelOutputs.length) {
    const composition = params.synthesis?.compositionDiagnostics;
    await recorder.record({
      transformationId: "legacy-synthesis:evidence-weighted",
      functionId: "buildEvidenceWeightedSynthesis",
      functionVersion: LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION,
      inputFactIds: modelOutputs,
      outputFactIds: ["synthesis:legacy-headline"],
      policyRefs: [params.policyRef.contentHash],
      evidenceRefs: [...new Set([...params.sourceArtifactIds, ...(composition?.dossierHashes ?? [])])],
      parameters: {
        computedModelCount: modelOutputs.length,
        compositionPolicyVersion: composition?.policyVersion ?? null,
        appliedCompositionCount: composition?.appliedCount ?? 0,
        compositionCountingPolicy: composition?.countingPolicy ?? null,
      },
    });
  }
  const finalized = await recorder.finalize();
  if (finalized.ok === false) {
    throw new Error(finalized.errors.map((error) => `${error.code}: ${error.message}`).join("; "));
  }
  return finalized.value;
}

function pointDistribution(value: number) {
  return { family: "point" as const, parameters: { value } };
}

/**
 * P6 Stage 9: the capital-cost and market candidates now come from the native
 * `resolveAnalysisAssumptions` stage instead of being read back off
 * `commandCenter.costOfCapital`. The growth candidates below still read the
 * monolith's base scenario card, because terminal growth and the year-1
 * drivers are forecast output (Stage 10) and cannot be derived here without
 * inventing a second, unvalidated derivation route.
 *
 * Candidate ORDER is load-bearing and unchanged: ke, kw, growth, market price.
 * The array order feeds `assumptionSetId`, which feeds each run's
 * `reproducibilityHash`, so reordering would make already-stored runs stop
 * matching a re-run of identical data.
 */
function buildRunAssumptionCandidates(params: {
  readonly resolution: AssumptionResolutionOutput;
  readonly commandCenter: ValuationCommandCenterOutput;
  readonly config: EngineConfig;
  readonly window: UnifiedAnalysisWindow;
  readonly factRef: ContentRef<"fact-set">;
  readonly policyRef: ContentRef<"policy-bundle">;
}): AssumptionCandidate<unknown>[] {
  const included = params.window.includedPeriods;
  const periodWindow = included.length
    ? { from: included[0]!, to: included[included.length - 1]!, observations: included.length }
    : null;
  const base = params.commandCenter.scenarios.find((scenario) => scenario.key === "base");
  const candidates: AssumptionCandidate<unknown>[] = [...params.resolution.capitalCandidates];
  if (base) {
    const g = base.assumptions.g;
    candidates.push({
      assumptionId: "terminal-growth",
      key: "g_terminal",
      value: g,
      unit: "FRACTION",
      mode: params.config.g_terminal_override != null ? "manual-override" : "sector-prior",
      evidenceRefs: params.config.g_terminal_override != null ? [] : [params.policyRef],
      periodWindow: null,
      range: { low: params.config.g_terminal_floor ?? 0.02, high: params.config.g_terminal_cap ?? 0.06, method: "configured-policy-band" },
      distribution: pointDistribution(g),
      confidence: params.config.g_terminal_override != null ? "medium" : "high",
      reviewerState: params.config.g_terminal_override != null ? "overridden" : "system",
      required: true,
    });
    for (const [key, value] of [
      ["sales-growth-year-1", base.assumptions.salesGrowthYear1],
      ["core-margin-year-1", base.assumptions.corePmYear1],
      ["asset-turnover-year-1", base.scenario.drivers.ato[0] ?? Number.NaN],
    ] as const) {
      candidates.push({
        assumptionId: key,
        key,
        value,
        unit: key === "asset-turnover-year-1" ? "RATIO" : "FRACTION",
        mode: "derived",
        evidenceRefs: [params.factRef],
        periodWindow,
        range: null,
        distribution: pointDistribution(value),
        confidence: Number.isFinite(value) ? "medium" : "unavailable",
        reviewerState: "system",
        required: true,
      });
    }
  }
  candidates.push(...params.resolution.marketCandidates);
  return candidates;
}

function buildRunForecastResults(params: {
  readonly commandCenter: ValuationCommandCenterOutput;
  readonly latest: RecastPeriod;
  readonly config: EngineConfig;
  readonly window: UnifiedAnalysisWindow;
  readonly assumptions: SourcedAssumptionSet;
  readonly factRef: ContentRef<"fact-set">;
}): IndustrialForecastResult[] {
  return params.commandCenter.scenarios.map((card) => buildIndustrialForecastFromLegacyScenario({
    caseId: card.key,
    label: card.label,
    scenario: card.scenario,
    latest: params.latest,
    config: params.config,
    analysisWindowId: params.window.windowId,
    assumptionIds: params.assumptions.intrinsicEligibleAssumptionIds,
    evidenceRefs: [params.factRef.contentHash],
    // Legacy scenario weights are policy weights, not calibrated empirical
    // likelihoods. Keep the native probability field null until calibration
    // evidence exists instead of relabeling a heuristic as probability.
    probabilityStatus: "not-assigned",
    probabilityRationale: card.forecastPolicy?.scenarioWeightRationale?.join(" ")
      || "Legacy scenario weights are not calibrated likelihoods and are intentionally excluded from ForecastState probability.",
  }));
}

function checkpointStage(level: AnalysisTraceabilityEnvelope["rigor"]["checkpoints"][number]["level"]): AnalysisStageId {
  switch (level) {
    case "syntactically-valid": return "fact-extraction";
    case "structurally-reconciled": return "structural-reconciliation";
    case "economically-plausible": return "economic-validation";
    case "valuation-eligible": return "model-execution";
    case "production-ready": return "release-trust";
  }
}

/**
 * The structural envelope is assembled by the legacy traceability builder,
 * while several native gates now run later in the AnalysisRun executor. Keep
 * the shared trust signal monotonic: a downstream fail-closed result may
 * demote trust, but it can never leave an earlier production-ready verdict in
 * place or manufacture an earlier rigor achievement.
 */
function applyTerminalOutcomeToEnvelope(
  envelope: AnalysisTraceabilityEnvelope,
  terminal: TerminalOutcome | null,
): AnalysisTraceabilityEnvelope {
  if (!terminal) return envelope;

  const terminalStageIndex = ANALYSIS_STAGE_ORDER.indexOf(terminal.stage);
  let prefixCleared = true;
  const checkpoints = envelope.rigor.checkpoints.map((checkpoint) => {
    const checkpointIndex = ANALYSIS_STAGE_ORDER.indexOf(checkpointStage(checkpoint.level));
    const invalidatedByTerminal = checkpointIndex >= terminalStageIndex;
    const achieved = prefixCleared && checkpoint.achieved && !invalidatedByTerminal;
    if (!achieved) prefixCleared = false;
    return {
      ...checkpoint,
      achieved,
      detail: invalidatedByTerminal
        ? `${checkpoint.label} was not achieved because ${terminal.code}: ${terminal.message}`
        : checkpoint.detail,
    };
  });
  const achievedLevels = checkpoints.filter((checkpoint) => checkpoint.achieved).map((checkpoint) => checkpoint.level);
  const pendingLevels = checkpoints.filter((checkpoint) => !checkpoint.achieved).map((checkpoint) => checkpoint.level);
  const currentCheckpoint = [...checkpoints].reverse().find((checkpoint) => checkpoint.achieved) ?? checkpoints[0]!;
  const disposition = terminal.kind === "failed" ? "failed" : "blocked";

  return {
    ...envelope,
    confidence: {
      ...envelope.confidence,
      status: "blocked",
      tone: "red",
      headline: `Analysis run ${disposition} at ${terminal.stage}: ${terminal.message}`,
      blockingCount: Math.max(1, envelope.confidence.blockingCount + 1),
    },
    rigor: {
      currentLevel: currentCheckpoint.level,
      currentLabel: currentCheckpoint.label,
      summary: terminal.message,
      achievedLevels,
      pendingLevels,
      checkpoints,
    },
  };
}

function buildGateResults(params: {
  envelope: AnalysisTraceabilityEnvelope;
  diagnostics: readonly LegacyAnalysisRunDiagnostic[];
  evidenceRefs: readonly ContentRef[];
  terminal: TerminalOutcome | null;
}): GateResult[] {
  const requestBlockers = params.diagnostics.filter((item) => item.stage === "request-validation" && item.severity !== "warning");
  const requestWarnings = params.diagnostics.filter((item) => item.stage === "request-validation" && item.severity === "warning");
  const requestStatus = requestBlockers.length > 0 ? "failed" : requestWarnings.length > 0 ? "warned" : "passed";
  const requestChecks: GateCheck[] = (requestBlockers.length || requestWarnings.length
    ? [...requestBlockers, ...requestWarnings].map((diagnostic) => ({
        checkId: diagnostic.code,
        label: diagnostic.code.replace(/_/g, " ").toLowerCase(),
        status: diagnostic.severity === "warning" ? "warned" as const : "failed" as const,
        blocksGate: diagnostic.severity !== "warning",
        observed: diagnostic.message,
        threshold: "valid pinned input",
        unit: null,
        evidenceRefs: params.evidenceRefs,
        summary: diagnostic.message,
      }))
    : [{
        checkId: "PINNED_INPUT_VALID",
        label: "Pinned input validation",
        status: "passed" as const,
        blocksGate: false,
        observed: true,
        threshold: "valid pinned input",
        unit: null,
        evidenceRefs: params.evidenceRefs,
        summary: "Pinned run metadata, raw input, configuration, and source identities are valid.",
      }]);
  const gates: GateResult[] = [{
    gateId: "legacy-request-validation",
    gateVersion: LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION,
    stage: "request-validation",
    status: requestStatus,
    blocksNext: requestBlockers.length > 0,
    evidenceRefs: params.evidenceRefs,
    checks: requestChecks,
    summary: requestBlockers[0]?.message ?? requestWarnings[0]?.message ?? "Pinned input validation passed.",
  }];

  for (const checkpoint of params.envelope.rigor.checkpoints) {
    const status = checkpoint.achieved
      ? "passed" as const
      : params.envelope.confidence.status === "blocked"
        ? "failed" as const
        : "insufficient-evidence" as const;
    gates.push({
      gateId: `legacy-rigor-${checkpoint.level}`,
      gateVersion: params.envelope.schemaVersion,
      stage: checkpointStage(checkpoint.level),
      status,
      blocksNext: !checkpoint.achieved,
      evidenceRefs: params.evidenceRefs,
      checks: [{
        checkId: checkpoint.level,
        label: checkpoint.label,
        status,
        blocksGate: !checkpoint.achieved,
        observed: checkpoint.achieved,
        threshold: "achieved",
        unit: null,
        evidenceRefs: params.evidenceRefs,
        summary: checkpoint.detail,
      }],
      summary: checkpoint.detail,
    });
  }

  if (params.terminal && params.terminal.stage !== "request-validation") {
    gates.push({
      gateId: `legacy-executor-${params.terminal.code.toLowerCase().replace(/_/g, "-")}`,
      gateVersion: LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION,
      stage: params.terminal.stage,
      status: "failed",
      blocksNext: true,
      evidenceRefs: params.evidenceRefs,
      checks: [{
        checkId: params.terminal.code,
        label: params.terminal.code.replace(/_/g, " ").toLowerCase(),
        status: "failed",
        blocksGate: true,
        observed: params.terminal.message,
        threshold: "successful legacy stage",
        unit: null,
        evidenceRefs: params.evidenceRefs,
        summary: params.terminal.message,
      }],
      summary: params.terminal.message,
    });
  }
  return gates;
}

function stageRefs(params: {
  stage: AnalysisStageId;
  factRef: ContentRef<"fact-set">;
  policyRef: ContentRef<"policy-bundle">;
  familyRef: ContentRef<"family-analysis"> | null;
  windowRef: ContentRef<"analysis-window"> | null;
  assumptionRef: ContentRef<"assumption-set">;
  forecastRefs: readonly ContentRef<"forecast-case">[];
  modelRefs: readonly ContentRef<"model-result">[];
  synthesisRef: ContentRef<"synthesis"> | null;
  transformationDagRef: ContentRef<"evidence"> | null;
  scenarioOrderingRef: ContentRef<"evidence"> | null;
  scenarioGovernanceRef: ContentRef<"evidence"> | null;
  scenarioCalibrationRef: ContentRef<"evidence"> | null;
  sectorSidecarRef: ContentRef<"evidence"> | null;
  advancedModelRefs: readonly ContentRef<"evidence">[];
}): { inputRefs: ContentRef[]; outputRefs: ContentRef[] } {
  const { stage } = params;
  if (stage === "request-validation") return { inputRefs: [params.factRef, params.policyRef], outputRefs: [] };
  if (stage === "artifact-ingestion" || stage === "fact-extraction") return { inputRefs: [params.factRef], outputRefs: [params.factRef] };
  if (stage === "concept-normalization" || stage === "family-classification" || stage === "recast" || stage === "structural-reconciliation" || stage === "economic-validation") {
    return { inputRefs: [params.factRef, params.policyRef], outputRefs: params.familyRef ? [params.familyRef] : [] };
  }
  if (stage === "window-selection") return { inputRefs: params.familyRef ? [params.familyRef] : [params.factRef], outputRefs: params.windowRef ? [params.windowRef] : [] };
  if (stage === "assumption-resolution") return { inputRefs: [params.policyRef], outputRefs: [params.assumptionRef] };
  if (stage === "forecast") return {
    inputRefs: [params.assumptionRef],
    outputRefs: [
      ...params.forecastRefs,
      ...(params.scenarioOrderingRef ? [params.scenarioOrderingRef] : []),
      ...(params.scenarioGovernanceRef ? [params.scenarioGovernanceRef] : []),
      ...(params.scenarioCalibrationRef ? [params.scenarioCalibrationRef] : []),
    ],
  };
  if (stage === "model-execution") return { inputRefs: [...params.forecastRefs, params.assumptionRef, ...(params.sectorSidecarRef ? [params.sectorSidecarRef] : [])], outputRefs: [...params.modelRefs, ...params.advancedModelRefs] };
  if (stage === "synthesis") return { inputRefs: [...params.modelRefs], outputRefs: params.synthesisRef ? [params.synthesisRef] : [] };
  return {
    inputRefs: params.synthesisRef ? [params.synthesisRef] : [],
    outputRefs: params.transformationDagRef ? [params.transformationDagRef] : [],
  };
}

function buildStageResults(params: {
  terminal: TerminalOutcome | null;
  gateResults: readonly GateResult[];
  diagnosticRefs: readonly ContentRef<"diagnostic">[];
  factRef: ContentRef<"fact-set">;
  policyRef: ContentRef<"policy-bundle">;
  familyRef: ContentRef<"family-analysis"> | null;
  windowRef: ContentRef<"analysis-window"> | null;
  assumptionRef: ContentRef<"assumption-set">;
  forecastRefs: readonly ContentRef<"forecast-case">[];
  modelRefs: readonly ContentRef<"model-result">[];
  synthesisRef: ContentRef<"synthesis"> | null;
  transformationDagRef: ContentRef<"evidence"> | null;
  scenarioOrderingRef: ContentRef<"evidence"> | null;
  scenarioGovernanceRef: ContentRef<"evidence"> | null;
  scenarioCalibrationRef: ContentRef<"evidence"> | null;
  sectorSidecarRef: ContentRef<"evidence"> | null;
  advancedModelRefs: readonly ContentRef<"evidence">[];
}): AnalysisStageResult[] {
  const blockerIndex = params.terminal ? ANALYSIS_STAGE_ORDER.indexOf(params.terminal.stage) : -1;
  const blockerGateIds = params.gateResults.filter((gate) => gate.blocksNext).map((gate) => gate.gateId);
  return ANALYSIS_STAGE_ORDER.map((stageId, sequence): AnalysisStageResult => {
    const refs = stageRefs({ stage: stageId, ...params });
    const base = {
      stageId,
      stageVersion: LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION,
      sequence,
      inputRefs: refs.inputRefs,
      outputRefs: refs.outputRefs,
      evidenceRefs: [params.factRef, params.policyRef],
      diagnosticRefs: stageId === params.terminal?.stage || stageId === "release-trust" ? params.diagnosticRefs : [],
    };
    if (!params.terminal) return { ...base, status: "completed", blocksNext: false, reasonCode: null };
    if (sequence < blockerIndex) return { ...base, status: "completed", blocksNext: false, reasonCode: null };
    if (sequence === blockerIndex) {
      if (params.terminal.kind === "failed") {
        return { ...base, status: "failed", blocksNext: true, reasonCode: params.terminal.code, errorCode: params.terminal.code };
      }
      return { ...base, status: "blocked", blocksNext: true, reasonCode: params.terminal.code, blockerGateIds };
    }
    if (refs.outputRefs.length > 0 || stageId === "release-trust") {
      return { ...base, status: "diagnostic-only", blocksNext: true, reasonCode: `UPSTREAM_${params.terminal.code}`, blockerGateIds };
    }
    return { ...base, status: "not-started", blocksNext: true, reasonCode: null };
  });
}

function emptyMaterialization(input: LegacyAnalysisRunInputV1): LegacyAnalysisRunMaterializationV1 {
  return {
    rawData: input.rawData,
    config: input.config,
    marketSnapshot: input.marketSnapshot ?? null,
    segmentData: input.segmentData ?? null,
    bankQuality: input.bankQuality ?? null,
    sourceArtifactHashes: input.sourceArtifactHashes ?? null,
    debugInfo: input.debugInfo ?? null,
    parserDiagnostics: input.parserDiagnostics ?? null,
    factSet: null,
    pipelineResult: null,
    commandCenter: null,
    modelResults: [],
    qualityGate: null,
    mappingAudit: null,
    analysisStatus: null,
    valuationReadiness: null,
    analysisWindow: null,
    transformationDag: null,
    sourcedAssumptionSet: null,
    forecastResults: [],
    scenarioOrdering: null,
    scenarioGovernance: null,
    scenarioCalibration: null,
    sectorCaseExecution: null,
    advancedModelExecutions: [],
  };
}

/**
 * Construct an executor around an explicit dependency set. Production callers
 * should use `executeLegacyAnalysisRun`; this factory exists for contract tests
 * and future worker/CLI adapters.
 */
export function createLegacyAnalysisRunExecutor(
  dependencies: LegacyAnalysisRunExecutorDependencies = DEFAULT_DEPENDENCIES,
): (input: LegacyAnalysisRunInputV1) => Promise<LegacyAnalysisRunExecutionResult> {
  return async (input) => {
    let materialization = emptyMaterialization(input);
    const artifacts: AnalysisContentArtifact[] = [];
    const diagnostics: LegacyAnalysisRunDiagnostic[] = [];

    try {
      const rawData = sortedRawInput(input.rawData);
      const config = clonePlain(input.config as EngineConfig);
      const marketSnapshot = input.marketSnapshot ? clonePlain(input.marketSnapshot as LiveMarketDataSnapshot) : null;
      const segmentData = input.segmentData ? clonePlain(input.segmentData as SegmentData) : null;
      const bankQuality = input.bankQuality ? clonePlain(input.bankQuality as BankQualityIndicators) : null;
      const debugInfo = input.debugInfo ? clonePlain(input.debugInfo as CapitalineParseDebug) : null;
      const parserDiagnostics = input.parserDiagnostics ? clonePlain(input.parserDiagnostics as SourceParserDiagnostics) : null;
      const sourceArtifactHashes = input.sourceArtifactHashes ? clonePlain(input.sourceArtifactHashes as SourceArtifactHash[]) : null;
      const canonicalFacts = input.canonicalFacts ? clonePlain(input.canonicalFacts) : null;
      const policyVersions = dependencies.getPolicyVersions();
      const featureFlags = dependencies.snapshotFlags();
      const configWarnings = dependencies.validateConfig(config);
      diagnostics.push(...validateInput(input, configWarnings));
      let terminal = terminalFromDiagnostics(diagnostics);

      let factSet: FactSet | null = null;
      if (canonicalFacts) {
        const adapted = await adaptLegacyRawPeriodsToFactSet({
          rawData,
          sourceArtifacts: canonicalFacts.sourceArtifacts as SourceArtifact[],
          periodSources: canonicalFacts.periodSources as Record<string, LegacyPeriodSource>,
          conceptMappings: canonicalFacts.conceptMappings as LegacyConceptMapping[],
        });
        if (adapted.status === "created") {
          factSet = adapted.factSet;
        } else if (!terminal) {
          const message = adapted.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
          terminal = { kind: "blocked", stage: "fact-extraction", code: "CANONICAL_FACT_ADAPTER_BLOCKED", message };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
        }
      }
      const factArtifact = await createAnalysisContentArtifact({
        kind: "fact-set",
        schemaVersion: factSet?.schemaVersion ?? "legacy-raw-period-proxy-v1",
        payload: factSet
          ? { derivationMode: "native-fact-adapter", factSet }
          : {
              derivationMode: "legacy-derived",
              payloadType: "raw-period-proxy",
              factLevelLineageAvailable: false,
              rawData,
            },
      });
      const policyArtifact = await createAnalysisContentArtifact({
        kind: "policy-bundle",
        schemaVersion: "legacy-policy-bundle-v1",
        payload: {
          derivationMode: "legacy-derived",
          policyVersions,
          featureFlags,
          caveat: "Legacy feature flags are captured at execution time; they are not a native policy artifact.",
        },
      });
      const catalogArtifact = await createAnalysisContentArtifact({
        kind: "model-catalog",
        schemaVersion: "2026-07-model-catalog-v1",
        payload: {
          derivationMode: "legacy-derived",
          catalog: generateModelCatalog(CURRENT_MODEL_REGISTRY),
        },
      });
      artifacts.push(factArtifact, policyArtifact, catalogArtifact);

      let qualityGate: QualityGateReport | null = null;
      let mappingAudit: MappingAuditReport | null = null;
      let pipelineResult: PipelineResult | null = null;
      let recastData: RecastPeriod[] = [];
      let valuationReadiness: ValuationReadiness | null = null;
      let analysisStatus: AnalysisStatusSummary | null = null;
      let commandCenter: ValuationCommandCenterOutput | null = null;
      let analysisWindow: UnifiedAnalysisWindow | null = null;
      let sourcedAssumptionSet: SourcedAssumptionSet | null = null;
      let forecastResults: IndustrialForecastResult[] = [];
      let scenarioOrdering: ScenarioOrderingReport | null = null;
      let scenarioGovernance: ScenarioGovernanceReport | null = null;
      let scenarioCalibration: ScenarioCalibrationReport | null = null;
      let sectorCaseExecution: SectorCaseCatalogExecutionResult | null = null;
      const advancedModelExecutions: Array<{
        request: GovernedAdvancedModelInput; promotionDossierHash: string | null; promotionDossier: ModelPromotionDossier | null;
        promotion: ModelPromotionDecision; result: GovernedAdvancedModelResult;
        compositionPolicy: ApprovedRealOptionsCompositionPolicy | null; compositionCandidate: RealOptionsCompositionCandidate | null;
      }> = [];
      let windowedRecastData: RecastPeriod[] = [];

      if (!terminal) {
        try {
          qualityGate = dependencies.evaluateQualityGate(rawData, config);
          mappingAudit = dependencies.auditMappingCoverage(rawData);
        } catch (error) {
          terminal = { kind: "failed", stage: "fact-extraction", code: "LEGACY_PREFLIGHT_FAILED", message: errorMessage(error) };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "error", message: terminal.message });
        }
      }

      if (!terminal && qualityGate?.scopeAssessment.blocked) {
        terminal = {
          kind: "blocked",
          stage: "family-classification",
          code: "LEGACY_SCOPE_BLOCKED",
          message: qualityGate.scopeAssessment.reasons[0] ?? "The legacy scope policy blocked this dataset.",
        };
        diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message: terminal.message });
      }

      if (!terminal) {
        try {
          pipelineResult = dependencies.processPipeline(rawData, config, bankQuality);
          recastData = pipelineResult.periods;
          qualityGate = dependencies.evaluateQualityGate(rawData, config, recastData.length > 0 ? recastData : null);
          valuationReadiness = recastData.length > 0 ? dependencies.resolveValuationReadiness(recastData) : null;
          analysisStatus = dependencies.deriveAnalysisStatus(qualityGate, valuationReadiness, mappingAudit);
        } catch (error) {
          terminal = { kind: "failed", stage: "recast", code: "LEGACY_PIPELINE_FAILED", message: errorMessage(error) };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "error", message: terminal.message });
        }
      }

      if (!terminal && analysisStatus?.status === "blocked") {
        terminal = {
          kind: "blocked",
          stage: "structural-reconciliation",
          code: "LEGACY_VALUATION_POLICY_BLOCKED",
          message: analysisStatus.reasons[0] ?? analysisStatus.summary,
        };
        diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message: terminal.message });
      }

      if (!terminal && pipelineResult?.analysisFamily === "financial-institution") {
        try {
          analysisWindow = await selectFamilyPeriodAnalysisWindow({
            rawData,
            analystExclusions: (config.excluded_periods ?? []).map((period) => ({
              period,
              reasonCode: "ANALYST_CONFIRMED_CONFIG_EXCLUSION",
              evidenceRefs: [factArtifact.ref],
              confirmed: true as const,
            })),
            minimumPeriods: 2,
          });
          if (analysisWindow.selectionStatus === "blocked") {
            const message = analysisWindow.rationale.join(" ");
            terminal = { kind: "blocked", stage: "window-selection", code: "FAMILY_ANALYSIS_WINDOW_BLOCKED", message };
            diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
          }
        } catch (error) {
          terminal = { kind: "failed", stage: "window-selection", code: "FAMILY_ANALYSIS_WINDOW_FAILED", message: errorMessage(error) };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "error", message: terminal.message });
        }
      }

      if (!terminal && pipelineResult?.analysisFamily !== "industrial") {
        terminal = {
          kind: "blocked",
          stage: "model-execution",
          code: "LEGACY_COMMAND_CENTER_UNSUPPORTED_FAMILY",
          message: "The legacy valuation command center requires an industrial recast; financial-institution output remains available as diagnostic family analysis only.",
        };
        diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message: terminal.message });
      }

      if (!terminal) {
        try {
          analysisWindow = await dependencies.selectAnalysisWindow({
            periods: recastData,
            rawData,
            valuationReadiness: valuationReadiness ?? undefined,
            analystExclusions: (config.excluded_periods ?? []).map((period) => ({
              period,
              reasonCode: "ANALYST_CONFIRMED_CONFIG_EXCLUSION",
              evidenceRefs: [factArtifact.ref],
              confirmed: true as const,
            })),
            minimumPeriods: 2,
          });
          windowedRecastData = recastData.filter((period) => analysisWindow!.includedPeriods.includes(period.period_end));
          if (analysisWindow.selectionStatus === "blocked") {
            const message = analysisWindow.rationale.join(" ");
            terminal = { kind: "blocked", stage: "window-selection", code: "UNIFIED_ANALYSIS_WINDOW_BLOCKED", message };
            diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
          }
        } catch (error) {
          terminal = { kind: "failed", stage: "window-selection", code: "UNIFIED_ANALYSIS_WINDOW_FAILED", message: errorMessage(error) };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "error", message: terminal.message });
        }
      }

      if (!terminal && windowedRecastData.length < 2) {
        terminal = {
          kind: "blocked",
          stage: "window-selection",
          code: "LEGACY_VALUATION_WINDOW_TOO_SHORT",
          message: "The legacy valuation command center requires at least two recast periods.",
        };
        diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message: terminal.message });
      }

      if (!terminal) {
        try {
          // Publication vintage for the holdout's no-look-ahead claim. Only
          // periods traceable to an artifact can be stamped; a
          // "source-unavailable" period is simply omitted, which keeps the index
          // incomplete and therefore withholds the claim rather than faking it.
          const periodArtifacts: Record<string, string> = {};
          for (const [periodEnd, source] of Object.entries(canonicalFacts?.periodSources ?? {})) {
            if (source.kind === "source-unavailable") continue;
            periodArtifacts[periodEnd] = source.artifactId;
          }
          const holdoutVintage = canonicalFacts
            ? buildHoldoutVintageIndex({
                artifacts: canonicalFacts.sourceArtifacts,
                periodArtifacts,
              })
            : null;
          commandCenter = dependencies.buildCommandCenter({
            data: windowedRecastData,
            config,
            marketData: marketSnapshot,
            analysisStatus,
            segmentData,
            holdoutVintage,
            macroPack: input.macroPack,
            betaPack: input.betaPack,
            // The run's own cutoff, which is already validated (AS_OF_REQUIRED,
            // AS_OF_INVALID) and already the look-ahead bound for raw periods,
            // market history and calibration above. Using it here too means a
            // pack observation's staleness is a property of the run rather than
            // of the wall clock, so re-running identical inputs reproduces an
            // identical provenance tier — which is the whole point of pinning.
            analysisAsOf: input.metadata.asOf,
          });
        } catch (error) {
          terminal = { kind: "failed", stage: "model-execution", code: "LEGACY_COMMAND_CENTER_FAILED", message: errorMessage(error) };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "error", message: terminal.message });
        }
      }

      const marketArtifact = marketSnapshot
        ? await createAnalysisContentArtifact({
            kind: "market-snapshot",
            schemaVersion: "legacy-pinned-market-snapshot-v1",
            payload: { derivationMode: "legacy-derived", marketSnapshot },
          })
        : null;
      if (marketArtifact) artifacts.push(marketArtifact);

      if (!terminal && commandCenter && analysisWindow) {
        // P6 Stage 9. Same periods and market snapshot the command center was
        // built from on line 1073 — a different period set here would resolve a
        // different cost of capital than the one the models actually used.
        const resolution = dependencies.resolveAssumptions({
          periods: windowedRecastData,
          window: analysisWindow,
          config,
          marketSnapshot,
          // Same pack and same as-of date the command center was built with
          // above. These two routes are asserted equal by the Stage 9 parity
          // spec, so passing a pack to one and not the other would fork the
          // valuation — the native stage would resolve a different discount rate
          // than the models actually used.
          macroPack: input.macroPack,
          betaPack: input.betaPack,
          analysisAsOf: input.metadata.asOf,
          factRef: factArtifact.ref,
          policyRef: policyArtifact.ref,
          marketRef: marketArtifact?.ref ?? null,
        });
        sourcedAssumptionSet = await resolveSourcedAssumptionSet({
          window: analysisWindow,
          candidates: buildRunAssumptionCandidates({
            resolution,
            window: analysisWindow,
            commandCenter,
            config,
            factRef: factArtifact.ref,
            policyRef: policyArtifact.ref,
          }),
        });
        if (sourcedAssumptionSet.status === "blocked") {
          const message = sourcedAssumptionSet.issues.map((issue) => issue.message).join("; ");
          terminal = { kind: "blocked", stage: "assumption-resolution", code: "SOURCED_ASSUMPTIONS_BLOCKED", message };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
        }
      }

      if (!terminal && commandCenter && analysisWindow && sourcedAssumptionSet) {
        const latest = windowedRecastData.at(-1);
        if (latest) {
          forecastResults = buildRunForecastResults({
            commandCenter,
            latest,
            config,
            window: analysisWindow,
            assumptions: sourcedAssumptionSet,
            factRef: factArtifact.ref,
          });
          if (input.scenarioCalibration) {
            scenarioCalibration = calibrateScenarioProbabilities({
              observations: clonePlain(input.scenarioCalibration.observations as ScenarioCalibrationObservation[]),
              policy: clonePlain(input.scenarioCalibration.policy as ScenarioCalibrationPolicy),
            });
            const computedHorizons = new Set(forecastResults.flatMap((result) => result.status === "computed" ? [result.forecastCase.horizonYears] : []));
            const calibrationBindingMatches = scenarioCalibration.family === "industrial" && computedHorizons.size === 1 && computedHorizons.has(scenarioCalibration.horizonYears) && dateOnlyTime(scenarioCalibration.calibrationAsOf) <= dateOnlyTime(input.metadata.asOf);
            if (calibrationBindingMatches) {
              forecastResults = applyScenarioCalibration(forecastResults, scenarioCalibration);
            } else {
              const message = "Scenario calibration evidence does not match the run family, forecast horizon, or point-in-time cutoff.";
              terminal = { kind: "blocked", stage: "forecast", code: "SCENARIO_CALIBRATION_BINDING_MISMATCH", message };
              diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
            }
          }
          const blockedForecasts = forecastResults.filter((forecast) => forecast.status === "blocked");
          if (blockedForecasts.length > 0) {
            const message = blockedForecasts.map((forecast) =>
              forecast.status === "blocked" ? `${forecast.caseId}: ${forecast.reasonCodes.join(", ")}` : "").join("; ");
            terminal = { kind: "blocked", stage: "forecast", code: "FORECAST_STATE_VALIDATION_BLOCKED", message };
            diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
          } else {
            scenarioOrdering = validateIndustrialScenarioOrdering(
              forecastResults.flatMap((forecast) => forecast.status === "computed" ? [forecast.forecastCase] : []),
            );
            if (scenarioOrdering.status === "failed") {
              terminal = {
                kind: "blocked",
                stage: "forecast",
                code: "FORECAST_SCENARIO_ORDERING_BLOCKED",
                message: scenarioOrdering.summary,
              };
              diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message: terminal.message });
            }
          }
        }
      }

      if (commandCenter && forecastResults.length > 0) {
        scenarioGovernance = buildScenarioGovernanceReport({
          forecastResults,
          scenarioOrdering,
          assumptions: sourcedAssumptionSet,
          commandCenter,
        });
      }

      if (!terminal && input.sectorSidecar) {
        const sidecar = clonePlain(input.sectorSidecar as GovernedSectorSidecarApproval);
        const definition = CURRENT_SECTOR_CASE_REGISTRY.require(sidecar.caseType);
        if (sidecar.status !== "approved" || sidecar.issuerId !== input.metadata.issuerId || sidecar.caseInput.issuerId !== input.metadata.issuerId || sidecar.caseInput.asOf > input.metadata.asOf || sectorInputFamily(sidecar) !== resolveFamily(pipelineResult)) {
          const message = "The governed sector sidecar is not approved or does not match the run issuer and point-in-time cutoff.";
          terminal = { kind: "blocked", stage: "model-execution", code: "SECTOR_SIDECAR_BINDING_MISMATCH", message };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
        } else {
          sectorCaseExecution = executeCatalogSectorCase({ modelId: definition.modelId, input: sidecar.caseInput });
          if (sectorCaseExecution.status !== "computed") {
            const message = `Governed sector case blocked: ${sectorCaseExecution.reasonCodes.join(", ") || "unknown reason"}.`;
            terminal = { kind: "blocked", stage: "model-execution", code: "SECTOR_CASE_EXECUTION_BLOCKED", message };
            diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
          }
        }
      }

      if (!terminal && input.advancedModels?.length) {
        for (const item of input.advancedModels) {
          const request = clonePlain(item.request as GovernedAdvancedModelInput);
          const dossier = item.dossier ? clonePlain(item.dossier as ModelPromotionDossier) : null;
          const definition = CURRENT_MODEL_REGISTRY.require(request.modelId);
          const promotion = evaluateModelPromotion(definition, dossier);
          const result = executeGovernedAdvancedModel(request, promotion);
          const compositionPolicy = item.compositionPolicy ? clonePlain(item.compositionPolicy as ApprovedRealOptionsCompositionPolicy) : null;
          advancedModelExecutions.push({ request, promotionDossierHash: item.dossierHash ?? null, promotionDossier: dossier, promotion, result, compositionPolicy, compositionCandidate: null });
          if (result.status === "blocked") {
            const message = `Governed advanced model '${request.modelId}' blocked: ${result.reasonCodes.join(", ")}.`;
            terminal = { kind: "blocked", stage: "model-execution", code: "ADVANCED_MODEL_EXECUTION_BLOCKED", message };
            diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
            break;
          }
        }
      }

      // Preserve completed legacy work even if traceability finalization is the
      // unexpected failing seam. The analysis window is attached later once its
      // content reference has been materialized.
      materialization = {
        rawData,
        config,
        marketSnapshot,
        segmentData,
        bankQuality,
        sourceArtifactHashes,
        debugInfo,
        parserDiagnostics,
        factSet,
        pipelineResult,
        commandCenter,
        modelResults: [],
        qualityGate,
        mappingAudit,
        analysisStatus,
        valuationReadiness,
        analysisWindow,
        transformationDag: null,
        sourcedAssumptionSet,
        forecastResults,
        scenarioOrdering,
        scenarioGovernance,
        scenarioCalibration,
        sectorCaseExecution,
        advancedModelExecutions,
      };

      let envelope: AnalysisTraceabilityEnvelope;
      try {
        const latestPeriod = rawData.at(-1)?.period_end ?? null;
        const structuralEnvelope = dependencies.buildTraceability({
          generatedAt: input.metadata.generatedAt,
          // Suppress the legacy residual local-storage write. Instance identity
          // is stamped immediately below without changing analytical content.
          runId: null,
          companyId: input.metadata.issuerId,
          sourceMode: input.metadata.sourceMode,
          periodCount: rawData.length,
          latestPeriod,
          qualityGate,
          mappingAudit,
          policyVersions,
          analysisStatus,
          recastPeriodCount: windowedRecastData.length || recastData.length,
          hasDebugInfo: Boolean(debugInfo),
          debugFiles: debugInfo?.files.length ?? 0,
          rawMetricKeyCount: debugInfo?.rawMetricKeys.length ?? new Set(rawData.flatMap((period) => Object.keys(period.raw_metric_values))).size,
          engineError: terminal?.kind === "failed" ? terminal.message : null,
          rawData,
          recastData: windowedRecastData.length ? windowedRecastData : recastData,
          config,
          debugInfo,
          parserDiagnostics,
          sourceArtifactHashes,
          contentClass: input.metadata.contentClass ?? null,
          retentionDays: input.metadata.retentionDays ?? null,
          runInspectorEnabled: input.metadata.runInspectorEnabled ?? false,
          bankMetrics: pipelineResult?.bankResult?.bankMetrics ?? null,
          bankSubtype: pipelineResult?.bankResult?.subtype ?? null,
          valuationTriangulation: commandCenter?.valuationTriangulation ?? null,
          // Null when no valuation ran: the ladder must not read "no tiers
          // reported" as evidence that the inputs were sourced.
          // equityMode is what lets a manual ke report as an undated prior
          // rather than as `absent`, which does not fire the gate.
          assumptionProvenance: commandCenter
            ? buildAssumptionProvenance(commandCenter.costOfCapital.assumptions, {
                equityMode: commandCenter.costOfCapital.equityMode,
                ke: commandCenter.costOfCapital.ke,
              })
            : null,
          // Null when no valuation ran: silence about earnings quality must not
          // read as a clean bill of health.
          earningsQuality: commandCenter
            ? buildEarningsQualitySummary(commandCenter.earningsQuality)
            : null,
        });
        envelope = {
          ...structuralEnvelope,
          generatedAt: input.metadata.generatedAt,
          runContext: { ...structuralEnvelope.runContext, runId: input.metadata.runId },
        };
      } catch (error) {
        const message = errorMessage(error);
        return {
          status: "failed",
          run: null,
          errorCode: "LEGACY_TRACEABILITY_FAILED",
          message,
          artifacts,
          diagnostics: [...diagnostics, { code: "LEGACY_TRACEABILITY_FAILED", stage: "release-trust", severity: "error", message }],
          materialization,
        };
      }

      if (commandCenter) {
        try {
          const analyticalDepth = dependencies.evaluateAnalyticalDepth(commandCenter, { modelKe: commandCenter.costOfCapital.ke });
          const antiTautology = dependencies.summarizeAntiTautology(commandCenter);
          envelope = { ...envelope, analyticalDepth, antiTautology };
        } catch (error) {
          terminal = { kind: "failed", stage: "release-trust", code: "LEGACY_TRUST_ENRICHMENT_FAILED", message: errorMessage(error) };
          diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "error", message: terminal.message });
          envelope = { ...envelope, analyticalDepth: null, antiTautology: null };
        }
      }

      const valuationCheckpoint = envelope.rigor.checkpoints.find((checkpoint) => checkpoint.level === "valuation-eligible");
      if (!terminal && valuationCheckpoint?.achieved !== true) {
        terminal = {
          kind: "blocked",
          stage: "model-execution",
          code: "LEGACY_VALUATION_GATE_NOT_CLEARED",
          message: valuationCheckpoint?.detail ?? "The legacy traceability envelope did not establish valuation eligibility.",
        };
        diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message: terminal.message });
      }

      envelope = applyTerminalOutcomeToEnvelope(envelope, terminal);

      const familyArtifact = pipelineResult
        ? await createAnalysisContentArtifact({
            kind: "family-analysis",
            schemaVersion: "legacy-pipeline-result-v1",
            payload: { derivationMode: "legacy-derived", pipelineResult },
          })
        : null;
      if (familyArtifact) artifacts.push(familyArtifact);

      const windowArtifact = analysisWindow
        ? await createAnalysisContentArtifact({
            kind: "analysis-window",
            schemaVersion: analysisWindow.policyVersion,
            payload: { derivationMode: "unified-window", analysisWindow },
          })
        : null;
      if (windowArtifact) artifacts.push(windowArtifact);

      const assumptionArtifact = await createAnalysisContentArtifact({
        kind: "assumption-set",
        schemaVersion: sourcedAssumptionSet?.schemaVersion ?? "legacy-assumption-set-v1",
        payload: sourcedAssumptionSet
          ? { derivationMode: "sourced-assumption-set", sourcedAssumptionSet }
          : {
              derivationMode: "legacy-derived",
              config,
              evidenceLedger: commandCenter?.evidenceLedger ?? null,
              caveat: "No unified analysis window was available; native sourced assumptions were not published.",
            },
      });
      artifacts.push(assumptionArtifact);

      const forecastArtifacts = await Promise.all(forecastResults.map((forecastResult) => createAnalysisContentArtifact({
            kind: "forecast-case" as const,
            schemaVersion: "2026-07-industrial-forecast-state-v1",
            payload: { derivationMode: "forecast-state", forecastResult },
          })));
      artifacts.push(...forecastArtifacts);

      const scenarioOrderingArtifact = scenarioOrdering
        ? await createAnalysisContentArtifact({
            kind: "evidence",
            schemaVersion: "2026-07-scenario-ordering-v1",
            payload: { evidenceType: "scenario-ordering", scenarioOrdering },
          })
        : null;
      if (scenarioOrderingArtifact) artifacts.push(scenarioOrderingArtifact);

      const scenarioCalibrationArtifact = scenarioCalibration
        ? await createAnalysisContentArtifact({
            kind: "evidence",
            schemaVersion: scenarioCalibration.schemaVersion,
            payload: { evidenceType: "scenario-calibration", scenarioCalibration },
          })
        : null;
      if (scenarioCalibrationArtifact) artifacts.push(scenarioCalibrationArtifact);

      const sectorSidecarArtifact = input.sectorSidecar
        ? await createAnalysisContentArtifact({
            kind: "evidence",
            schemaVersion: input.sectorSidecar.schemaVersion,
            payload: { evidenceType: "governed-sector-sidecar", sidecar: input.sectorSidecar, execution: sectorCaseExecution },
          })
        : null;
      if (sectorSidecarArtifact) artifacts.push(sectorSidecarArtifact);

      const unlinkedModelResults: CatalogValuationModelResult[] = commandCenter
        ? [...adaptLegacyCommandCenterModelResults(commandCenter)]
        : [];
      if (sectorCaseExecution?.modelResult) unlinkedModelResults.push(clonePlain(sectorCaseExecution.modelResult));
      let modelResults: CatalogValuationModelResult[] = unlinkedModelResults.map((modelResult, index) =>
        modelResult.status === "computed"
          ? {
              ...modelResult,
              evidenceRefs: modelResult.evidenceRefs.length
                ? modelResult.evidenceRefs
                : [factArtifact.ref.contentHash, assumptionArtifact.ref.contentHash],
              transformationRefs: [modelTransformationId(modelResult.modelId, modelResult.caseId, index)],
            }
          : modelResult);
      for (const [index, execution] of advancedModelExecutions.entries()) {
        if (!execution.compositionPolicy) continue;
        if (execution.request.modelId !== "advanced.real-options-rd-pipeline") {
          advancedModelExecutions[index] = { ...execution, compositionCandidate: { status: "blocked", blockerCodes: ["COMPOSITION_MODEL_MISMATCH"], eligibleForIntrinsicSynthesis: false } };
          continue;
        }
        const dossier = execution.compositionPolicy.dossier;
        const baseResult = modelResults.find((result) => result.modelId === dossier.baseModelId && result.caseId === dossier.baseCaseId) ?? null;
        advancedModelExecutions[index] = { ...execution, compositionCandidate: evaluateRealOptionsCompositionCandidate({ request: execution.request, result: execution.result, policy: execution.compositionPolicy, baseResult }) };
      }
      if (commandCenter) {
        for (const execution of advancedModelExecutions) {
          if (!execution.compositionPolicy || !execution.compositionCandidate) continue;
          const activation = applyRealOptionsCompositionCandidate({
            synthesis: commandCenter.evidenceWeightedSynthesis,
            policy: execution.compositionPolicy,
            candidate: execution.compositionCandidate,
          });
          if (activation.status === "blocked") {
            const message = `Governed real-options synthesis substitution blocked: ${activation.blockerCodes.join(", ")}.`;
            terminal = { kind: "blocked", stage: "synthesis", code: "REAL_OPTIONS_COMPOSITION_SUBSTITUTION_BLOCKED", message };
            diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "blocker", message });
            break;
          }
          commandCenter = { ...commandCenter, evidenceWeightedSynthesis: activation.synthesis };
        }
        const effectiveSynthesis = commandCenter.evidenceWeightedSynthesis;
        modelResults = modelResults.map((modelResult) => modelResult.status === "computed" && modelResult.modelId === "industrial.evidence-weighted-synthesis"
          ? {
              ...modelResult,
              perShare: effectiveSynthesis.intrinsicRange.midPerShare,
              diagnostics: {
                ...modelResult.diagnostics,
                lowPerShare: effectiveSynthesis.intrinsicRange.lowPerShare,
                highPerShare: effectiveSynthesis.intrinsicRange.highPerShare,
                compositionAppliedCount: effectiveSynthesis.compositionDiagnostics?.appliedCount ?? 0,
              },
            }
          : modelResult);
        if (effectiveSynthesis.compositionDiagnostics?.appliedCount) {
          if (forecastResults.length > 0) {
            scenarioGovernance = buildScenarioGovernanceReport({ forecastResults, scenarioOrdering, assumptions: sourcedAssumptionSet, commandCenter });
          }
          try {
            envelope = { ...envelope, antiTautology: dependencies.summarizeAntiTautology(commandCenter) };
          } catch (error) {
            const message = errorMessage(error);
            terminal = { kind: "failed", stage: "release-trust", code: "COMPOSED_TRUST_ENRICHMENT_FAILED", message };
            diagnostics.push({ code: terminal.code, stage: terminal.stage, severity: "error", message });
          }
        }
      }
      envelope = applyTerminalOutcomeToEnvelope(envelope, terminal);
      const scenarioGovernanceArtifact = scenarioGovernance
        ? await createAnalysisContentArtifact({
            kind: "evidence",
            schemaVersion: scenarioGovernance.schemaVersion,
            payload: { evidenceType: "scenario-governance", scenarioGovernance },
          })
        : null;
      if (scenarioGovernanceArtifact) artifacts.push(scenarioGovernanceArtifact);
      const advancedModelArtifacts = await Promise.all(advancedModelExecutions.map((execution) => createAnalysisContentArtifact({
        kind: "evidence" as const,
        schemaVersion: "2026-07-governed-advanced-model-execution-v5",
        payload: { evidenceType: "governed-advanced-model-execution", execution },
      })));
      artifacts.push(...advancedModelArtifacts);
      const modelArtifacts = await Promise.all(modelResults.map((modelResult) =>
        createAnalysisContentArtifact({
          kind: "model-result" as const,
          schemaVersion: "2026-07-model-result-v1",
          payload: {
            derivationMode: "legacy-derived",
            modelResult,
          },
        })));
      artifacts.push(...modelArtifacts);

      const synthesisArtifact = commandCenter
        ? await createAnalysisContentArtifact({
            kind: "synthesis",
            schemaVersion: "2026-07-evidence-weighted-synthesis-v2",
            payload: {
              derivationMode: "legacy-derived",
              synthesis: commandCenter.evidenceWeightedSynthesis,
              scenarioGovernance,
            },
          })
        : null;
      if (synthesisArtifact) artifacts.push(synthesisArtifact);

      let transformationDag: TransformationDag | null = null;
      let transformationDagArtifact: AnalysisContentArtifact<"evidence"> | null = null;
      if (factSet) {
        try {
          transformationDag = await buildLegacyTransformationDag({
            factSet,
            pipelineResult,
            modelResults,
            hasSynthesis: synthesisArtifact != null,
            synthesis: commandCenter?.evidenceWeightedSynthesis ?? null,
            policyRef: policyArtifact.ref,
            sourceArtifactIds: normalizeSourceArtifactIds(input),
          });
          transformationDagArtifact = await createAnalysisContentArtifact({
            kind: "evidence",
            schemaVersion: transformationDag.schemaVersion,
            payload: { evidenceType: "transformation-dag", transformationDag },
          });
          artifacts.push(transformationDagArtifact);
        } catch (error) {
          const message = errorMessage(error);
          diagnostics.push({
            code: "TRANSFORMATION_DAG_FAILED",
            stage: "release-trust",
            severity: "error",
            message,
          });
          if (!terminal) {
            terminal = { kind: "failed", stage: "release-trust", code: "TRANSFORMATION_DAG_FAILED", message };
          }
        }
      }

      const diagnosticArtifacts = await Promise.all(diagnostics.map((diagnostic) => createAnalysisContentArtifact({
        kind: "diagnostic" as const,
        schemaVersion: "legacy-execution-diagnostic-v1",
        payload: diagnostic,
      })));
      artifacts.push(...diagnosticArtifacts);

      const gateResults = buildGateResults({
        envelope,
        diagnostics,
        evidenceRefs: [factArtifact.ref, policyArtifact.ref],
        terminal,
      });
      const stageResults = buildStageResults({
        terminal,
        gateResults,
        diagnosticRefs: diagnosticArtifacts.map((artifact) => artifact.ref),
        factRef: factArtifact.ref,
        policyRef: policyArtifact.ref,
        familyRef: familyArtifact?.ref ?? null,
        windowRef: windowArtifact?.ref ?? null,
        assumptionRef: assumptionArtifact.ref,
        forecastRefs: forecastArtifacts.map((artifact) => artifact.ref),
        modelRefs: modelArtifacts.map((artifact) => artifact.ref),
        synthesisRef: synthesisArtifact?.ref ?? null,
        transformationDagRef: transformationDagArtifact?.ref ?? null,
        scenarioOrderingRef: scenarioOrderingArtifact?.ref ?? null,
        scenarioGovernanceRef: scenarioGovernanceArtifact?.ref ?? null,
        scenarioCalibrationRef: scenarioCalibrationArtifact?.ref ?? null,
        sectorSidecarRef: sectorSidecarArtifact?.ref ?? null,
        advancedModelRefs: advancedModelArtifacts.map((artifact) => artifact.ref),
      });

      materialization = {
        rawData,
        config,
        marketSnapshot,
        segmentData,
        bankQuality,
        sourceArtifactHashes,
        debugInfo,
        parserDiagnostics,
        factSet,
        pipelineResult,
        commandCenter,
        modelResults,
        qualityGate,
        mappingAudit,
        analysisStatus,
        valuationReadiness,
        analysisWindow,
        transformationDag,
        sourcedAssumptionSet,
        forecastResults,
        scenarioOrdering,
        scenarioGovernance,
        scenarioCalibration,
        sectorCaseExecution,
        advancedModelExecutions,
      };

      const run = await createAnalysisRunV1({
        schemaVersion: ANALYSIS_RUN_SCHEMA_VERSION,
        executorVersion: LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION,
        derivationMode: "legacy-derived",
        issuerId: input.metadata.issuerId,
        family: resolveFamily(pipelineResult),
        asOf: input.metadata.asOf,
        status: terminal?.kind === "failed" ? "failed" : terminal ? "blocked" : "completed",
        sourceArtifactIds: normalizeSourceArtifactIds(input),
        factSetRef: factArtifact.ref,
        policyBundleRef: policyArtifact.ref,
        modelCatalogRef: catalogArtifact.ref,
        familyAnalysisRef: familyArtifact?.ref ?? null,
        analysisWindowRef: windowArtifact?.ref ?? null,
        marketSnapshotRef: marketArtifact?.ref ?? null,
        assumptionSetRef: assumptionArtifact.ref,
        forecastCaseRefs: forecastArtifacts.map((artifact) => artifact.ref),
        modelResultRefs: modelArtifacts.map((artifact) => artifact.ref),
        synthesisRef: synthesisArtifact?.ref ?? null,
        stageResults,
        gateResults,
        trustEnvelope: envelope,
        publicationRef: null,
        runId: input.metadata.runId,
        relation: input.metadata.relation ?? { kind: "root", parentRunId: null, parentReproducibilityHash: null },
        createdAt: input.metadata.createdAt,
      });

      if (!terminal) return { status: "completed", run, artifacts, diagnostics, materialization };
      if (terminal.kind === "blocked") return { status: "blocked", run, reasonCode: terminal.code, artifacts, diagnostics, materialization };
      return { status: "failed", run, errorCode: terminal.code, message: terminal.message, artifacts, diagnostics, materialization };
    } catch (error) {
      const message = errorMessage(error);
      return {
        status: "failed",
        run: null,
        errorCode: "LEGACY_EXECUTOR_FAILED",
        message,
        artifacts,
        diagnostics: [...diagnostics, { code: "LEGACY_EXECUTOR_FAILED", stage: "release-trust", severity: "error", message }],
        materialization,
      };
    }
  };
}

/** Execute the current legacy analytical stack once and finalize AnalysisRunV1. */
export const executeLegacyAnalysisRun = createLegacyAnalysisRunExecutor();
