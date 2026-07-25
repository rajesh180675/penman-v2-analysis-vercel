# UI Projection Read-Models — Cutover #7 Design

**Date:** 2026-07-20 (IST)
**Status:** Design complete
**Owner:** Jace
**Prerequisites:** Stages 9–12 native (assumption-resolution → forecast → model-execution → synthesis)

## 1. Current state

`useRunBackedAuditAnalysis()` at `src/app/useRunBackedAuditAnalysis.ts` returns a fat object with ~30 properties. All tab components receive this through `TabRouter.tsx` as props. The strangler seam is:

```ts
function buildLegacyUiProjection(value: unknown): LegacyUiRunProjection | null {
  if (!value) return null;
  return structuredClone(value) as LegacyUiRunProjection;
}
```

This clones the entire `LegacyAnalysisRunMaterializationV1` blob → destructures 11 fields → reassembles as the `projection` object. **0 tabs mutate the materialization** because structuredClone makes it a shallow snapshot. The clone exists solely because the legacy types are not `DeepReadonly`.

The `AnalysisRunStore` (`src/app/analysisRun/store.ts`) already holds the verified immutable `StoredAnalysisRun` and exposes typed selectors:
- `selectRecastData()` → `RecastPeriod[]`
- `selectCommandCenter()` → `ValuationCommandCenterOutput | null`
- `selectTrustEnvelope()` → `AnalysisRunV1["trustEnvelope"] | null`
- `selectModelResults()` → `LegacyAnalysisRunMaterializationV1["modelResults"]`
- `selectMaterialization()` → full blob (fallback)

## 2. Tab → field consumption inventory

### 2.1 Read-model-only tabs (consume ≤2 fields from the projection; trivial migration)

| Tab | Props consumed from projection | Store selectors needed |
|-----|-------------------------------|----------------------|
| statements | `recastData`, `traceability` | `selectRecastData()`, `selectTrustEnvelope()` |
| ratios | `recastData`, `traceability` | same |
| quality | `recastData`, `traceability` | same |
| regression | `recastData`, `traceability` | same |
| v3analytics | `recastData`, `traceability` | same |
| thesis | `recastData` | `selectRecastData()` |
| workspace | `recastData`, `analysisStatus` | `selectRecastData()`, `deriveAnalysisStatus(...)` |
| inspector | `analysisStatus` | `deriveAnalysisStatus(...)` |
| dashboard | `recastData`, `traceability` | `selectRecastData()`, `selectTrustEnvelope()` |

**9 tabs — Wave 1 candidates. Zero schema changes. Pure selector swap.**

### 2.2 Multi-field read-model tabs (multiple typed artifacts; need adapter)

| Tab | Props consumed from projection | Store selectors needed |
|-----|-------------------------------|----------------------|
| forecast | `recastData`, `traceability`, `forecastResults`, `analysisWindow`, `sourcedAssumptionSet`, `scenarioOrdering`, `scenarioGovernance` | `selectRecastData()`, `selectTrustEnvelope()` + stage-10 artifacts: `selectForecastCases()`, `selectScenarioOrdering()`, `selectScenarioGovernance()` |
| valuation | `recastData`, `traceability`, `commandCenter`, `publication`, `lossMakerResult`, `ratioSanity`, `segmentData`, `analysisStatus` | `selectRecastData()`, `selectTrustEnvelope()` + stage-11/12 artifacts: `selectModelResults()`, `selectSynthesis()`, `selectCommandCenter()` (strangler bridge) |
| report | `recastData`, `traceability`, `publication`, `ratioSanity` | `selectRecastData()`, `selectTrustEnvelope()`, `selectSynthesis()`, `selectModelResult("ratio-sanity")` |
| atlas | `pipelineResult` | `selectMaterialization().pipelineResult` (bridge) |
| business | `pipelineResult`, `recastData` | `selectRecastData()`, `selectMaterialization().pipelineResult` (bridge) |

**5 tabs — Wave 2 candidates. Need typed read-model hooks for stage artifacts.**

