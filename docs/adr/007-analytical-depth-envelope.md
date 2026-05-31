# ADR-007: analyticalDepth envelope block (Plan 5 keystone)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Rajesh, Claude (Opus 4.8)
- **PR:** #(this PR)
- **Schema bump:** `2026-06-traceability-v17` → `2026-06-traceability-v18`

## Context

The `AnalysisTraceabilityEnvelope` is the single confidence signal rendered across 9 UI tabs. Every block it carries today answers *can the DATA be trusted* — rigor ladder, parser fidelity, reconciliation residuals, mapping coverage. None answers *how much analytical depth the valuation actually exercised*: whether a reverse-DCF expectation was plausible, whether clean-surplus held, whether the independent Damodaran CAPM `ke` cross-check agreed with the model `ke`, whether a sum-of-the-parts was run.

Those four analytics are already computed — in `buildValuationCommandCenter` (`ValuationCommandCenterOutput.{reverseDcf, cleanSurplus, damodaranCapm, sotp}`) — but they never reach the envelope, so a reviewer reading the trust panel cannot see the depth of the analysis behind the verdict.

Plan 5/5b specify a full 10-sub-block `analyticalDepth` suite (the four above plus leases, real-options, credit-spread WACC, working-capital sustainability, ESG-adjusted ke, FX hedging). That is a multi-week initiative. This ADR records the **keystone**: the envelope block, the schema bump, and population of the four analytics that already exist. The remaining six slot into `analyticalDepth.*` later with no further schema bump.

## Decision

Add `analyticalDepth?: AnalyticalDepthSummary | null` to the envelope (a pure type leaf, `src/engine/types/analyticalDepth.ts`, mirroring the `status / summary / counts / checks[]` shape of the other blocks). Populate it with a **pure enrichment function** (`evaluateAnalyticalDepth`, `src/engine/analyticalDepth.ts`) at the surface seam (`ValuationReport`) where the envelope and the command center coexist — **not** inside `buildAnalysisTraceability`. Bump the schema `v17 → v18` with a non-destructive forward migrator defaulting legacy envelopes to `null`.

## Why enrichment-seam, not a builder parameter

`buildAnalysisTraceability` runs in `useAuditAnalysis` where valuation output is not in scope (verified: all 6 call sites build the envelope before/without valuation). The envelope reaches `ValuationReport` as a prop, and the command center is built locally there. Threading valuation *into* the builder would force every snapshot/publication/audit call site to compute a valuation it does not need. Enriching at the surface keeps the builder untouched (golden envelopes stay byte-identical) and confines depth to the one place it is meaningful.

## Consequences

### Positive
- Reviewers see a depth read-out (reverse-DCF plausibility, clean-surplus, CAPM ke agreement, SOTP) in the valuation trust panel.
- Backward-compatible: optional + nullable, so the 9 non-valuation surfaces, the snapshot/publication paths, and migrated legacy envelopes are unaffected.
- `buildAnalysisTraceability` output is unchanged → golden suite stays 7/7 byte-identical.

### Negative / Tradeoffs
- The UI-time envelope carries depth; the persisted/snapshot envelope carries `null`. This is honest (valuation is not in the snapshot path) but means depth is not currently durable in audit snapshots — a follow-up if persistence is needed.
- Two structurally-identical summary interfaces (`ValuationTraceabilitySurfaceSummary`, the panel's `TraceabilitySurfaceSummary`) both gained an optional `depthLine`; they remain duplicated, as before.

### Neutral
- Depth is surfaced only in `ValuationReport` (the sole surface rendering the trust panel that also builds a command center). `DashboardView` builds a command center but renders no trust panel, so it was intentionally left untouched rather than given dead wiring.

## Alternatives Considered

### Alternative A: thread valuation into `buildAnalysisTraceability`
Rejected: forces non-valuation call sites (snapshot, publication, audit harness) to compute or stub valuation, and changes the builder's output shape (golden churn). The seam approach is strictly less invasive.

### Alternative B: schema scaffold only (block always `null`)
Rejected: ships a hollow slot nothing reads — signals "depth implemented" while delivering nothing, against the no-speculative-code principle.

### Alternative C: ship the full Plan 5/5b 10-sub-block suite now
Deferred: multi-week scope. The keystone unblocks incremental sub-block additions under the same `analyticalDepth.*` namespace with no further schema bump.

## Verification

- [x] Spec file: `src/engine/__tests__/analyticalDepth.spec.ts` (roll-up absent/partial/rich; reverse-DCF + CAPM watch triggers; pessimistic-spread not flagged)
- [x] Spec file: `src/lib/__tests__/envelopeMigrations.spec.ts` (v17→v18 defaults `analyticalDepth` to null; preserves an existing block; idempotent)
- [x] `npm run typecheck` clean
- [x] `npm run test:golden` 7/7 byte-identical (builder untouched)
- [x] `node scripts/check-doc-schema-pin.cjs` OK at v18
- [ ] Manual: `npm run dev` → Valuation tab → trust panel shows the analytical-depth line

## References

- Plan 5 / 5b — financial-modelling depth roadmap (`docs/architecture/plans/2026-05-28_to-10x-plan-5*.md`)
- ADR-005 (branded primitives), ADR-006 (pipeline strategy / `pipelineStrategyId` envelope field)
- Migration runner: `src/lib/envelopeMigrations.ts`; version constant: `src/engine/policyVersions.ts`
