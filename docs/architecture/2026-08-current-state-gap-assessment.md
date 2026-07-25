# Current-State Gap Assessment — Penman V2 Target Architecture

**Date:** 2026-08-04
**Author:** Archy (Senior Developer)
**Status:** Findings for Phase 1 — reviewed, awaiting Phase 2 design
**Scope:** Stage-by-stage native vs legacy-derived coverage, UI projection dependency inventory, top-10 migration blockers

---

## 1. Stage-by-Stage Analysis: 14 Stages of `ANALYSIS_STAGE_ORDER`

Legend:
- **Native** — contract exists, logic is isolated, runs independently
- **Hybrid** — contract exists but orchestration is within legacy executor
- **Legacy-derived** — no standalone logic; embedded inside legacy executor or pipeline monolith

| # | Stage | Status | What actually runs today | What blocks native |
|---|---|---|---|---|
| 1 | **request-validation** | Legacy-derived | `validateInput()` inside `legacyExecutor.ts` lines 140-210. Validates runId, issuerId, asOf, sourceMode, config warnings, source artifact hashes. Gate result built post-hoc from diagnostics. | No native input-validation stage. Gate is reconstructed from diagnostics in `buildGateResults()`, not evaluated as a stage. |
| 2 | **artifact-ingestion** | Legacy-derived | Artifacts created inline via `createAnalysisContentArtifact()` — fact, policy, catalog, family, window, market, assumption, forecast, model, synthesis artifacts are all materialized by the executor body (lines 500-800). | No dedicated ingestion stage. Artifact creation is scattered through the executor body, not a sequenced stage with its own inputs/outputs contract. |
| 3 | **fact-extraction** | Hybrid (optional native) | If `canonicalFacts` input is provided, `adaptLegacyRawPeriodsToFactSet()` runs (page 5). Otherwise creates a `legacy-raw-period-proxy` artifact with `factLevelLineageAvailable: false`. Quality gate and mapping audit also run here. | Optional only. When canonical facts are absent, falls back to a flat proxy with no fact-level lineage. No standalone fact-extraction engine; adapter runs inside executor. |
| 4 | **concept-normalization** | Legacy-derived | No explicit normalization phase. Concept mapping is embedded inside the optional `canonicalFacts` adapter (`LegacyConceptMapping`). Non-canonical path has zero concept identity. | No concept normalization contract in the stage pipeline. The `concept-normalization` stage exists in `ANALYSIS_STAGE_ORDER` but nothing materializes its inputs/outputs. |
| 5 | **family-classification** | Legacy-derived | Scope assessment runs via `evaluateQualityGate()` → blocks at `LEGACY_SCOPE_BLOCKED`. `resolveFamily()` maps `PipelineResult.analysisFamily` and `pipelineStrategyId`. | No family-classification stage with typed output. The family is derived from the pipeline result, not a stage that produces a `FamilyAnalysisRef`. |
| 6 | **recast** | Legacy-derived | `processCompanyDataFull()` — the monolithic pipeline. Industrial recast OR financial-institution pipeline. Returns `PipelineResult` with `periods`, `bankResult`, `structuralBreakPeriods`, `ratioSanity`, etc. | Monolithic pipeline. No stage-level decomposition. Recast, reconciliation, economic validation all happen in one call. The recast stage cannot be independently verified or replaced. |
| 7 | **structural-reconciliation** | Legacy-derived | Checked indirectly: if `analysisStatus.status === "blocked"` after pipeline, sets terminal at `structural-reconciliation`. The actual reconciliation logic is in `analysisTraceability.ts` checkpoint model. | No standalone reconciliation result. The `insufficient-evidence` state (ADR-011) is not implemented for reconciliation. Still uses old `confirmed`/`degraded`/`failed` ternary. |
| 8 | **economic-validation** | Legacy-derived | Embedded in traceability envelope as `economically-plausible` checkpoint. No standalone economic validation stage with typed outputs. | The economic-sanity anchor and valuation-readiness anchor are separate policies (see greenfield doc finding VAL-06). Not merged into a unified `AnalysisWindow`. |
| 9 | **window-selection** | Hybrid (native contract exists) | Calls `selectUnifiedAnalysisWindow()` or `selectFamilyPeriodAnalysisWindow()` — native `AnalysisWindow` contract (`src/engine/analysisCase/`). Orchestration still runs inside executor (lines 400-440). | Native contract exists but orchestration is in legacy executor. FI path uses `selectFamilyPeriodAnalysisWindow` while industrial uses `selectUnifiedAnalysisWindow` — two paths, both legacy-orchestrated. |
| 10 | **assumption-resolution** | Hybrid (native contract exists) | Calls `resolveSourcedAssumptionSet()` with `buildRunAssumptionCandidates()` — native `SourcedAssumptionSet` contract. Inputs come from command center + config + market snapshot. | Native contract exists but inputs are legacy-derived (command center, config). Resolution runs inside executor, not as an independent stage. Assumption candidates are hardcoded (ke, kw, g_terminal, sales growth, margin, ATO) rather than model-catalog-driven. |
| 11 | **forecast** | Hybrid (native contract exists) | `buildRunForecastResults()` creates `IndustrialForecastResult` from command center scenarios via `buildIndustrialForecastFromLegacyScenario()`. Calibration runs separately. | Forecast state uses recast-period cloning (VAL-01 from greenfield doc). Scenarios come from legacy command center, not from native balanced forecast engine. Only industrial forecasts exist — bank/nbfc/insurance have no native forecast cases. |
| 12 | **model-execution** | Hybrid | Adapts command center results via `adaptLegacyCommandCenterModelResults()`. Runs sector cases via `executeCatalogSectorCase()`. Executes advanced models via `executeGovernedAdvancedModel()`. Model catalog exists (`CURRENT_MODEL_REGISTRY`) but execution is embedded. | Model catalog is native but execution is not. The executor adapts command center outputs rather than running models from catalog independently. Bank models are not wired through catalog. Invalid models (VAL-03) still produce `computed` status. |
| 13 | **synthesis** | Legacy-derived | Evidence-weighted synthesis built from command center. `compositionCandidate` / `applyRealOptionsCompositionCandidate()` runs inside executor. Synthesis ref is created post-hoc. | Synthesis is not an independent stage. It's constructed from the legacy command center's `evidenceWeightedSynthesis`, not from a native independent-model-group collapse. Correlated formulations get multiple votes (VAL-02). |
| 14 | **release-trust** | Legacy-derived | Builds traceability envelope, analytical depth, anti-tautology. Gate results computed from envelope checkpoints. Transformation DAG built from fact/model refs. | Trust envelope is reconstructed from legacy traceability builder (`buildAnalysisTraceability`). Not evaluated as a native monotonic gate ladder. Failed gates can be demoted but the original envelope serialized them first. |

