import { describe, expect, it, vi } from "vitest";
import type { AnalysisStatusSummary } from "../../analysisStatus";
import type { AnalysisTraceabilityEnvelope } from "../../analysisTraceability";
import type { MappingAuditReport, QualityGateReport } from "../../mappingAudit";
import type { PipelineResult } from "../../pipeline";
import type { EngineConfig, RawPeriodData, RecastPeriod } from "../../types";
import { DEFAULT_CONFIG } from "../../types";
import type { ValuationCommandCenterOutput } from "../../valuationCommandCenter";
import type { ValuationReadiness } from "../../valuationPolicy";
import { resolveCostOfCapitalFromConfig } from "../../costOfCapital";
import { evaluateRealOptionsCompositionApproval } from "../../advancedModelGovernance";
import {
  createLegacyAnalysisRunExecutor,
  type LegacyAnalysisRunExecutorDependencies,
  type LegacyAnalysisRunInputV1,
} from "../index";

const RAW: RawPeriodData[] = [
  { company_id: "issuer-1", period_end: "2025-03-31", raw_metric_values: { revenue: 90 } },
  { company_id: "issuer-1", period_end: "2026-03-31", raw_metric_values: { revenue: 100 } },
];

const RECAST = [
  { period_end: "2025-03-31" },
  { period_end: "2026-03-31" },
] as RecastPeriod[];

function qualityGate(scopeBlocked = false): QualityGateReport {
  return {
    scopeAssessment: {
      blocked: scopeBlocked,
      reasons: scopeBlocked ? ["Unsupported mixed scope."] : [],
    },
    valuationBlocked: scopeBlocked,
    blockingReasons: scopeBlocked ? ["Unsupported mixed scope."] : [],
  } as unknown as QualityGateReport;
}

function status(blocked = false): AnalysisStatusSummary {
  return {
    status: blocked ? "blocked" : "production-ready",
    label: blocked ? "Blocked" : "Production-ready",
    headline: blocked ? "Unsupported scope" : "Ready",
    summary: blocked ? "Unsupported mixed scope." : "Ready.",
    reasons: blocked ? ["Unsupported mixed scope."] : [],
    tone: blocked ? "red" : "emerald",
    qualityTier: "Tier 1",
    valuationStatus: "production-ready",
    scopeBlocked: blocked,
    valuationBlocked: blocked,
    blockingCount: blocked ? 1 : 0,
    diagnosticCount: 0,
    optionalCount: 0,
  };
}

function readiness(): ValuationReadiness {
  return {
    status: "production-ready",
    latestPeriod: "2026-03-31",
    anchorPeriod: "2026-03-31",
    anchorIndex: 1,
    fallbackUsed: false,
    contaminationTier: "CLEAN",
    persistenceStatus: "durable",
    persistenceScore: 80,
    terminalFlags: [],
    terminalFlagLabels: [],
    reasons: ["Latest period is a clean anchor."],
  };
}

function pipeline(): PipelineResult {
  return {
    periods: RECAST,
    analysisFamily: "industrial",
    pipelineStrategyId: "industrial-v1",
  } as unknown as PipelineResult;
}

function commandCenter(): ValuationCommandCenterOutput {
  return {
    scenarios: [],
    costOfCapital: resolveCostOfCapitalFromConfig({ config: DEFAULT_CONFIG }),
    shareBasis: { shares: 10, sharesForPerShare: 10 },
    cashFlowDcf: null,
    epv: null,
    sotp: null,
    evEbitda: { evFromMedian: null, equityFromMedian: null },
    reverseDcf: {
      impliedOwnerEarningsGrowth: null,
      impliedTerminalROIC: null,
      impliedKE: null,
    },
    evidenceLedger: { rows: [], summary: { total: 0, unsupportedCount: 0, priceDerivedCount: 0 } },
    evidenceWeightedSynthesis: {
      intrinsicRange: { lowPerShare: null, midPerShare: null, highPerShare: null },
      contributions: [],
    },
    valuationTriangulation: { status: "confirmed" },
  } as unknown as ValuationCommandCenterOutput;
}