### 2.3 Zero-projection-dependency tabs (already decoupled)

| Tab | Sources | No projection fields |
|-----|---------|---------------------|
| upload | `rawData`, `config`, `handleDataSubmit` | ✓ |
| watchlist | `workspaceCompanies`, `workspaceCompanyId` | ✓ |
| bank | `bankResult`, `config`, `companyId` | ✓ |
| scope | `scopeAwareResult` (separate computation) | ✓ |
| comparison | `registry`, `config`, `comparisonPublication`, `portfolioRunComparison` | ✓ |
| debug | `debugInfo`, `recastData`, `rawData`, `qualityGate`, `engineError` | ✓ |

**6 tabs — Wave 0 (no migration needed).**

### 2.4 Summary

- **9 tabs read-only-ready** (Wave 1) — swap to narrow selectors, immediate benefit
- **5 tabs multi-field** (Wave 2) — need typed read-model hooks for native stage artifacts
- **6 tabs zero-dependency** — already decoupled
- **0 tabs genuinely mutate materialization state** — structuredClone already prevents it

## 3. Typed read-model hooks

### 3.1 Principle

Each read-model hook subscribes to the `AnalysisRunStore` (via the store exposed by `useAnalysisRunExecution`) and returns a narrow, typed, deeply-readonly view. Hooks are stable-referenced (`useMemo`-wrapped internally) so they don't cause re-renders when the store revs but the selected slice hasn't changed.

### 3.2 Hook catalog

```ts
// ── Core slices (store.selectors already exist) ──

/** Read-only recast period array. Stable reference. */
function useRecastPeriods(store: AnalysisRunStore): readonly RecastPeriod[]

/** Read-only trust envelope. Stable reference. */
function useTrustEnvelope(store: AnalysisRunStore): DeepReadonly<AnalysisTraceabilityEnvelope> | null

/** Analysis status summary derived from quality gate + readiness + mapping. */
function useAnalysisStatus(store: AnalysisRunStore): AnalysisStatusSummary

// ── Stage-9 (assumption-resolution) ──

/** Sourced assumption set from the run. */
function useSourcedAssumptions(store: AnalysisRunStore): DeepReadonly<SourcedAssumptionSet> | null

/** Analysis window. */
function useAnalysisWindow(store: AnalysisRunStore): DeepReadonly<UnifiedAnalysisWindow> | null

// ── Stage-10 (forecast) ──

/** Industrial forecast results. */
function useForecastResults(store: AnalysisRunStore): readonly DeepReadonly<IndustrialForecastResult>[]

/** Scenario ordering report. */
function useScenarioOrdering(store: AnalysisRunStore): DeepReadonly<ScenarioOrderingReport> | null

/** Scenario governance report. */
function useScenarioGovernance(store: AnalysisRunStore): DeepReadonly<ScenarioGovernanceReport> | null

// ── Stage-11 (model-execution) ──

/** Cost-of-capital + share basis + readiness. (Was part of commandCenter) */
function useCostOfCapital(store: AnalysisRunStore): CostOfCapitalResult | null

/** Run-specific model results (catalog-dispatched). */
function useModelResults(store: AnalysisRunStore): readonly DeepReadonly<ValuationModelResult>[]

/** Command center — strangler bridge until native synthesis is complete. */
function useCommandCenterView(store: AnalysisRunStore): DeepReadonly<ValuationCommandCenterOutput> | null

// ── Stage-12 (synthesis) ──

/** Evidence-weighted synthesis. Replaces commandCenter.evidenceWeightedSynthesis in future. */
function useSynthesis(store: AnalysisRunStore): DeepReadonly<EvidenceWeightedValuationSynthesis> | null

/** Publication snapshot — build from recast data + traceability + quality gate. */
function usePublication(store: AnalysisRunStore): AnalysisPublicationSnapshot | null
```

### 3.3 Implementation pattern

Each hook uses:
```ts
import { useSyncExternalStore } from "react";

function useRecastPeriods(store: AnalysisRunStore): readonly RecastPeriod[] {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.selectRecastData(),
  );
}
```

