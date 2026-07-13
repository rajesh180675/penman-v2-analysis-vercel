# Penman V2 — Sophistication Roadmap (Grounded Audit → Plan)

Generated: 2026-06-29
Audited corpus: 33 companies, 225 engine TS files, 185 test files, ~83K LOC (TS), 20 UI tabs.

## Baseline (empirically verified)

| Dimension | State | Evidence |
|-----------|-------|----------|
| Maturity score | 8.5/10 (reviewer-ready) | `docs/valuation-maturity-scorecard.md` |
| Production-ready rows | 0/33 | Same scorecard: 0 PRODUCTION_READY |
| Reconciliation failures | 4 companies | SBIN, DABUR, BHARTIARTL, GRASIM, TATASTEEL, M&M, NTPC, POWERGRID, RELIANCE, TITAN — residual >100% |
| Source-lineage gaps | 10/33 | Missing artifact hashes + lineageRef |
| Stale segment data | 10/33 companies | SegmentFinance_.xls older than latest P&L/BS year |
| `any` usage | 86 in src/ (21 in engine) | `grep -rn '\bany\b' src/` |
| God modules | 5 files >550 LOC | `reconciliationResiduals.ts`(816), `analysisTraceability.ts`(636), `mappingSpec.ts`(599), `valuationCommandCenter/core.ts`(591), `bankReconciliationResiduals.ts`(564) |
| TODO/FIXME | 1 | `DataEntry.tsx:211` |
| Existing roadmap | 10-plan "10x" index exists | `docs/architecture/plans/2026-05-28_to-10x-master-index.md` — ~40 PRs, 5 schema bumps |

**Key insight:** The codebase already has an ambitious 10/10 roadmap. The highest-value work is NOT writing new plans — it's executing the highest-leverage gaps the roadmap hasn't closed yet, plus fixing data freshness issues that silently degrade every valuation.

## Three Highest-Leverage Phases

### Phase 1: Data Freshness & Source Lineage (blocks 13/33 companies)

**Why:** 10 companies have stale segment data (TCS FY2017, Tata Steel FY2016, Vodafone FY2016, Paytm FY2019, Muthoot FY2018, Shriram FY2018, Britannia FY2019, Asian Paints FY2022, NTPC FY2024). 10 companies lack source-lineage evidence. These are the dominant blockers preventing production-ready status.