**Summary**: 0/14 stages are fully native. 4 stages have native contracts but legacy orchestration (window-selection, assumption-resolution, forecast, model-execution). 10 stages are entirely legacy-derived.

---

## 2. What Blocks `derivationMode: "native"`

The `derivationMode` field is currently always `"legacy-derived"`. To flip it to `"native"`:

### Hard blockers (cannot be deferred):

1. **No native executor** — `createLegacyAnalysisRunExecutor()` orchestrates all 14 stages in one async function with a single try/catch. A native executor would run stages sequentially, producing intermediate typed results and enabling per-stage validation/retry.

2. **Monolithic pipeline** — `processCompanyDataFull()` performs recast, reconciliation, family classification, and economic validation in one call. Cannot run stages independently.

3. **No native fact extraction** — When `canonicalFacts` is absent, fact extraction produces a proxy with `factLevelLineageAvailable: false`. A native run must always produce canonical facts.

4. **Command center as implicit oracle** — The valuation command center (`buildValuationCommandCenter`) runs after pipeline + window + assumptions and produces scenarios, cost of capital, model results, and synthesis together. A native architecture would run model execution and synthesis as separate stages.

5. **Trust envelope reconstructed, not evaluated** — The traceability envelope is built first, then gates are extracted from it. Native would evaluate gates first, then build the envelope as a summary.

### Soft blockers (can be migrated incrementally):

6. **Window selection has two code paths** — industrial uses `selectUnifiedAnalysisWindow`, FI uses `selectFamilyPeriodAnalysisWindow`. A native `AnalysisWindow` stage should unify these.

7. **Assumption resolution is hardcoded** — `buildRunAssumptionCandidates` hardcodes ke, kw, g_terminal, sales growth, margin, ATO. Should be model-catalog-driven.

