# Native Migration Test & Validation Strategy — Phase 3

**Date:** 2026-07-20 (IST)
**Status:** Design complete
**Owner:** Cody
**Prerequisites:** Phase 1 & 2 docs (legacy-to-native-migration.md, ui-projection-read-models.md), golden-company suite, runDiff, identity-core tests

---

## 1. Executive Summary

Five test layers, phased rollout mapped to cutover order (Facts → ForecastState → ModelCatalog → SectorCases → Synthesis → AdvancedGovernance → UIProjection). The central premise: **the strangler must be output-equivalent during cutover.** Every native subsystem must prove byte-identical `reproducibilityHash` (same → same) and `runDiff`-clean analytical output (legacy vs native → zero unexpected diffs) before the legacy adapter is deleted.

---

## 2. Layer 1: PARITY — Golden-Company Parity Harness

### 2.1 What it proves

For every golden-company fixture, the native path and the legacy path produce identical analytical outputs. "Identical" means:

- **`reproducibilityHash` matches** between legacy and native runs for the same inputs
- **`runDiff` on the flat snapshot shows zero `ChangedCell[]`** that aren't explicitly classified as "intended deltas" (e.g., floating-point rounding below 1e-12, new fields native adds that legacy didn't emit)
- **Per-subsystem checkpoint deltas are zero** — e.g., FactSet content hash is the same, ForecastCase content hashes match

### 2.2 Existing coverage

| File | Role |
|------|------|
| `src/engine/__tests__/goldenCompanySuite.spec.ts` | Validates ratio ranges, quality tier, terminal flags for 5 mandatory golden companies (Asian Paints, Reliance, HDFC Bank, NTPC, Bajaj Finance) + any extras with fixtures |
| `src/engine/goldenCompanySuite.ts` | `runGoldenCompanyCase()` — runs `processCompanyData` → `evaluateQualityGate` → `resolveValuationReadiness`. **Calls the LEGACY pipeline only.** |
| `src/engine/__tests__/goldenCompanyExpectations.spec.ts` | Schema validation of `expectations.json` for each golden company; enforces plan-v4 schema contract |

### 2.3 New tests needed — Per-subsystem parity checkpoints

For each cutoff step, create a dual-run test that: (1) calls the legacy path, (2) calls the native path with same inputs, (3) records every delta. Tests live alongside the subsystem being migrated.

```ts
// Pattern — src/engine/facts/__tests__/parity.facts.spec.ts
describe("Facts parity: native vs legacy", () => {
  for (const fixture of GOLDEN_COMPANY_CASES) {
    it(`produces identical FactSet for ${fixture.id}`, async () => {
      const legacy = await runLegacyFactExtraction(fixture.rawData, fixture.config);
      const native = await runNativeFactExtraction(fixture.rawData, fixture.config);
      expect(legacy.factSetRef.contentHash).toBe(native.factSetRef.contentHash);
      expect(await verifyAnalysisContentArtifact(legacy.factSetArtifact)).toBe(true);
      expect(await verifyAnalysisContentArtifact(native.factSetArtifact)).toBe(true);
    });
  }
});
```

**Checkpoint table:**

| Cutover # | Subsystem | Fixture count | Parity assert | Pass/fail criterion |
|-----------|-----------|--------------|--------------|---------------------|
| 1 | Facts | 5+ | `FactSetRef.contentHash` identical | Hash match for ≥4/5 companies; 1 failure allowed with documented root cause |
| 2 | ForecastState | 3 (industrial) | `ForecastCase[].contentHash` each identical | All 4 scenarios per company hash-match |
| 3 | ModelCatalog | 3 (industrial) | `ValuationModelResult[].contentHash` hash | ≥12 of 13 models hash-match per company; intended deltas recorded in `IntendedDeltaCatalog` |
| 4 | SectorCases | 1 (bank) | `SectorCaseCatalogExecutionResult` match | N/A until bank pipeline is parity-harnessed |
| 5 | Synthesis | 3 | `SynthesisStageOutput.synthesisRef.contentHash` | Hash match for ≥2/3; delta tolerance ≤ 1e-12 on numeric weights |
| 6 | AdvancedGovernance | 1 (composition fixture) | `synthesisRef` hash, no mutation | Composition must produce same final synthesis as legacy post-hoc mutation |
| 7 | UIProjection | 20 tabs | No `structuredClone`; selector output identical to legacy projection fields | Tab-by-tab comparison matrix |

