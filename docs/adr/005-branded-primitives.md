# ADR-005 — Branded primitives for unit-semantic types (Plan 1 PR-1.4)

**Date:** 2026-05-28
**Status:** Accepted
**Schema bump:** `2026-06-traceability-v12` → `2026-06-traceability-v13`

## Context

The engine processes monetary values in three units (INR Crore, INR Absolute, share counts in Crore vs Absolute) and ratios in two scales (fraction in [0,1] vs basis points). Today every numeric primitive is `number`, so the compiler cannot stop you from passing absolute shares to a per-Crore EPS calculator or a percentage value (13) where a fraction (0.13) is required.

This bug class is documented in user memory:

> *"config.shares_outstanding is CRORE-SHARES (not absolute)"*

Fixing it case-by-case has not stuck. We need the type system itself to carry unit semantics so unit-contract bugs become compile errors.

## Decision

Introduce branded primitives in `src/engine/types/units.ts`:

| Brand | Underlying | Purpose |
|---|---|---|
| `INRCrore` | `number` | Capitaline / Indian-context monetary values |
| `INRAbsolute` | `number` | Absolute INR (Crore × 10⁷) |
| `CroreShares` | `number` | Share counts as Crore-shares (registry convention) |
| `AbsoluteShares` | `number` | Absolute share counts (must be integers) |
| `PercentFraction` | `number` | Ratios in [-2, +5], guarding percent/fraction mixups |
| `BasisPoints` | `number` | 1 bps = 0.0001 fraction |

Brands are phantom symbols (`unique symbol`) — zero runtime cost, but TypeScript treats different brands as incompatible types. Constructors validate at the boundary (NaN/Infinity, range, integrality); arithmetic helpers preserve brands.

Conversions are explicit (`croreToAbsolute`, `croreSharesToAbsolute`, `fractionToBps`). Implicit conversion is the bug we are stopping; the type system will refuse it.

## Cascade strategy

The plan called for a 200+ callsite refactor in this PR. We are deferring that to follow-up PRs (one per pipeline stage):

- **PR-1.4** (this PR): land the units module + tests + schema v13 bump + ADR. No callsite refactors. Branded types co-exist with the existing `number` callsites.
- **PR-1.4a** (planned): refactor parser boundary (Capitaline / Screener / XBRL) to emit `INRCrore` and `CroreShares`.
- **PR-1.4b** (planned): refactor `EngineConfig.shares_outstanding`, `market_price`, monetary defaults to branded types.
- **PR-1.4c** (planned): refactor `Ratios` and `QualityMetrics` ratio fields to `PercentFraction`.

This keeps each PR independently reviewable (and revertable) instead of bundling a 200-file change behind one schema bump.

## Schema-version implication

`TRACEABILITY_SCHEMA_VERSION` is bumped to `2026-06-traceability-v13` so the registry sanitizer rejects v12-shaped envelopes after this PR ships. Stale persisted snapshots are dropped (forces re-run, never silently re-hydrates) — same fail-closed behaviour as previous bumps.

## Acceptance

```bash
npx tsc --noEmit                                       # clean
npm run test -- src/engine/types/__tests__/units.spec.ts  # 13 cases pass
grep TRACEABILITY_SCHEMA_VERSION src/engine/policyVersions.ts
# = "2026-06-traceability-v13"
```

## Rollback

Revert the PR. Persisted v13 envelopes would be rejected by the v12 sanitizer; users re-run the pipeline. Documented in `docs/operational-handoff.md`.