8. **Forecast state is legacy-scenario-derived** — Uses command center scenarios rather than independent `ForecastState` contracts. Limited to industrial.

9. **Model execution adapts command center** — Instead of running from model catalog independently. Bank models are not in the catalog.

10. **Synthesis is not independence-aware** — Correlated formulations get independent votes (VAL-02). Market-implied models leak into intrinsic counts (AUD-02).

---

## 3. Legacy UI Projection Dependency Inventory

### 3.1 Current architecture

`useRunBackedAuditAnalysis` destructures the run's `materialization` through `buildLegacyUiProjection()` (structuredClone seam). The hook returns ~30 projection fields consumed by AppShell and forwarded to TabRouter.

The structuredClone seam (line 45-48 of `useRunBackedAuditAnalysis.ts`) isolates tabs from mutating the run, but the projection fields are still the legacy mutable types (e.g., `PipelineResult`, `ValuationCommandCenterOutput`).

### 3.2 Tab-by-tab projection consumption

| Tab | Fields consumed from projection | Group | Migration difficulty |
|---|---|---|---|
| **upload** | rawData (from AppShell, not projection) | input | N/A — no run dependency |
| **dashboard** (industrial) | recastData, traceability, ratioSanity, segmentData, readyCompanyCount | analysis | **Medium** — needs 4 typed selectors |
| **dashboard** (FI) | bankResult, config, marketCapCr | analysis | **Hard** — bankResult is legacy |
| **watchlist** | workspaceCompanies (from registry) | input | N/A — not run-backed |
| **workspace** | rawData, recastData, config, analysisStatus | input | **Medium** — needs run selector |
| **inspector** | auditMeta, analysisStatus | input | **Easy** — already uses run data |
| **statements** | recastData, traceability, publication?.traceabilitySummary | analysis | **Easy** — 2 typed selectors |
| **ratios** (industrial) | recastData, config, traceability, publication?.traceabilitySummary | analysis | **Easy** — 2 typed selectors + config |
| **ratios** (FI) | bankResult, config, marketCapCr | analysis | **Hard** — bankResult is legacy |
| **forecast** | recastData, forecastResults, analysisWindow, sourcedAssumptionSet, scenarioOrdering, scenarioGovernance, traceability | analysis | **Hard** — 7 projection fields, many legacy |
| **quality** (industrial) | recastData, traceability, publication?.traceabilitySummary | analysis | **Easy** — 2 typed selectors |
| **quality** (FI) | bankResult, config, marketCapCr | analysis | **Hard** — bankResult is legacy |
| **scope** | scopeAwareResult (not from projection — computed in hook) | analysis | **Easy** — already an overlay |
| **atlas** | pipelineResult, rawData | analysis | **Hard** — pipelineResult is monolithic |
| **business** | pipelineResult, recastData | analysis | **Hard** — pipelineResult is monolithic |
| **valuation** (industrial) | recastData, commandCenter, analysisStatus, traceability, publication, liveMarketData, config | valuation | **Critical** — commandCenter is entire legacy oracle |
| **valuation** (FI) | bankResult, config, marketCapCr | valuation | **Hard** — bankResult is legacy |
| **bank** | bankResult, config, marketCapCr | valuation | **Hard** — bankResult is legacy |
| **comparison** | registry, comparisonPublication, portfolioRunComparison, config | peers | **Medium** — needs run comparison selectors |
| **report** (industrial) | recastData, traceability, publication, ratioSanity, config, rawData | export | **Medium** — needs run + publication selectors |
| **report** (FI) | bankResult, config, marketCapCr | export | **Hard** — bankResult is legacy |
| **thesis** | recastData, config | export | **Easy** — 2 fields |
| **regression** | recastData, rawData, config, traceability, registry | advanced | **Medium** — multi-field |
| **v3analytics** | recastData, config, traceability | advanced | **Easy** — 2 typed selectors |
| **debug** | debugInfo, recastData, rawData, qualityGate, pipelineResult, engineError | advanced | **Hard** — escapes to raw internals |

### 3.3 Tabs that can move to typed run-backed projections first