### 2.4 Intended delta catalog

Some deltas between legacy and native are **intentional** — e.g., native adds an evidence ref that legacy silently omitted. Every such delta must be recorded in a shared `IntendedDeltaCatalog`:

```ts
// src/engine/migration/intendedDeltaCatalog.ts
export const INTENDED_DELTAS: Record<string, IntendedDelta> = {
  "facts.contentRef.byteLength": {
    subsystem: "facts",
    reason: "Native adds a constant 'score' field to the fact set; legacy omits it.",
    impact: "semantic-add",
    requiresReviewerApproval: false,
  },
};
```

The parity harness ignores deltas in the catalog and **fails on any delta outside it**.

---

## 3. Layer 2: DETERMINISM — Reproducibility Hash Stability

### 3.1 What it proves

Same inputs → same `reproducibilityHash` across runs, across worker boundaries, across browser tab boundaries. Three canonicalization gaps (found by Archy in §12.4 of the migration doc) must be covered with tests.

### 3.2 Gaps to close + test coverage

**Gap A — Unsorted ContentRef arrays (§12.4, item 2):**

`[refA, refB]` and `[refB, refA]` produce different hashes despite same content. Fix: sort by `contentHash` before hashing.

```ts
// New test — src/lib/__tests__/identity.contentRefOrder.spec.ts
it("ContentRef arrays are sorted deterministically before hashing", async () => {
  const runA = draft({ forecastCaseRefs: [ref("forecast-case", "x"), ref("forecast-case", "y")] });
  const runB = draft({ forecastCaseRefs: [ref("forecast-case", "y"), ref("forecast-case", "x")] });
  expect(await hashAnalysisRunCore(runA)).toBe(await hashAnalysisRunCore(runB));
});
```

**Gap B — `status` not in identity core (§12.4, item 1):**

A completed run and a blocked run with identical inputs produce the same hash. Fix: add `status` to `AnalysisRunIdentityCoreV1`.

```ts
// New test — src/lib/__tests__/identity.statusInCore.spec.ts
it("status is part of identity core", async () => {
  const completed = draft({ status: "completed" });
  const blocked = draft({ status: "blocked" });
  expect(await hashAnalysisRunCore(completed)).not.toBe(await hashAnalysisRunCore(blocked));
});
```

**Gap C — `verifyAnalysisRunIdentity` never called (§12.4, item 5):**

```ts
// New test — src/lib/__tests__/identity.verifyCalled.spec.ts
it("run store calls verifyAnalysisRunIdentity on retrieval", async () => {
  const run = await createAnalysisRunV1(draft());
  const store = createAnalysisRunStore();
  await store.putRun(run);
  const retrieved = await store.getRun(run.runId);
  expect(retrieved).not.toBeNull();
  // Internal: store.getRun() calls verifyAnalysisRunIdentity and logs warning on mismatch
});
```

### 3.3 Cross-boundary determinism

```ts
// New test — src/engine/analysisRun/__tests__/identity.crossBoundary.spec.ts
it("same inputs produce same hash across worker boundary", async () => {
  const input = cannedInput("Asian Paints");
  const result1 = await executeLegacy(input);
  const result2 = await executeLegacy(input); // same deps
  expect(result1.run!.reproducibilityHash).toBe(result2.run!.reproducibilityHash);
});
```

### 3.4 Fork detection

```ts
// New test — src/lib/__tests__/identity.fork.spec.ts
it("forkAnalysisRun preserves parent hash in relation", async () => {
  const parent = await createAnalysisRunV1(draft());
  const fork = forkAnalysisRun(parent, { asOf: "2026-06-30" });
  expect(fork.relation.parentReproducibilityHash).toBe(parent.reproducibilityHash);
  expect(fork.relation.kind).toBe("fork");
});
```

---

## 4. Layer 3: GATE INVARIANTS — Fail-Closed + 5-Level Rigor Ladder

### 4.1 What this protects

