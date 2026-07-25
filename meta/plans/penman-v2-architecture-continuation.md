---
SECTION_ID: plans.penman-v2-architecture-continuation
TYPE: plan
STATUS: completed
PRIORITY: high
---

# Penman V2 — Architecture Continuation & Migration Design

GOAL: End-to-end architecture + migration plan for the strangler move from `legacyExecutor` to native immutable AnalysisRun, covering valuationCommandCenter, bankPipeline, forecastState, ingestion parsers, UI projection, and reproducibility/content-hash workflow.

CONTEXT: Full codebase deep dive complete. Current state: `legacyExecutor.ts` (1643 lines) wraps the legacy render-time pipeline in an immutable run shell. UI consumes a `structuredClone` "legacy UI projection" (strangler seam). Native canonical layers (facts/DAG, forecastState, modelCatalog, sectorCases, valuationEvidence, advancedModelGovernance) already exist but are wired as legacy-derived.

## Task Checklist

### Phase 1: Current-state assessment & migration sequencing (Owner: Archy) ✅
- [x] Deep-dive legacyExecutor dependency graph: which subsystems are "native-ready" vs "legacy-coupled"
- [x] Gap analysis: what each subsystem must expose to drop the legacy adapter (facts native ingestion, forecastState native run, modelCatalog native execution, etc.)
- [x] Migration sequence: order of subsystem cutover, strangler exit criteria, rollback strategy
- [x] Deliverable: `docs/architecture/plans/2026-07-20-legacy-to-native-migration.md`

### Phase 2: Per-subsystem native designs — sequenced per cutover order (Facts → ForecastState → ModelCatalog → SectorCases → Synthesis → AdvancedGovernance → UIProjection)
- [x] valuationCommandCenter — decompose monolith into native synthesis entry point (Owner: Archy) — P0 blocker ✅
- [x] ingestion parsers — native fact extraction: source artifacts → canonical FactSet, drop adaptLegacyRawPeriodsToFactSet (Owner: Archy) — cutover #1
- [x] forecastState — native forecast-case artifacts, scenario ordering + calibration as run stages (Owner: Archy) — cutover #2
- [x] modelCatalog + sectorCases + synthesis + advancedGovernance — native stage contracts (Owner: Archy) — cutover #3-6 ✅
- [x] bankPipeline — native family-run contract (bank/nbfc/insurance as first-class AnalysisRun families) (Owner: Archy) — after command-center ✅
- [x] UI projection — typed read models from run store, drop structuredClone seam (Owner: Jace, consumes Archy's run contracts) — cutover #7
  - Design doc: `docs/architecture/plans/2026-07-20-ui-projection-read-models.md`
  - Inventory: 9 tabs read-only-ready (Wave 1), 5 tabs multi-field (Wave 2), 6 tabs zero-dependency (Wave 0)
  - Proposed hooks: useRecastPeriods, useTrustEnvelope, useAnalysisStatus, useSourcedAssumptions, useAnalysisWindow, useForecastResults, useScenarioOrdering, useScenarioGovernance, useModelResults, useCommandCenterView, useSynthesis, usePublication
  - Adapter pattern for Wave-2 tabs: src/app/readModels/adapters/*LegacyProps.ts
  - 0 tabs mutate materialization state — structuredClone already prevents it
- [x] reproducibility/content-hash — canonicalization + identity-core projection + cross-run determinism (Owner: Archy) — enabler ✅

### Phase 3: Integration & validation
- [x] Cross-subsystem contract review (Archy + Cody) — 5 contract mismatches found, all resolved with documented fixes in §13
- [x] Test strategy: golden-suite parity, run-diff determinism, reproducibility hash stability (Owner: Cody)
  - Delivered: `docs/architecture/plans/2026-07-20-native-migration-test-strategy.md`
  - 5 layers: PARITY, DETERMINISM, GATE INVARIANTS, RUN-DIFF, PHASED ROLLOUT
  - 15 existing tests mapped, 14 new test files specified, 2 new infrastructure files
  - P1 risk: advanced-model mutation pattern (composition incompatibility with immutable stages)
- [x] UI migration plan for 20 tabs (Owner: Jace)
  - Delivered: `docs/architecture/plans/2026-07-20-ui-projection-read-models.md#7-tab-by-tab-implementation-plan`
  - Wave 0: 6 zero-dep tabs (~0.5 eng day)
  - Wave 1: 9 read-only-ready tabs → 3 read-model hooks + pure selector swaps (~3 eng days + 1 QA)
  - Wave 2: 5 multi-field adapter tabs → 5 adapter hooks + 9 read-model hooks (~5 eng days + 2 QA)
  - Wave 3: Delete buildLegacyUiProjection() + structuredClone (~1 eng day)
  - Total: ~9.5 eng days + 3.5 QA days

## Success Criteria
- [x] Migration plan doc reviewed and sequenced (§1-13, cutover order + 9 strangler-exit conditions)
- [x] Each subsystem has a native-run design with definition-of-done (7/7)
- [x] Strangler exit criteria explicit (§3, 9 conditions; legacyExecutor deletable when met)
- [x] No regression to rigor-ladder / fail-closed invariants (Cody test strategy gate-invariants layer + Archy §13 contract review)