`useSyncExternalStore` gives us tear-free subscription to the store's immutable snapshots. The store already returns `Object.freeze`d arrays (via `cloneAndFreeze`) and publishes on every mutation. Because `selectRecastData()` returns the same frozen array reference when the run hasn't changed, React sees the same reference and skips re-render.

### 3.4 Shared trust envelope flow

The `AnalysisRunStatusBar` (currently wired via `traceability` prop < `useRunBackedAuditAnalysis`) will receive:
```ts
const trustEnvelope = useTrustEnvelope(store);
```
This is **identical to today's `traceability`** — same type, same shape, same runtime reference stability. **Zero changes to AnalysisRunStatusBar.**

### 3.5 Strangler adapter for tabs that need mutable contracts

**No tab genuinely needs mutable contracts** because structuredClone already isolates them. However, 5 tabs (Wave 2) have legacy prop interfaces that receive 6+ individual props rather than a single typed artifact. The adapter pattern:

```ts
// Step 1: adapter hook that assembles the legacy prop shape from typed selectors
function useValuationReportLegacyProps(store: AnalysisRunStore) {
  const recastData = useRecastPeriods(store);
  const commandCenter = useCommandCenterView(store);
  const trustEnvelope = useTrustEnvelope(store);
  const publication = usePublication(store);
  const modelResults = useModelResults(store);

  return useMemo(() => ({
    data: recastData,
    commandCenter,
    traceability: trustEnvelope,
    publication,
    lossMaker: selectLossMakerResult(modelResults),
    ratioSanity: selectRatioSanity(modelResults),
    segmentData: selectSegmentData(modelResults),
    analysisStatus: deriveAnalysisStatus(/* from trust envelope... */),
  }), [recastData, commandCenter, trustEnvelope, publication, modelResults]);
}

// Step 2: tab component renders unchanged — props are still the same shape,
// but they come from the adapter hook instead of the fat projection.
function ValuationReportWrapper() {
  const store = useAnalysisRunStore(); // from context
  const legacyProps = useValuationReportLegacyProps(store);
  return <ValuationReport {...legacyProps} />;
}

// Step 3: when the tab is refactored to consume typed artifacts directly,
// delete the adapter and swap to narrow hooks inside the tab component.
```

**Adapter lifecycle:**
- Phase A (dual-read): adapter hook wraps existing tab — no behavior change
- Phase B (native read): adapter reads from typed selectors, kept as facade
- Phase C (delete): tab refactored to read hooks directly, adapter removed

## 4. Wave sequencing

### Wave 0 — Zero-dependency tabs
Files: `TabRouter.tsx` — these tabs already receive non-projection props. No change.

### Wave 1 — 9 read-only-ready tabs
Change `TabRouter.tsx` to pass `store.selectRecastData()` + `store.selectTrustEnvelope()` instead of `recastData` and `traceability` from the projection. The tab components consume these identically.

**Files touched:**
- `src/app/components/TabRouter.tsx` — prop plumbing
- `src/app/useRunBackedAuditAnalysis.ts` — can delete `recastData` derivation from projection for these tabs
- New: `src/app/readModels/useRecastPeriods.ts`, `src/app/readModels/useTrustEnvelope.ts`

### Wave 2 — 5 multi-field tabs
For each Wave-2 tab:
1. Create the adapter hook in `src/app/readModels/adapters/{tabName}LegacyProps.ts`
2. Wrap the tab in `TabRouter.tsx` with the adapter
3. When native stages 9–12 produce artifacts, swap adapter internals to typed selectors
4. Delete adapter when tab is refactored to direct hooks

