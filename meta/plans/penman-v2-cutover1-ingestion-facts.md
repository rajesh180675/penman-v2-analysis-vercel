---
SECTION_ID: plans.penman-v2-cutover1-ingestion-facts
TYPE: plan
STATUS: in_progress
PRIORITY: high
---

# Cutover #1 — Ingestion → Canonical Facts (review-gated implementation)

GOAL: Independent readiness review of migration doc §8, then implement native fact extraction: parsers emit SourceArtifact → canonical FactSet, replacing adaptLegacyRawPeriodsToFactSet, with parity harness gating.

REFERENCES:
- Design: docs/architecture/plans/2026-07-20-legacy-to-native-migration.md (§8, §13 fixes)
- Tests: docs/architecture/plans/2026-07-20-native-migration-test-strategy.md (Phase Foundation)
- Parent plan: meta/plans/penman-v2-architecture-continuation.md (completed)

## Task Checklist

⚠️ BLOCKER (Phases B+): claude CLI not authenticated — user must run `/login` + OAuth in consoles 4870 (Archy: §8.4 fix) and 4803 (Cody: parity harness). Tasks drafted/queued, re-dispatch after login.

### Phase A: Independent readiness review (Owner: Cody)
- [x] Review §8 against actual parser code — verify build*CanonicalFactBundle signatures are implementable
- [x] Verdict: GO-with-fixes (see verdict below)
- [ ] Fix 1 (CRITICAL): RawPeriodData projection drops unmapped facts — recast stage needs ALL raw metrics (~100+), not just the ~16 ontology-mapped concepts. The `projectRawPeriodData` from §8.4 would silently drop ~80% of raw columns. **Mitigation:** The projection must be a passthrough of the original parser `RawPeriodData[]` alongside the FactSet, not a reconstruction from ontology-backed facts only. `RawPeriodData` continues as a first-class input to the recast stage until consumers are migrated.
- [ ] Fix 2 (MEDIUM): XBRL FACT_TO_CANONICAL has 6+ values (e.g., "Cash and Cash Equivalents", "Current Investments", "Net Property, plant and equipment") that don't match any CONCEPT_ONTOLOGY alias — these facts silently drop. **Mitigation:** Add missing aliases to CONCEPT_ONTOLOGY OR document in IntendedDeltaCatalog.
- [ ] Fix 3 (LOW): §8 claims `buildCapitalineCanonicalFactBundle` is 226 lines — actual implementation is ~40 lines plus helpers. Update the doc line count after implementation.

### Phase B: Foundation (Owner: Cody, gated on Phase A GO)
- [ ] MigrationParityHarness + IntendedDeltaCatalog infra (per test strategy)
- [ ] Determinism specs closing the 3 canonicalization gaps

### Phase C: Implementation (Owner: Cody)
- [ ] Native fact bundles for screener/json/manual (generic text base)
- [ ] XBRL two-level concept bridge (FACT_TO_CANONICAL → CONCEPT_ONTOLOGY)
- [ ] Wire native FactSet into legacyExecutor behind flag; parity green on golden suite

## Success Criteria
- [ ] Review verdict documented
- [ ] Golden-company parity: native FactSet == legacy adapter output (runDiff clean)
- [ ] No rigor-ladder / fail-closed regression
