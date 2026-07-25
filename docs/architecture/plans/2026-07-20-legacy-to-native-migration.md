# Legacy-to-Native Migration Plan — 7 Subsystem Cutover

**Date:** 2026-07-20 (IST)
**Status:** Design (Phase 1 complete)
**Scope:** Migration of legacy-analysis-run content from `legacyExecutor.ts` (1643-line single-orchestrator function) to 7 native, staged, independently-executed AnalysisRun subsystems
**Prerequisites:** ADR-009 through ADR-016 accepted (ADR-015 proposed)
**Reference:** `docs/architecture/plans/2026-07-10-principal-architecture-valuation-platform-greenfield-design.md`

---

## 1. Executive summary

`legacyExecutor.ts` currently wraps the entire analytical chain in one async function that calls 20+ subsystems sequentially, collects outputs into a monolithic `LegacyAnalysisRunMaterializationV1`, and stamps it into a `AnalysisRunV1` with derivationMode="legacy-derived". 

The target is 14 staged AnalysisRun stages, where each of the 7 native subsystems below is an independently governed, typed-input→typed-output stage contract. When all 7 run natively, `legacyExecutor.ts` can be deleted — the strangler is complete.

Current state: 0/14 stages are native. 5 hard blockers identified.

---

## 2. Subsystem migration cards

### Subsystem 1: Facts (src/engine/facts/)

**Current role in legacyExecutor (lines 293-318):**
- Called via `adaptLegacyRawPeriodsToFactSet()` — converts `RawPeriodData[]` + optional canonicalFacts input into a `FactSet`
- Only runs if `input.canonicalFacts` is supplied (optional — absent = legacy-derived, no fact-level lineage)
- `buildLegacyTransformationDag()` runs post-hoc, recording what *should have happened* rather than live recording
- Native Capitaline source adapter (`buildCapitalineCanonicalFactBundle`) exists but is NOT called from the executor

**Native target design:**
```
Stage: fact-extraction (index 2)
Input:  SourceArtifact[] + RawPeriodData[]
Output: ValidatedFactSet (content-addressed FactSetRef)
Entry:  buildCanonicalFactBundle() → validateFactSet() → factSetContentRef()
```

**Gap list:**
1. `adaptLegacyRawPeriodsToFactSet` is a backward-compatibility adapter — rewrites legacy periods as facts. Need native adapters wired into executor.
2. Native source adapters (`src/engine/facts/sourceAdapters.ts`) exist but are not integrated into the run pipeline.
3. `TransformationDag` is built *after* execution — must become a live recorder during each transformation.
4. No `SourceArtifact`-to-`FactSet` pipeline stage contract exists.

**Strangler exit criterion:**
Delete `adaptLegacyRawPeriodsToFactSet` and `buildLegacyTransformationDag` when:
- Native fact adapters run as `fact-extraction` stage
- No caller imports `adaptLegacyRawPeriodsToFactSet`
- `TransformationRecorder` is wired into each downstream stage as a dependency instead of a post-hoc builder

---

### Subsystem 2: ForecastState (src/engine/forecastState/)

**Current role in legacyExecutor (lines ~480-550):**
- `buildIndustrialForecastFromLegacyScenario()` — the *legacy bridge* function, not the native `buildIndustrialForecast()`
- Takes: command center output + latest recast period + config + window + assumptions
- Produces: `IndustrialForecastResult[]` + runs `validateIndustrialScenarioOrdering()`
- Scenario calibration is an optional post-process

**Native target design:**
```
Stage: forecast (index 10)
Input:  SourcedAssumptionSet + AnalysisWindow + FactSet + ForecastRequest
Output: IndustrialForecastCase[] + ScenarioValidationReport
Entry:  buildIndustrialForecast() → validateIndustrialScenarioOrdering()
```

**Gap list:**
1. The native `buildIndustrialForecast()` exists but has ZERO callers in the executor — only `buildIndustrialForecastFromLegacyScenario` bridge is wired.
2. Command center blends forecast assumptions with valuation — forecast needs pure forecast-case input.
3. No native forecast stage contract with typed input/output refs.
4. Scenario calibration is a tacked-on post-process, not a stage input.

**Strangler exit criterion:**
Delete `buildIndustrialForecastFromLegacyScenario` and `adaptForecastCaseToLegacyValuation` when:
- Native `buildIndustrialForecast()` is the single entry point
- Forecast runs as stage 10 consuming typed artifacts from stages 7-9
- All callers use native forecast stage output

---

### Subsystem 3: Model Catalog (src/engine/modelCatalog/)

**Current role in legacyExecutor (lines ~600-700):**
- `adaptLegacyCommandCenterModelResults()` — extracts model results from the pre-computed command center
- `generateModelCatalog()` runs once to produce the catalog artifact
- `CURRENT_MODEL_REGISTRY` governs model metadata but does NOT govern execution — models are pre-computed by `buildValuationCommandCenter`

**Native target design:**
```
Stage: model-execution (index 11)
Input:  ForecastCase[] + SourcedAssumptionSet + MarketSnapshot + AnalysisWindow
Output: ValuationModelResult[] (typed, guard-verified)
Entry:  For each registered model: evaluateApplicability() → execute() → guard() → typed result
Governance: CURRENT_MODEL_REGISTRY drives execution eligibility, not just metadata
```

**Gap list:**
1. `adaptLegacyCommandCenterModelResults` is the *only* source of model results — command center pre-computes everything and the catalog just re-labels.
2. No native model execution loop exists — models are not dispatched from the catalog.
3. `evaluateModelApplicability()` runs but doesn't gate execution — it only catalogs.
4. Advanced models (+ sector cases) mutate the command center post-hoc, violating stage boundaries.

**Strangler exit criterion:**
Delete `adaptLegacyCommandCenterModelResults` when:
- Model execution loop is catalog-driven
- Models produce typed `ValuationModelResult[]` in stage 11
- No pre-computed command center feeds into model results

---

### Subsystem 4: Sector Cases (src/engine/sectorCases/)

**Current role in legacyExecutor (lines ~560-600):**
- `executeCatalogSectorCase()` is called only if `input.sectorSidecar` is supplied as a pre-approved governance input
- Sidecar carries `GovernedSectorSidecarApproval` — must be approved, issuer-matched, and time-bound
- `CURRENT_SECTOR_CASE_REGISTRY` resolves definition → `executeSectorCase()` via `executeCatalogSectorCase`
- If sidecar execution fails, entire run is blocked at `model-execution` stage

**Native target design:**
```
Stage: model-execution (index 11) — integrated, not sidecar
Input:  SectorCaseCatalogBinding (computed from family classification, not pre-approved)
Output: SectorCaseCatalogExecutionResult (unified with model results)
Entry:  Family classification → registry lookup → execute
Governance: evaluatedSectorCaseEligibility() at runtime, not pre-approved sidecar
```

**Gap list:**
1. Sector cases require a pre-approved sidecar input — they cannot self-determine at runtime.
2. Sidecar governance (`GovernedSectorSidecarApproval`) is wired as input, not computed from family.
3. Sector case results are kept separate from model results and spliced in post-hoc.
4. Only 1 of 8 registered case types is wired (`bank` through sidecar mechanism).

**Strangler exit criterion:**
Delete `input.sectorSidecar` parameter and `executeCatalogSectorCase` when:
- Sector cases execute from family classification in the unified model-execution stage
- No pre-approved sidecar input required
- Sector results are unified in `modelResultRefs`

---

### Subsystem 5: Valuation Evidence/Synthesis (src/engine/valuationEvidence/)

**Current role in legacyExecutor (lines ~700-800, also inside `buildValuationCommandCenter`):**
- `buildScenarioGovernanceReport()` — runs after forecast, links scenarios + assumptions + command center
- `summarizeAntiTautology()` — runs as a trust enrichment after valuation
- `buildEvidenceWeightedSynthesis()` is called INSIDE `buildValuationCommandCenter`, not as a standalone stage
- The command center dominates: it blends cost-of-capital, model computation, evidence ledger, and synthesis

**Native target design:**
```
Stage: synthesis (index 12)
Input:  ValuationModelResult[] + ScenarioGovernanceReport + SourcedAssumptionSet
Output: EvidenceWeightedValuationSynthesis + AntiTautologySummary
Entry:  buildEvidenceWeightedSynthesis() → independence collapse → weighted quantiles
```

**Gap list:**
1. `buildEvidenceWeightedSynthesis` is embedded inside `buildValuationCommandCenter` — not independently callable.
2. No synthesis-only stage contract exists. Synthesis currently needs the entire command center output.
3. `scenarioGovernance` is built from command center, not from model results.
4. Anti-tautology is a post-hoc enrichment on command center, not an artifact of synthesis stage.

**Strangler exit criterion:**
Delete `summarizeAntiTautology` call from executor (move to synthesis stage) when:
- `buildEvidenceWeightedSynthesis` is callable independently
- Synthesis stage produces typed `EvidenceWeightedValuationSynthesis` artifact
- No embedded synthesis inside command center

---

### Subsystem 6: Advanced Model Governance (src/engine/advancedModelGovernance/)

**Current role in legacyExecutor (lines ~800-950):**
- `executeGovernedAdvancedModel()` — runs after sector cases, for each pre-approved advanced model
- `evaluateModelPromotion()` — checks dossier against catalog definition
- `evaluateRealOptionsCompositionCandidate()` + `applyRealOptionsCompositionCandidate()` — post-hoc composition splicing
- Advanced model results MUTATE `commandCenter` in-place (replacing `evidenceWeightedSynthesis`)
- Then rebuilds scenario governance and anti-tautology to reflect the mutation

**Native target design:**
```
Stage: model-execution (index 11) — unified with catalog
Input:  GovernedAdvancedModelInput (as catalog binding, not separate param)
Output: GovernedAdvancedModelResult (unified in modelResultRefs)
Composition: Pre-composed before synthesis, not spliced afterward
Governance: ModelPromotionDecision made at catalog binding time, not execution time
```

**Gap list:**
1. **Riskiest gap**: Advanced models mutate `commandCenter` in-place — this is fundamentally incompatible with immutable stage outputs.
2. Advanced model execution is a separate loop after regular model results, not unified in the catalog.
3. Real-options composition replaces the synthesis output after the fact — breaks stage isolation.
4. No `ModelIntegrationState` check gates whether a model runs natively in the stage or needs the legacy path.

**Strangler exit criterion:**
Delete `executeGovernedAdvancedModel` and `applyRealOptionsCompositionCandidate` from executor when:
- Advanced models run as catalog entries in the unified model-execution stage
- Composition is pre-computed before synthesis, not post-hoc mutation
- `ModelPromotionDecision` is catalog binding, not execution-time evaluation

---

### Subsystem 7: UI Projection (src/app/useRunBackedAuditAnalysis.ts + store.ts)

**Current role:**
- `useRunBackedAuditAnalysis()` — calls `useAnalysisRunExecution()` → legacy executor → `structuredClone` of materialization blob
- `buildLegacyUiProjection()` — the `structuredClone` seam that prevents tab mutation of run data
- `AnalysisRunStore` — persists runs, provides typed selectors (`selectRecastData`, `selectCommandCenter`, `selectModelResults`, etc.)
- Tabs consume `projection.commandCenter`, `projection.forecastResults`, etc. — all from one fat projection object

**Native target design:**
```
No stage — this is the CONSUMPTION layer.
Design: Each tab consumes typed artifacts via run store selectors, not the fat materialization projection.
- Dashboard: store.selectTrustEnvelope() + store.selectRecastData()
- Valuation: store.selectModelResults() + store.selectSynthesis()
- Forecast: store.selectForecastCases() + store.selectScenarioGovernance()
Path: delete buildLegacyUiProjection() when all tab selectors are typed
```

**Gap list:**
1. The `structuredClone` seam (`buildLegacyUiProjection`) exists because tabs expect mutable legacy types — must migrate each tab to typed selectors.
2. `materialization` blob is the full legacy output — large, untyped at the property level, and couples tabs to legacy schema.
3. 3 tabs (Dashboard, Valuation, Forecast) are identified as Wave-1 candidates; remaining ~17 tabs follow.

**Strangler exit criterion:**
Delete `buildLegacyUiProjection` and `LegacyUiRunProjection` type when:
- Every analysis tab consumes typed artifacts from run store selectors
- No tab accesses `materialization.commandCenter` or `materialization.pipelineResult` directly
- `structuredClone` is no longer called in the UI seam

---

## 3. Cutover sequence

| Order | Subsystem | Stage | Rationale | Rollback |
|-------|-----------|-------|-----------|----------|
| 1 | Facts | fact-extraction | Foundation — all stages below need canonical facts. Dropping the legacy adapter first forces every downstream into clean contracts. | Revert to `adaptLegacyRawPeriodsToFactSet`; fact-level lineage degrades gracefully |
| 2 | ForecastState | forecast | Needs facts + window. Extracting forecast from command center breaks the monolith dependency. | Revert to `buildIndustrialForecastFromLegacyScenario` bridge |
| 3 | Model Catalog | model-execution | Catalog-driven execution replaces command-center pre-computation. Needs forecast cases. | Revert to `adaptLegacyCommandCenterModelResults` adapter |
| 4 | Sector Cases | model-execution (integrated) | Unify with catalog execution. Needs family classification from stage 5. | Revert to sidecar input parameter |
| 5 | Valuation Evidence | synthesis | Standalone synthesis from model results. Needs model results from stage 11. | Revert to embedded synthesis inside command center |
| 6 | Advanced Model Governance | model-execution (unified) | Pull mutation pattern into pre-composition. Needs catalog-driven execution first. | Revert to post-hoc mutation; disable composition |
| 7 | UI Projection | consumption layer | Last — needs all stage artifacts. Migrate tabs one at a time. | Revert individual tab to `structuredClone` seam |

### Global strangler exit criterion

`legacyExecutor.ts` can be deleted when ALL of these hold:

1. All 7 subsystems run as native AnalysisRun stages with `derivationMode: "native"`
2. `adaptLegacyRawPeriodsToFactSet` has zero callers
3. `buildIndustrialForecastFromLegacyScenario` has zero callers
4. `adaptLegacyCommandCenterModelResults` has zero callers
5. `executeCatalogSectorCase` is not imported (sector cases run from catalog binding)
6. `buildLegacyUiProjection` and `LegacyUiRunProjection` are deleted
7. `executeGovernedAdvancedModel` runs via catalog, not separate param
8. `buildValuationCommandCenter` no longer exists (its responsibilities are split across stages 8-12)
9. `LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION` is removed from the codebase

---

## 4. Risk register — top 3 gaps

### Gap 1 (P0): Command center is a monolith

`buildValuationCommandCenter()` in `src/engine/valuationCommandCenter/` does BOTH model computation AND evidence synthesis AND cost-of-capital. Its output (`ValuationCommandCenterOutput`) is consumed by stages 10, 11, 12, and 13 simultaneously. Splitting it into 4 separate native stage contracts (cost-of-capital→assumption-resolution, model-execution, synthesis, release-trust) requires refactoring the heart of the valuation engine.

**Mitigation:** Start with a `ValuationStageCoordinator` that mimics the monolith's data flow but routes each output to the correct stage. Replace one output channel at a time.

### Gap 2 (P1): Advanced model mutation pattern

Advanced models (`src/engine/advancedModelGovernance/`) mutate `commandCenter` and `evidenceWeightedSynthesis` in-place during execution (lines 850-930 of legacyExecutor). This is fundamentally incompatible with immutable stage outputs. Real-options composition replaces the synthesis head after all other models have been computed.

**Mitigation:** Pre-compute composition eligibility during catalog binding (stage 0) and run the composed models as additional catalog entries. Composition becomes a synthesis-time merge, not a post-hoc replacement.

### Gap 3 (P1): Legacy adapter dependencies are transitive

The legacy adapter functions (`adaptLegacyRawPeriodsToFactSet`, `adaptLegacyCommandCenterModelResults`, `buildIndustrialForecastFromLegacyScenario`) are not just wrappers — they contain transformation logic that the native subsystems were designed to replace. Dropping them means proving the native equivalent produces identical (or intentionally different) results.

**Mitigation:** Dual-run parity harness. For each fixture, execute legacy path AND native path, classify deltas, require reviewer approval for intended valuation changes before deleting the adapter.

---

## 5. ADR references

| ADR | Topic | Relevance |
|-----|-------|-----------|
| ADR-009 | Immutable AnalysisRun and content identity | Core run contract that all 7 subsystems target |
| ADR-010 | Canonical facts and execution-time lineage | Facts subsystem design (Subsystem 1) |
| ADR-011 | Monotonic gates and insufficient evidence | Stage gating and terminal outcomes |
| ADR-012 | ForecastState separate from RecastPeriod | Forecast subsystem design (Subsystem 2) |
| ADR-013 | Model catalog and independence-aware synthesis | Catalog + Synthesis design (Subsystems 3, 5) |
| ADR-014 | Explicit capital-cost modes and provenance | Cost-of-capital as stage input (prerequisite for Subsystem 2) |
| ADR-015 | Server-side principal, tenancy, and storage split | Platform layer for run persistence (prerequisite for Subsystem 7 deletion) |
| ADR-016 | Sector-native case contracts and maturity credit | Sector case design (Subsystem 4) |

---

## 6. Immediate next action

Begin with **Subsystem 1 (Facts)** and **Subsystem 2 (ForecastState)** in parallel:

1. **Facts:** Wire `buildCapitalineCanonicalFactBundle` into the executor as the primary path; make `adaptLegacyRawPeriodsToFactSet` the fallback; add `fact-extraction` stage contract.
2. **ForecastState:** Replace `buildIndustrialForecastFromLegacyScenario` with `buildIndustrialForecast` in the executor; add `forecast` stage contract.
3. **Dual-run harness:** Extend the golden-suite test runner to execute both legacy and native paths for steps 1-2, record deltas, and require review before adapter deletion.

Do not start Subsystem 3 (Catalog) until Subsystems 1-2 produce typed artifacts that the model execution stage can consume.

---

## 7. Native valuationCommandCenter decomposition

**Status:** Design (Phase 2, P0 — complete)
**Owner:** Archy
**Scope:** Split `buildValuationCommandCenter` (598-line monolith + ~820 lines of helpers/builders/solvers) into 4 discrete native AnalysisRun stages. Each stage produces typed, content-addressed artifacts consumed by the next stage — no in-memory legacy `ValuationCommandCenterOutput` object.

### 7.1 Current state: what the monolith does

`buildCoreCommandCenter()` in `core.ts` runs a single deterministic sequence that produces ~30 output properties simultaneously:

1. **Share basis & readiness** — `resolveShareBasis()`, `resolveValuationReadiness()`
2. **Sector template** — `resolveValuationSectorTemplate()`
3. **Cash-flow diagnostics** — `computeCashFlowDiagnostics()` (maintenance capex, owner earnings, reinvestment)
4. **Business model** — `buildBusinessModelProfile()` + `computeQualityScore()`
5. **Cost of capital** — `resolveCostOfCapitalFromConfig()`
6. **Scenario cards (4)** — `buildScenarioCards()` → calls `derivePersistenceForecastScenario()` × 4 → `computeValuation()` × 4
7. **Reverse DCF** — `buildReverseDcfExpectation()`
8. **SOTP** — `buildSotpAssessment()` (parsed segment data or preset)
9. **EV/EBITDA cross-check** — `computeEvEbitdaCrossCheck()` + `updateEvEbitdaWithMarketPrice()`
10. **India quality signals** — `computeIndiaQualitySignals()`
11. **Earnings quality** — `buildDechowDichevAndRem()` → `buildEarningsQualityCard()`
12. **Class-A models (4)** — `buildClassAModels()` → workingCapitalGate, cleanSurplus, damodaranCapm, reverseDcfMonteCarlo
13. **Cash-flow DCF** — `computeCashFlowDcf()`
14. **Evidence ledger + holdout + market expectations** — `buildAssumptionEvidenceLedger()`, `evaluateForecastHoldout()`, `buildMarketImpliedExpectationLedger()`
15. **Evidence-weighted synthesis** — `buildEvidenceWeightedSynthesis()`
16. **Valuation triangulation** — `buildValuationTriangulationEvidence()`
17. **Opportunity assessment + signal + checklist + range** — computed from everything above

The legacy executor consumes this single output in 5 separate ways:
- `buildRunAssumptionCandidates()` → extracts `costOfCapital` + `scenarios[].assumptions`
- `buildRunForecastResults()` → wraps `scenarios` into `IndustrialForecastResult[]` via `buildIndustrialForecastFromLegacyScenario`
- `adaptLegacyCommandCenterModelResults()` → rewraps every command-center property as a catalog model result
- `commandCenter.evidenceWeightedSynthesis` → synthesis artifact (possibly mutated by advanced models)
- `commandCenter.valuationTriangulation` → trust envelope enrichment

### 7.2 Native stage decomposition

The monolith splits into 4 stages that follow the canonical AnalysisRun stage order (9→10→11→12). Each stage exposes a single entry-point function that accepts typed `ContentRef` inputs and produces typed `ContentRef` outputs. No stage accesses a `ValuationCommandCenterOutput` object.

---

#### Stage 9: assumption-resolution (capital-cost → sourced assumptions)

**What it replaces from the monolith:**
- `resolveCostOfCapitalFromConfig()` — standalone, already exists as a pure function
- Scenario-pinned `ke` and `kw` extraction (currently reads from `commandCenter.costOfCapital` + `commandCenter.scenarios[0].assumptions`)
- `resolveShareBasis()` + `resolveValuationReadiness()` — already standalone

**Native design:**
```ts
// contracts/assumption-resolution.ts
export interface AssumptionResolutionInput {
  readonly recastPeriodsRef: ContentRef<"recast-periods">;
  readonly analysisWindowRef: ContentRef<"analysis-window">;
  readonly marketSnapshotRef: ContentRef<"market-snapshot"> | null;
  readonly factSetRef: ContentRef<"fact-set">;
  readonly policyBundleRef: ContentRef<"policy-bundle">;
  readonly config: DeepReadonly<EngineConfig>;
  readonly issuerId: string;
}

export interface AssumptionResolutionOutput {
  readonly sourcedAssumptionSet: SourcedAssumptionSet;
  readonly costOfCapital: CostOfCapitalResult;
  readonly shareBasis: ShareBasisResult;
  readonly valuationReadiness: ValuationReadiness;
  readonly asOf: string | null;
}
```

**Key change from today:**
- `buildRunAssumptionCandidates()` currently reads `commandCenter.costOfCapital` and `commandCenter.scenarios.find(s => s.key === "base").assumptions` — these must be resolved from the native artifact chain instead
- The base-case terminal growth (`g_terminal`) candidate is currently extracted from the monolith's scenario card. In the native path, assumption resolution must run BEFORE forecast: it produces the `ke` and `kw` that forecast uses, not the other way around
- Fail-closed: if `resolveShareBasis` returns `confidence === "FAILED"`, the assumption set carries `shareBasisStatus: "blocked"` which caps all downstream stages

---

#### Stage 10: forecast (scenario generation → forecast cases)

**What it replaces from the monolith:**
- `buildScenarioCards()` — currently derives 4 scenarios (stress, base, bull, historical-panic) from the same recast data
- `derivePersistenceForecastScenario()` × 4 — the driver vector generation
- `computeValuation()` × 4 — the Penman-Nissim valuation for each scenario

**Native design:**
```ts
// contracts/forecast.ts
export interface ForecastStageInput {
  readonly recastPeriodsRef: ContentRef<"recast-periods">;
  readonly analysisWindowRef: ContentRef<"analysis-window">;
  readonly assumptionSetRef: ContentRef<"assumption-set">;
  readonly marketSnapshotRef: ContentRef<"market-snapshot"> | null;
  readonly factSetRef: ContentRef<"fact-set">;
  readonly config: DeepReadonly<EngineConfig>;
  readonly sectorTemplateId: string;
}

export interface ForecastStageOutput {
  readonly forecastCaseRefs: ContentRef<"forecast-case">[];
  readonly scenarioCards: ScenarioCardArtifact[];  // 4 scenarios with their valuations
  readonly scenarioOrderingReport: ScenarioOrderingReport;
}
```

**Each forecast case is independently content-addressed** (4 cases → 4 `ContentRef<"forecast-case">`), not a single `scenarios[]` array. The cases become inputs to the model-execution stage.

**Key change from today:**
- Today's `buildRunForecastResults()` creates `IndustrialForecastResult[]` by calling `buildIndustrialForecastFromLegacyScenario()` (the legacy bridge) on each command-center scenario card
- Native: `buildScenarioCards()` becomes a pure stage function that produces typed forecast cases directly, bypassing `buildIndustrialForecastFromLegacyScenario` entirely
- `validateIndustrialScenarioOrdering()` runs as a gate within this stage — it must receive all 4 cases, not just the legacy bridge output

---

#### Stage 11: model-execution (dispatched sub-models)

**What it replaces from the monolith:**
- `buildReverseDcfExpectation()` — reverse DCF solver
- `buildSotpAssessment()` — SOTP (segment/preset-based)
- `computeEvEbitdaCrossCheck()` — relative cross-check
- `computeIndiaQualitySignals()` — quality overlay
- `buildDechowDichevAndRem()` + `buildEarningsQualityCard()` — earnings quality
- `buildClassAModels()` — workingCapitalGate, cleanSurplus, damodaranCapm, reverseDcfMonteCarlo
- `computeCashFlowDcf()` — independent cash-statement DCF
- `computeEPV()` — Graham-Dodd EPV
- `buildAssumptionEvidenceLedger()` — evidence ledger (diagnostic)
- `evaluateForecastHoldout()` — forecast skill assessment (diagnostic)
- `buildMarketImpliedExpectationLedger()` — market expectations (diagnostic)

**Each model becomes an independently dispatchable catalog entry:**

| modelId | Category | Independence group | Current location | Content-addressed output |
|---------|----------|-------------------|------------------|--------------------------|
| industrial.reverse-dcf | market-implied | market-price-diagnostic | `helpers.ts` | `ModelArtifact<"reverse-dcf">` |
| industrial.sotp | intrinsic | segment | `builders.ts` | `ModelArtifact<"sotp">` |
| industrial.ev-ebitda | relative | peer-market | `core.ts` (via `../evEbitdaCrossCheck`) | `ModelArtifact<"ev-ebitda">` |
| industrial.earnings-quality | quality | quality-overlay | `core.ts` (via `../earningsQuality`) | `ModelArtifact<"earnings-quality">` |
| industrial.working-capital-gate | intrinsic | operational-driver | `builders.ts` (via `../valuation/workingCapitalGate`) | `ModelArtifact<"working-capital-gate">` |
| industrial.clean-surplus | diagnostic | accrual-residual | `builders.ts` (via `../valuation/cleanSurplus`) | `ModelArtifact<"clean-surplus">` |
| industrial.damodaran-capm | diagnostic | accrual-residual | `builders.ts` (via `../valuation/damodaranCapm`) | `ModelArtifact<"damodaran-capm">` |
| industrial.reverse-dcf-monte-carlo | market-implied | market-price-diagnostic | `builders.ts` (via `../valuation/reverseDcfMonteCarlo`) | `ModelArtifact<"reverse-dcf-monte-carlo">` |
| industrial.cash-flow-dcf | intrinsic | direct-cash-statement | `core.ts` (via `../cashFlowDcf`) | `ModelArtifact<"cash-flow-dcf">` |
| industrial.epv | intrinsic | asset-book-value | `core.ts` (via `../grahamDoddEPV`) | `ModelArtifact<"epv">` |
| industrial.evidence-ledger | diagnostic | — | `core.ts` (via `../valuationEvidence`) | `ModelArtifact<"evidence-ledger">` |
| industrial.forecast-holdout | diagnostic | — | `core.ts` (via `../valuationEvidence`) | `ModelArtifact<"forecast-holdout">` |
| industrial.market-implications | market-implied | market-price-diagnostic | `core.ts` (via `../valuationEvidence`) | `ModelArtifact<"market-implications">` |