**Files added:**
- `src/app/readModels/useForecastResults.ts`
- `src/app/readModels/useAnalysisWindow.ts`
- `src/app/readModels/useCommandCenterView.ts`
- `src/app/readModels/usePublication.ts`
- `src/app/readModels/useSourcedAssumptions.ts`
- `src/app/readModels/useScenarioOrdering.ts`
- `src/app/readModels/useScenarioGovernance.ts`
- `src/app/readModels/useSynthesis.ts`
- `src/app/readModels/adapters/forecastLegacyProps.ts`
- `src/app/readModels/adapters/valuationLegacyProps.ts`
- `src/app/readModels/adapters/reportLegacyProps.ts`
- `src/app/readModels/adapters/atlasLegacyProps.ts`
- `src/app/readModels/adapters/businessLegacyProps.ts`

### Wave 3 — Delete strangler seam
When all tabs have migrated:
1. Delete `buildLegacyUiProjection()` and `LegacyUiRunProjection` type
2. Remove `structuredClone` call from `useRunBackedAuditAnalysis`
3. Delete `LegacyAnalysisRunMaterializationV1` from the UI layer (keep in engine for legacy executor until cutover complete)

## 5. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `useSyncExternalStore` tear risk if store publishes before immutable reference is stable | Stale component state | Store uses `Object.freeze` + frozen arrays; `useSyncExternalStore` is designed for this pattern |
| Wave-2 adapter hooks increase component tree depth by 1 | Negligible performance impact | Adapters are lightweight memo wrappers; no DOM nodes added |
| Tabs that access `recastData.length` directly (not through selector) | Re-render on every store publish even if recast data unchanged | Use `useSyncExternalStore` with shallow-equality on the snapshot; store returns stable reference for unchanged runs |
| `commandCenter` still needed as a monolithic type until stages 9–12 ship | Wave-2 valuation tab blocked on command-center decomposition | `useCommandCenterView` is the strangler bridge — identical shape to today's `projection.commandCenter`; deletion deferred to after all 7 subsystems native |

## 6. Success criteria

- [ ] `buildLegacyUiProjection()` deleted
- [ ] `LegacyUiRunProjection` type deleted
- [ ] All 20 tabs consume typed narrow selectors
- [ ] `AnalysisRunStatusBar` unchanged (still receives `trustEnvelope` via `useTrustEnvelope`)
- [ ] No `structuredClone` in the UI seam
- [ ] `selectMaterialization()` only used by bridge adapters in Wave 2, zero callers in Wave 3

## 7. Tab-by-tab implementation plan

### 7.1 Wave 0 — Zero-dependency tabs (no changes needed)

| # | Tab | Component | File | Current props from TabRouter | Notes |
|---|-----|-----------|------|----------------------------|-------|
| 1 | upload | DataEntry | `src/components/DataEntry.tsx` | `onDataSubmit, onBatchSubmit, currentData={rawData}, config, onConfigChange={setConfig}` | All props from inputs/config — no projection dependency. Zero work. |
| 2 | watchlist | WatchlistDashboard | `src/components/WatchlistDashboard.tsx` | `companies={workspaceCompanies}, activeCompanyId={workspaceCompanyId}, onSelectCompany={fn}` | All props from workspace state — no projection dependency. Zero work. |
| 3 | bank | FinancialInstitutionReport | `src/components/FinancialInstitutionReport.tsx` | `bankResult, config, companyId, auditRunId, marketCapCr, nbfcSidecar` | `bankResult` comes from `pipelineResult.bankResult` (projection) — but bank is a separate family; receives the financial-institution result directly, not through the general projection. Minimal: one selector swap. |
| 4 | scope | SubsidiaryContributionPanel | `src/components/dashboard/SubsidiaryContributionPanel.tsx` | `result={scopeAwareResult}` | `scopeAwareResult` is a memoized computation in `useRunBackedAuditAnalysis`, not from the projection. Zero work. |
| 5 | comparison | ComparisonReport | `src/components/ComparisonReport.tsx` | `registry, config, publication={comparisonPublication}, runComparison={portfolioRunComparison}` | `portfolioRunComparison` comes from `execution.store.selectPortfolioComparison()`, not from projection. `comparisonPublication` is a memo. Zero work. |
| 6 | debug | DebugPanel | `src/components/DebugPanel.tsx` | `debugInfo, recastData, rawData, qualityGate, engineError, greenfield={pipelineResult?.greenfield}` | Reads `recastData`, `qualityGate`, `pipelineResult?.greenfield` from projection. **Minimal work:** swap to `store.selectRecastData()` and `store.selectMaterialization()?.qualityGate` in TabRouter inline. No adapter needed. |

