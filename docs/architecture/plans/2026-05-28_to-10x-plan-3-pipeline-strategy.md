# Plan 3 — Pipeline Strategy Refactor (5 PRs, schema v13 → v14)

> **⚠️ SUPERSEDED (2026-05-30).** This roadmap was abandoned after PR-3.1's interface + registry shipped as dead scaffolding. Verification found the strategy spine abstracted a single readable 2-way dispatch fork (`family === "financial-institution"` → `processBankData`, else industrial → `computeValuation`), routed nothing in production (all four `value()` methods threw "not implemented in canary"), and its only live tendril — the `pipelineStrategyId` audit stamp — was itself buggy (keyed off `config.company_type` instead of the detected family, mis-stamping every auto-detected financial as `industrial-v1`). The spine was deleted and the stamp re-homed onto the real fork. A strategy pattern is revisited only when a sector needs genuinely different recast/ratio **stages** (e.g. a REIT), not merely different bands. See [`docs/adr/006-pipeline-strategy-pattern.md`](../../adr/006-pipeline-strategy-pattern.md).

> **For Hermes:** Use `subagent-driven-development` skill. This plan deletes ~1,500 LOC by unifying the parallel `bank/`, `nbfc/`, `insurance/`, and industrial pipelines under one strategy interface. Treat the existing test suite as a contract — it MUST stay green throughout.

**Goal:** Replace the duplicated bank/NBFC/insurance pipelines with a single `PipelineStrategy` abstraction so that:
- Adding a new sector type is a 200-line strategy file plus a registry entry, not a 1,500-line parallel universe
- A change to `analysisTraceability.ts` automatically applies to every sector
- The rigor envelope shape is uniform across all sectors

**Architecture:** Strategy + Factory pattern with a discriminated-union sector tag (`industrial | bank | nbfc | insurance`). Each strategy implements the same 7-method interface; the orchestrator selects one based on the registry's `companyKind` field.

**Tech Stack:** No new dependencies.

**Sequencing rule:** Strict order required. PR-3.1 (interface) → PR-3.2 (industrial as reference impl) → PR-3.3 (bank) → PR-3.4 (nbfc) → PR-3.5 (insurance + cleanup). Each merge requires the previous one. **Rollback policy:** if PR-3.3 reveals a flaw in the interface, revert PR-3.3 and re-spec; do NOT mutate the interface mid-flight.

---

## PR-3.1 — Define `PipelineStrategy` interface (Schema v13 → v14)

**Branch:** `pipeline/strategy-interface-v14`
**Schema bump:** v13 → v14 — adds `pipelineStrategyId: string` to envelope so the workbook records which strategy was used
**Estimated diff:** +400 / -50, 4 new files

**The interface (`src/engine/pipeline/strategy.ts`):**

```ts
import type { RawPeriodData } from "../types/raw";
import type { RecastPeriod } from "../types/recast";
import type { ValuationResult } from "../types/valuation";
import type { AnalysisTraceabilityEnvelope } from "../types/traceability";
import type { CompanyConfig } from "../types/registry";

export type SectorKind = "industrial" | "bank" | "nbfc" | "insurance";

export interface PipelineStrategy {
  /** Identifier echoed into the envelope for audit. Stable across versions. */
  readonly id: string;
  readonly kind: SectorKind;
  readonly version: string;

  /** Adapter selection — does this strategy handle this raw payload? */
  matches(rawData: RawPeriodData[], config: CompanyConfig): boolean;

  /** Stage 1: ingestion adapter dispatch (parser already chose the right one). */
  validateRaw(rawData: RawPeriodData[]): ValidationReport;

  /** Stage 2: recast (sort, normalize units, build RecastPeriod). */
  recast(rawData: RawPeriodData[], config: CompanyConfig): RecastPeriod[];

  /** Stage 3: ratios + quality scoring (sector-specific). */
  computeRatios(recastData: RecastPeriod[], config: CompanyConfig): SectorRatios;

  /** Stage 4: anomaly detection (sector-specific signal set). */
  detectAnomalies(rawData: RawPeriodData[], recastData: RecastPeriod[]): AnomalyReport;

  /** Stage 5: valuation (one or many lenses, sector-specific). */
  value(input: ValuationInput): ValuationResult;

  /** Stage 6: assemble envelope. Strategy contributes sector-specific fields; common fields filled by orchestrator. */
  contributeToEnvelope(ctx: EnvelopeContext): SectorEnvelopeContribution;
}

export type SectorEnvelopeContribution = {
  /** Strategy-specific status block (e.g., bank's CRAR check, NBFC's GNPA gate). */
  sectorStatus: SectorStatusBlock;
  /** Strategy-specific extra blocks merged into the envelope. */
  sectorBlocks?: Record<string, unknown>;
};

export type SectorRatios = IndustrialRatios | BankRatios | NbfcRatios | InsuranceRatios;
```