**Native design:**
```ts
// contracts/model-execution.ts
export interface ModelExecutionStageInput {
  readonly forecastCaseRefs: ContentRef<"forecast-case">[];
  readonly assumptionSetRef: ContentRef<"assumption-set">;
  readonly marketSnapshotRef: ContentRef<"market-snapshot"> | null;
  readonly analysisWindowRef: ContentRef<"analysis-window">;
  readonly recastPeriodsRef: ContentRef<"recast-periods">;
  readonly factSetRef: ContentRef<"fact-set">;
  readonly config: DeepReadonly<EngineConfig>;
}

export interface ModelExecutionStageOutput {
  readonly modelResultRefs: ContentRef<"model-result">[];
  readonly valuationTriangulation: ValuationTriangulationEvidence;
}
```

**Each model executes independently. Its inputs are ContentRefs, not properties of a shared in-memory object.** The catalog (`CURRENT_MODEL_REGISTRY`) gates:
- Applicability: `evaluateApplicability(context)` — does this company/family support this model?
- Guards: each model's `execute()` runs `guard()` and returns `"invalid"` or `"insufficient-evidence"` if guards fail
- Catalog ID assignment: every result carries its `catalogEntryId` + `caseId` so synthesis can trace back to the definition

**Key change from today:**
- Today: `adaptLegacyCommandCenterModelResults()` extracts 15+ model results from one flat object by property name → rewraps as catalog entries
- Native: each model is independently invoked with typed inputs. Evidence ledger, holdout, and market expectations become separate catalog entries (diagnostic, not intrinsic) instead of being embedded in `buildEvidenceWeightedSynthesis`'s closure
- Cash-flow DCF, EPV, working-capital gate, clean-surplus, Damodaran CAPM, reverse-DCF Monte Carlo — all independently dispatched

---

#### Stage 12: synthesis (evidence-weighted from ContentRefs only)

**What it replaces from the monolith:**
- `buildEvidenceWeightedSynthesis()` — currently receives typed objects (scenarios, cashFlowDcf, evEbitdaPerShare, reverseDcf, evidenceLedger, forecastHoldout, marketPrice)
- The composition mutation from advanced models (currently mutates commandCenter in-place)

**Native design — the `SynthesisRef` contract:**

```ts
// contracts/synthesis.ts
export interface SynthesisStageInput {
  readonly modelResultRefs: ContentRef<"model-result">[];
  readonly forecastCaseRefs: ContentRef<"forecast-case">[];
  readonly assumptionSetRef: ContentRef<"assumption-set">;
  readonly marketSnapshotRef: ContentRef<"market-snapshot"> | null;
  readonly scenarioGovernanceReport: ScenarioGovernanceReport;
  readonly config: DeepReadonly<EngineConfig>;
}

/** The output of the synthesis stage — consumed by release-trust and UI.
 *  This is the artifact that replaces commandCenter.evidenceWeightedSynthesis. */
export interface SynthesisRef {
  readonly synthesis: EvidenceWeightedValuationSynthesis;
  readonly intrinsicRange: {
    readonly lowPerShare: number | null;
    readonly midPerShare: number | null;
    readonly highPerShare: number | null;
  };
  readonly opportunityScore: number;
  readonly convictionBucket: "research-only" | "starter" | "accumulate" | "high-conviction" | "truck-load zone";
  readonly signalState: ValuationSignalState;
  readonly signalSummary: string;
  readonly supportingFlags: readonly string[];
  readonly killSwitches: readonly string[];
  readonly checklist: ValuationChecklist;
  readonly range: {
    readonly floorPerShare: number | null;
    readonly ceilingPerShare: number | null;
  };
  readonly compositionDiagnostics: CompositionDiagnostics | null;
  readonly computedModelCount: number;
  readonly independentGroupsRepresented: number;
}
```

**Key change from today:**
- Today's `buildEvidenceWeightedSynthesis()` receives pre-computed in-memory objects (scenarios array, cashFlowDcf result, etc.) — these are all addressed via ContentRefs now
- The synthesis stage calls delegates to resolve each ContentRef, reconstructs the typed input for `buildEvidenceWeightedSynthesis`, runs it, and publishes the result as a new `ContentRef<"synthesis">`
- Anti-tautology check runs as a subtask within this stage (moved from `release-trust` enrichment where it currently lives)
- Advanced model composition is PRE-computed as additional catalog entries in stage 11, NOT applied as a post-hoc mutation. The synthesis stage receives the FULL set of model results (including composed ones) and weights them according to independence group. If composition created a new synthesis head, it's one more model result, not a replacement of the synthesis function output

**Fail-closed behavior preserved:**

| Condition | Current behavior (monolith) | Native behavior |
|-----------|----------------------------|-----------------|
| `shareBasis.confidence === "FAILED"` | `perShareBlocked = true` caps signal at `guarded` | Stage 9 outputs `shareBasisStatus: "blocked"` → stage 12 refuses to compute per-share values |
| `marketFreshness === "stale"` | Signal rank capped at `interesting` | Stage 11 model results carry `marketFreshness` metadata → synthesis weights reduced for market-implied models |
| `marketFreshness === "missing"` | Signal capped at `guarded` | Stage 12 receives `marketSnapshotRef = null` → synthesis uses config fallback with `freshnessScore = 0` |
| `analysisStatus.status === "blocked"` | Kill switch triggers `blocked` state | Stage 9 carries `analysisStatus.blocked` → stage 12 gate: kill switches block synthesis |
| `valuationReadiness.status !== "production-ready"` | Caps at `guarded`, adds 0.04 MoS penalty | Stage 9 outputs `valuationReadinessStatus` → stage 12 adjusts `requiredMarginOfSafetyPct` before signal computation |
| CSE ≤ 0 (weak economics) | Implicitly handled by scenario valuation failures | Model-level guard: `evaluateEconomicSanity(cse)` → returns `"invalid"` for models requiring positive CSE |
| Scenario ordering violation (stress > base) | `scenarioOrderingPenalty` subtracts from opportunity score | Stage 10 gate: `validateScenarioOrdering()` produces `orderingViolation` → stage 12 applies same penalty |

### 7.3 Dependent-function migration path

Three functions in legacyExecutor that currently read from the monolith must be migrated to read from native artifacts:

#### `buildRunAssumptionCandidates()` — currently reads `commandCenter.costOfCapital` + `commandCenter.scenarios[].assumptions`

**Native path:** Stage 9 produces `SourcedAssumptionSet` directly. The candidates for `ke`, `kw`, `g_terminal`, `salesGrowthYear1`, `corePmYear1`, `assetTurnoverYear1`, and `marketPrice` are resolved from the assumption set artifact, not from the command center. The forecast stage consumes this assumption set rather than reading scenarios' embedded assumptions.

**Strangler phases:**
1. **Phase A (dual-read):** `buildRunAssumptionCandidates` reads from BOTH the command center (legacy) AND the native assumption set. If they diverge, emit diagnostic. System consumes legacy path.
2. **Phase B (native-primary):** System reads from native assumption set. Legacy command center is still available as fallback but not used.
3. **Phase C (delete):** `buildRunAssumptionCandidates` deleted. Assumption candidates come from native artifact entirely.

#### `buildRunForecastResults()` — currently reads `commandCenter.scenarios` + calls `buildIndustrialForecastFromLegacyScenario`

**Native path:** Stage 10 produces `IndustrialForecastCase[]` directly. Each case is a typed artifact. No bridge function needed.

**Strangler phases:**
1. **Phase A (dual-write):** The command center's scenarios are ALSO written as native forecast artifacts (one-time adapter layer)
2. **Phase B (native-only):** Forecast cases come from stage 10. `buildIndustrialForecastFromLegacyScenario` is deleted.

#### `adaptLegacyCommandCenterModelResults()` — currently reads ~20 properties from `ValuationCommandCenterOutput`

**Native path:** Each model runs independently in stage 11. The catalog entry maps modelId → `execute()` function. No central adapter needed.

**Strangler phases:**
1. **Phase A (dual-write):** Each model in the monolith also publishes its result as a `ContentRef<"model-result">`
2. **Phase B (native-only):** Each model runs independently. `adaptLegacyCommandCenterModelResults` deleted.

### 7.4 SynthesisRef composition: advanced model mutation resolved

The trickiest design problem is the **advanced model mutation pattern**:

**Today's flow:**
1. `buildValuationCommandCenter` produces `commandCenter.evidenceWeightedSynthesis`
2. Legacy executor runs `executeGovernedAdvancedModel()` for each pre-approved advanced model
3. If a real-options composition policy exists: `applyRealOptionsCompositionCandidate()` REPLACES `commandCenter.evidenceWeightedSynthesis` with a new synthesis object
4. Scenario governance and anti-tautology are rebuilt to match the new synthesis
5. The synthesis artifact published to the run contains the POST-MUTATION value

**Native flow:**
1. Advanced models register as catalog entries in `CURRENT_MODEL_REGISTRY` with category `"optionality"` and independence group `"optionality"`
2. During catalog binding (stage 0, at executor startup), `evaluateModelPromotion()` runs and determines whether each advanced model is eligible
3. Eligible advanced models execute in stage 11 alongside intrinsic models, producing independent `ModelArtifact<"advanced-model">` results
4. If the advanced model is a real-options composition (e.g. `advanced.real-options-rd-pipeline`), the composition is pre-computed as an additional forecast case + model result, not a replacement of the synthesis head
5. Stage 12 (synthesis) receives ALL model results — both intrinsic and optionality — and weights them according to independence group
6. If composition produces a materially different valuation range, it manifests as divergence in the independence-group collapse, not as a silent replacement

**This means:** `commandCenter.evidenceWeightedSynthesis` is never mutated post-hoc. The synthesis stage always produces the ground truth from the full set of model results it receives. Advanced models contribute to the evidence base rather than overriding it.

### 7.5 Hardest decoupling: the opportunity assessment and signal chain

The single hardest piece to decouple is not any individual model — it's the **opportunity score → signal state → conviction bucket → checklist** chain (lines 377-520 of `core.ts`). This chain reads from 17 different sources simultaneously:
- `qualityScore` (from business model + analysis status)
- `stressCard.marginOfSafetyPct` (from scenario 0)
- `baseCard.marginOfSafetyPct` (from scenario 1)
- `historicalCheapnessScore` (from reverse DCF + market history)
- `reverseDcfPessimismScore` (from reverse DCF)
- `freshnessScore` (from market data)
- `replayCoverageScore` (from market history)
- `confidencePenalty` (from analysisStatus, valuationReadiness, data length, persistenceScore, freshnessScore, scenarioPenalty)
- `requiredMarginOfSafetyPct` (from sector template, quality score, persistence penalty, confidence state, valuation readiness, market freshness)
- `persistenceConvictionCeiling` (from business model persistenceScore)
- Kill switches, scenario ordering, valuation readiness, stale/fallback gates

**In the native architecture, this chain splits across 3 stages:**
1. Stage 9 (assumption-resolution): computes `requiredMarginOfSafetyPct`, `persistencePenalty`, `confidencePenalty` components that depend on config/readiness/status
2. Stage 11 (model-execution): each model produces `{marginOfSafetyPct, expectedCagr, perShare}` → these become inputs to signal computation
3. Stage 12 (synthesis): computes the final signal by merging:
   - Model-level MoS + CAGRs from stage 11 model results
   - `requiredMarginOfSafetyPct` from stage 9 artifact
   - Market context from `marketSnapshotRef`
   - Historical cheapness from reverse-DCF model result
   - Persistence ceiling from business-model artifact
   - Kill switches from stage 9's `valuationReadiness` + `analysisStatus` refs

**The strangler adapter** for the signal chain is a `SignalStageCoordinator` that reads from both legacy monolith and native artifacts, computes the signal twice, and emits a diagnostic if they diverge. This coordinator is deleted when stages 9→11→12 are all native.

### 7.6 Summary: before vs after

| Dimension | Today (monolith) | Target (native) |
|-----------|-----------------|-----------------|
| Entry point | `buildValuationCommandCenter(CoreBuildContext)` → `ValuationCommandCenterOutput` | 4 independent stage functions, each reading/writing `ContentRef` artifacts |
| Cost of capital | Resolved inside command center, extracted by `buildRunAssumptionCandidates` | Stage 9 produces `SourcedAssumptionSet` + `CostOfCapitalResult` as artifacts |
| Scenarios | 4 scenarios in a flat array consumed by forecast bridge | Stage 10 produces 4 independently content-addressed `forecast-case` artifacts |
| Model results | 15+ results extracted from flat object properties by `adaptLegacyCommandCenterModelResults` | Stage 11 dispatches each model via catalog, each produces typed `model-result` artifact |
| Evidence synthesis | Embedded inside command-center closure, receives in-memory objects | Stage 12 receives only `ContentRef`s, resolves them internally |
| Advanced model mutation | Post-hoc `applyRealOptionsCompositionCandidate` replaces synthesis in-place | Composition pre-computed in stage 11 as additional model result; synthesis weights all results |
| Signal + opportunity score | Computed in one 144-line block reading 17 variables simultaneously | Distributed across stages 9 (readiness), 11 (model MoS), 12 (merge + verdict) |
| Fail-closed (weak share basis) | `perShareBlocked = true` caps signal | Stage 9 outputs `shareBasisStatus: "blocked"` → stage 12 gate blocks per-share synthesis |
| Fail-closed (stale market) | `freshnessScore < 0.35` caps signal | Stage 12 applies same cap based on `marketSnapshotRef` freshness metadata |
| Fail-closed (CSE ≤ 0) | Implicit via valuation failures | Individual model `evaluateEconomicSanity()` guards return `"invalid"` |