**Tasks:**
1. Stale-data detector script: scan all company folders, compare SegmentFinance year coverage vs P&L/BS year coverage, emit report of gaps. File: `scripts/audit-data-freshness.ts`
2. Source-artifact hashing: when a ZIP is loaded, compute SHA-256 of each `.xls` inside and stamp it into the traceability envelope. Files: `src/engine/capitalineParser.ts`, `src/engine/analysisTraceability.ts`, `src/engine/types/traceabilityEnvelope.ts`
3. lineageRef binding: map each recast period back to its source `.xls` file + cell range. File: `src/engine/lineageBuilder.ts`
4. UI: show stale-data warning badge in SegmentBreakdown and Statements tabs when segment year coverage < P&L coverage. File: `src/components/dashboard/SegmentBreakdown.tsx`
5. Re-download stale Capitaline exports (manual; script can't automate Capitaline auth)

**Tests:** `scripts/audit-data-freshness.spec.ts`, extend `segmentParser.spec.ts` with year-coverage assertion, extend `analysisTraceability.spec.ts` with source-hash assertion.

**Schema bump:** v19 → v20 (adds `sourceArtifactHashes` and `lineageRefs` to envelope).

---

### Phase 2: Reconciliation Residual Closure (blocks 6/33 companies)

**Why:** 6 companies have reconciliation residuals >100% (SBIN 111%, DABUR 100%, BHARTIARTL 179%, GRASIM 142%, TATASTEEL 165%, TITAN 197%). These fail the structurally-reconciled gate, blocking valuation eligibility.

**Tasks:**
1. Root-cause each residual: run `scripts/audit-company-run.ts` for each blocked company, inspect which residual check breaches (BS, cash-distribution, share-capital, debt-flow, income-statement)
2. Fix mapping gaps in `CapitalineIndASDetailedMappingSpec.yaml` for the specific labels causing residuals
3. Add sector-specific reconciliation overrides where Ind-AS mapping is correct but sector economics differ (e.g. telecom spectrum, utility rate-base)
4. Tighten residual thresholds after fixing root causes — current thresholds may be too loose for sectors where reconciliation should be near-zero

**Tests:** Extend `reconciliationResiduals.spec.ts` with per-company fixture assertions. Add golden test: each previously-blocked company must now pass structurally-reconciled.

**No schema bump.**

---

### Phase 3: God-Module Decomposition + Type Safety (technical debt ceiling)

**Why:** 5 files >550 LOC make the engine hard to extend safely. 86 `any` usages weaken type guarantees. The existing 10x roadmap (Plans 1-2) targets this but hasn't shipped.

**Tasks (from existing roadmap, prioritized):**
1. Split `reconciliationResiduals.ts` (816 LOC) → `reconciliationResiduals/` directory (industrial, bank, telecom, utility, types)
2. Split `analysisTraceability.ts` (636 LOC) → `analysisTraceability/` (envelope-builder, rigor-evaluator, accounting-coverage, re-exports)
3. Split `valuationCommandCenter/core.ts` (591 LOC) → already has `helpers.ts`/`builders.ts`; extract `triangulation.ts`, `sensitivity.ts`
4. Strip `any` from engine: 21 → <10. Replace with `unknown` + type guards or proper interfaces
5. Branded primitives for monetary units (already partially done: `CroreShares` exists; extend to `INRCrore`, `PercentFraction`)

**Tests:** Existing test suite is comprehensive (185 files). Run `npm run validate` after each split. No new tests needed — existing coverage guards regressions.

**Schema bump:** v20 → v21 (branded primitives may change envelope serialization).

## Medium-Leverage (Phase 4-6, lower priority)

### Phase 4: Reviewer Experience (from Plan 8)
- Run-diff between two runs of same company
- Evidence locking with sign-off
- Cell-level annotations
- Reproducibility hash

### Phase 5: Advanced Modelling Depth (from Plans 5/5b)
- Reverse-DCF intervals (partially shipped — `reverseDCF.ts` exists)
- Clean-surplus residual tracking
- CAPM ke with Damodaran sector premium
- Real-options for pharma pipeline companies
- Ind-AS 116 lease-adjusted equity (DMART already handled)

### Phase 6: Observability & A11y (from Plans 7/9)
- Sentry + OTel error capture
- WCAG 2.2 AA conformance
- Print-ready PDFs
- i18n (en/hi/ta/bn)

## Execution Strategy

**Phase 1 first** — data freshness is the dominant blocker. Without fresh data and source hashes, no amount of engine sophistication can move companies to production-ready.

**Phase 2 parallel with Phase 1** — reconciliation fixes are independent of data freshness and can be done concurrently.

**Phase 3 after 1+2** — decomposition is pure refactoring; do it once the engine contract is stable from Phase 1-2 changes.

**Phases 4-6 deferred** — they improve reviewer experience and modelling depth but don't unblock the 0/33 production-ready count.

## What NOT to Do

- Don't write new plan documents — the 10x index already covers everything. Execute, don't plan.
- Don't add new valuation models until existing ones clear production-ready for all 33 companies.
- Don't touch the pipeline dispatch fork — ADR-006 explicitly rejected the strategy-spine abstraction.
- Don't auto-download Capitaline data — it requires authenticated browser sessions.

## Verification Gates

After each phase:
```bash
npm run typecheck     # zero errors
npm run test          # all green
npm run build         # succeeds
npx tsx scripts/valuation-scorecard.ts --format md  # score improves
```

After Phase 1: source-lineage blockers ≤ 3 (from 10)
After Phase 2: reconciliation blockers ≤ 2 (from 6)
After Phase 3: no file >600 LOC, `any` count <30 in engine