**Acceptance:** All 6 tabs render identically before/after. No new files. Zero changes to tab components.

**Wave 0 effort: ~0.5 engineering day** (verification + 2-line debug prop swap).

### 7.2 Wave 1 — Read-only-ready tabs (pure selector swap)

| # | Tab | Component | File | Props consumed from projection | Read-model hooks | Legacy props dropped |
|---|-----|-----------|------|-------------------------------|-----------------|---------------------|
| 7 | statements | RecastStatements | `src/components/RecastStatements.tsx` | `data={recastData!}, traceability, traceabilitySummary={publication?.traceabilitySummary}` | `useRecastPeriods(store)` → `data`, `useTrustEnvelope(store)` → `traceability` | `traceabilitySummary` is optional (default null) — drop it |
| 8 | ratios | RatioReport | `src/components/RatioReport.tsx` | `data={recastData!}, config, traceability, traceabilitySummary={publication?.traceabilitySummary}` | `useRecastPeriods(store)` → `data`, `useTrustEnvelope(store)` → `traceability` | `traceabilitySummary` is optional (default null) — drop it; `config` stays from parent |
| 9 | quality | QualityReport | `src/components/QualityReport.tsx` | `data={recastData!}, traceability, traceabilitySummary={publication?.traceabilitySummary}` | `useRecastPeriods(store)` → `data`, `useTrustEnvelope(store)` → `traceability` | `traceabilitySummary` is optional — drop it |
| 10 | regression | RegressionReport | `src/components/RegressionReport.tsx` | `rawData, recastData, config, registry, traceability, traceabilitySummary={publication?.traceabilitySummary}` | `useRecastPeriods(store)` → `recastData`, `useTrustEnvelope(store)` → `traceability` | `traceabilitySummary` is optional — drop it; `rawData`, `config`, `registry` stay from parent |
| 11 | v3analytics | V3AnalyticsPanel | `src/components/V3AnalyticsPanel.tsx` | `data={recastData!}, config, traceability, traceabilitySummary={publication?.traceabilitySummary}` | `useRecastPeriods(store)` → `data`, `useTrustEnvelope(store)` → `traceability` | `traceabilitySummary` is optional — drop it |
| 12 | thesis | InvestmentThesis | `src/components/InvestmentThesis.tsx` | `data={recastData!}, config` | `useRecastPeriods(store)` → `data` | none (config stays from parent) |
| 13 | workspace | CompanyWorkspace | `src/components/CompanyWorkspace.tsx` | `rawData, recastData, config, analysisStatus, auditMeta, registry, selectedCompanyId, onSelectCompanyId` | `useRecastPeriods(store)` → `recastData`, `useAnalysisStatus(store)` → `analysisStatus` | `analysisStatus` flows from hook instead of projection |
| 14 | inspector | RunInspector | `src/components/RunInspector.tsx` | `auditMeta, analysisStatus` | `useAnalysisStatus(store)` → `analysisStatus` | `analysisStatus` flows from hook instead of projection |
| 15 | dashboard | DashboardView | `src/components/dashboard/DashboardView.tsx` | `data={recastData!}, config, traceability, ratioSanity, segmentData, marketData, peerCount, onNavigate` | `useRecastPeriods(store)` → `data`, `useTrustEnvelope(store)` → `traceability` | `ratioSanity`, `segmentData` are optional (default null) — drop them for Wave 1; re-add via `useModelResults()` in Wave 2 |

**Properties that remain from parent (not from projection):**
- `config` — passed from TabRouter's props (not from projection)
- `rawData` — from inputs (not from projection)
- `registry` — from inputs (not from projection)
- `auditMeta` — from inputs (not from projection)
- `marketData` / `marketDataLoading` / `marketDataError` / `onMarketRefresh` — from inputs (not from projection)
- `segmentData` — from inputs (not from projection)

