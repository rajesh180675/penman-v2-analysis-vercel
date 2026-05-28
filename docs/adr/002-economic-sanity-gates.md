# ADR-002: Economic Sanity Gates (Schema v9 → v10)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Deciders:** Chief architect (autonomous execution per plan v4)
- **PR:** rigor/economic-sanity-v10
- **Plan:** `.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md` (PR-B)
- **Builds on:** [ADR-001](001-concept-identity-layer.md)

## Context

Structural reconciliation says "the math adds up." It does not say "the math is meaningful." A latest period contaminated by a one-time impairment, a major buyback, a demerger, or an outsized RNOA jump silently corrupts terminal value and hence intrinsic value. The pre-v9 envelope had no concept of an "anchor period" — every run anchored on the latest reported period regardless of contamination.

Empirical anchor:
- `src/engine/corporateActions.ts` already detected buybacks, capital raises, and dilutions via raw-metric heuristics, but expressed thresholds inline rather than as exported constants.
- `src/engine/fcfeDirtySurplus.ts` already computed dirty-surplus residuals; but no caller used them to gate rigor.
- The existing rigor ladder advanced `economically-plausible` purely on `structuralAchieved && !valuationBlocked`, with no view of which period the analysis would anchor on.

## Decision

Bumped the envelope schema from `2026-06-traceability-v9` to `2026-06-traceability-v10`. The new envelope adds:

```ts
economicSanity: {
  status: "passed" | "warned" | "blocked";
  anchorPeriod: string | null;
  anchorReason: string;
  skippedPeriods: { period: string; reason: string }[];
  failedChecks: GateCheckResult[];
}
```

A new module `src/engine/economicSanityGates.ts` runs five checks per period and walks **latest → oldest** until a clean anchor is found within `MAX_ANCHOR_LOOKBACK_PERIODS` (= 3). The five checks:

| ID | Severity | Trigger |
|---|---|---|
| `terminal-period-contamination` | block | buyback ≥ 5% CSE, equity issuance ≥ 10% CSE, or unusual item flagged `affectsTerminalEligibility` |
| `dirty-surplus-integrity` | warn (escalates to block on 2 consecutive years) | dirty surplus residual ≥ 4% of CSE |
| `implausible-rnoa-jump` | warn | |ΔRNOA| ≥ 30pp without a known capital event or unusual item |
| `demerger-discontinued-contamination` | block | parser-detected discontinued-ops signal or manifest-flagged demerger |
| `anchor-period-selection` | summary | walks back at most `MAX_ANCHOR_LOOKBACK_PERIODS` |

Capital-transaction thresholds (`BUYBACK_PCT_OF_CSE`, `RIGHTS_PCT_OF_CSE`, `SPECIAL_DIVIDEND_PER_SHARE`) are now exported constants from `corporateActions.ts` so the two gates can never disagree on what counts as material.

When `economicSanity.status === "blocked"` AND `isEnabled("rigor.economicSanityBlock")`, rigor stops at `structurally-reconciled`. `"warned"` reaches `economically-plausible` carrying warning forward.

The flag is on by default and flippable via Vercel env without redeploy. The companyRegistry sanitizer rejects any envelope whose `schemaVersion !== TRACEABILITY_SCHEMA_VERSION`, recording the migration via `recordSchemaMigration()` (see ADR-000 / ADR-001 / PR-0).

## Consequences

### Positive
- Anchor period is now first-class. A reviewer opens RunInspector and sees `Economic sanity: passed | warned | blocked (anchor 2024-03-31, skipped 1)` next to parser fidelity, reconciliation, and concept identity.
- Capital-transaction thresholds live in one file. No more drift between `corporateActions.ts` and `economicSanityGates.ts`.
- The block is reversible — `VITE_RIGOR_ECONOMIC_SANITY_BLOCK=false` soft-disables without redeploy.

### Negative / Tradeoffs
- All persisted v9 envelopes in localStorage are now rejected on read. Same migration story as v8→v9.
- Sustained-dirty-surplus escalation requires looking at the period before the anchor as well. Implemented inside `evaluateEconomicSanity` by re-running checks for the previous period; minor cost (≤1 extra check pass per run, no recursion).

### Neutral
- Existing `corporateActions` callers are unchanged; the threshold constants are additive exports.

## Alternatives Considered

### A. Soft-warn instead of hard-block
Surface every contamination as a warning. Rejected: defeats fail-closed. Latest-period contamination silently breaks DCF terminal values.

### B. User-selectable anchor in UI
Let the analyst pick the anchor manually. Rejected for now: deterministic walk-back is reproducible across reviewers; manual override can come later as an explicit override (logged in lineage when PR-D ships).

### C. Re-derive thresholds from sector medians
Compute thresholds dynamically per sector. Rejected: thresholds are governance choices, not statistical artifacts. Hard-coded constants are auditable and easy to change with a single ADR.

## Verification

- [x] `src/engine/__tests__/economicSanityGates.spec.ts` — 11 cases (empty, passed, Check A pos/neg, Check C jump, Check C suppression, Check D demerger, Check E walk-back exhausted, Check E first-clean, threshold constant, anchor reason)
- [x] `src/lib/__tests__/companyRegistryStore.spec.ts` updated to v10 round-trip and v9 rejection
- [x] `src/components/__tests__/ForecastReport.spec.tsx` fixtures updated
- [x] RunInspector surfaces "Economic sanity" status row with anchor and skipped count
- [x] Telemetry: `trace("config", "economicSanity:warned"|"economicSanity:blocked", ...)` fires; `recordSchemaMigration()` fires when sanitizer rejects v9 envelopes

## References

- Plan v4: `.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md` § PR-B
- ADR-001: concept identity layer (v9)
- ADR-000: process and template
- Feature flag module: `src/lib/featureFlags.ts`
- Schema migration helper: `src/lib/schemaMigration.ts`