**Registry pattern (`src/engine/pipeline/registry.ts`):**

```ts
import { IndustrialPipelineStrategy } from "./strategies/industrial";
import { BankPipelineStrategy } from "./strategies/bank";
import { NbfcPipelineStrategy } from "./strategies/nbfc";
import { InsurancePipelineStrategy } from "./strategies/insurance";

const STRATEGIES = [
  new BankPipelineStrategy(),
  new NbfcPipelineStrategy(),
  new InsurancePipelineStrategy(),
  new IndustrialPipelineStrategy(),  // catch-all, MUST be last
];

export function selectStrategy(rawData: RawPeriodData[], config: CompanyConfig): PipelineStrategy {
  const match = STRATEGIES.find(s => s.matches(rawData, config));
  if (!match) throw new Error(`No strategy matches company kind=${config.companyKind ?? "unknown"}`);
  return match;
}

export const ALL_STRATEGIES: ReadonlyArray<PipelineStrategy> = Object.freeze(STRATEGIES);
```

**Steps:**

1. Create `src/engine/pipeline/` directory with `strategy.ts` and `registry.ts`.
2. Define every type in the interface as a strict, branded type (uses Plan 1's primitives).
3. Add `pipelineStrategyId` to `AnalysisTraceabilityEnvelope` in `src/engine/types/traceability.ts`.
4. Bump `TRACEABILITY_SCHEMA_VERSION` to `"2026-06-traceability-v14"`.
5. Add ADR-006 in `docs/adr/006-pipeline-strategy-pattern.md`.
6. **Important:** Don't implement any concrete strategy yet — that's PR-3.2 onward. This PR only ships the interface and a passing TypeScript compile.

**Acceptance test:**

```bash
npx tsc --noEmit                              # 0 errors
ls src/engine/pipeline/                       # strategy.ts, registry.ts present
# No concrete strategy yet — registry will throw at runtime, that's expected
```

---

## PR-3.2 — Migrate industrial pipeline (reference implementation)

**Branch:** `pipeline/industrial-strategy`
**Schema bump:** none
**Estimated diff:** +800 / -300, 1 new file (the strategy class), updates to `pipeline.ts` orchestrator

**Why first:** Industrial is the most-tested code path (10 of the 12 golden companies). Migration here is the canary — if the abstraction can't accommodate industrial cleanly, redesign before any sector migration.

**Steps:**

1. Create `src/engine/pipeline/strategies/industrial.ts` implementing `PipelineStrategy`.
2. Inside, the methods delegate to existing functions:
   ```ts
   class IndustrialPipelineStrategy implements PipelineStrategy {
     readonly id = "industrial-v1";
     readonly kind = "industrial" as const;
     readonly version = "2026-06";
     matches() { return true; }                       // catch-all — must be last
     validateRaw(raw)        { return validateIndustrialRaw(raw); }       // existing fn
     recast(raw, cfg)        { return existingPipeline.recast(raw, cfg); } // existing fn
     computeRatios(rd, cfg)  { return existingPipeline.ratios(rd, cfg); }
     detectAnomalies(raw, rd){ return existingPipeline.anomalies(raw, rd); }
     value(input)            { return existingPipeline.value(input); }
     contributeToEnvelope(c) { return { sectorStatus: { kind: "industrial", clean: true } }; }
   }
   ```
3. In `App.tsx` (or whatever calls `pipeline.run`), replace the direct call with `selectStrategy(rawData, config).recast(rawData, config)` (and the rest).
4. Run full suite. Industrial golden companies should pass with **byte-identical envelopes** (ID strings excepted).
5. Add `pipelineStrategyId === "industrial-v1"` assertion to `goldenCompanyExpectations.spec.ts` for industrial-profile companies.

**Acceptance test:**

```bash
# Snapshot test — pre/post industrial migration
git stash                                              # at the pre-PR commit
npm test 2>&1 | tee /tmp/before.log
git stash pop
npm test 2>&1 | tee /tmp/after.log
diff <(grep -E "✓|✗|PASS|FAIL" /tmp/before.log) <(grep -E "✓|✗|PASS|FAIL" /tmp/after.log)   # 0 lines

# pipelineStrategyId is in envelope
grep -rn "pipelineStrategyId" src/engine/   # at least 3 hits
```

---

## PR-3.3 — Migrate bank pipeline

**Branch:** `pipeline/bank-strategy`
**Schema bump:** none
**Estimated diff:** +900 / -1,800, deletes `bankPipeline.ts` (790 lines), `bankExcelExport.ts` partial

**Steps:**

1. Create `src/engine/pipeline/strategies/bank.ts` implementing `PipelineStrategy`.
2. Lift logic from `bankPipeline.ts`, `bankAssetQuality.ts`, `bankValuation.ts`. The strategy's `value()` method blends the existing 5+ bank lenses.
3. `matches()`:
   ```ts
   matches(_, cfg) { return cfg.companyKind === "bank"; }
   ```
4. Place the strategy BEFORE `IndustrialPipelineStrategy` in the registry array (registry uses `find` — first match wins).
5. Delete `bankPipeline.ts`. Update `bankExcelExport.ts` to consume the new strategy's output rather than its internal types.
6. Run full bank-related test suites:
   ```
   src/engine/__tests__/bankPipeline.spec.ts
   src/engine/__tests__/bankValuation.spec.ts
   src/engine/__tests__/bankAssetQuality.spec.ts
   src/engine/__tests__/bankQualityIndicators.spec.ts
   src/engine/__tests__/bridgeDebtMapping.spec.ts
   src/engine/__tests__/eclStressGovernor.spec.ts
   ```
7. HDFC Bank golden case (from Plan v4 PR-F) MUST pass with `pipelineStrategyId === "bank-v1"` and `expectedRigorLevel === "valuation-eligible"`.

**Acceptance test:**

```bash
npx vitest run src/engine/__tests__/bank*.spec.ts   # all green
grep -rn "from \"\\./bankPipeline\"" src/ | wc -l    # 0 (file deleted)
git diff --stat | grep "bankPipeline.ts"             # shows 790 lines removed
```

---

## PR-3.4 — Migrate NBFC + insurance pipelines

**Branch:** `pipeline/nbfc-insurance-strategies`
**Schema bump:** none
**Estimated diff:** +1,000 / -1,400

**Steps:**

1. Create `src/engine/pipeline/strategies/nbfc.ts`. Lift from existing NBFC pipeline (see Bajaj Finance D3c subsidiary + D4 LGD/RBI-NHB sidecar logic per memory).
2. Create `src/engine/pipeline/strategies/insurance.ts`. Lift from existing insurance pipeline.
3. Register both before industrial.
4. Run all NBFC + insurance tests:
   ```
   src/engine/__tests__/bajajFinance.spec.ts
   src/engine/__tests__/eclStressGovernor.spec.ts
   ```
5. Bajaj Finance golden case (Plan v4 PR-F) MUST pass with `pipelineStrategyId === "nbfc-v1"`.

**Acceptance:**

```bash
npx vitest run src/engine/__tests__/bajajFinance.spec.ts   # green
# Insurance suite green (whatever specs cover insurance)
```

---

## PR-3.5 — Cleanup, deletion, deduplication

**Branch:** `pipeline/cleanup-and-delete-duplicates`
**Schema bump:** none
**Estimated diff:** ~+200 / -1,500 (net deletion)

**Why:** Three previous PRs introduced strategies. This PR ruthlessly deletes everything that's now dead.

**Steps:**

1. Find files only-referenced-by-themselves:
   ```bash
   for f in $(find src/engine -name "*.ts" -not -path "*__tests__*"); do
     base=$(basename $f .ts)
     refs=$(grep -rln "from.*$base" src/ --include="*.ts" --include="*.tsx" | wc -l)
     [ "$refs" -le "1" ] && echo "$f orphaned ($refs refs)"
   done
   ```
2. Delete the orphans confirmed dead by the strategy migration. Expected: `bankPipeline.ts`, `bankExcelExport.ts` (subsumed into per-strategy export), some helper files in NBFC/insurance.
3. Update imports tree-wide.
4. Update README, `docs/operational-handoff.md`, `RIGOR_KNOWLEDGE_BASE.md` to describe the new architecture.
5. Add `docs/architecture/pipeline-strategies.md` — the canonical reference.

**Acceptance test:**

```bash
# LOC reduction target
git diff main..HEAD --stat src/engine/ | tail -1
# Expected: net negative, ≥ 1500 lines removed

# Suite still green
npm run validate
```

---

## Cross-cutting acceptance for Plan 3

```bash
# ─── Strategy registry has 4 entries ──────────────
grep -A 10 "STRATEGIES = " src/engine/pipeline/registry.ts | grep "PipelineStrategy" | wc -l   # ≥ 4

# ─── Old parallel files are gone ──────────────────
ls src/engine/bankPipeline.ts 2>/dev/null && echo "FAIL: bankPipeline.ts still exists" || echo "OK"

# ─── Net LOC reduction ───────────────────────────
git log --since="$(git log --format=%cI -n1 main..pipeline/strategy-interface-v14 | tail -1)" --shortstat -- src/engine/ | tail -3
# Should show net deletion ≥ 1,500

# ─── Schema bumped ──────────────────────────────
grep TRACEABILITY_SCHEMA_VERSION src/engine/policyVersions.ts   # = "2026-06-traceability-v14"

# ─── pipelineStrategyId in workbook ─────────────
grep -rn "pipelineStrategyId" src/engine/excelExport.ts          # at least 1 hit (Cover sheet)

# ─── All sector-specific tests green ────────────
npx vitest run src/engine/__tests__/bank*.spec.ts src/engine/__tests__/bajajFinance.spec.ts   # all pass
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Strategy interface is wrong shape, discovered at PR-3.3 | medium | PR-3.2 (industrial) is the canary. If industrial doesn't fit cleanly, halt and redesign |
| Bank tests subtly drift due to lift-and-shift | medium | Lift logic byte-for-byte where possible; the test suite is the contract. Snapshot envelopes pre/post and diff |
| `companyKind` field doesn't exist in registry → matches() can't dispatch | high | PR-3.1 step 0: audit `companyRegistryStore` and ensure `companyKind` is populated for the 5 golden companies. If not, this becomes a prerequisite micro-PR |
| Workbook export breaks for sector-specific tabs | medium | PR-2 / PR-3 already pin the workbook regression contract. Each strategy's `contributeToEnvelope` returns sector blocks that the workbook reads. Update `excelExport.ts` to consume these |

## Definition of done

10/10 means:
1. Adding a new sector type (e.g. REIT) is a 200-line strategy file + 1 registry line + 1 ADR.
2. A change to the rigor ladder applies uniformly across all sectors without per-sector cherry-picking.
3. ~1,500 lines deleted; god-files (`bankPipeline.ts` 790 lines, `bankValuation.ts` 1,387 lines) are decomposed into strategy + helpers.
4. Envelope carries `pipelineStrategyId` so workbook reviewers know which strategy ran.
5. Golden-suite-expectations.json profile matches the strategy actually selected.