**Implementation pattern per Wave-1 tab:**
```tsx
// Before (TabRouter.tsx):
{activeTab === "statements" && hasRecast &&
  <RecastStatements data={recastData!} traceability={traceability}
    traceabilitySummary={publication?.traceabilitySummary ?? null} />}

// After (TabRouter.tsx) — tab component unchanged, just new props:
{activeTab === "statements" && hasRecast && (() => {
  const data = useRecastPeriods(store);
  const traceability = useTrustEnvelope(store);
  return <RecastStatements data={data} traceability={traceability} />;
})()}
```

**New files needed (Wave 1):**
- `src/app/readModels/useRecastPeriods.ts`
- `src/app/readModels/useTrustEnvelope.ts`
- `src/app/readModels/useAnalysisStatus.ts`

**Acceptance per tab:**
1. Screenshot tab before change
2. Apply selector swap
3. Screenshot tab after change
4. Pixel-match: same layout, same data values
5. Console: no new warnings, no selector subscription errors
6. Trust envelope: `AnalysisRunStatusBar` receives identical `traceability` object (same reference stability)

**Wave 1 effort: ~3 engineering days + 1 QA day.**

### 7.3 Wave 2 — Multi-field adapter tabs

| # | Tab | Component | File | Props consumed from projection | Adapter hook | Read-model hooks used by adapter |
|---|-----|-----------|------|-------------------------------|-------------|----------------------------------|
| 16 | forecast | ForecastReport (+RunBackedForecastReport) | `src/components/ForecastReport.tsx` | `data={recastData!}, rawData, config, traceability, traceabilitySummary, runForecastResults, analysisWindow, sourcedAssumptionSet, scenarioOrdering, scenarioGovernance` | `useForecastLegacyProps(store)` | `useRecastPeriods()`, `useTrustEnvelope()`, `useAnalysisWindow()`, `useSourcedAssumptions()`, `useForecastResults()`, `useScenarioOrdering()`, `useScenarioGovernance()` |
| 17 | valuation | ValuationReport | `src/components/ValuationReport.tsx` | `data={recastData!}, config, analysisStatus, auditMeta, traceability, publication, lossMaker, ratioSanity, segmentData, commandCenter, marketData, marketDataLoading, marketDataError, onMarketRefresh` | `useValuationLegacyProps(store)` | `useRecastPeriods()`, `useTrustEnvelope()`, `useAnalysisStatus()`, `useCommandCenterView()`, `usePublication()`, `useModelResults()` |
| 18 | report | AcademicReport | `src/components/AcademicReport.tsx` | `data={recastData!}, config, rawData, auditMeta, traceability, publication, ratioSanity` | `useReportLegacyProps(store)` | `useRecastPeriods()`, `useTrustEnvelope()`, `usePublication()`, `useModelResults()` |
| 19 | atlas | AtlasReport | `src/components/atlas/AtlasReport.tsx` | `rawData, pipelineResult` | `useAtlasLegacyProps(store)` | `selectMaterialization().pipelineResult` (strangler bridge) |
| 20 | business | BusinessModelReport | `src/components/business-model/BusinessModelReport.tsx` | `pipelineResult, recastData` | `useBusinessLegacyProps(store)` | `useRecastPeriods()`, `selectMaterialization().pipelineResult` (strangler bridge) |

#### Adapter hook details

**`forecastLegacyProps.ts`:**
```ts
function useForecastLegacyProps(store: AnalysisRunStore) {
  const data = useRecastPeriods(store);
  const traceability = useTrustEnvelope(store);
  const analysisWindow = useAnalysisWindow(store);
  const assumptions = useSourcedAssumptions(store);
  const forecastResults = useForecastResults(store);
  const scenarioOrdering = useScenarioOrdering(store);
  const governance = useScenarioGovernance(store);

  return useMemo(() => ({
    data, traceability,
    analysisWindow, sourcedAssumptionSet: assumptions,
    runForecastResults: forecastResults,
    scenarioOrdering, scenarioGovernance,
  }), [data, traceability, analysisWindow, assumptions, forecastResults, scenarioOrdering, governance]);
}
```