**Wave 1 candidates** (easy — minimal projection fields, stable contracts):
1. **statements** — `recastData` + `traceability` → typed `RecastPeriodRef` + `EnvelopeRef`
2. **quality** — `recastData` + `traceability` → same pattern
3. **v3analytics** — `recastData` + `traceability` → same pattern
4. **thesis** — `recastData` + `config` → typed selector
5. **ratios (industrial)** — `recastData` + `config` + `traceability` → typed selector

**Wave 2 candidates** (medium — more fields but stable contract shapes):
6. **dashboard (industrial)** — 4 typed selectors from run
7. **workspace** — run selector + config
8. **comparison** — run comparison selectors
9. **regression** — multi-field but mostly stable
10. **report (industrial)** — run + publication selectors

**Wave 3** (hard — blocked by legacy model execution / command center):
11. **valuation** — blocked by `commandCenter` being the legacy oracle
12. **forecast** — blocked by `forecastResults` being legacy-scenario-derived
13. **atlas** — blocked by `pipelineResult` being monolithic
14. **business** — blocked by `pipelineResult` being monolithic
15. **debug** — not a candidate (debugging escape)

**FI fallback tabs** — all hard because `bankResult` is legacy. These can only move after bank/nbfc/insurance native pipelines exist.

---

## 4. Top 10 Gaps Ranked by Migration Criticality

```
Rank  Gap                                                           Area          Severity   Blocks native?
──────────────────────────────────────────────────────────────────────────────────────────────────────
 1    Monolithic processCompanyDataFull — recast, reconciliation,   engine        P0         YES
      family classification, and economic validation in one call.
      Cannot decompose stages 4-8.
      
 2    No native executor — single try/catch orchestrates all 14     engine/       P0         YES
      stages. No per-stage progress, validation, or retry.          platform

 3    Command center is implicit oracle — scenarios, cost of        engine        P0         YES
      capital, model results, and synthesis produced together.
      Model execution and synthesis cannot be separate stages.

 4    Trust envelope built before gates evaluated — traceability    engine        P0         YES
      serializes envelope, then gates are extracted from it.
      Violates ADR-011 monotonic prefix semantics in practice.

 5    No canonical facts when adapter absent — fact extraction      engine        P0         YES
      falls back to flat proxy with no fact-level lineage.
      derivationMode "native" requires facts always.

 6    Correlated model formulations get independent votes —         engine/synth  P0         NO (blocks scorecard)
      VAL-02 from greenfield doc. RE + ReOI + FCFF all vote.
      Also reverse DCF counted as model (AUD-02).

 7    Window selection has two code paths — industrial vs FI.       engine        P1         NO (but risky)
      Different contracts for the same conceptual stage.

 8    Forecast state clones recast periods — VAL-01 from            engine        P0         YES
      greenfield doc. Historical cash-flow reused for forecast
      years. Only industrial path exists.

 9    Bank/NBFC/insurance native pipelines absent — bank            engine        P1         NO (but blocks FI)
      models not in catalog. No native forecast cases.
      UI falls back to legacy FinancialInstitutionReport.

10    UI projection seam still uses structuredClone of legacy       UI            P1         NO
      types — pipelineResult, commandCenter, bankResult are
      all legacy mutable contracts behind a read-only facade.
      8/20 tabs blocked on commandCenter or bankResult.
```

---

## 5. Key Findings Summary

1. **0 of 14 stages are fully native.** Only 4 have native contracts (window, assumptions, forecast, model catalog) but all are legacy-orchestrated.

2. **The legacy executor is a god function** — 1643 lines, one try/catch, no stage-level error isolation. Replacing it with a native stage executor is the highest-leverage migration step.

3. **The UI projection seam is a read-only facade over mutable types.** `structuredClone` prevents mutation but the types (`PipelineResult`, `ValuationCommandCenterOutput`) are still legacy. 12/20 tabs consume at least one legacy-derived field.

4. **5 tabs can move to typed projections in Wave 1** — statements, quality, v3analytics, thesis, ratios (industrial). These require only `RecastPeriod` + traceability envelope selectors.

5. **Bank/NBFC/insurance are entirely on legacy paths** — no native pipeline, no native model catalog entries, no native forecast cases. The UI uses `FinancialInstitutionReport` as a catch-all.

6. **The largest single dependency is `commandCenter`** — consumed by valuation tab, forecast tab (indirectly through forecastResults), and report generation. Until model execution and synthesis are native stages, the valuation tab cannot migrate.