function envelope(params: {
  generatedAt: string;
  scopeBlocked?: boolean | undefined;
  valuationEligible?: boolean | undefined;
  runId?: string | null | undefined;
}): AnalysisTraceabilityEnvelope {
  const achieved = params.valuationEligible ?? !params.scopeBlocked;
  const checkpoints = [
    ["syntactically-valid", true],
    ["structurally-reconciled", achieved],
    ["economically-plausible", achieved],
    ["valuation-eligible", achieved],
    ["production-ready", achieved],
  ].map(([level, passed]) => ({
    level,
    label: String(level),
    achieved: Boolean(passed),
    detail: passed ? `${level} passed.` : `${level} blocked.`,
  }));
  return {
    schemaVersion: "2026-06-traceability-v20",
    generatedAt: params.generatedAt,
    runContext: {
      runId: params.runId ?? null,
      companyId: "issuer-1",
      sourceMode: "json",
      periodCount: 2,
      latestPeriod: "2026-03-31",
    },
    confidence: {
      status: params.scopeBlocked ? "blocked" : "production-ready",
      headline: params.scopeBlocked ? "Blocked" : "Ready",
      tone: params.scopeBlocked ? "red" : "emerald",
      blockingCount: params.scopeBlocked ? 1 : 0,
      diagnosticCount: 0,
      optionalCount: 0,
    },
    rigor: {
      currentLevel: achieved ? "production-ready" : "syntactically-valid",
      currentLabel: achieved ? "Production-ready" : "Syntactically valid",
      summary: achieved ? "Ready." : "Blocked.",
      achievedLevels: checkpoints.filter((item) => item.achieved).map((item) => item.level),
      pendingLevels: checkpoints.filter((item) => !item.achieved).map((item) => item.level),
      checkpoints,
    },
  } as unknown as AnalysisTraceabilityEnvelope;
}

function dependencies(options: {
  scopeBlocked?: boolean | undefined;
  processError?: Error | undefined;
  windowBlocked?: boolean | undefined;
} = {}): LegacyAnalysisRunExecutorDependencies {
  const gate = qualityGate(Boolean(options.scopeBlocked));
  return {
    processPipeline: vi.fn(() => {
      if (options.processError) throw options.processError;
      return pipeline();
    }) as unknown as LegacyAnalysisRunExecutorDependencies["processPipeline"],
    evaluateQualityGate: vi.fn(() => gate) as unknown as LegacyAnalysisRunExecutorDependencies["evaluateQualityGate"],
    auditMappingCoverage: vi.fn(() => ({} as MappingAuditReport)) as unknown as LegacyAnalysisRunExecutorDependencies["auditMappingCoverage"],
    resolveValuationReadiness: vi.fn(() => readiness()) as unknown as LegacyAnalysisRunExecutorDependencies["resolveValuationReadiness"],
    deriveAnalysisStatus: vi.fn(() => status(Boolean(options.scopeBlocked))) as unknown as LegacyAnalysisRunExecutorDependencies["deriveAnalysisStatus"],
    buildCommandCenter: vi.fn(() => commandCenter()) as unknown as LegacyAnalysisRunExecutorDependencies["buildCommandCenter"],
    buildTraceability: vi.fn((traceParams: { generatedAt?: string | null; runId?: string | null }) => envelope({
      generatedAt: traceParams.generatedAt ?? "2026-07-10T00:00:00.000Z",
      scopeBlocked: Boolean(options.scopeBlocked || options.processError),
      valuationEligible: !options.scopeBlocked && !options.processError,
      runId: traceParams.runId,
    })) as unknown as LegacyAnalysisRunExecutorDependencies["buildTraceability"],
    selectAnalysisWindow: vi.fn(async () => ({
      policyVersion: "2026-07-unified-window-v1",
      windowId: `sha256:${"c".repeat(64)}`,
      includedPeriods: ["2025-03-31", "2026-03-31"],
      excludedPeriods: [],
      anchorPeriod: "2026-03-31",
      selectionStatus: options.windowBlocked ? "blocked" : "confirmed",
      rationale: [options.windowBlocked ? "Fixture window is unsafe." : "Fixture window."],
      sourcePeriodCount: 2,
      economicStatus: "passed",
      valuationReadinessStatus: "production-ready",
      blockerCodes: options.windowBlocked ? ["FIXTURE_WINDOW_BLOCKED"] : [],
    })) as unknown as LegacyAnalysisRunExecutorDependencies["selectAnalysisWindow"],
    evaluateAnalyticalDepth: vi.fn(() => ({ status: "rich", summary: "4/4", presentCount: 4, watchCount: 0, checks: [] })) as unknown as LegacyAnalysisRunExecutorDependencies["evaluateAnalyticalDepth"],
    summarizeAntiTautology: vi.fn(() => ({ paradigmIndependence: { independentLensCount: 2 } })) as unknown as LegacyAnalysisRunExecutorDependencies["summarizeAntiTautology"],
    getPolicyVersions: vi.fn(() => ({ traceabilitySchemaVersion: "2026-06-traceability-v20" })) as unknown as LegacyAnalysisRunExecutorDependencies["getPolicyVersions"],
    snapshotFlags: vi.fn(() => ({
      "rigor.conceptIdentityBlock": true,
      "rigor.economicSanityBlock": true,
      "rigor.terminalEligibilityBlock": true,
      "rigor.residualScoreDowngrade": true,
    })),
    validateConfig: vi.fn(() => []),
  };
}