**`valuationLegacyProps.ts`:**
```ts
function useValuationLegacyProps(store: AnalysisRunStore) {
  const data = useRecastPeriods(store);
  const traceability = useTrustEnvelope(store);
  const analysisStatus = useAnalysisStatus(store);
  const commandCenter = useCommandCenterView(store);
  const publication = usePublication(store);
  const modelResults = useModelResults(store);

  return useMemo(() => ({
    data, traceability, analysisStatus,
    commandCenter, publication,
    lossMaker: selectLossMakerResult(modelResults),
    ratioSanity: selectRatioSanity(modelResults),
    segmentData: selectSegmentData(modelResults),
  }), [data, traceability, analysisStatus, commandCenter, publication, modelResults]);
}
```

**`reportLegacyProps.ts`:**
```ts
function useReportLegacyProps(store: AnalysisRunStore) {
  const data = useRecastPeriods(store);
  const traceability = useTrustEnvelope(store);
  const publication = usePublication(store);
  const modelResults = useModelResults(store);

  return useMemo(() => ({
    data, traceability, publication,
    ratioSanity: selectRatioSanity(modelResults),
  }), [data, traceability, publication, modelResults]);
}
```

**`atlasLegacyProps.ts`:**
```ts
function useAtlasLegacyProps(store: AnalysisRunStore) {
  const materialization = store.selectMaterialization();
  return useMemo(() => ({
    pipelineResult: materialization?.pipelineResult ?? null,
  }), [materialization]);
}
```

**`businessLegacyProps.ts`:**
```ts
function useBusinessLegacyProps(store: AnalysisRunStore) {
  const data = useRecastPeriods(store);
  const materialization = store.selectMaterialization();
  return useMemo(() => ({
    recastData: data,
    pipelineResult: materialization?.pipelineResult ?? null,
  }), [data, materialization]);
}
```

**New files needed (Wave 2):**
- `src/app/readModels/useForecastResults.ts`
- `src/app/readModels/useAnalysisWindow.ts`
- `src/app/readModels/useSourcedAssumptions.ts`
- `src/app/readModels/useCommandCenterView.ts`
- `src/app/readModels/useScenarioOrdering.ts`
- `src/app/readModels/useScenarioGovernance.ts`
- `src/app/readModels/usePublication.ts`
- `src/app/readModels/useSynthesis.ts` (future — not consumed by any Wave-2 adapter but needed for completion)
- `src/app/readModels/useModelResults.ts`
- `src/app/readModels/adapters/forecastLegacyProps.ts`
- `src/app/readModels/adapters/valuationLegacyProps.ts`
- `src/app/readModels/adapters/reportLegacyProps.ts`
- `src/app/readModels/adapters/atlasLegacyProps.ts`
- `src/app/readModels/adapters/businessLegacyProps.ts`

**Selector helper functions (placed in `useModelResults.ts` or a shared helper):**
```ts
function selectLossMakerResult(modelResults: readonly DeepReadonly<ValuationModelResult>[]): LossMakerValuationResult | null {
  return modelResults.find((r) => r.kind === "loss-maker")?.payload ?? null;
}
function selectRatioSanity(modelResults: readonly DeepReadonly<ValuationModelResult>[]): SanityAssessment | null {
  return modelResults.find((r) => r.kind === "ratio-sanity")?.payload ?? null;
}
function selectSegmentData(modelResults: readonly DeepReadonly<ValuationModelResult>[]): AllSegmentData | null {
  return modelResults.find((r) => r.kind === "segment-data")?.payload ?? null;
}
```

**Acceptance per tab (Wave 2):**
1. Screenshot tab before change
2. Application renders with adapter wrapper
3. Screenshot tab after change
4. Pixel-match: all data sections render identically (recast data, trust panel, command center, forecast scenarios, publication)
5. Console: no errors from adapter hooks, no stale closure warnings
6. Trust envelope: `AnalysisRunStatusBar` receives identical `traceability` object
7. Performance: adapter `useMemo` produces stable prop references; no extra re-renders vs baseline