The 5-level rigor ladder (syntactically-valid → structurally-reconciled → economically-plausible → valuation-eligible → production-ready) and all fail-closed gates must NOT regress during migration. Every stage has a contract: block if input conditions aren't met, degrade gracefully on partial data.

### 4.2 Existing test coverage (from legacyExecutor.spec.ts)

| Test | Covers |
|------|--------|
| `fails closed on a domain scope blocker without invoking downstream engines` | Scope gate blocks at family-classification; model-execution never starts |
| `captures an unexpected pipeline failure in a finalized failed run` | Pipeline error → `failed` run, stage marked failed |
| `demotes a green structural envelope when a later native window gate blocks` | Window selection blocks → trust envelope demoted to `syntactically-valid` |
| `executes each legacy analytical seam once and finalizes enriched content` | Happy path — all seams called exactly once |
| `has stable analytical identity across volatile run instance metadata` | `reproducibilityHash` stable across runId/createdAt changes |
| Complex synthetic composition test | Real-options composition replaces synthesis vote correctly |

### 4.3 New contract tests needed per native stage

**Stage 9 — assumption-resolution:**

```ts
describe("Stage 9 gate invariants (assumption-resolution)", () => {
  it("blocks downstream when shareBasis confidence is FAILED", async () => { /* ... */ });
  it("degrades gracefully when market snapshot is null", async () => { /* ... */ });
  it("uses default cost of capital when config is minimal", async () => { /* ... */ });
  it("produces deterministic assumption set for same inputs across calls", async () => { /* ... */ });
});
```

**Stage 10 — forecast:**

```ts
describe("Stage 10 gate invariants (forecast)", () => {
  it("produces 4 distinct scenario cards with validated ordering", async () => { /* ... */ });
  it("blocks when assumption-set has MISSNG_KE reason code", async () => { /* ... */ });
  it("degrades to single-case forecast when data window is <3 periods", async () => { /* ... */ });
  it("sets correct scenarioOrderingReport.status for illogical ordering", async () => { /* ... */ });
});
```

**Stage 11 — model-execution:**

```ts
describe("Stage 11 gate invariants (model-execution)", () => {
  it("dispatches all registered models when eligibility passes", async () => { /* ... */ });
  it("skips models whose applicability check returns false", async () => { /* ... */ });
  it("blocks entirely when base model is blocked with no alternative", async () => { /* ... */ });
  it("terminal at stage 11 — synthesis never starts", async () => { /* ... */ });
  it("bank family has correct 3-4 model bindings (not 13 industrial)", async () => { /* ... */ });
});
```

**Stage 12 — synthesis:**

```ts
describe("Stage 12 gate invariants (synthesis)", () => {
  it("produces insufficient-evidence when zero model results", async () => { /* ... */ });
  it("single-vote synthesis degrades gracefully", async () => { /* ... */ });
  it("independence-aware collapse works with 2+ votes in same group", async () => { /* ... */ });
  it("anti-tautology computes correct lens count", async () => { /* ... */ });
});
```

**Family-classification (stage 5):**

```ts
describe("Family-classification gate invariants (stage 5)", () => {
  it("blocks mixed-conglomerate with MIXED_CONGOLMERATE reason", async () => { /* ... */ });
  it("financial-institution families skip recast and forecast stages", async () => { /* ... */ });
  it("industrial families skip family-analysis stage", async () => { /* ... */ });
});
```

**Gate ladder regression sweep:**

```ts
// New file — src/engine/__tests__/rigorLadderRegression.spec.ts
describe("5-level rigor ladder — migration regression guard", () => {
  for (const level of ["syntactically-valid", "structurally-reconciled", "economically-plausible", "valuation-eligible", "production-ready"]) {
    it(`${level} is properly demoted when an upstream gate blocks`, async () => {
      // For each level, create a scenario where that level's gates fail
      // and verify the trust envelope correctly reports the demotion
    });
  }
  it("no gate ever upgrades a level — only blocks or passes", async () => { /* ... */ });
  it("blocked gate clears achievedLevels below it in the chain", async () => { /* ... */ });
});
```

---

## 5. Layer 4: RUN-DIFF — Migration Acceptance Harness

### 5.1 What it proves

