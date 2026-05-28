# ADR-004: Per-Number Lineage as Sidecar (Schema v11 → v12)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Deciders:** Chief architect (autonomous execution per plan v4)
- **PR:** rigor/lineage-sidecar-v12
- **Plan:** `.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md` (PR-D)
- **Builds on:** [ADR-001](001-concept-identity-layer.md), [ADR-002](002-economic-sanity-gates.md), [ADR-003](003-unusual-item-taxonomy.md)
- **Overrides:** Brief's "store the full lineage map in the traceability envelope" instruction

## Context

The original brief (Plan v3 PR-D) said "store the full lineage map in the traceability envelope." Plan v4 N-7 explicitly overrides this. Concrete reason: the envelope is JSON-stringified for audit blobs, comparison registry, and localStorage; lineage scaled at "8 numbers × 12 periods × ~1KB each = 96KB per company × 32 companies in registry = 3MB just for lineage." That blows the localStorage budget and bloats every comparison-registry sync.

## Decision

Lineage data lives in the **audit snapshot only**. The envelope carries a small `lineageRef`:

```ts
lineageRef: {
  hasLineage: boolean;
  conceptCount: number;
  periodCount: number;
  /** FNV-1a-like 8-hex checksum over JSON-serialized lineage entries.
   *  Drift detection only — not cryptographic. */
  checksum: string;
}
```

The full `LineageMap` (per `(concept, period)` entry with sourceMetricKeys, sourceStatements, transformationSteps, policyDecisionsApplied, confidence, warnings) lives at `snapshot.lineage` in the audit snapshot returned by `buildAnalysisSnapshot`. RunInspector / DebugPanel fetch the snapshot when a reviewer drills into a number.

Schema bumped from `2026-06-traceability-v11` to `2026-06-traceability-v12`. We also reject v11 envelopes via the standard sanitizer + `recordSchemaMigration()` pattern.

### Lineage construction is post-hoc

Plan v4 N-8 mandates `pipeline.ts` stays pure. We honor that: `buildLineageMap` reads already-computed `RecastPeriod` / `RawPeriodData` and reconstructs lineage by:

1. Looking up raw aliases for non-derived concepts via `findRawMetric`
2. Listing static derivation source keys (`BS.TA`, `derived.CoreOI`, etc.)
3. Mapping a static `TRANSFORMATION_RECIPE` per concept ID
4. Surfacing `recast.spec_flags` as `policyDecisionsApplied` entries
5. Pulling the final value from the recast / IS / BS / CF buckets

This means lineage is reproducible from any snapshot without touching the hot pipeline path. Cost: ~25ms for a 12-period typical case (measured locally).

### Eight instrumented numbers

`LINEAGE_CONCEPT_IDS = ["noa", "nfo", "cse", "core-oi", "rnoa", "free-cash-flow", "pat", "intrinsic-value-per-share"]`. IV/share is populated only when caller passes `intrinsicValuePerShareByPeriod`; absent → confidence flips to `"estimated"`.

### Caps (Plan v4 N-3)

| Field | Cap |
|---|---|
| `sourceMetricKeys` | 50 |
| `transformationSteps` | 20 |
| `policyDecisionsApplied` | 10 |
| Snapshot size budget | 100KB for typical 12-period run |

Over-cap entries are replaced with `"... (N more)"` so reviewers can tell truncation occurred.

## Consequences

### Positive
- Envelope JSON serialization stays small (~200 bytes for `lineageRef`).
- Localstorage / shared-research-API growth is bounded.
- Pipeline stays pure (Plan v4 N-8) — no builder threading.
- Drift detection: if envelope checksum doesn't match snapshot, ops know something serialized incorrectly.

### Negative / Tradeoffs
- Lineage reconstruction is approximate — we don't capture every micro-step the pipeline took, only the canonical recipe per concept. A reviewer who wants byte-level provenance still has to read the source. This is acceptable: the rigor ladder is about defensibility, not exact replay.
- One more schema bump means one more localStorage rejection round for users on v11.

### Neutral
- `RunInspector.tsx` adds a "Lineage" status row showing concept × period count and checksum prefix. The full drilldown UI (per-number accordion) is deferred — `lineageRef` ships now, accordion ships in a follow-up if reviewers ask for it.
- Provenance sheet in `excelExport.ts` is deferred; PR-E covers workbook regression and can pick this up.

## Alternatives Considered

### A. Full lineage in envelope (the brief)
Rejected for size reasons documented above.

### B. Pipeline-threaded LineageBuilder
Plan v3 PR-D originally specced this. Rejected: turning `pipeline.ts` into a non-pure function with an opt-in builder param adds a hot-path branch and complicates testing. Post-hoc reconstruction is simpler and equally defensible because the recipe is deterministic.

### C. Skip lineage entirely until a reviewer needs it (lazy build)
Tempting but defeats audit-trail durability — a reviewer two months later has lost the recast inputs. We must persist alongside the snapshot.

## Verification

- [x] `src/engine/__tests__/numberLineage.spec.ts` — 13 cases (entry shape, raw key resolution, derived sources, spec_flag propagation, cap enforcement on policy/transform/source, IV/share inclusion, missing-IV-confidence, ref hash determinism, snapshot size budget, null inputs)
- [x] `src/lib/__tests__/companyRegistryStore.spec.ts` updated to v12 round-trip and v11 rejection
- [x] `src/components/__tests__/ForecastReport.spec.tsx` fixtures updated
- [x] RunInspector surfaces "Lineage" status row with concept/period count and checksum prefix
- [x] Snapshot size <100KB for 12-period typical case (verified in spec)

## References

- Plan v4: `.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md` § PR-D
- ADR-001 / ADR-002 / ADR-003 — predecessor schema bumps
- `src/engine/lineageBuilder.ts`, `src/engine/lineageTypes.ts`
- `src/lib/auditSnapshot.ts` — sidecar persistence
