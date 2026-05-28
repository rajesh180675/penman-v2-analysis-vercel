# ADR-006 — Pipeline Strategy Pattern (Plan 3 PR-3.1)

**Date:** 2026-05-28
**Status:** Accepted
**Schema bump:** `2026-06-traceability-v13` → `2026-06-traceability-v14`

## Context

The engine has four pipelines today (industrial, bank, NBFC, insurance). They live in parallel module trees with overlapping logic, ~1,500 LOC of which is structural duplication: each repeats sort → unit-normalize → recast → ratios → anomaly → valuation → envelope assembly. Adding a new sector (e.g. REITs, AMCs) means rebuilding the same scaffolding from scratch.

Cross-cutting changes (e.g. updating the `AnalysisTraceabilityEnvelope` shape) require touching every pipeline by hand. A bug in one pipeline's recast can hide for months because the bank tests don't exercise the industrial code path.

## Decision

Introduce a `PipelineStrategy` interface in `src/engine/pipeline/strategy.ts` that every sector pipeline implements. Stages are numbered methods so the orchestrator drives them in deterministic order:

1. `validateRaw` — ingestion-side adapter validation
2. `recast` — sort + unit-normalize + canonical period rows
3. `computeRatios` — sector-specific ratios + quality scoring
4. `detectAnomalies` — sector-specific signal set
5. `value` — sector-specific valuation lenses
6. `contributeToEnvelope` — sector-specific envelope blocks (orchestrator owns common ones)

A frozen registry in `src/engine/pipeline/registry.ts` holds the active strategies in priority order. `selectStrategy(rawData, config)` returns the first strategy whose `matches()` predicate is true. Industrial is the catch-all and **must be last**.

## Why discriminated-union over inheritance

- TypeScript's exhaustiveness check on `kind: SectorKind` makes `assertNever` switches enforce sector coverage
- No surprise behavior from base-class methods inheritors forgot to override
- Each strategy is a single file you can read top-to-bottom

## Schema-version implication

`AnalysisTraceabilityEnvelope` gets an optional `pipelineStrategyId: string` field, recording which strategy produced the run. Optional in v14 because the registry is empty until PR-3.2 lands the industrial canary; will become required once all four strategies are wired (PR-3.5).

## Cascade strategy

PR-3.1 ships **interface only**. No concrete strategy yet. The registry throws on selection — by design, since the orchestrator does not call `selectStrategy()` until PR-3.2.

| PR | Lands | Notes |
|---|---|---|
| 3.1 | this PR | Interface, registry, schema v14, ADR |
| 3.2 | next | Industrial strategy as canary; orchestrator switches to registry |
| 3.3 | after | Bank strategy |
| 3.4 | after | NBFC + insurance strategies |
| 3.5 | last | Delete duplicated parallel pipelines |

**Rollback policy.** If PR-3.3 reveals a flaw in the interface, revert PR-3.3 and re-spec; do not mutate the interface mid-flight. The interface is the contract.

## Acceptance

```bash
npx tsc --noEmit                                         # clean
ls src/engine/pipeline/                                  # strategy.ts, registry.ts present
grep TRACEABILITY_SCHEMA_VERSION src/engine/policyVersions.ts
# = "2026-06-traceability-v14"
grep -rn "pipelineStrategyId" src/engine/                 # field present in envelope
```

## Rollback

Revert the PR. Persisted v14 envelopes would be rejected by the v13 sanitizer; users re-run the pipeline. Documented in `docs/operational-handoff.md`.