`runDiff.ts` becomes the **central migration acceptance tool**. For each cutover step, the CI pipeline runs:

```
legacy golden-company run  ──┐
                             ├── diffRuns(legacySnapshot, nativeSnapshot) → zero unexpected ChangedCell[]
native golden-company run  ──┘
```

### 5.2 Existing coverage (runDiff.spec.ts)

The test suite at `src/lib/__tests__/runDiff.spec.ts` validates:
- Empty diff for identical snapshots
- Correct delta/relativeDelta for numeric changes
- Infinite impact for added/removed cells
- `rankByImpact` orders by absolute relative delta
- `topChanges` returns at most N changes
- Realistic valuation diff finds dominant driver

### 5.3 New tests needed — Harness-level integration tests

```ts
// New file — src/engine/migration/__tests__/migrationParityHarness.spec.ts
describe("Migration parity harness — runDiff as acceptance gate", () => {
  it("legacy vs native diff for Asian Paints has zero unexpected changes", async () => {
    const harness = createMigrationParityHarness({ companyId: "asian-paints" });
    const { legacy, native } = await harness.runBoth();
    const diff = diffRuns(legacy.snapshot, native.snapshot);
    const unexpected = diff.filter((cell) => !INTENDED_DELTAS[cell.key]);
    expect(unexpected).toHaveLength(0);
  });

  it("legacy vs native reproducibilityHash matches", async () => {
    const harness = createMigrationParityHarness({ companyId: "asian-paints" });
    const { legacy, native } = await harness.runBoth();
    expect(legacy.reproducibilityHash).toBe(native.reproducibilityHash);
  });

  it("runDiff snapshot builder covers all top-level output keys", async () => {
    const snapshot = buildRunSnapshot(legacyRun);
    const expectedKeys = ["valuation.ke", "valuation.kd", "valuation.terminalGrowth", 
      "valuation.intrinsicValue", "valuation.netIncome", "rigor.currentLevel", 
      "confidence.status", ...];
    for (const key of expectedKeys) {
      expect(snapshot).toHaveProperty(key);
    }
  });
});
```

### 5.4 Snapshot builder contract

The snapshot builder (`buildRunSnapshot(run: AnalysisRunV1): RunSnapshot`) must flatten:
- `trustEnvelope.rigor` → `rigor.currentLevel`, `rigor.achievedLevels[]`
- `trustEnvelope.confidence` → `confidence.status`, `confidence.blockingCount`
- `stageResults[i]` → `stage.{stageId}.status`
- `gateResults[i]` → `gate.{gateId}.status`
- `modelResultRefs` → `modelCount`
- `marketSnapshotRef` → `marketSnapshot.{contentHash}`
- All single-value ContentRef fields → `{fieldName}.contentHash`

---

## 6. Layer 5: PHASED TEST ROLLOUT — Mapped to Cutover Order

### Phase A: Foundation (Facts + ForecastState)

| Test layer | What runs | Blocking for cutover? |
|-----------|-----------|----------------------|
| Parity | Facts parity spec for 5 golden companies | YES — all 5 must pass |
| Determinism | ContentRef ordering, status-in-core, verify-called | YES — all 3 new specs pass |
| Gate invariants | Stage 9 + Stage 10 contract tests | YES — all contract tests pass |
| Run-diff | Legacy vs native diff for 5 companies | YES — zero unexpected deltas |

**CI gate:** `npm run test:migration:foundation`

### Phase B: Core engine (ModelCatalog + SectorCases)

| Test layer | What runs | Blocking for cutover? |
|-----------|-----------|----------------------|
| Parity | ModelCatalog parity (3 companies, 13 models each) | YES — ≥12/13 per company |
| Determinism | Cross-boundary hash stability + fork detection | YES |
| Gate invariants | Stage 11 (model-execution) contract tests + family-classification | YES |
| Run-diff | Legacy vs native model-result arrays compared via runDiff | YES |

**CI gate:** `npm run test:migration:core`

### Phase C: Synthesis + AdvancedGovernance

| Test layer | What runs | Blocking for cutover? |
|-----------|-----------|----------------------|
| Parity | Synthesis + composition parity | YES — synthesis content hash matches |
| Gate invariants | Stage 12 (synthesis) contract tests + composition non-mutation | YES |
| Run-diff | Full runDiff from legacy → native for composition fixtures | YES — zero unexpected |