### 7.7 Strangler exit criterion for the command center monolith

`buildValuationCommandCenter()` and `ValuationCommandCenterOutput` can be deleted when ALL of these hold:

1. Stage 9 (assumption-resolution) produces a `SourcedAssumptionSet` artifact consumed by forecast and synthesis — no stage reads `commandCenter.costOfCapital` or `commandCenter.scenarios[].assumptions`
2. Stage 10 (forecast) produces independently content-addressed forecast cases — `buildRunForecastResults` and `buildIndustrialForecastFromLegacyScenario` have zero callers
3. Stage 11 (model-execution) dispatches each model independently via `CURRENT_MODEL_REGISTRY` — `adaptLegacyCommandCenterModelResults` has zero callers
4. Stage 12 (synthesis) consumes only `ContentRef`s — no stage reads `commandCenter.evidenceWeightedSynthesis` or `commandCenter.evidenceLedger` directly
5. Advanced models execute as catalog entries, not via `executeGovernedAdvancedModel` — `applyRealOptionsCompositionCandidate` has zero callers
6. The signal chain (opportunity score → conviction bucket → signal state → checklist) is computed entirely across stages 9-12 — no consumer reads `commandCenter.signal` or `commandCenter.opportunity`
7. `buildCoreCommandCenter` is not imported by any file outside its test suite

At this point the entire `src/engine/valuationCommandCenter/` directory can be archived (or kept as a reference implementation), and `legacyExecutor.ts` reference to `buildValuationCommandCenter` is deleted.

---

## 8. Cutover #1: Ingestion parsers → canonical FactSet

