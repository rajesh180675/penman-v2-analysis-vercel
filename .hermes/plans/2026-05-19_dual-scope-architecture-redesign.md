# Dual-Scope Architecture + Landing Page Redesign

**Status:** v3 (post empirical validation)
**Date:** 2026-05-19
**Owner:** rajesh

---

## Goal

Two coupled changes:

1. **Architecture** — when a company has both consolidated and standalone ZIPs in `public/data/companies/{folder}/`, auto-load both, run them through `processScopeAwareData()`, and surface the gap analysis (subsidiary contribution + cross-validation warnings) as a first-class UI feature. Today the user picks one ZIP via a scope toggle and the other is ignored.

2. **Landing page UX** — first-time browser visit currently shows: OnboardingCard + 13-card CompanyLibraryGrid + 5-tab mode selector (Capitaline / Screener / JSON / XBRL / Manual) + Upload card with Library dropdown + Essential config row + Advanced config + Cost-of-Capital config. Too cluttered. Redesign to a minimal three-step flow: **Pick** → **Load** → **Analyze**.

---

## Current State (Empirically Validated)

### Filesystem
- 13 company folders. 11 have both `{folder}.zip` AND `standalone.zip`. KOTAKBANK and SBIN have neither (placeholders).
- registry.json field `hasStandalone: true|false` already encodes which companies have standalone data.

### Code
- `src/engine/scopeAwareLoader.ts` — `processScopeAwareData(consolidated, standalone, config, quality)` exists, fully implemented, returns `ScopeAwareResult` with subsidiary contribution + summary stats. Has 14 passing tests.
- `src/App.tsx:90` — single `rawData` state. Single `pipelineResult` memo (line 180) calling `processCompanyDataFull` with one dataset only.
- `src/components/DataEntry.tsx:211` — scope toggle picks ONE zip per submission: `scope === "standalone" ? "standalone.zip" : "${folder}.zip"`. Standalone gets parsed as if it were the company's main data.
- `src/components/data-entry/CompanyLibraryGrid.tsx` — has scope toggle baked in; calls `onPickCompany(folder, ticker, type, scope)`.
- `src/components/dashboard/OnboardingCard.tsx` exists, shown when `!currentData`.
- 5-tab mode selector in DataEntry.tsx hardcodes 5 ingestion paths.
- registry.json fetch already works in CompanyLibraryGrid (useEffect at line 193).

### What works today (do not break)
- Upload your own ZIP (drag-drop or file picker) — the primary power-user path.
- Load Sample button.
- Screener.in paste.
- Raw JSON / XBRL / Manual entry.
- All 674 tests passing.

---

## Proposed Approach

### Architecture: dual-load model

Replace the single `rawData` model with a `dataSource` envelope:

```ts
interface DataSource {
  consolidated: RawPeriodData[];
  standalone: RawPeriodData[] | null;
  scopeAwareResult: ScopeAwareResult | null;  // null when standalone is null
}
```

When the user picks a library company:
1. Always fetch `{folder}.zip` (consolidated) — required.
2. If `registry.hasStandalone === true`, also fetch `standalone.zip` in parallel.
3. Parse both, run `processScopeAwareData(cons, stan, config)`, store the full envelope.

When the user uploads their own ZIP:
1. Single ZIP → `dataSource = { consolidated, standalone: null, scopeAwareResult: null }`.
2. Future enhancement: optional second-ZIP slot ("Add standalone for cross-check").

**Default valuation behavior remains consolidated** — academically correct, no regression. Standalone enriches the analysis without changing the core valuation.

### UI: Subsidiary Contribution panel

When `scopeAwareResult` is non-null, surface a new panel:

- **Where:** new "Scope" tab between Statements and Ratios, OR inline section in the existing Dashboard.
- **What:** per-period table of `consolidated PAT − standalone PAT = subsidiary PAT`, with % contribution chart, trend arrow (growing/stable/shrinking), and red flags:
  - "Standalone PAT > Consolidated PAT" → likely subsidiary losses or inter-company dividend leakage
  - "Subsidiary contribution < 5%" → no SOTP needed, parent dominates
  - "Subsidiary contribution > 30%" → SOTP recommended; flag mismatch with current segment definitions if any

### Landing page: minimal three-step flow

Replace the current cluttered upload page with:

```
┌────────────────────────────────────────────────────────┐
│  Penman-Nissim Valuation Engine                        │
│  Multi-framework analysis: PB-RNOA, EPV, SOTP, RI      │
└────────────────────────────────────────────────────────┘

  STEP 1 — Pick a company

  [ Library (13)  |  Upload your own  |  Try sample ]
                                                  ──── (active tab)

  Library: searchable grid of 13 companies, each card shows:
    - Emoji + name + ticker
    - Sector badge (Bank / NBFC / Industrial / etc.)
    - Data badges: ✓ Consolidated  ✓ Standalone  (or only one)
    - Click → loads BOTH if available, falls back to consolidated
    - No scope toggle on cards (we always load both)

  Upload: single drag-drop zone for consolidated ZIP +
          optional second slot "Add standalone for cross-check"

  Sample: one-click VST sample loader

──────────────────────────────────────────────────────────

  STEP 2 — Confirm (only shown after pick)

  Company:    HDFC Bank
  Type:       Bank
  Periods:    8 years (FY18-FY25)
  Scope:      ✓ Consolidated  ✓ Standalone
              → Will compute subsidiary contribution

  [ Analyze ]   [ Change company ]

──────────────────────────────────────────────────────────

  Advanced (collapsed by default):
    - Cost of capital config
    - Manual classification override
    - Engine config tweaks
```