**CI gate:** `npm run test:migration:synthesis`

### Phase D: UIProjection

| Test layer | What runs | Blocking for cutover? |
|-----------|-----------|----------------------|
| Parity | Wave-1 tab-by-tab selector output vs legacy projection fields | YES — all 9 Wave-1 tabs pass |
| Gate invariants | `buildLegacyUiProjection` not called | YES after Wave-3 deletion |
| Run-diff | N/A (UI layer comparison is selector-level, not runDiff) | N/A |

**CI gate:** `npm run test:migration:ui`

### Phase E: Global strangler deletion

| Test layer | What runs | Blocking for deletion? |
|-----------|-----------|----------------------|
| All Phase A–D | Full migration regression sweep | YES — ALL must pass |
| Dead-code audit | `adaptLegacyRawPeriodsToFactSet` etc. zero callers | YES |
| Rigor ladder sweep | Full regression of gate demotion for all 5 levels | YES |

**CI gate:** `npm run test:migration:final`

---

## 7. Test infrastructure

### 7.1 Migration parity harness

```ts
// src/engine/migration/migrationParityHarness.ts
export class MigrationParityHarness {
  constructor(private readonly fixtures: GoldenCompanyCase[]) {}

  async runBoth(companyId: string) {
    const fixture = this.fixtures.find((f) => f.id === companyId);
    if (!fixture) throw new Error(`No fixture for ${companyId}`);
    
    const legacyResult = await runGoldenCompanyCase(fixture);
    // Native: calls the new native stage sequence directly (not through legacyExecutor)
    const nativeResult = await runNativeStageSequence(fixture.rawData, fixture.config);
    
    return {
      legacy: {
        run: legacyResult,
        snapshot: buildRunSnapshot(legacyResult),
        reproducibilityHash: legacyResult.reproducibilityHash,
      },
      native: {
        run: nativeResult,
        snapshot: buildRunSnapshot(nativeResult),
        reproducibilityHash: nativeResult.reproducibilityHash,
      },
    };
  }
}
```

### 7.2 CI command configuration

```
name: test:migration:foundation
command: vitest run --shard=1/3 --project=migration-foundation

name: test:migration:core
command: vitest run --shard=2/3 --project=migration-core

name: test:migration:synthesis
command: vitest run --shard=3/3 --project=migration-synthesis

name: test:migration:ui
command: vitest run src/app/readModels/__tests__/

name: test:migration:final
command: vitest run --shard=1/3 --project=migration-foundation && vitest run --shard=2/3 --project=migration-core && vitest run --shard=3/3 --project=migration-synthesis
```

### 7.3 Test data

Golden-company fixtures from `public/data/companies/` with their `expectations.json`. Each fixture includes:
- Raw XLS/XLSX data (gitignored on CI except Bajaj Finance sidecars)
- `expectations.json` — expected rigor level, ratio ranges, flag expectations
- Optional: pre-computed legacy `AnalysisRunV1` JSON snapshot for diff-baseline comparison

---

## 8. Biggest Testability Risk

**The advanced model mutation pattern (§12.4 in migration doc, Gap 2).**

Advanced models call `applyRealOptionsCompositionCandidate()` which replaces a specific vote in `evidenceWeightedSynthesis` **after** synthesis is computed. This is fundamentally incompatible with the native design where composition is pre-computed as a catalog model before synthesis. The parity harness cannot directly compare "legacy post-hoc mutation" with "native pre-composed catalog entry" because the execution order is different.

**Mitigation:**
1. Stage 11 (model-execution) produces both the original base model result AND the composed model result as separate entries in `modelResultRefs`
2. Stage 12 (synthesis) sees both — synthesis naturally collapses duplicated evidence via independence-aware weighting
3. The parity assert is not "identical content hash" but "final synthesis output has same mid-point perShare within tolerance" + "no replaced votes"
4. `IntendedDeltaCatalog` documents the shift as `synthesis.contributionCount: +1` (composed model adds a vote instead of replacing one)