function input(overrides: Partial<LegacyAnalysisRunInputV1["metadata"]> = {}): LegacyAnalysisRunInputV1 {
  return {
    rawData: RAW,
    config: DEFAULT_CONFIG as EngineConfig,
    marketSnapshot: {
      symbol: "TEST",
      provider: "fixture",
      fetchedAt: "2026-07-10T07:00:00.000Z",
      price: 100,
      previousClose: 99,
      changePct: 0.01,
      marketCap: 1_000,
      enterpriseValue: 1_100,
      sharesOutstanding: 10,
      riskFreeRate: 0.07,
      priceAsOf: "2026-07-10",
      rateAsOf: "2026-07-10",
      freshness: "live",
      sourceSummary: "Pinned fixture",
      warnings: [],
      history: null,
    },
    segmentData: null,
    metadata: {
      runId: "run-1",
      issuerId: "issuer-1",
      asOf: "2026-07-10",
      createdAt: "2026-07-10T08:00:00.000Z",
      generatedAt: "2026-07-10T07:59:59.000Z",
      sourceMode: "json",
      sourceArtifactIds: [`sha256:${"a".repeat(64)}`],
      ...overrides,
    },
  };
}

describe("legacy-backed AnalysisRun executor", () => {
  it("executes each legacy analytical seam once and finalizes enriched content", async () => {
    const deps = dependencies();
    const execute = createLegacyAnalysisRunExecutor(deps);

    const result = await execute(input());

    expect(result.status).toBe("completed");
    expect(result.run?.derivationMode).toBe("legacy-derived");
    expect(result.run?.status).toBe("completed");
    expect(result.run?.trustEnvelope.analyticalDepth).toBeTruthy();
    expect(result.run?.trustEnvelope.antiTautology).toBeTruthy();
    expect(result.run?.marketSnapshotRef?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.run?.modelResultRefs.length).toBeGreaterThan(1);
    expect(result.materialization.modelResults.length).toBe(result.run?.modelResultRefs.length);
    expect(result.run?.publicationRef).toBeNull();
    expect(deps.processPipeline).toHaveBeenCalledTimes(1);
    expect(deps.buildCommandCenter).toHaveBeenCalledTimes(1);
    expect(deps.buildTraceability).toHaveBeenCalledTimes(1);
    expect(deps.evaluateAnalyticalDepth).toHaveBeenCalledTimes(1);
    expect(deps.summarizeAntiTautology).toHaveBeenCalledTimes(1);
  });

  it("executes an approved, family-bound sector sidecar as an immutable catalog model result", async () => {
    const execute = createLegacyAnalysisRunExecutor(dependencies());
    const governed = input();
    const evidence = { "retail.mature-store-cohort": ["source:stores"], "retail.central-costs-capex": ["source:capex"], "retail.net-debt": ["source:debt"] };
    const result = await execute({
      ...governed,
      sectorSidecar: {
        sidecarId: "issuer-1-retail-v1", issuerId: "issuer-1", caseType: "retail-unit-economics", schemaVersion: "retail-unit-economics-case-v1",
        reviewedAt: "2026-07-09T00:00:00.000Z", reviewerPrincipalId: "reviewer-1", status: "approved", evidence,
        caseInput: {
          caseType: "retail-unit-economics", issuerId: "issuer-1", asOf: "2026-03-31", companyType: "consumer", sharesOutstandingCr: 10, evidence,
          matureStoreCount: 100, annualRevenuePerStoreCr: 2, storeEbitdaMargin: 0.2, centralCostsCr: 10,
          maintenanceCapexPerStoreCr: 0.05, cashTaxRate: 0.25, costOfOperations: 0.11, terminalGrowth: 0.04, netDebtCr: 50,
        },
      },
    });
    expect(result.status).toBe("completed");
    expect(result.materialization.sectorCaseExecution).toMatchObject({ status: "computed", requestedModelId: "sector.retail.unit-economics-fcff" });
    expect(result.materialization.modelResults.some((model) => model.modelId === "sector.retail.unit-economics-fcff" && model.status === "computed")).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.ref.kind === "evidence" && artifact.ref.schemaVersion === "retail-unit-economics-case-v1")).toBe(true);
  });

  it("persists governed advanced-model output as non-synthesis run evidence", async () => {
    const execute = createLegacyAnalysisRunExecutor(dependencies());
    const result = await execute({
      ...input(),
      advancedModels: [{
        request: { modelId: "advanced.esg-adjusted-ke", issuerId: "issuer-1", asOf: "2026-07-10", sidecarId: "esg-1", sidecarStatus: "approved", evidenceRefs: ["source:esg"], transformationRefs: ["transform:esg"], input: { baseKe: 0.12, bucket: "BBB" } },
        dossier: null,
      }],
    });
    expect(result.status).toBe("completed");
    expect(result.materialization.advancedModelExecutions[0]).toMatchObject({ result: { status: "computed", eligibleForProductionUse: false, eligibleForIntrinsicSynthesis: false } });
    expect(result.artifacts.some((artifact) => artifact.ref.schemaVersion === "2026-07-governed-advanced-model-execution-v5")).toBe(true);
  });

  it("replaces one exact synthesis vote for an approved real-options composition", async () => {
    const baseDeps = dependencies();
    const baseCommandCenter = commandCenter();
    const deps: LegacyAnalysisRunExecutorDependencies = { ...baseDeps, buildCommandCenter: vi.fn(() => ({
      ...baseCommandCenter,
      cashFlowDcf: { enterpriseValue: 1_100, equityValue: 1_000, perShare: 100, baseFcf: 80, kw: 0.09, terminalGrowth: 0.04, windowPeriods: 2 },
      evidenceWeightedSynthesis: {
        contributions: [
          { modelKey: "cash-fcff-dcf", label: "Cash DCF", independenceGroup: "cash-statement", perShare: 100, baseReliability: 0.72, evidenceCoveragePenalty: 0, forecastSkillPenalty: 0, priceDerivedPenalty: 0, finalWeight: 0.72, includedInIntrinsicRange: true, reason: "fixture cash vote" },
          { modelKey: "relative-ev-ebitda", label: "Peer", independenceGroup: "peer-market", perShare: 90, baseReliability: 0.38, evidenceCoveragePenalty: 0, forecastSkillPenalty: 0, priceDerivedPenalty: 0, finalWeight: 0.38, includedInIntrinsicRange: true, reason: "fixture peer vote" },
        ],
        intrinsicRange: { lowPerShare: 90, midPerShare: 95, highPerShare: 100, rangeWideningPct: 0 },
        marketExpectationRange: { pricePerShare: 100, requiredGrowth: null, requiredRnoa: null, saturated: false },
        defensibility: { status: "confirmed", checklist: [
          { key: "assumption-evidence", label: "Evidence", passed: true, detail: "fixture" },
          { key: "forecast-holdout-skill", label: "Holdout", passed: true, detail: "fixture" },
          { key: "price-derived-isolation", label: "Isolation", passed: true, detail: "fixture" },
          { key: "paradigm-independence", label: "Independence", passed: true, detail: "fixture" },
          { key: "range-widening", label: "Range", passed: true, detail: "fixture" },
        ], summary: "fixture" },
      },
    })) as unknown as LegacyAnalysisRunExecutorDependencies["buildCommandCenter"] };
    const compositionDossier = {
      modelId: "advanced.real-options-rd-pipeline" as const, issuerId: "issuer-1", sidecarId: "options-1", effectiveAsOf: "2026-07-09",
      baseModelId: "industrial.cash-statement-fcff-dcf", baseCaseId: "base", baseExcludesOptionality: true,
      synthesisTargetModelKey: "cash-fcff-dcf", synthesisTargetIndependenceGroup: "cash-statement" as const, substitutionMode: "replace-exact-base-vote-once" as const,
      advancedInputHash: `sha256:${"f".repeat(64)}` as const,
      excludedProjectIds: ["drug-1"], maximumAdjustmentToBaseRatio: 0.5,
      evidenceRefs: ["artifact:composition"], transformationRefs: ["transform:composition"],
    };
    const approval = evaluateRealOptionsCompositionApproval(`sha256:${"b".repeat(64)}`, compositionDossier, [
      { reviewerPrincipalId: "reviewer-1", decision: "approved", evidenceRef: "review:1", reviewedAt: "2026-07-09T01:00:00.000Z" },
      { reviewerPrincipalId: "reviewer-2", decision: "approved", evidenceRef: "review:2", reviewedAt: "2026-07-09T02:00:00.000Z" },
    ]);
    if (approval.status !== "approved") throw new Error("Expected approved fixture composition.");
    const result = await createLegacyAnalysisRunExecutor(deps)({
      ...input(),
      advancedModels: [{
        request: {
          modelId: "advanced.real-options-rd-pipeline", issuerId: "issuer-1", asOf: "2026-07-10", sidecarId: "options-1", sidecarStatus: "approved",
          evidenceRefs: ["artifact:options"], transformationRefs: ["transform:options"], outputBridge: { sourceMonetaryUnit: "INR_CRORE", sharesOutstandingCr: 10, valueRole: "incremental-equity-adjustment" },
          input: { riskFreeRate: 0.07, projects: [{ id: "drug-1", stage: "phase-3", underlyingValue: 100, developmentCost: 80, timeToDecisionYears: 2, probabilityOfSuccess: 0.5, volatility: 0.4 }] },
        },
        dossier: {
          modelId: "advanced.real-options-rd-pipeline", implementationIntegration: "wired", realIssuerGoldenCount: 1,
          factCoverageRatio: 1, guardCoverageRatio: 1, lineageCoverageRatio: 1,
          calibration: { status: "not-required", asOf: null, sampleSize: 0, metric: null },
          reviewerPrincipalIds: ["reviewer-1", "reviewer-2"], evidenceRefs: ["artifact:promotion"],
        },
        dossierHash: `sha256:${"c".repeat(64)}`,
        compositionPolicy: approval.policy,
      }],
    });
    expect(result.status).toBe("completed");
    expect(result.materialization.advancedModelExecutions[0]?.compositionCandidate?.status).toBe("eligible-candidate");
    expect(result.materialization.commandCenter?.evidenceWeightedSynthesis.compositionDiagnostics).toMatchObject({ appliedCount: 1, targetModelKeys: ["cash-fcff-dcf"], countingPolicy: "replace-exact-base-vote-once" });
    const cashVote = result.materialization.commandCenter?.evidenceWeightedSynthesis.contributions.find((item) => item.modelKey === "cash-fcff-dcf");
    expect(cashVote?.perShare).toBeGreaterThan(100);
    expect(cashVote?.substitution?.basePerShare).toBe(100);
    expect(result.materialization.modelResults.find((item) => item.modelId === "industrial.evidence-weighted-synthesis" && item.status === "computed")).toMatchObject({ diagnostics: { compositionAppliedCount: 1 } });
    expect(result.artifacts.some((artifact) => artifact.ref.kind === "synthesis" && artifact.ref.schemaVersion === "2026-07-evidence-weighted-synthesis-v2")).toBe(true);
  });

  it("has stable analytical identity across volatile run instance metadata", async () => {
    const execute = createLegacyAnalysisRunExecutor(dependencies());
    const first = await execute(input());
    const second = await execute(input({
      runId: "run-2",
      createdAt: "2026-07-11T08:00:00.000Z",
      generatedAt: "2026-07-11T07:59:59.000Z",
    }));

    expect(first.run?.reproducibilityHash).toBe(second.run?.reproducibilityHash);
  });

  it("materializes a native canonical FactSet when explicit artifacts and mappings are supplied", async () => {
    const execute = createLegacyAnalysisRunExecutor(dependencies());
    const sourceId = `sha256:${"b".repeat(64)}` as const;
    const base = input();
    const result = await execute({
      ...base,
      canonicalFacts: {
        sourceArtifacts: [{
          artifactId: sourceId,
          fileName: "fixture.json",
          mediaType: "application/json",
          byteLength: 100,
          sourceMode: "json",
          acquiredAt: "2026-07-10T00:00:00.000Z",
          filingAsOf: "2026-03-31",
          issuerId: "issuer-1",
          scope: "consolidated",
          parserVersion: "fixture-v1",
          contentClass: "financial-statements",
        }],
        periodSources: {
          "2025-03-31": { kind: "reported", artifactId: sourceId, filingVersion: "original", scope: "consolidated", accountingStandard: "ind-as", durationStart: "2024-04-01" },
          "2026-03-31": { kind: "reported", artifactId: sourceId, filingVersion: "original", scope: "consolidated", accountingStandard: "ind-as", durationStart: "2025-04-01" },
        },
        conceptMappings: [{
          rawLabel: "revenue",
          conceptId: "revenue",
          statement: "IS",
          periodKind: "duration",
          normalizedUnit: "INR_CRORE",
          storedScale: "crore",
          currency: "INR",
        }],
      },
    });
    expect(result.status).toBe("completed");
    expect(result.materialization.factSet?.facts).toHaveLength(2);
    expect(result.run?.sourceArtifactIds).toContain(sourceId);
    expect(result.materialization.transformationDag?.rootFactIds).toHaveLength(2);
    expect(result.materialization.transformationDag?.nodes.some((node) => node.functionId === "processCompanyDataFull")).toBe(true);
    expect(result.materialization.transformationDag?.nodes.length).toBeGreaterThan(0);
    expect(result.materialization.modelResults.filter((model) => model.status === "computed").every((model) => model.transformationRefs.length === 1)).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.ref.kind === "evidence" && artifact.ref.schemaVersion === "transformation-dag-v1")).toBe(true);
  });

  it("fails closed on a domain scope blocker without invoking downstream engines", async () => {
    const deps = dependencies({ scopeBlocked: true });
    const result = await createLegacyAnalysisRunExecutor(deps)(input());

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("Expected blocked result");
    expect(result.reasonCode).toBe("LEGACY_SCOPE_BLOCKED");
    expect(result.run.status).toBe("blocked");
    expect(result.run.stageResults.find((stage) => stage.stageId === "family-classification")?.status).toBe("blocked");
    expect(result.run.stageResults.find((stage) => stage.stageId === "model-execution")?.status).toBe("not-started");
    expect(deps.processPipeline).not.toHaveBeenCalled();
    expect(deps.buildCommandCenter).not.toHaveBeenCalled();
    expect(deps.buildTraceability).toHaveBeenCalledTimes(1);
  });

  it("captures an unexpected pipeline failure in a finalized failed run", async () => {
    const deps = dependencies({ processError: new Error("synthetic recast failure") });
    const result = await createLegacyAnalysisRunExecutor(deps)(input());

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("Expected failed result");
    expect(result.errorCode).toBe("LEGACY_PIPELINE_FAILED");
    expect(result.run?.status).toBe("failed");
    expect(result.run?.stageResults.find((stage) => stage.stageId === "recast")?.status).toBe("failed");
    expect(deps.processPipeline).toHaveBeenCalledTimes(1);
    expect(deps.buildCommandCenter).not.toHaveBeenCalled();
  });

  it("demotes a green structural envelope when a later native window gate blocks", async () => {
    const result = await createLegacyAnalysisRunExecutor(dependencies({ windowBlocked: true }))(input());

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("Expected blocked result");
    expect(result.reasonCode).toBe("UNIFIED_ANALYSIS_WINDOW_BLOCKED");
    expect(result.run.trustEnvelope.confidence.status).toBe("blocked");
    expect(result.run.trustEnvelope.confidence.tone).toBe("red");
    expect(result.run.trustEnvelope.rigor.achievedLevels).toEqual([
      "syntactically-valid",
      "structurally-reconciled",
      "economically-plausible",
    ]);
    expect(result.run.trustEnvelope.rigor.pendingLevels).toEqual([
      "valuation-eligible",
      "production-ready",
    ]);
    expect(result.run.trustEnvelope.rigor.checkpoints.find((checkpoint) => checkpoint.level === "valuation-eligible")?.detail)
      .toContain("UNIFIED_ANALYSIS_WINDOW_BLOCKED");
  });
});