Rationale:
- Step 1 collapses the 5-tab mode selector + grid + dropdown + dual upload + sample button into 3 clear paths.
- Step 2 gives explicit feedback ("we found both ZIPs, will compute gap"). Removes ambiguity.
- Advanced config hidden behind a single toggle. Most users never need it.
- OnboardingCard is removed (its content is now Step 1's tab descriptions).
- Mode tabs (Screener / JSON / XBRL / Manual) move into "Upload your own" → "Other formats" sub-section. Power users can still find them; first-time users aren't confused.

---

## Step-by-Step Implementation

### Phase A — Engine / Data Layer
1. Add `LandingDataSource` type to `src/engine/types.ts` (or new `src/engine/dataSource.ts`).
2. Refactor `App.tsx`:
   - Replace `rawData: RawPeriodData[]` with `dataSource: LandingDataSource | null`.
   - `pipelineResult` memo — when `dataSource.standalone` is non-null, prefer `processScopeAwareData()` and use its `consolidated` field for the main pipeline; expose `scopeAwareResult` as a separate memo.
   - All consumers reading `rawData` migrate to `dataSource.consolidated`.
3. Update `DataEntry.handleLibraryPick()` to fetch both ZIPs in parallel when registry says hasStandalone, parse both, return both via `onDataSubmit(consolidatedRows, standaloneRows | null, ...)`.
4. Update `onDataSubmit` signature in App.tsx to accept optional standalone array.

### Phase B — UI: Subsidiary Contribution panel
1. New component `src/components/dashboard/SubsidiaryContributionPanel.tsx` consuming `ScopeAwareResult`.
2. New tab `"scope"` in App.tsx tab list, visible when `scopeAwareResult !== null`.
3. Tab renders:
   - Period-by-period table (consolidated, standalone, gap, gap %)
   - Trend chart (Recharts area)
   - Red flag callouts for the 3 conditions above.

### Phase C — Landing Page Redesign
1. New component `src/components/landing/LandingPage.tsx` that owns the 3-step flow.
2. Three sub-components: `LibraryStep`, `UploadStep`, `SampleStep`.
3. CompanyLibraryGrid simplified — drop scope toggle, always loads both. Keep search + sector filter.
4. Move 5-tab mode selector to `UploadStep` → "Other formats" disclosure.
5. Confirmation card showing what was loaded (Step 2).
6. App.tsx renders `<LandingPage>` when `!dataSource`, replacing current DataEntry mounting flow.
7. DataEntry stays as a sub-component of UploadStep so power-user paths survive.

### Phase D — Migration / cleanup
1. Remove deprecated scope toggle from CompanyLibraryGrid props.
2. Drop the legacy "Library dropdown" inside DataEntry header (line 259-305).
3. Drop OnboardingCard render from DataEntry; LandingPage handles the empty state.
4. Update all uses of `rawData` across components (App.tsx, DebugPanel.tsx, AcademicReport.tsx, etc.) to `dataSource.consolidated`.

### Phase E — Tests
1. New test `src/components/__tests__/LandingPage.spec.tsx` — verify 3 paths render.
2. New test `src/engine/__tests__/dualScopeIntegration.spec.ts` — load both, assert `scopeAwareResult` is populated and pipeline still produces consolidated valuation.
3. Existing tests adjust for new `dataSource` envelope.
4. `npm run validate` must stay green.

---

## Files Likely to Change

### New
- `src/components/landing/LandingPage.tsx`
- `src/components/landing/LibraryStep.tsx`
- `src/components/landing/UploadStep.tsx`
- `src/components/landing/ConfirmStep.tsx`
- `src/components/dashboard/SubsidiaryContributionPanel.tsx`
- `src/engine/dataSource.ts` (envelope type)
- `src/components/__tests__/LandingPage.spec.tsx`
- `src/engine/__tests__/dualScopeIntegration.spec.ts`

### Modified
- `src/App.tsx` (state model + tab list + render flow)
- `src/components/DataEntry.tsx` (slim down, becomes UploadStep child)
- `src/components/data-entry/CompanyLibraryGrid.tsx` (drop scope toggle, dual-fetch logic)
- `src/components/dashboard/OnboardingCard.tsx` (likely deleted or absorbed)
- All components reading `rawData` → migrate to `dataSource.consolidated`

### Untouched (verify they still work)
- All engine/* except `dataSource.ts` addition
- All tests except those mentioned in Phase E
- registry.json
- folder structure

---

## Tests / Validation

### Unit
- `dualScopeIntegration.spec.ts` — given consolidated + standalone for ITC, scopeAwareResult.subsidiaryContribution.length > 0 and pipeline result still passes industrial gates.
- `LandingPage.spec.tsx` — clicking each of 3 tabs renders correct sub-component; library card click triggers onPickCompany with both zips fetched (mock fetch).

### Integration
- Manual test: load HDFC Bank (has both) → confirm Scope tab renders with bank subsidiary gap.
- Manual test: load KOTAKBANK (no standalone) → confirm app loads with consolidated only and Scope tab is hidden.
- Manual test: upload custom ZIP → confirm fallback flow still works.

### Regression
- `npm run validate` — all 674 existing tests pass.
- `npx tsx scripts/validate-registry.ts` still green.

---

## Risks, Tradeoffs, Open Questions

### Risks
- **Migration scope** — `rawData` is referenced in 30+ places across components. Touching all of them risks subtle breakages. Mitigation: keep a thin compat shim during transition (`get rawData() { return this.dataSource?.consolidated ?? null }`).
- **Bank quality sidecar fetch** — currently triggered by company_id from rawData. Need to ensure consolidated drives quality fetch consistently.
- **Audit/persistence** — `persistAuditFile` calls expect a single ZIP. Will need to persist both when both are loaded.
- **Bundle size** — already 2.7MB vendor chunk (from audit). Don't add more libraries. Reuse Recharts for the gap chart.

### Tradeoffs
- **Breaking the scope toggle** — power users who currently load standalone-only for some niche analysis lose that path. Mitigation: keep "Upload your own" → user can drop standalone.zip directly there as a single-source workflow.
- **Slower company load** — fetching 2 ZIPs serially or in parallel is slower than 1. ~200ms typically; not user-perceptible.

### Open Questions
1. **Should subsidiary contribution drive valuation, not just validate it?** — This was the conversation we had. Plan keeps it as validation-only for now (default consolidated valuation). Adding hybrid valuation (parent + subsidiary segments) is Phase F, future work.
2. **Where does the Scope tab fit in the tab order?** — Proposed: between Statements and Ratios. User feedback may shift.
3. **Bank-specific subsidiary view?** — Banks have HDFC Securities, HDFC Life as subsidiaries; the gap analysis applies but the subsidiary contribution semantics are different (insurance + broking vs. core banking). Plan leaves this generic; bank-specific framing can come later.
4. **Confirm sample data** — Load Sample uses a hardcoded VST in-memory dataset; doesn't have standalone. Should sample button be removed once library is the primary path? Plan keeps it for dev convenience.

---

## Iteration Log

| Iter | Change | Why |
|---|---|---|
| v1 | Initial draft | Direct answer to user prompt |
| v2 | Added Phase D migration cleanup section | Realized 30+ rawData references needed enumeration |
| v3 | Added empirical validation section after listing folders + tracing scopeAwareLoader signature | Verified standalone exists for 11 companies, function signature matches plan, no surprises |

---

## Estimated Effort

- Phase A (engine/data): 1 session
- Phase B (subsidiary panel): 1 session
- Phase C (landing redesign): 1.5 sessions
- Phase D (migration): 0.5 session
- Phase E (tests): 0.5 session

**Total: ~4-5 focused sessions.** Could be parallelized via subagents (A+B independent of C; D+E final integration).

---

## Next Action

User decides:
- **A.** Approve plan, execute Phase A first
- **B.** Adjust scope (e.g., skip landing redesign, do dual-load only)
- **C.** Different priority entirely (e.g., bank Excel export H5 first)