This risk is **P1** — it delays Phase C by requiring reviewer sign-off on the new synthesis shape before the legacy `applyRealOptionsCompositionCandidate` can be deleted.

---

## Appendix A: Test file inventory

| File | Layer | New/Existing |
|------|-------|-------------|
| `src/lib/__tests__/runDiff.spec.ts` | Run-diff | Existing |
| `src/lib/__tests__/identity.contentRefOrder.spec.ts` | Determinism | **New** |
| `src/lib/__tests__/identity.statusInCore.spec.ts` | Determinism | **New** |
| `src/lib/__tests__/identity.verifyCalled.spec.ts` | Determinism | **New** |
| `src/lib/__tests__/identity.fork.spec.ts` | Determinism | **New** |
| `src/engine/__tests__/goldenCompanySuite.spec.ts` | Parity (legacy baseline) | Existing |
| `src/engine/__tests__/goldenCompanyExpectations.spec.ts` | Contract | Existing |
| `src/engine/__tests__/rigorLadderRegression.spec.ts` | Gate invariants | **New** |
| `src/engine/analysisRun/__tests__/analysisRun.spec.ts` | Determinism | Existing |
| `src/engine/analysisRun/__tests__/legacyExecutor.spec.ts` | Gate invariants | Existing |
| `src/engine/analysisRun/__tests__/executionProtocol.spec.ts` | Protocol | Existing |
| `src/engine/analysisRun/__tests__/identity.crossBoundary.spec.ts` | Determinism | **New** |
| `src/engine/facts/__tests__/parity.facts.spec.ts` | Parity | **New** |
| `src/engine/forecastState/__tests__/parity.forecast.spec.ts` | Parity | **New** |
| `src/engine/modelCatalog/__tests__/parity.models.spec.ts` | Parity | **New** |
| `src/engine/valuationEvidence/__tests__/parity.synthesis.spec.ts` | Parity | **New** |
| `src/engine/advancedModelGovernance/__tests__/parity.composition.spec.ts` | Parity | **New** |
| `src/engine/migration/__tests__/migrationParityHarness.spec.ts` | Run-diff (integration) | **New** |
| `src/engine/migration/migrationParityHarness.ts` | Infrastructure | **New** |
| `src/engine/migration/intendedDeltaCatalog.ts` | Infrastructure | **New** |

## Appendix B: Test project configuration (vitest workspace)

```ts
// vitest.workspace.ts additions
{
  "extends": "./vitest.config.ts",
  "test": {
    "name": "migration-foundation",
    "include": [
      "src/lib/__tests__/identity.*.spec.ts",
      "src/engine/facts/__tests__/parity.*.spec.ts",
      "src/engine/analysisRun/__tests__/identity.*.spec.ts",
    ],
  },
},
{
  "extends": "./vitest.config.ts",
  "test": {
    "name": "migration-core",
    "include": [
      "src/engine/forecastState/__tests__/parity.*.spec.ts",
      "src/engine/modelCatalog/__tests__/parity.*.spec.ts",
      "src/engine/__tests__/rigorLadderRegression.spec.ts",
    ],
  },
},
{
  "extends": "./vitest.config.ts",
  "test": {
    "name": "migration-synthesis",
    "include": [
      "src/engine/valuationEvidence/__tests__/parity.*.spec.ts",
      "src/engine/advancedModelGovernance/__tests__/parity.*.spec.ts",
      "src/engine/migration/__tests__/migrationParityHarness.spec.ts",
    ],
  },
},
```

## Appendix C: CI pipeline phase gates

```
PR opened
  └── test:migration:foundation (must pass)
  └── test:unit (all existing tests)
      └── [Phase A cutover approved]

Squad merge to main
  └── test:migration:foundation
  └── test:migration:core (must pass)
  └── test:unit
  └── test:e2e (Playwright)
      └── [Phase B cutover approved]

Release candidate
  └── test:migration:foundation
  └── test:migration:core
  └── test:migration:synthesis (must pass)
  └── test:migration:ui
  └── test:unit
  └── test:e2e
      └── [Phase C cutover approved]

Full strangler deletion PR
  └── test:migration:final (must pass)
  └── test:unit
  └── test:e2e
  └── [legacyExecutor.ts deleted]
```
