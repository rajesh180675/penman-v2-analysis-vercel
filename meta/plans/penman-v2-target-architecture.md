---
SECTION_ID: plans.penman-v2-target-architecture
TYPE: plan
STATUS: in_progress
PRIORITY: high
---

# Penman V2 — Target Architecture & Migration Plan

GOAL: Design the target architecture and migration plan for Penman V2 covering:
(1) legacyExecutor → immutable native AnalysisRun migration,
(2) valuation command center target design,
(3) pipeline modernization (beyond current strangler),
(4) UI projection seam (legacy tab contracts → run-backed projections).
TIMELINE: design phase this session

## Context (from deep dive)
- Current state: strangler migration mid-flight. `legacyExecutor.ts` (1643 lines) wraps the old render-time chain into immutable `AnalysisRunV1` (content-addressed, 14 stages, worker-executed).
- UI consumes runs via `buildLegacyUiProjection` structuredClone seam (`useRunBackedAuditAnalysis`).
- Platform layer exists: repos, RBAC, durable SQL/blob persistence, atomic lifecycle, governance evidence.
- Docs already present: ADR-009..016, `docs/architecture/plans/2026-07-10-principal-architecture-valuation-platform-greenfield-design.md`, valuation-command-center-roadmap.md.

## Task Checklist

### Phase 1: Current-state & gap assessment (Owner: Archy)
- [x] Review existing ADRs (009-016) + greenfield design docs vs actual code state
- [x] Gap analysis: legacyExecutor stages vs native stage contracts; what blocks "native" derivationMode
- [x] Inventory of legacy UI projection dependencies (which tabs read what)
- Findings: docs/architecture/2026-08-current-state-gap-assessment.md — 0/14 stages native, 5 hard blockers, Wave-1 tab candidates identified

### Phase 2: Target architecture design (Owner: Archy)
- [*] Target domain model: native AnalysisRun stages (fact extraction → recast → reconciliation → window → assumptions → forecast → models → synthesis → trust)
- [ ] Valuation command center target design (native, stage-aligned, model catalog integration)
- [ ] Pipeline modernization: strategy pattern per family (ADR-006), bank/nbfc/insurance/industrial native pipelines
- [ ] UI projection seam: projection contracts per tab group, removal path for structuredClone seam

### Phase 3: Migration plan (Owner: Archy)
- [ ] Phased migration roadmap with strangler checkpoints and rollback gates
- [ ] Data/persistence migration (durable SQL + artifacts, schema versioning)
- [ ] Test/validation strategy (golden suite, dual-run parity harness)
- [ ] Risk register + sequencing

## Success Criteria
- [ ] Architecture doc set written to docs/architecture/ (target design + migration plan)
- [ ] Each of the 4 requested areas covered with concrete contracts, not prose-only
- [ ] Migration phases independently shippable with parity gates