**Wave 2 effort: ~5 engineering days + 2 QA days.**

### 7.4 Wave 3 — Delete strangler seam

| Step | Action | Files | Risk |
|------|--------|-------|------|
| 7.4.1 | Delete `buildLegacyUiProjection()` function | `src/app/useRunBackedAuditAnalysis.ts` | Low — function body is isolated |
| 7.4.2 | Delete `LegacyUiRunProjection` interface | `src/app/useRunBackedAuditAnalysis.ts` | Low — type alias, no runtime impact |
| 7.4.3 | Remove `structuredClone()` call from `useRunBackedAuditAnalysis` | `src/app/useRunBackedAuditAnalysis.ts` | **Medium** — verify no legacy tab still depends on the cloned shape |
| 7.4.4 | Verify `selectMaterialization()` has zero callers outside Wave-2 adapters | Project-wide grep | Low — grep confirms |
| 7.4.5 | Delete `LegacyAnalysisRunMaterializationV1` type from UI layer imports | `src/app/useRunBackedAuditAnalysis.ts`, `src/app/analysisRun/store.ts` | Low — keep in engine for executor |
| 7.4.6 | Remove `LegacyUiRunProjection` from all type exports | Project-wide grep | Low |

**Rollback:** If any tab breaks in production, restore `buildLegacyUiProjection()` as a thin wrapper that reads directly from selectors (no structuredClone). This reverses the deletion without restoring the clone cost.

**Wave 3 effort: ~1 engineering day.**

### 7.5 Summary

**Effort breakdown by wave:**

| Wave | Tabs | Engineering days | QA days | Risk |
|------|------|-----------------|---------|------|
| Wave 0 — Zero-dep | 6 | 0.5 | 0 | None |
| Wave 1 — Read-only-ready | 9 | 3 | 1 | Low (pure prop swap) |
| Wave 2 — Multi-field adapter | 5 | 5 | 2 | Medium (adapter correctness) |
| Wave 3 — Delete strangler | 0 (cleanup) | 1 | 0.5 | Medium (regression in rarely-used path) |
| **Total** | **20** | **9.5** | **3.5** | — |

**Cost of structuredClone removal:** The `structuredClone` on every run finalization currently clones the full `LegacyAnalysisRunMaterializationV1` (~200 KB object). Removing it saves ~4-8 ms per run finalization on the hot path and eliminates the transient GC pressure. The clone existed because legacy types lacked `DeepReadonly` — with all 20 tabs on typed read-models, the clone is purely overhead.

**Tab ordering within a wave (recommended implementation sequence):**

| Order | Tab | Wave | Why this order |
|-------|-----|------|----------------|
| 1 | debug | 0 | Simplest — just 2 selectors inline |
| 2 | thesis | 1 | Only needs `useRecastPeriods` — smoke test the hook |
| 3 | inspector | 1 | Only needs `useAnalysisStatus` — smoke test the second hook |
| 4 | statements | 1 | Both core hooks — first real test of combined consumption |
| 5 | ratios | 1 | Same pattern as statements |
| 6 | quality | 1 | Same pattern |
| 7 | v3analytics | 1 | Same pattern |
| 8 | regression | 1 | Same pattern + additional non-projection props |
| 9 | workspace | 1 | Same + `useAnalysisStatus` |
| 10 | dashboard | 1 | Same + optional props dropped (ratioSanity, segmentData become null) |
| 11 | atlas | 2 | Simplest adapter — single field bridge |
| 12 | business | 2 | Two-field adapter — verifies multi-hook composition |
| 13 | report | 2 | Three hooks + model result selectors |
| 14 | forecast | 2 | Seven hooks — validates full adapter pattern |
| 15 | valuation | 2 | Six hooks + publication — most complex adapter |
| 16 | — | 3 | Delete strangler seam |