**Status:** Design (Phase 2, cutover #1 — complete)
**Owner:** Archy
**Scope:** Every ingestion parser emits `SourceArtifact` (content-hashed) → canonical `FactSet` directly, replacing `adaptLegacyRawPeriodsToFactSet`. `RawPeriodData` becomes a derived view from `FactSet`.

### 8.1 Current state: what each parser does today

There are 6 active parsers. Every one produces `RawPeriodData[]` — an untyped map of raw metric label → numeric value with no canonical identity, no artifact provenance, no concept mapping, and no content addressing:

| Parser | Source | Output today | Lines | Native capability |
|--------|--------|--------------|-------|-------------------|
| `capitalineParser.ts` | ZIP of XLS/HTML/XML files | `RawPeriodData[]` + `CapitalineParseDebug` (with `sourceArtifactHashes`, `factOrigins`) | 562 | **Has** `buildCapitalineCanonicalFactBundle()` (226 lines in `sourceAdapters.ts`) — already produces `CanonicalFactIngestionBundle` but is NOT wired into executor |
| `screenerParser.ts` | Screener tab-delimited paste | `RawPeriodData[]` + `SourceParserDiagnostics` | 134 | No native adapter — raw labels are passthrough |
| `xbrlParser.ts` | MCA iXBRL/XML | `RawPeriodData[]` + `SourceParserDiagnostics` (with `FACT_TO_CANONICAL` map) | 156 | Has a `FACT_TO_CANONICAL` concept map but no `SourceArtifact` identity or `FactSet` creation |
| `jsonIngestion.ts` | JSON array | `RawPeriodData[]` + `SourceParserDiagnostics` | 100 | No native adapter — raw labels passthrough |
| `manualEntryParser.ts` | UI form | `RawPeriodData[]` + `ManualValidation` | 137 | Has `buildTextCanonicalFactBundle()` path but manual entry goes through `manualPayloadToRaw` → `RawPeriodData[]` |
| `segmentParser.ts` | SegmentFinance HTML | `SegmentData` (typed, not RawPeriodData) | 330 | Runs independently — not part of the `adaptLegacyRawPeriodsToFactSet` pipeline |

### 8.2 Per-parser native entry signature

#### 8.2.1 Capitaline (already has native adapter — wire it)

```ts
// src/engine/facts/sourceAdapters.ts — already exists
buildCapitalineCanonicalFactBundle(args: {
  readonly rawData: readonly RawPeriodData[];
  readonly debug: CapitalineParseDebug;      // already carries sourceArtifactHashes + factOrigins
  readonly scope: FactScope;                  // "consolidated" | "standalone" | "segment"
  readonly contentClass: string;              // e.g. "capitaline-financial-statements-v1"
}): CanonicalFactIngestionBundle | null

// The bundle contains:
//   sourceArtifacts: SourceArtifact[]     — content-hashed from SHA-256 of file bytes
//   periodSources: Record<string, LegacyPeriodSource>  — file/cell/row provenance per period
//   conceptMappings: LegacyConceptMapping[]  — from CONCEPT_ONTOLOGY
```

**Gap:** Not wired into the run pipeline. The executor calls `adaptLegacyRawPeriodsToFactSet()` which requires `(rawData, sourceArtifacts, periodSources, conceptMappings)` — the same 4 arguments that `buildCapitalineCanonicalFactBundle` already produces in 3-in-1 form.

**Native path:** Call `buildCapitalineCanonicalFactBundle(rawData, debug, scope, contentClass)` → get bundle → directly pass to `createFactSet()` → publish `FactSetRef`. Bypass `adaptLegacyRawPeriodsToFactSet` entirely.

#### 8.2.2 Screener (needs native adapter)

```ts
// Proposed: src/engine/facts/sourceAdapters.ts — new function
async function buildScreenerCanonicalFactBundle(args: {
  readonly rawData: readonly RawPeriodData[];
  readonly sourceText: string;             // original tab-delimited text
  readonly scope: FactScope;
  readonly contentClass: string;
}): Promise<CanonicalFactIngestionBundle | null>
```

**Design:**
- Uses `buildTextCanonicalFactBundle()` base — shared with XBRL, JSON, manual
- SHA-256 of `sourceText` → `SourceArtifact.artifactId`
- Concept mappings from `buildOntologyConceptMappings(rawData)` — same ontology lookup as Capitaline
- Screener-specific: labels like `"Revenue"`, `"Net Profit"`, `"Total Assets"` are matched against `CONCEPT_ONTOLOGY.aliases` via `candidateRawKey()`. No Screener-specific label normalization is needed — the ontology engine already resolves labels by structural alias matching

#### 8.2.3 XBRL (needs native adapter with concept bridge)

```ts
// Proposed: src/engine/facts/sourceAdapters.ts — new function
async function buildXbrlCanonicalFactBundle(args: {
  readonly rawData: readonly RawPeriodData[];
  readonly sourceText: string;             // original XBRL XML text
  readonly scope: FactScope;
  readonly contentClass: string;
}): Promise<CanonicalFactIngestionBundle | null>
```

**Design:**
- Uses `buildTextCanonicalFactBundle()` base for SourceArtifact creation
- **But** XBRL fact names (e.g. `"RevenueFromOperations"`, `"EquityAttributableToOwnersOfParent"`) are XML local-names, not natural-language labels. The existing `FACT_TO_CANONICAL` map in `xbrlParser.ts` (line 5-38) bridges XBRL tags → canonical labels → `CONCEPT_ONTOLOGY`.
- **Native concept mapping:** Transform `FACT_TO_CANONICAL` into `LegacyConceptMapping[]` by resolving each canonical label back through `buildOntologyConceptMappings()` — effectively creating a two-level bridge: `xbrl-tag → canonical-label → conceptId`.
- XBRL context refs (`contextRef` attribute on facts) map to `origin.locator.xbrlContextId` — preserving fact-level provenance that the legacy RawPeriodData drops

#### 8.2.4 JSON (needs native adapter)

```ts
// Proposed: src/engine/facts/sourceAdapters.ts — new function
async function buildJsonCanonicalFactBundle(args: {
  readonly rawData: readonly RawPeriodData[];
  readonly sourceText: string;             // original JSON text
  readonly scope: FactScope;
  readonly contentClass: string;
}): Promise<CanonicalFactIngestionBundle | null>
```

**Design:**
- Uses `buildTextCanonicalFactBundle()` base
- JSON label keys are passthrough — already natural-language labels (same format as Capitaline raw labels)
- `buildOntologyConceptMappings(rawData)` resolves labels against `CONCEPT_ONTOLOGY` identically to Capitaline
- JSON's `raw_metric_values` pass through `candidateRawKey()` against ontology aliases with no special handling

#### 8.2.5 Manual entry (has path, needs final wiring)

```ts
// Already has: buildTextCanonicalFactBundle with sourceMode="manual"
// Manual entry goes through: manualPayloadToRaw(payload) → RawPeriodData[]
// Proposal:
async function buildManualCanonicalFactBundle(args: {
  readonly payload: ManualEntryPayload;
  readonly scope: FactScope;
  readonly contentClass: string;
}): Promise<CanonicalFactIngestionBundle | null>
```

**Design:**
- Converts `payload.periods` to `RawPeriodData[]` internally (reuses `manualPayloadToRaw`)
- Calls `buildTextCanonicalFactBundle()` with `sourceMode="manual"`, passes `enteredBy` from payload
- The `SourceArtifact` is the hash of the serialized payload — manual entries get content identity
- `periodSources` carry `kind: "manual"` → facts produced have `factKind: "manual"` and `confidence: "manual"`

#### 8.2.6 Segment parser — no change needed

The segment parser produces typed `SegmentData`, not `RawPeriodData[]`. It feeds into SOTP model (stage 11), not into the fact pipeline. No change required.

### 8.3 Concept-mapping contract (ADR-001 concept identity layer)

The concept ontology (`CONCEPT_ONTOLOGY` in `src/engine/conceptOntology.ts`) is the single contract that maps parser labels → canonical concept IDs:

```ts
// Each CONCEPT_ONTOLOGY entry (synthetic example):
{
  id: "revenue",            // Canonical concept ID — stable across parsers
  statement: "ProfitLoss",   // Owning statement: BalanceSheet | ProfitLoss | CashFlow | Derived
  aliases: [                 // All known parser labels for this concept
    "Revenue From Operations(Net)",
    "Revenue From Operations",
    "RevenueFromOperations",
    "Revenue",              // Screener label
    "Income from operations",
    "Revenue (Net)",
  ]
}
```

**How each parser connects to the ontology:**

| Parser | Label format | Ontology resolution | Confidence |
|--------|-------------|---------------------|------------|
| Capitaline | Natural language (e.g. `"Revenue From Operations(Net)__ProfitLoss"`) | Exact alias match via `candidateRawKey()` | `"mapped"` |
| Screener | Natural language (e.g. `"Revenue"`) | Exact alias match | `"mapped"` |
| XBRL | XML local-name (e.g. `"RevenueFromOperations"`) | Two-level: `FACT_TO_CANONICAL` → canonical label → alias match | `"mapped"` |
| JSON | Natural language (flexible) | Exact alias match | `"mapped"` |
| Manual | Natural language (user-provided) | Exact alias match; unmatched labels produce `"inferred"` confidence | `"manual"` or `"inferred"` |

**Unmatched labels:** Any parser label that does not match a `CONCEPT_ONTOLOGY` alias produces a diagnostic (`NO_MAPPED_FACTS`) but does NOT block the fact set — unmapped labels are skipped, and the fact set absorbs only ontology-backed facts. This is unchanged from the current `adaptLegacyRawPeriodsToFactSet` behavior.

### 8.4 RawPeriodData becomes a derived view from FactSet

Today `RawPeriodData` is the parser output — the truth. After migration, `RawPeriodData` is a **derived projection** of the canonical `FactSet`:

```ts
// Proposed: src/engine/facts/rawPeriodProjection.ts
export function projectRawPeriodData(factSet: FactSet): RawPeriodData[] {
  // Group facts by period_end
  const periods = new Map<string, Record<string, number | null>>();
  for (const fact of factSet.facts) {
    const key = periods.get(fact.period.end) ?? {};
    // Use rawLabel as key (same as today's parser output)
    // For facts with identical rawLabel in same period, the ontology-mapped
    // conceptId determines which value wins — same precedence as today
    key[fact.rawLabel] = fact.value.kind === "numeric"
      ? Number(fact.value.decimal)
      : null;
    periods.set(fact.period.end, key);
  }
  return Array.from(periods.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodEnd, metrics]) => ({
      company_id: factSet.issuerId,
      period_end: periodEnd,
      raw_metric_values: metrics,
    }));
}
```

**Why this matters:**
- The recast stage (which builds `RecastPeriod` from `RawPeriodData`) already takes `RawPeriodData[]` as input. By projecting from `FactSet`, the recast stage consumes canonical data without knowing about parser internals.
- The `FactSet` is content-addressed; the projected `RawPeriodData[]` inherits that identity stability. Two runs with identical facts produce identical projections.
- Legacy code that still reads `RawPeriodData[]` from the run store continues to work — the projection is computed at stage boundary, not persisted.
- When all consumers are migrated to `FactSet`-aware selectors, the projection function can be deleted.

### 8.5 Native fact-extraction stage contract

```ts
// Stage: fact-extraction (index 2)
export interface FactExtractionStageInput {
  readonly parserOutput: SourceParserOutput;  // discriminated union by sourceMode
  readonly issuerId: string;
  readonly scope: FactScope;
  readonly config: DeepReadonly<EngineConfig>;
}

export interface FactExtractionStageOutput {
  readonly factSetRef: ContentRef<"fact-set">;
  readonly sourceArtifactRefs: ContentRef<"source-artifact">[];
  readonly projectedRawPeriods: RawPeriodData[];  // derived view for legacy compatibility
  readonly diagnostics: LegacyFactAdapterDiagnostic[];
}
```

**Publish artifacts to the run:**
- `ContentRef<"fact-set">` — the canonical FactSet, content-addressed
- `ContentRef<"source-artifact">[]` — one per input file, content-addressed
- The projected `RawPeriodData[]` is a stage-local derived view — NOT a run artifact. It is produced for backward compatibility and removed when the recast stage consumes `FactSet` directly.

### 8.6 Gap list

1. **Capitaline native adapter exists but is not wired.** `buildCapitalineCanonicalFactBundle` is exported from `facts/sourceAdapters.ts` and is called in tests, but `legacyExecutor.ts` calls `adaptLegacyRawPeriodsToFactSet` instead.
2. **No native adapters for Screener, XBRL, JSON, Manual.** These need `build*CanonicalFactBundle` functions. The base `buildTextCanonicalFactBundle()` covers 4/5 of the work; only XBRL needs a custom concept bridge.
3. **`RawPeriodData` projection utility does not exist.** A small `projectRawPeriodData(factSet)` module is needed to keep legacy recast running.
4. **Parser diagnostics must propagate.** Today each parser emits `SourceParserDiagnostics`. The native adapter must preserve parser-level diagnostics (warning counts, error counts, checks) and map them into the fact-extraction stage output.

### 8.7 Strangler exit criterion for `adaptLegacyRawPeriodsToFactSet`

Delete `adaptLegacyRawPeriodsToFactSet` and `buildLegacyTransformationDag` from `legacyRawAdapter.ts` when ALL of these hold:

1. Every parser that feeds into an analysis run has a wired `build*CanonicalFactBundle` entry (Capitaline already done; Screener, XBRL, JSON, Manual need adapters — estimate: ~80 lines each for Screener/JSON/Manual, ~120 for XBRL)
2. The fact-extraction stage is registered in the AnalysisRun stage sequence (index 2)
3. `RawPeriodData` is projected from `FactSet` via `projectRawPeriodData()` in the stage boundary
4. `SourceParserDiagnostics` from each parser are carried into the stage output (not lost)
5. The `TransformationRecorder` is wired as a live dependency, not built post-hoc
6. No caller in the codebase imports `adaptLegacyRawPeriodsToFactSet` or `buildLegacyTransformationDag`

---

## 9. Cutover #2: ForecastState — native forecast-case artifacts with scenario ordering + calibration as gated stages

**Status:** Design (Phase 2, cutover #2 — complete)
**Owner:** Archy
**Scope:** Forecast cases become first-class `ContentRef<"forecast-case">` artifacts built from sourced assumptions (not adapted from legacy scenario cards). Scenario ordering + calibration become their own gated stages. Preserve `probabilityStatus: "not-assigned"` honesty and calibration binding-mismatch fail-closed behavior.

### 9.1 Current state

Today's forecast flow in `legacyExecutor.ts`:

```
commandCenter.scenarios (4 in-memory objects)
  → buildIndustrialForecastFromLegacyScenario (bridge)
    → buildIndustrialForecast (native engine — called THROUGH the bridge)
      → IndustrialForecastResult[] (status: "computed" | "blocked")
        → validateIndustrialScenarioOrdering (check only)
          → applyScenarioCalibration (optional post-process mutation of probability)
            → adaptForecastCaseToLegacyValuation (converts to legacy valuation format)
```

**Key problems:**
1. `buildIndustrialForecastFromLegacyScenario` is a 172-line bridge that unpacks legacy command-center scenario cards into `IndustrialForecastRequest` — the bridge exists because the native `buildIndustrialForecast()` requires a `IndustrialForecastRequest` (with typed anchor, drivers, terminal), but the legacy executor has command-center scenario cards instead
2. `applyScenarioCalibration` mutates `probability` and `probabilityStatus` in-place AFTER forecast creation — the calibration stage should be a separate stage that produces a calibration report consumed by the forecast stage, not a post-hoc mutation
3. `validateIndustrialScenarioOrdering` is called as a pure check (no output artifacts) — should be a gated stage that produces `ScenarioOrderingReport` as an artifact consumed by synthesis
4. `adaptForecastCaseToLegacyValuation` exists because downstream models (in command center) expect `LegacyValuationPeriodInput[]` — native model-execution stage should consume `IndustrialForecastCase` directly

### 9.2 Native forecast stage decomposition

The single forecast "step" splits into 3 native stages:

```
Stage 9: assumption-resolution    → SourcedAssumptionSet + CostOfCapitalResult + ShareBasisResult
                            ↓
Stage 10a: forecast-generation    → IndustrialForecastCase[] (4 independently content-addressed)
                            ↓
Stage 10b: scenario-ordering      → ScenarioOrderingReport (gate — may block downstream)
                            ↓
Stage 10c: calibration (optional) → ScenarioCalibrationReport (may block or degrade)
                            ↓
Stage 11: model-execution         → consumes forecast-case refs + assumption refs + ordering report
```

#### Stage 10a: forecast-generation

```ts
// contracts/forecast-stage.ts
export interface ForecastGenerationInput {
  readonly assumptionSetRef: ContentRef<"assumption-set">;
  readonly analysisWindowRef: ContentRef<"analysis-window">;
  readonly factSetRef: ContentRef<"fact-set">;
  readonly recastPeriodsRef: ContentRef<"recast-periods">;
  readonly marketSnapshotRef: ContentRef<"market-snapshot"> | null;
  readonly config: DeepReadonly<EngineConfig>;
  readonly issuerId: string;
}

export interface ForecastGenerationOutput {
  readonly forecastCaseRefs: ContentRef<"forecast-case">[];
  /** Each case is independently content-addressed: "stress", "base", "bull", "custom" */
  readonly cases: readonly IndustrialForecastCase[];
  /** Blocked if any case failed to compute */
  readonly status: "computed" | "blocked";
  readonly reasonCodes: readonly string[];
}
```

**Key differences from today:**

1. **Forecast cases are independently content-addressed artifacts.** Each `IndustrialForecastCase` is hashed to a `ContentRef<"forecast-case">`. The 4 cases (stress, base, bull, custom) are 4 separate artifacts — they can be independently referenced, cached, or replaced. Today's `commandCenter.scenarios` is a flat array where ordering is positional.

2. **Assumptions come from `SourcedAssumptionSet`, not command-center scenarios.** Today the bridge reads `scenario.drivers.sales_growth`, `scenario.drivers.core_sales_pm`, `scenario.drivers.ato`, etc. from the command center's scenario cards. Native stage 9 produces `SourcedAssumptionSet` with typed assumption entries for `ke`, `kw`, `g_terminal`, `salesGrowthYear1`, `corePmYear1`, `assetTurnoverYear1`. Stage 10a reads these directly — no bridge needed.

3. **Anchor comes from `AnalysisWindow` + `RecastPeriod`, not from `latest` recast.** Today the bridge picks `args.latest` (the last recast period) and builds the anchor from it. Native stage uses `AnalysisWindow` to determine the anchor period, reads the corresponding `RecastPeriod` from the run store, and constructs `IndustrialForecastAnchor` directly.

4. **`probabilityStatus` honesty is preserved.** The `SourcedAssumptionSet` from stage 9 carries `intrinsicEligibleAssumptionIds` — if `probabilityStatus` is `"not-assigned"`, the forecast cases carry `probability: null` and `probabilityStatus: "not-assigned"`. Only calibration (stage 10c) upgrades this to `"calibrated"`.

#### Stage 10b: scenario-ordering (gate)

```ts
export interface ScenarioOrderingInput {
  readonly forecastCaseRefs: ContentRef<"forecast-case">[];
}

export interface ScenarioOrderingOutput {
  readonly report: ScenarioOrderingReport;
  readonly status: "passed" | "failed" | "not-applicable";
}
```

**Already exists:** `validateIndustrialScenarioOrdering()` in `src/engine/forecastState/ordering.ts` — 108 lines, complete, tested. It takes `IndustrialForecastCase[]` and returns `ScenarioOrderingReport`. No changes needed.

**Migration:** Move from inline post-forecast call to a registered stage. The report becomes an artifact consumed by synthesis (stage 12) — the `scenarioOrderingPenalty` currently computed inside the command center monolith (as part of the opportunity-score chain) reads this report.

#### Stage 10c: scenario-calibration (optional gate)

```ts
export interface ScenarioCalibrationInput {
  readonly forecastsRef: ContentRef<"forecast-case">[];
  readonly calibrationPolicy: {
    readonly family: string;
    readonly regime: string;
    readonly horizonYears: number;
    readonly calibrationAsOf: string;     // point-in-time
    readonly minimumSampleSize: number;
    readonly dirichletPriorPerScenario: number;
    readonly minimumSkillVsBenchmark: number;
  };
  readonly vintageStore: PointInTimeScenarioVintageStore;
}

export interface ScenarioCalibrationOutput {
  readonly report: ScenarioCalibrationReport;
  readonly status: "calibrated" | "degraded" | "unavailable";
  /** Mutation: if calibrated, re-publish forecast cases with calibrated probabilities */
  readonly calibratedForecastCaseRefs: ContentRef<"forecast-case">[];
}
```

**Key design decision:** Calibration is a **separate stage** that RE-PUBLISHES forecast cases with updated probability metadata. It does NOT mutate the original artifacts in place — instead it produces a new set of `calibratedForecastCaseRefs` that supersede the originals for all downstream stages.

**Fail-closed behaviors preserved:**

| Condition | Today's behavior | Native behavior |
|-----------|-----------------|-----------------|
| `report.status === "unavailable"` | Probabilities stay `null` with `status: "not-assigned"` | Stage 10c passes through original cases unchanged; all downstream stages see `probabilityStatus: "not-assigned"` |
| `report.status === "degraded"` (sample < minimum) | Probabilities remain heuristic, `reasonCodes` populated | Stage 10c produces cases with `probabilityStatus: "heuristic"` and carries `reasonCodes` in the calibration report artifact |
| `report.status === "calibrated"` | Probabilities overwritten via `applyScenarioCalibration()` | Stage 10c produces new `calibratedForecastCaseRefs` with `probabilityStatus: "calibrated"` and `probabilityEvidenceRefs` pointing to the vintage observations |
| Calibration binding mismatch (stress > base probabilities would violate ordering) | Not explicitly handled — calibration can assign probabilities that contradict the ordering report | Stage 10c GATE: `validateIndustrialScenarioOrdering()` runs on the calibrated cases. If ordering fails, the calibration is rejected and the previous `"not-assigned"` / `"heuristic"` cases are preserved. This is a NEW guard that does not exist today — it prevents calibration from silently breaking scenario monotonicity |

### 9.3 Independence from legacy scenario cards

The key design goal is that forecast cases become **native artifacts** that have no knowledge of command-center scenario cards. This means:

**What breaks today:**
```
commandCenter.scenarios[0].key          → "stress"
commandCenter.scenarios[0].name         → "Stress case"
commandCenter.scenarios[0].probability  → 0.20
commandCenter.scenarios[0].drivers      → ForecastScenarioDrivers { sales_growth[], core_sales_pm[], ato[], ... }
commandCenter.scenarios[0].horizonT     → 10
commandCenter.scenarios[0].terminal     → { ke, kw, g_terminal, ... }
commandCenter.scenarios[0].valuation    → ValuationSummary { marketCap, intrinsicValue, marginOfSafety, ... }
```

**What replaces it:**
```
ContentRef<"forecast-case">[0] → resolves to IndustrialForecastCase {
  caseId: "stress-2026",           ← stable content-addressed ID
  scenarioKey: "stress",
  family: "industrial",
  analysisWindowId: "sha256:...",
  assumptionIds: ["ke", "kw", "g_terminal", ...],  ← refs to SourcedAssumptionSet entries
  probability: 0.20,               ← null until stage 10c calibration
  probabilityStatus: "not-assigned",
  projected: IndustrialProjectedState[],             ← balanced projected statements
  terminal: TerminalEconomicsDiagnostic,
  validation: ForecastValidationReport,
  transformationRefs: string[]                       ← transformation DAG nodes
}
```

**The `ForecastScenarioDrivers` type (for example `sales_growth[]`, `core_sales_pm[]`) does not exist in the native world.** They are replaced by `IndustrialForecastYearDrivers[]` (33 explicit fields per year) that produce fully balanced projected states (income statement + balance sheet + cash flow + diagnostics) — not just valuation outputs.

### 9.4 Scenario calibration location: post-forecast, pre-model-execution

Today `applyScenarioCalibration` runs after forecast creation but before model execution. The calibration assigns probabilities to named scenarios (stress/base/bull) based on point-in-time empirical evidence.

**Native position:** Stage 10c runs BETWEEN forecast-generation (10a) and model-execution (11). This is the correct position because:
- Models in stage 11 may consume `probability` metadata for weighting
- The `calibratedForecastCaseRefs` are the input to model-execution — models never see uncalibrated probabilities
- `ScenarioOrderingReport` from stage 10b is consumed by stage 10c to validate calibration doesn't break monotonicity

### 9.5 Wiring: what `legacyExecutor.ts` must change

1. **Delete** `buildIndustrialForecastFromLegacyScenario()` call (line ~480-550)
2. **Add** stage 10a call: `executeForecastGeneration(input)` → returns `ForecastGenerationOutput`
3. **Add** stage 10b call: `executeScenarioOrdering(output.forecastCaseRefs)` → returns `ScenarioOrderingOutput`
4. **Add** stage 10c call (if calibration configured): `executeScenarioCalibration(output.forecastCaseRefs, policy)` → returns `ScenarioCalibrationOutput`
5. **Wire** `ContentRef<"forecast-case">[]` into model-execution stage (stage 11) — replacing the `LegacyValuationPeriodInput[]` adapter

### 9.6 Gap list

1. **`buildIndustrialForecast()` takes `IndustrialForecastRequest` natively but is only called through the legacy bridge.** The native function exists (441 lines in `engine.ts`) and works — it has ZERO callers outside `legacyScenarioBridge.ts`. Must wire it directly from the executor.
2. **No `ForecastGenerationInput` contract with `ContentRef` inputs.** Today's `IndustrialForecastRequest` takes raw primitive types (anchor, drivers, terminal). Must wrap in a stage contract that resolves `ContentRef`s to typed objects.
3. **Scenario calibration needs `PointInTimeScenarioVintageStore` dependency.** Today's `calibrateScenarioProbabilities()` is stateless (data passed in). Must wire the vintage store as an injectable dependency (already exists: `InMemoryPointInTimeScenarioVintageStore` in `vintageStore.ts`).
4. **`ForecastGenerationOutput` does not exist** — need a new interface.
5. **Stage 10c produces re-published forecast case refs** — the run store must support artifact overwrite or versioning for the re-published cases.

### 9.7 Strangler exit criterion for forecast bridge

Delete `buildIndustrialForecastFromLegacyScenario`, `adaptForecastCaseToLegacyValuation`, and the command-center scenario-card reading code from `legacyExecutor.ts` when ALL of these hold:

1. Stage 10a (forecast-generation) produces `ForecastGenerationOutput` with typed, content-addressed `IndustrialForecastCase` artifacts — not adapted from command center
2. Stage 10b (scenario-ordering) runs as a gated stage producing `ScenarioOrderingReport` artifact consumed by stage 12
3. Stage 10c (calibration) runs as an optional stage producing `ScenarioCalibrationReport` + re-published `calibratedForecastCaseRefs`
4. `buildIndustrialForecast()` (the native engine) is the single entry point — called directly with resolved `ContentRef` inputs
5. Model-execution stage (11) consumes `ContentRef<"forecast-case">[]` directly — not `LegacyValuationPeriodInput[]`
6. `CommandCenterScenario` type is not referenced by any stage input (it becomes a legacy-only type in the soon-to-be-deleted `valuationCommandCenter`)
7. `applyScenarioCalibration` no longer mutates in-place — calibration is a separate artifact stage

---

## 10. Cutover #3-6: modelCatalog, sectorCases, synthesis, advancedGovernance — unified native stage contracts

**Status:** Design (Phase 2, cutover #3-6 — complete)
**Owner:** Archy
**Scope:** Model catalog, sector cases, valuation evidence/synthesis, and advanced model governance each become native AnalysisRun stages consuming only ContentRef artifacts. Advanced-model composition stops mutating the synthesis post-hoc — it becomes a content-addressed catalog entry.

### 10.1 Current state: how legacyExecutor consumes these 4 subsystems

The legacy executor invokes these subsystems in sequence, all fed from the same `commandCenter` monolith:

```
commandCenter (built by buildValuationCommandCenter)
  ├── adaptLegacyCommandCenterModelResults()  → modelResults[] (line 1397)
  ├── buildScenarioGovernanceReport()         → scenarioGovernance (line ~1230)
  ├── executeCatalogSectorCase()              → sectorCaseExecution (line 1195)
  ├── executeGovernedAdvancedModel()          → advancedModelExecutions (line 1210)
  ├── evaluateRealOptionsCompositionCandidate() → compositionCandidate (line ~1440)
  └── applyRealOptionsCompositionCandidate()  → MUTATES commandCenter.evidenceWeightedSynthesis in-place (line 1423)
```

Then:
- `summarizeAntiTautology(commandCenter)` runs post-hoc (line ~1300)
- Scenario governance is REBUILT after composition mutation (line ~1450)
- Anti-tautology is RECOMPUTED after composition mutation (line ~1455)

**The mutation pattern (advanced models → synthesis):**
```
commandCenter.evidenceWeightedSynthesis (from buildValuationCommandCenter)
  → applyRealOptionsCompositionCandidate({
       synthesis: commandCenter.evidenceWeightedSynthesis,  // mutated HERE
       policy: compositionPolicy,
       candidate: compositionCandidate,
     })
  → commandCenter = { ...commandCenter, evidenceWeightedSynthesis: activation.synthesis }
  → scenarioGovernance = buildScenarioGovernanceReport({ commandCenter })  // REBUILT
  → antiTautology = summarizeAntiTautology(commandCenter)  // RECOMPUTED
```

### 10.2 Native design: 5 models deployed as catalog entries (model-execution stage 11)

Stage 11 dispatches each registered model independently via `CURRENT_MODEL_REGISTRY`. Each model produces a `ValuationModelResult` that is independently content-addressed. No model result comes from `adaptLegacyCommandCenterModelResults`.

**Full model roster (native dispatch):**

| Group | Model ID | Source | Today's source | Native entry |
|-------|----------|--------|---------------|--------------|
| Accrual | `industrial.penman.residual-income` | Reverse-DCF solver | `commandCenter.reverseDcfExpectation` | `execute() → guarded result` |
| Accrual | `industrial.penman.residual-operating-income` | Class-A RNOA model | `commandCenter.classAModels.cleanSurplusRiv` | `execute() → guarded result` |
| Cash | `industrial.cash-statement-fcff-dcf` | Cash-flow DCF | `commandCenter.cashFlowDcf` | `execute() → guarded result` |
| Relative | `industrial.ev-ebitda-peer` | EV/EBITDA cross-check | `commandCenter.evEbitdaCrossCheck` | `execute() → guarded result` |
| Relative | `industrial.sotp-sum-of-parts` | SOTP assessment | `commandCenter.sotpAssessment` | `execute() → guarded result` |
| Earnings quality | `industrial.earnings-quality-dechow-dichev` | DD&REM model | `commandCenter.earningsQualityCard` | `execute() → guarded result` |
| Earnings quality | `industrial.working-capital-gate` | Working-capital gate | `commandCenter.classAModels.workingCapitalGate` | `execute() → guarded result` |
| Cash | `industrial.cash-damodaran-capm` | Damodaran CAPM | `commandCenter.classAModels.damodaranCapm` | `execute() → guarded result` |
| Monte Carlo | `industrial.reverse-dcf-monte-carlo` | Reverse-DCF MC | `commandCenter.classAModels.reverseDcfMonteCarlo` | `execute() → guarded result` |
| Evidence ledger | `industrial.evidence-ledger` | Assumption evidence | `commandCenter.evidenceLedger` | `execute() → guarded result` |
| Holdout | `industrial.forecast-holdout` | Holdout evaluation | `commandCenter.forecastHoldout` | `execute() → guarded result` |
| Market | `industrial.market-implied-expectations` | Market expectations | `commandCenter.marketImpliedExpectations` | `execute() → guarded result` |
| Sector | `bank.sotp-conglomerate` | Sector case result | `executeCatalogSectorCase()` → `sectorCaseExecution.modelResult` | Register in catalog with `evaluateSectorCaseEligibility()` gate |
| **Composed** | **`industrial.real-options-composed`** | **NEW** | Post-hoc `applyRealOptionsCompositionCandidate` mutation | **Pre-composed catalog entry (see 10.4)** |

#### Stage 11 input/output contracts

```ts
// contracts/model-execution-stage.ts
export interface ModelExecutionStageInput {
  readonly forecastCaseRefs: ContentRef<"forecast-case">[];     // from stage 10
  readonly assumptionSetRef: ContentRef<"assumption-set">;      // from stage 9
  readonly analysisWindowRef: ContentRef<"analysis-window">;    // from stage 8
  readonly factSetRef: ContentRef<"fact-set">;                   // from stage 2
  readonly marketSnapshotRef: ContentRef<"market-snapshot"> | null;
  readonly catalogBinding: {
    readonly registry: ValuationModelRegistry;
    readonly family: "industrial" | "financial-institution";
    readonly subtype: string | null;
    readonly eligibleByFamily: readonly string[];    // model IDs gated by family classifiation
  };
  readonly advancedModelBindings?: readonly AdvancedModelCatalogBinding[];
  readonly sectorCaseBinding?: SectorCaseCatalogBinding;
  readonly config: DeepReadonly<EngineConfig>;
}

export interface AdvancedModelCatalogBinding extends GovernedAdvancedModelInput {
  /** Pre-resolved at catalog registration time, not execution time */
  readonly promotion: ModelPromotionDecision;
  /** Composition policy pre-resolved — null if not a composable advanced model */
  readonly compositionPolicy: ApprovedRealOptionsCompositionPolicy | null;
  /** The base model result this composition replaces (resolved by contentHash lookup, not by in-memory mutation) */
  readonly baseModelResultRef?: ContentRef<"model-result">;
}

export interface ModelExecutionStageOutput {
  readonly modelResultRefs: ContentRef<"model-result">[];
  /** Each model result is independently content-addressed */
  readonly results: readonly ValuationModelResult[];
  /** Gate: if any model blocked, results are still produced but with blocked results flagged */
  readonly status: "completed" | "partially-blocked" | "blocked";
}
```

### 10.3 Sector cases: from pre-approved sidecar to runtime eligibility

Today: sector cases require `input.sectorSidecar` — a `GovernedSectorSidecarApproval` that must be pre-approved, issuer-matched, time-bound. The executor binds it to the run at `model-execution` stage.

Native: sector cases are registered in `CURRENT_SECTOR_CASE_REGISTRY` alongside regular models. Eligibility (`evaluateSectorCaseEligibility()`) gates execution at runtime based on family classification and subtype, not a pre-approved sidecar input.

```ts
// Native: sector case runs if family classification gates it
const sectorCaseBinding = familyClassification.subtype === "bank"
  ? { modelId: "bank.sotp-conglomerate", input: buildFromSectorTemplate(familyClassification) }
  : null;  // No sidecar required
```

**Key change:** The `input.sectorSidecar` parameter is deleted. Sector case execution is determined by family classification (stage 5), not by a governance-input seam. The `GovernedSectorSidecarApproval` type becomes a legacy-only input format — a transition adapter converts it to `SectorCaseCatalogBinding` during the strangler period.

### 10.4 Advanced-model composition becomes non-mutating (P0 design)

**This is the trickiest gap solved in the entire migration.**

#### Today's mutation pattern

```ts
// lines 1423-1453 of legacyExecutor.ts
for (const execution of advancedModelExecutions) {
  if (!execution.compositionPolicy || !execution.compositionCandidate) continue;
  const activation = applyRealOptionsCompositionCandidate({
    synthesis: commandCenter.evidenceWeightedSynthesis,  // ← reads from monolith
    policy: execution.compositionPolicy,
    candidate: execution.compositionCandidate,
  });
  if (activation.status === "blocked") { /* terminal */ }
  commandCenter = { ...commandCenter, evidenceWeightedSynthesis: activation.synthesis }; // ← MUTATES
}
// Then rebuilds scenario governance and anti-tautology from mutated commandCenter
```

The mutation REPLACES a specific vote in the synthesis (the base model result, e.g. `accrual-riv-reoi` base case) with a composed value (base + option value). This is fundamentally incompatible with immutable stage outputs because it happens AFTER synthesis is computed.

#### Native design: composition as a pre-computed catalog model

```ts
// Stage 11 (model-execution) — pseudocode
for (const binding of input.advancedModelBindings ?? []) {
  if (!binding.compositionPolicy) {
    // Run as a standalone advanced model — produces a regular model result
    results.push(executeAndGuard(binding));
    continue;
  }
  // Composition: pre-compose as a catalog model BEFORE synthesis
  const baseResult = await resolveModelResult(binding.baseModelResultRef!);
  const candidate = evaluateRealOptionsCompositionCandidate({
    request: binding,
    result: advancedResult,
    policy: binding.compositionPolicy,
    baseResult,
  });
  if (candidate.status === "eligible-candidate") {
    // The composed result is published as a standard catalog model result
    // with modelId: "industrial.real-options-composed"
    const composedResult = buildComposedModelResult({
      baseResult,
      candidate,
      evidenceRefs: [...baseResult.evidenceRefs, ...binding.evidenceRefs],
    });
    results.push(composedResult);
    // The original base model result is still in results too — synthesis
    // will naturally favor the composed result via independence-aware weighting
  }
}
```

**Key changes:**
1. `applyRealOptionsCompositionCandidate` is **deleted** — no post-hoc mutation
2. The composed result is a standard `ValuationModelResult` with `modelId: "industrial.real-options-composed"` — it goes into the model results array alongside all other models
3. Stage 12 (synthesis) sees this as just another model result — it weights all results based on independence groups and evidence quality
4. The base model result remains in the array — synthesis naturally collapses duplicated evidence
5. `substituteEvidenceWeightedSynthesisContribution` is **deleted** — no need for vote replacement when the composed vote is already present

**What about the dual-review approval?** The `ApprovedRealOptionsCompositionPolicy` still exists, but it's checked at catalog binding time (when the policy is attached to the advanced model input), not at execution time. The `evaluateRealOptionsCompositionCandidate` function is preserved but called in stage 11 as part of the composition model's `execute()` step — not as a post-hoc mutation.

### 10.5 Synthesis stage (stage 12) — clean, independent

With composition pre-computed in stage 11, synthesis becomes a pure function:

```ts
// contracts/synthesis-stage.ts
export interface SynthesisStageInput {
  readonly modelResultRefs: ContentRef<"model-result">[];
  readonly modelResults: readonly (ValuationModelResult | SectorCaseCatalogExecutionResult)[];
  readonly scenarioOrderingRef: ContentRef<"evidence"> | null;
  readonly scenarioGovernanceRef: ContentRef<"evidence"> | null;
  readonly assumptionSetRef: ContentRef<"assumption-set">;
  readonly config: DeepReadonly<EngineConfig>;
}

export interface SynthesisStageOutput {
  readonly synthesisRef: ContentRef<"synthesis">;
  readonly antiTautologySummary: AntiTautologySummary;
  readonly scenarioGovernanceReport: ScenarioGovernanceReport;
  readonly valuationTriangulationEvidence: ValuationTriangulationEvidence;
}
```

**What today's `buildEvidenceWeightedSynthesis` does (from within command center):**
- Collapses contributions by independence group
- Computes weighted quantiles (low/mid/high)
- Applies independence penalty
- Produces defensibility checklist
- Computes opportunity score, signal state, conviction bucket, MoS, range

**Native: all of this is a pure function of model results + assumptions.** No command center dependency needed.

### 10.6 Summary: what gets deleted

| Legacy function | Lines | Replaced by |
|----------------|-------|-------------|
| `adaptLegacyCommandCenterModelResults()` | 155 in `legacyAdapters.ts` | Stage 11 dispatch loop — each model produces its own result |
| `executeCatalogSectorCase()` + sidecar input | 134 in `execution.ts` | Family-classification-gated sector case binding |
| `executeGovernedAdvancedModel()` (as separate loop) | 177 in `execution.ts` | Advanced models as catalog entries in unified stage 11 dispatch |
| `applyRealOptionsCompositionCandidate()` | 222 in `composition.ts` | Pre-composed catalog model `industrial.real-options-composed` |
| `substituteEvidenceWeightedSynthesisContribution()` | ~80 in `evidenceWeightedSynthesis.ts` | Natural independence-aware weighting in stage 12 |

### 10.7 Stage 12 (synthesis) fail-closed behaviors preserved

| Condition | Today's behavior | Native behavior |
|-----------|-----------------|-----------------|
| Zero model results | Synthesis is skipped; `evidenceWeightedSynthesis` is null in command center | Stage 12 produces synthesis with `weightStatus: "insufficient-evidence"` and all trust signals at minimum |
| Only one model computed | `buildEvidenceWeightedSynthesis` degrades gracefully (single-vote synthesis) | Same — independence-aware collapse with single vote |
| Base model blocked, no advanced alternative | Terminal at model-execution | Terminal at stage 11 before stage 12 runs |
| All models blocked | Terminal | Terminal at stage 11 |
| Weak share basis (shareBasis.failed) | Already caught at assumption-resolution before model-execution | Already caught at stage 9 — never reaches stage 11 |
| Stale market data | CSE ≤ 0 blocks valuation | Caught at stage 9 (assumption-resolution blocks downstream) |
| valuationReadiness ≠ production-ready | Terminal at model-execution | Caught at stage 9 or early gate |

### 10.8 Strangler exit criterion for `adaptLegacyCommandCenterModelResults`

Delete from `src/engine/modelCatalog/legacyAdapters.ts` when ALL hold:
1. Stage 11 dispatches 13+ models independently via `CURRENT_MODEL_REGISTRY`
2. `executeCatalogSectorCase` is not imported from sectorCases
3. Advanced models execute as catalog entries in unified stage 11 dispatch
4. `applyRealOptionsCompositionCandidate` has zero callers
5. `substituteEvidenceWeightedSynthesisContribution` has zero callers
6. Stage 12 (synthesis) produces `SynthesisStageOutput` from ContentRef inputs only
7. No consumer imports `adaptLegacyCommandCenterModelResults`

---

## 11. Cutover — bankPipeline native family-run

**Status:** Design (Phase 2 — complete)
**Owner:** Archy
**Scope:** Bank/NBFC/Insurance become first-class AnalysisRun families with their own stage sequence. The legacy executor's "UNSUPPORTED_FAMILY" block at model-execution is replaced by a valid, native family-specific stage sequence.

### 11.1 Current state

Today in `legacyExecutor.ts`:

```
processCompanyDataFull(rawData, config, bankQuality)
  └── internally calls processBankData() for financial-institution scope
      └── returns FinancialInstitutionAnalysisResult with periods, bankMetrics, valuation

... later ...

if (pipelineResult?.analysisFamily !== "industrial") {
  terminal = {
    kind: "blocked",
    stage: "model-execution",
    code: "LEGACY_COMMAND_CENTER_UNSUPPORTED_FAMILY",
    message: "The legacy valuation command center requires an industrial recast...",
  };
}
```

**Problem:** The bank pipeline runs successfully and produces metrics + valuation, but the executor then blocks the run because the command center (industrial-only) can't consume bank outputs. The `bankResult.valuation` (from `computeBankValuation()`) is produced but never used for synthesis — it's only surfaced as a diagnostic.

The `resolveFamily()` function in `src/engine/analysisFamily.ts` maps `scope.analysisFamily` to `"industrial"` or `"financial-institution"`. The `FinancialInstitutionAnalysisResult` carries `subtype` (`"bank" | "nbfc" | "insurance" | "generic-financial"`). Today, the subtype is used for ratio computation branching inside `processBankData` but not for stage scheduling.

### 11.2 Native design: family-specific stage sequences

Family classification (stage 5) determines which stage slots are active:

```ts
// AnalysisStageOrder for industrial families (current):
["request-validation", "artifact-ingestion", "fact-extraction", ..., "recast", ..., 
 "window-selection", "assumption-resolution", "forecast", "model-execution", "synthesis", "release-trust"]

// AnalysisStageOrder for financial-institution families (proposed):
["request-validation", "artifact-ingestion", "fact-extraction", ..., "family-classification",
 "family-analysis", "window-selection", "assumption-resolution", "model-execution", "synthesis", "release-trust"]
// NOTE: No "recast" stage (banks use FinancialInstitutionPeriodSnapshot, not RecastPeriod)
// NOTE: No "forecast" stage (bank valuation uses its own forecast model within computeBankValuation)
// NOTE: "structural-reconciliation" and "economic-validation" are skipped
```

**Stage map for financial-institution:**

| Stage ID | Active | Role |
|----------|--------|------|
| request-validation | Yes | Same — validate pinned input |
| artifact-ingestion | Yes | Same |
| fact-extraction | Yes | Same — fact set from ingestion parsers |
| concept-normalization | No | No recast needed |
| family-classification | Yes | Detect bank/nbfc/insurance subtype |
| recast | No | Skipped — no Penman recast |
| structural-reconciliation | No | Skipped |
| economic-validation | No | Skipped |
| window-selection | Yes | Simplified — `selectFamilyPeriodAnalysisWindow()` (already exists) |
| assumption-resolution | Yes | Cost of capital only (ke, kw from config/ESG adjustment) |
| forecast | No | Skipped — bank forecast embedded in valuation model |
| model-execution | Yes | Bank-specific models from catalog: ROE-based, dividend-discount, SOTP |
| synthesis | Yes | Simplified — weight bank-specific model results only |
| release-trust | Yes | Same envelope + traceability |

### 11.3 Native `family-analysis` stage (stage 6 — NEW)

Today, the bank pipeline runs inside `processCompanyDataFull` and the result is buried in `pipelineResult.bankResult`. Native: the family-analysis stage is a standalone stage that produces a typed `ContentRef<"family-analysis">`:

```ts
// contracts/family-analysis-stage.ts
export interface FamilyAnalysisStageInput {
  readonly factSetRef: ContentRef<"fact-set">;
  readonly rawPeriodData: readonly RawPeriodData[];  // projected from fact set
  readonly config: DeepReadonly<EngineConfig>;
  readonly marketSnapshotRef: ContentRef<"market-snapshot"> | null;
  readonly bankQualityRef: ContentRef<"evidence"> | null;
  readonly family: "financial-institution";
  readonly subtype: FinancialInstitutionSubtype;
}

export interface FamilyAnalysisStageOutput {
  readonly familyAnalysisRef: ContentRef<"family-analysis">;
  readonly bankPeriodMetrics: readonly BankPeriodMetrics[];
  readonly assetQuality: BankAssetQualityResult | null;
  readonly periods: readonly FinancialInstitutionPeriodSnapshot[];
  readonly valuation: BankValuationBundle | null;  // preliminary ROE-based valuation
}
```

**Key differences from today:**
1. `processBankData()` is called from the stage entry, not from `processCompanyDataFull`
2. The output is content-addressed as `ContentRef<"family-analysis">` — not buried in `pipelineResult.bankResult`
3. `BankPeriodMetrics` are first-class artifacts, not side-channel data on the pipeline result
4. The preliminary `valuation` (from `computeBankValuation`) is produced here but MAY be superseded by more sophisticated bank models in stage 11 (model-execution)

### 11.4 Model-execution for financial-institution families

Stage 11 for banks is much simpler than for industrial — only 3-4 models:

| Model ID | Source | Function |
|----------|--------|----------|
| `financial.roe-based-valuation` | ROE-PB analysis | From `computeBankValuation()` → `roeBased` |
| `financial.dividend-discount` | Dividend discount model | From `computeBankValuation()` → `dividendDiscount` |
| `financial.sotp-conglomerate` | SOTP (if segments present) | From sector case registry (same as industrial) |
| `financial.deposit-franchise-multiple` | Deposit franchise valuation | NEW — explicit book-value multiple for banks |

### 11.5 Mixed-conglomerate fail-closed gate

A mixed conglomerate (financial subsidiary + industrial parent) is detected at family-classification stage:

```ts
// Stage 5: family-classification
if (classification === "mixed-conglomerate") {
  return {
    status: "blocked",
    reasonCode: "MIXED_CONGOLMERATE",
    message: "Mixed conglomerate detected. Financial and industrial analyses must be separate runs.",
  };
}
```

This gate ALREADY EXISTS in `scopePolicy.ts` — `ScopeAssessment` includes `classification: "industrial" | "financial-institution" | "mixed-conglomerate"`. Today it's checked implicitly (the executor blocks when `pipelineResult.analysisFamily !== "industrial"`). Native: it's an explicit gate in stage 5.

### 11.6 Bank valuation fail-closed behaviors preserved

| Condition | Today's behavior | Native behavior |
|-----------|-----------------|-----------------|
| `processBankData` returns empty periods | `pipelineResult.periods = []`, later `windowedRecastData` is empty → terminal at window-selection | Stage 6 returns `status: "blocked"` with reason code `BANK_METRICS_EMPTY` |
| `computeBankValuation` fails/returns null | `valuation: null` in result, synthesis skipped | Stage 11 sees zero bank models → `ValuationTriangulationEvidence` carries `blocked: true` |
| Market cap is null | `computeBankValuation` skips per-share calculation | Model results carry `perShare: null` with reason code `MARKET_CAP_MISSING` |
| `BankQualityIndicators` not provided | Quality signals carry `skip-with-reason`, metrics computed from Capitaline only | Same — graceful degradation |
| Insurance subtype (no valuation pipeline) | `valuation: null`, metrics computed | Stage 11 has zero active models → synthesis is empty with `insufficient-evidence` |

### 11.7 Strangler exit criterion for bank block

Delete the `LEGACY_COMMAND_CENTER_UNSUPPORTED_FAMILY` terminal block from `legacyExecutor.ts` when:
1. Stage 5 (family-classification) gates financial-institution families to their own stage sequence
2. Stage 6 (family-analysis) produces `ContentRef<"family-analysis">` for banks/NBFCs/insurance
3. Stage 11 (model-execution) dispatches bank-specific models from the catalog
4. Stage 12 (synthesis) produces bank-specific `EvidenceWeightedValuationSynthesis`
5. The mixed-conglomerate gate at family-classification is explicit

---

## 12. Cutover — reproducibility/content-hash enabler

**Status:** Design (Phase 2 — complete)
**Owner:** Archy
**Scope:** Specify canonicalization rules, identity-core projection, cross-run determinism guarantees, and fork detection. The `identity.ts` and `contentRefs.ts` already implement most of this — this section formalizes the contract and identifies gaps.

### 12.1 Current state

`identity.ts` (120 lines) and `contentRefs.ts` (75 lines) already implement:

1. **`canonicalizeAnalysisRunCore()`** — selects identity-relevant fields, canonicalizes, returns string
2. **`hashAnalysisRunCore()`** — SHA-256 of canonicalized identity core → `sha256:${digest}`
3. **`selectAnalysisRunIdentityCore()`** — explicit projection excluding `generatedAt`
4. **`createAnalysisRunV1()`** — stamps `reproducibilityHash` on the final run
5. **`verifyAnalysisRunIdentity()`** — re-hashes and compares
6. **`createAnalysisContentArtifact()`** — content-hashes individual artifacts
7. **`verifyAnalysisContentArtifact()`** — verifies individual artifacts

`evidenceLocking.ts` (139 lines) implements:
1. **`canonicalize()`** — deterministic JSON with sorted keys, no whitespace, fixed numeric precision
2. **`reproducibilityHash()`** — SHA-256 of canonicalized envelope
3. **`lockEvidence()`** — stamp with reviewer identity
4. **`verifyLockedHash()`** — verify envelope integrity

### 12.2 Canonicalization rule set

The following rules govern all content hashing in the system:

#### Rule 1: Deterministic JSON serialization
```ts
// From evidenceLocking.ts — canonicalReplacer
function canonicalReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number") return roundNumber(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) sorted[k] = (value as Record<string, unknown>)[k];
    return sorted;
  }
  return value;
}
```
- Object keys sorted lexicographically at every depth
- No whitespace (JSON.stringify default)
- No trailing newlines
- `undefined` skipped (JSON.stringify default)
- `null` preserved

#### Rule 2: Numeric precision fixed to 12 decimals
```ts
function roundNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 1e12) / 1e12;
}
```
- All finite numbers rounded to 12 decimal places
- Covers all financial precision needs without floating-point drift
- `Infinity`, `-Infinity`, `NaN` passed through (though should not occur in practice)
- **Caveat:** This means two runs with values differing by < 1e-12 produce the same hash. Acceptable — financial precision beyond 12 decimals is meaningless.

#### Rule 3: Volatile-field exclusion
Fields excluded from `reproducibilityHash` computation:
| Field | Reason | Where excluded |
|-------|--------|---------------|
| `generatedAt` | Instance timestamp, not analytical content | `stableTrustEnvelope()` in `identity.ts` |
| `runContext.runId` | Instance identity, not analytical content | `stableTrustEnvelope()` in `identity.ts` (already excluded by omission from `StableTrustEnvelopeV1` type) |
| `createdAt` | Run instance creation time | Not part of `AnalysisRunIdentityCoreV1` |
| `publicationRef` | Post-hoc publication state | Excluded from `selectAnalysisRunIdentityCore` |
| `status` | Execution outcome, not input | Today excluded from identity core (but see caveat in §12.3) |

**All other fields participate in the hash.** This includes:
- `schemaVersion`, `executorVersion`, `derivationMode` — version pins
- `issuerId`, `family`, `asOf` — business identity
- `sourceArtifactIds` — input provenance
- All `ContentRef` fields — artifact dependencies (`factSetRef`, `policyBundleRef`, `modelCatalogRef`, etc.)
- `trustEnvelope` stable fields (rigor checkpoints, confidence, analytical depth)
- `relation` — parent run identity (for fork detection)

#### Rule 4: ContentRef byte-stamp verification
```ts
async function verifyAnalysisContentArtifact(artifact): Promise<boolean> {
  const canonical = canonicalize(artifact.payload);
  const digest = await reproducibilityHash(artifact.payload);
  return artifact.ref.contentHash === `sha256:${digest}`
    && artifact.ref.byteLength === utf8ByteLength(canonical);
}
```
- Each artifact carries BOTH content hash AND byte length
- Verification checks both — catch byte-level corruption even if hash collides
- `byteLength` is UTF-8 byte length (not character count)

#### Rule 5: Recursive freeze (immutability enforcement)
```ts
function cloneAndFreeze<T>(value: T): DeepReadonly<T> { ... }
```
- Every ContentArtifact payload is deep-frozen at creation time
- `createAnalysisRunV1` freezes the entire run object
- Prevents mutation after identity is stamped

### 12.3 Cross-run determinism guarantees

**Same inputs → same reproducibilityHash:**

Two analysis runs produce identical `reproducibilityHash` when ALL of these match:

1. **Same `sourceArtifactIds`** — same input files (SHA-256 of file bytes)
2. **Same `config`** — same EngineConfig (serialized via canonicalize, so key ordering differences don't matter)
3. **Same `policyBundleRef`** — same policy bundle content
4. **Same `family` + `issuerId`** — same business identity
5. **Same `asOf`** — same point-in-time cutoff
6. **Same stage sequence** — same `stageResults[i].status` + `stageResults[i].outputRefs` for every stage

**`status` IS part of identity core.** A "completed" run and a "blocked" run with identical inputs produce DIFFERENT reproducibility hashes. The hash represents the complete analytical outcome, not just the input contract. See Cody's parity test `identity.statusInCore.spec.ts`.

**Fork detection via `relation`:**

```ts
interface AnalysisRunRelation {
  kind: "root" | "fork";
  parentRunId: string | null;
  parentReproducibilityHash: string | null;
}
```
- `kind: "root"` — first run against these inputs
- `kind: "fork"` — derived from parent run (e.g., assumption change, new model)
- `parentReproducibilityHash` is the parent's hash — enables tree traversal
- When a locked run is forked, the fork carries `parentReproducibilityHash: <locked-hash>` — the locked run's envelope was NOT mutated; it created a new run
- Fork chain depth is unbounded — audit tools traverse up to `parentRunId = null`

### 12.4 What must change (gap list)

1. **`status` is NOT part of identity core.** If you re-run identical inputs and get a different status (bug, timeout, divergent model), the hash is identical — no tamper detection. **Recommendation:** Make `status` part of identity core (it's an analytical property, not volatile metadata). This means blocked and completed runs have different hashes, which is correct.

2. **`ContentRef` arrays are position-dependent** in today's `canonicalize()`. This means `[refA, refB]` and `[refB, refA]` produce different hashes even if they contain the same refs. **Recommendation:** Sort ContentRef arrays by `contentHash` before hashing (since `contentHash` is deterministic). Applied in `selectAnalysisRunIdentityCore`.

3. **`MediaType` and `ByteLength` are computed after payload creation** in `createAnalysisContentArtifact()`. These are deterministic (same payload → same byte length), so this is correct — but must be explicitly documented as a requirement: the `byteLength` is the UTF-8 byte length of the canonicalized payload.

4. **Fork chain traversal is an audit concern, not a run-time concern.** The `relation` field is present in the run object but there's no `forkFrom()` utility today. **Recommendation:** Add `forkAnalysisRun(run: AnalysisRunV1, newInput: Partial<AnalysisRunCoreV1>): AnalysisRunDraftV1` utility that copies the parent's identity core, sets `relation: { kind: "fork", parentRunId: run.runId, parentReproducibilityHash: run.reproducibilityHash }`, and merges `newInput`.

5. **`verifyAnalysisRunIdentity` is implemented but not called anywhere.** **Recommendation:** Wire it into:
   - The run store's `getRun()` path (verification on retrieval)
   - The UI's run display (show green/red hash badge)
   - The audit log (tamper detection)
   - The publication workflow (reject if hash doesn't verify)

### 12.5 Strangler exit criterion for reproducibility

The reproducibility infrastructure is already largely in place. The exit criterion for the `LEGACY_ANALYSIS_RUN_EXECUTOR_VERSION` to be replaced by native executor version:
1. `reproducibilityHash` is computed for every native run (already true)
2. `verifyAnalysisRunIdentity` is wired into run store and audit log
3. ContentRef arrays are sorted deterministically before hashing
4. `status` is part of identity core (proposed change)
5. `forkAnalysisRun` utility exists
6. Legacy executor produces identical `reproducibilityHash` for same inputs as native executor (parity harness required to prove this)

---

## 13. Cross-subsystem contract review — consistency addendum

**Status:** Review complete (Phase 3 — all design docs checked for cross-contract consistency)
**Review date:** 2026-07-20
**Documents reviewed:**
- This migration doc (§1-§12)
- `docs/architecture/plans/2026-07-20-native-migration-test-strategy.md` (Cody)
- `docs/architecture/plans/2026-07-20-ui-projection-read-models.md` (Jace)

### 13.1 Contract mismatches found: 5

#### Mismatch 1 (P1): `SynthesisStageInput.modelResults` inlines resolved objects alongside ContentRefs

**Location:** §10.5 `SynthesisStageInput`
**Problem:** The interface carries BOTH `modelResultRefs: ContentRef<"model-result">[]` AND `modelResults: readonly (ValuationModelResult | SectorCaseCatalogExecutionResult)[]` (the resolved payloads). This violates the native principle that stages consume only ContentRefs and resolve internally.
**Fix:** Remove `modelResults` from `SynthesisStageInput`. The synthesis stage resolves from `modelResultRefs` internally. If performance is a concern (N+1 resolution), add a batch resolver utility — do not bake it into the contract.
**Affects:** §10.5, `contracts/synthesis-stage.ts`

#### Mismatch 2 (P1): `ScenarioOrderingReport` is not content-addressed but downstream expects a ContentRef

**Location:** §10.2 (stage 10b) vs §10.5 (stage 12)
**Problem:** Stage 10b produces `ScenarioOrderingOutput.report: ScenarioOrderingReport` as an inlined field. But stage 12's `SynthesisStageInput` expects `scenarioOrderingRef: ContentRef<"evidence"> | null` — the type `"evidence"` is a generic catch-all rather than a proper artifact type.
**Fix:** 
- Define `ContentRef<"scenario-ordering-report">` as a first-class artifact type
- Stage 10b publishes the ordering report as this typed ContentRef
- Stage 12 consumes `scenarioOrderingRef: ContentRef<"scenario-ordering-report"> | null` instead of the mismatched `"evidence"` type
**Affects:** §10.2, §10.5, and contracts

#### Mismatch 3 (P1): `SynthesisStageInput.scenarioGovernanceRef` is circular — stage 12 produces its own input

**Location:** §10.5 `SynthesisStageInput`
**Problem:** `scenarioGovernanceRef: ContentRef<"evidence"> | null` is listed as an INPUT to stage 12 (synthesis), but stage 12's OWN output includes `scenarioGovernanceReport: ScenarioGovernanceReport`. A stage cannot consume its own output. The scenario governance report is currently built from the command center (post-forecast) in the legacy flow. In the native design it is unclear which stage produces it.
**Fix:** 
- Scenario governance must be produced by a PRIOR stage — either stage 10c (calibration stage) or a new stage 10d
- Remove `scenarioGovernanceRef` from `SynthesisStageInput` if governance is purely an output of synthesis, OR move governance production to stage 10c and add it as a proper input ref to stage 12
- Recommendation: Stage 10c produces `ScenarioGovernanceReport` (evaluating scenario quality and probability coherence before models run). Stage 12 consumes it as `ContentRef<"scenario-governance-report"> | null` AND produces an enriched governance report as part of synthesis output
**Affects:** §10.5, contracts

#### Mismatch 4 (P2): `useForecastResults` returns `IndustrialForecastResult[]` but migration doc produces `IndustrialForecastCase[]`

**Location:** Jace's doc §3.2 vs migration doc §9.2-§9.5
**Problem:** Jace's hook catalog lists `useForecastResults(store): readonly DeepReadonly<IndustrialForecastResult>[]`. The migration doc defines the native artifact as `IndustrialForecastCase` (not `IndustrialForecastResult`). These are different type names.
**Fix:** Align naming. The migration doc should keep `IndustrialForecastCase` (since each case is independently content-addressed). Jace's hook should be renamed to `useForecastCases(store): readonly DeepReadonly<IndustrialForecastCase>[]`. The adapter in Wave 2 (`adapters/forecastLegacyProps.ts`) maps case to the legacy `IndustrialForecastResult` shape as needed.
**Affects:** Jace's read-model doc, migration doc §9

#### Mismatch 5 (P2): `usePublication` target not covered in migration doc

**Location:** Jace's doc §3.2 vs migration doc stage map
**Problem:** Jace defines `usePublication(store): AnalysisPublicationSnapshot | null`. The migration doc does not define a publication stage or artifact type. The legacy `publicationRef` is excluded from identity core (§12.3) as a post-hoc field.
**Fix:** 
- Add a `publication` stage (stage 14) to the migration doc's stage sequence — it freezes the run's analytical outputs into a lockable `PublicationSnapshot` artifact
- Alternatively, document that `publicationRef` is an audit-only field computed outside the stage pipeline (set by UI/handlePublication action) — if so, specify that `usePublication` reads from the run's non-stage metadata, not from a stage artifact
- Recommendation: Define `ContentRef<"publication-snapshot">` as a top-level run field (not a stage artifact) — the analysis run directly carries `publicationRef: ContentRef<"publication-snapshot"> | null`
**Affects:** Migration doc stage sequence, Jace's read-model hooks

### 13.2 Consistency checks — resolved: 3

#### Resolved 1: Advanced-model synthesis shape (Cody's P1 flag)

**Status:** ✓ Consistent
**Cody's concern (§8):** Parity harness cannot directly compare legacy post-hoc mutation with native pre-composed catalog entry because execution order differs.
**Migration doc answer (§10.4):** Pre-composed catalog model `industrial.real-options-composed` executes in stage 11; stage 12 receives both base and composed results; independence-aware weighting naturally handles the duplicate evidence. Parity assert is NOT identical content hash but mid-point perShare within tolerance.
**Conclusion:** Cody's mitigation matches §10.4 exactly. The `IntendedDeltaCatalog` entry `synthesis.contributionCount: +1` documents the shift. Resolved — no contract change needed.

#### Resolved 2: Jace's `useCommandCenterView` as strangler bridge

**Status:** ✓ Consistent
**Jace's doc (§3.2):** `useCommandCenterView` returns `DeepReadonly<ValuationCommandCenterOutput> | null` as a bridge until native stages 9-12 are complete.
**Migration doc (§7):** The command center monolith is decomposed across stages 9-12. Until all 4 stages are native, `buildValuationCommandCenter` still runs and its output is available via `useCommandCenterView`.
**Conclusion:** This is the intended strangler pattern. The bridge is deleted when stages 9-12 are all native (Global strangler exit criterion #8). Resolved.

#### Resolved 3: Cody's reproducibilityHash test vs migration doc identity core

**Status:** ✓ Resolved with contract clarification needed
**Problem:** Migration doc §12.3 says "`status` field is NOT part of identity core... This is intentional." But §12.4 recommendation #1 says "Make `status` part of identity core." Cody's test `identity.statusInCore.spec.ts` expects status to be IN the core (different hash for completed vs blocked runs).
**Resolution:** The migration doc is internally inconsistent — §12.3 and §12.4 contradict each other. The CORRECT contract is: `status` IS part of identity core. §12.3's "Exception: status field is NOT part of identity core" paragraph is deleted. Cody's test stands. Runs with different `status` values MUST produce different hashes.
**Fix applied:** See Mismatch Fix A below.
**Affects:** §12.3 (the exception paragraph is removed as part of this review)

### 13.3 Contract fixes applied to this document

**Fix A — §12.3 exception paragraph deleted:**
The paragraph "Exception: status field is NOT part of identity core... To verify execution integrity, audit run.status + gateResults + stageResults alongside the hash" is removed from §12.3. The contract now matches §12.4 recommendation #1: `status` is part of identity core. This aligns with Cody's test expectations.

**Fix B — §10.5 `SynthesisStageInput.modelResults` field noted for removal:**
The `modelResults: readonly ... []` inline field is contract-inconsistent. Implementation must resolve from `modelResultRefs` only.

**Fix C — §10.5 `ScenarioGovernanceRef` circular dependency documented:**
Production of `ScenarioGovernanceReport` must move to stage 10c (or a new stage 10d) to break the circular dependency where stage 12 would consume its own output.

### 13.4 Go/No-go determination

**GO** — The design set is coherent and implementation-ready. 5 contract mismatches were found, all with concrete fixes (2 P1, 2 P2 + 1 resolved through doc consistency). No P0 blockers.

Implementation must apply Fix A (§12.3) before any developer reads the doc. Fixes B-D (§10.5, Jace's hook naming, publication stage) are tracked in the plan but do not block cutover #1 (facts).

**Final confidence: HIGH** — the 7-subsystem cutover design, test strategy, and UI read-model contracts are aligned after the 5 mismatches documented above are resolved.
