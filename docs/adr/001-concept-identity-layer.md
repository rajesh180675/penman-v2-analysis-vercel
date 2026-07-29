# ADR-001: Concept Identity Layer (Schema v8 → v9)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Deciders:** Chief architect (autonomous execution per plan v4)
- **PR:** rigor/concept-identity-v9
- **Plan:** `.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md` (PR-A)

## Context

The traceability envelope shipped in `2026-04-traceability-v8` proves that mappings cleared structural reconciliation, but it could not prove that each concept (e.g. "Trade Receivables", "Property Plant and Equipment") had **exactly one canonical identity** across the run. A concept could be silently sourced from two raw labels in the same period, or appear under two different statement owners across periods, and the rest of the rigor ladder would not notice.

Empirical anchor:
- `src/engine/conceptOntology.ts` had 13 entries, no derived concepts, and no statement-owner / sign / aggregation discriminators on the `ConceptDefinition` type.
- `summarizeConceptCoverage` told us *how many* concepts matched, not *whether the identity was unique*.
- `valuation-eligible` could be reached even when two periods sourced "noa" from contradictory raw labels.

## Decision

Bumped the envelope schema from `2026-04-traceability-v8` to `2026-06-traceability-v9`. The new envelope adds:

```ts
conceptIdentity: {
  status: "clean" | "conflicts-present" | "valuation-blocked";
  conflictCount: number;
  unresolvedCriticalCount: number;
  conflicts: ConceptConflict[];   // capped at 200
  truncated: boolean;
}
```

The `ConceptDefinition` type is extended with explicit `statementOwner`, `signConvention`, `aggregationBehavior`, and `providerRelevance` so each concept's economic identity is declared, not inferred. `detectConflicts(rawData, registry)` surfaces three classes:
- `cross-statement-conflict` — alias appears under two different statement owners (ontology bug)
- `duplicate-source` — two raw labels both resolve to the same concept in one period
- `unresolved` — required (`core`, non-`Derived`) concept has no match in the latest period

When `unresolvedCriticalCount > 0` AND `isEnabled("rigor.conceptIdentityBlock")`, rigor cannot reach `valuation-eligible`. The flag is on by default and flippable via Vercel env without redeploy.

The registry sanitizer (`src/lib/companyRegistrySnapshot.ts`) rejects any envelope whose `schemaVersion !== TRACEABILITY_SCHEMA_VERSION`, calls `recordSchemaMigration()` for telemetry, and returns `null` so downstream code re-runs the pipeline rather than silently using stale state.

## Consequences

### Positive
- Every concept now has exactly one declared (statement, sign, aggregation) identity. Reviewers can read the registry once and reason about every metric's economic role.
- Conflicts are surfaced by run, not by audit. A reviewer opening RunInspector sees `Concept identity: clean | conflicts-present | valuation-blocked` next to parser fidelity and reconciliation.
- The block is reversible — `VITE_RIGOR_CONCEPT_IDENTITY_BLOCK=false` soft-disables the gate without code redeploy.

### Negative / Tradeoffs
- All persisted v8 envelopes in localStorage are now rejected on read. Users see "this run needs to be re-executed" until they re-run the pipeline. Mitigated by sanitizer telemetry: DebugPanel will (in PR-D) surface a migration counter so ops can see how many envelopes need refreshing.
- Adding `conceptIdentity` to the envelope adds ~200 bytes per run + up to ~20KB if the conflict list is non-empty. Within the 50KB / run budget set by plan v4 N-3.

### Neutral
- Existing call sites of `summarizeConceptCoverage` and `rankUnmappedLabels` are unchanged; the new fields are additive.
  - 2026-07-29: `rankUnmappedLabels` was later replaced by `summarizeUnmappedLabels` for reasons unrelated to this ADR — its sole caller read `.length` off a list the function had already truncated. The statement above remains an accurate description of what this ADR changed.

## Alternatives Considered

### A. Soft-warn instead of hard-block
Surface conflicts but never gate rigor. Rejected: defeats the purpose of the rigor ladder. The whole point is to fail-closed when identity is ambiguous.

### B. In-place v8 sanitizer (auto-upgrade on read)
Read v8 envelopes and synthesize the `conceptIdentity` field at deserialization time. Rejected: would silently re-hydrate stale runs and hide migration volume. Plan v4 N-1 mandates loud reject + telemetry.

### C. Embed full conflict graph in envelope
Persist the per-period conflict graph for forensic drilldown. Rejected: scales badly. Capped at 200 conflicts with `truncated: true` is the right tradeoff for now; full-detail drilldown lives in PR-D's lineage sidecar.

## Verification

- [x] `src/engine/__tests__/conceptIdentity.spec.ts` — 11 cases (registry sanity, alias resolution, cross-statement, duplicate-source, unresolved, summary statuses, cap, determinism)
- [x] `src/lib/__tests__/companyRegistryStore.spec.ts` updated to assert v9 round-trip and v8 rejection
- [x] `src/components/__tests__/ForecastReport.spec.tsx` updated to provide `conceptIdentity` in test fixtures
- [x] RunInspector surfaces a "Concept identity" status row next to parser fidelity / reconciliation
- [x] Telemetry: `trace("config", "conceptIdentity:detected", ...)` fires when conflictCount > 0; `recordSchemaMigration()` fires when sanitizer rejects a stale envelope

## References

- Plan v4: `.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md` § PR-A
- ADR-000 process: `docs/adr/000-process-and-template.md`
- Feature flag module: `src/lib/featureFlags.ts`
- Schema migration helper: `src/lib/schemaMigration.ts`
