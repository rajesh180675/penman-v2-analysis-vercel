# Session Summary — 2026-05-17

End-of-session report for the comprehensive multi-sector hardening pass on
penman-v2-analysis. 20 commits shipped to `origin/main` since the previous
checkpoint (`2541ac7`), all builds clean, 474 tests passing.

## Quick Status

- **Branch**: `main`, clean, fully pushed to `origin/main`
- **Latest commit**: `8c45403 refactor(App): consolidate engine call`
- **Tests**: 474 passing across 70 test files
- **Typecheck**: clean (`npm run typecheck`)
- **Build**: clean (`npm run validate`)
- **Deployed**: Vercel auto-deploys on push, so the live app is up-to-date

## What We Accomplished

This session pushed beyond the ITC + HDFC Bank Ind-AS-only baseline so the
engine handles **any Indian listed company across sectors and accounting
standards**, with explicit skip-with-reason instead of silent NaN when
prerequisites aren't met.

Five phases shipped end-to-end:

### Phase A — Multi-standard ingestion (Ind-AS + Revised Sch-VI + Old GAAP/Standard)

The Capitaline parser now identifies which Indian accounting standard each
file is rendered under and merges across formats with provenance tracking.

- `standardAliases.ts` — 40 alias entries mapping REV/Standard labels to Ind-AS canonical
- `standardFromFilename(path)` — path-aware detection (filename suffix AND folder name)
- `STANDARD_PRECEDENCE`: ind-as=4, revised-sch-vi=3, standard=2, unknown=1
- Every `RawPeriodData` now tagged with `accounting_standard`
- 31 unit tests covering real Capitaline folder layouts (`revised schd/`, `standard/`)

Validated against real ITC data: all 20 files in the multi-format tree
detect correctly, 7 alias gaps closed from labels found in REV/Standard
exports that didn't yet exist in mappingSpec.

### Phase A6 — Accounting-standard confidence in traceability envelope

`AnalysisTraceabilityEnvelope.accountingStandardCoverage` now exposes:

- Per-standard period count
- Missing-provenance count
- Dominant standard (count tiebreaker, then precedence)
- Confidence band: high (all Ind-AS) → medium → low → unknown

UI can now show "13/15 periods Ind-AS, 2 Old GAAP" without users
having to dig into raw period data. 10 unit tests.

### Phase B4 — Three bank valuation models

Banks can't use Penman-Nissim's OA/FA reformulation (advances ARE the
operating asset; deposits ARE the operating liability). New equity-side
models in `bankValuation.ts`:

1. **Justified P/B Gordon** — `Value = BV × (sustainable_ROE − g) / (ke − g)`
2. **Equity Residual Income with 5-year fade** — explicit fade window then terminal
3. **Sustainable DDM** — payout × earnings discounted at ke

Each model **independently skips with reason** when prerequisites fail
(non-positive ROE history, ke ≤ g, missing book value, etc). Triangulated
value is the median of computed models. 18 unit tests covering all skip
paths.

UI: new 'Bank' tab in the main TABS list, period snapshots table, three
model cards with diagnostics, triangulation box with market-cap comparison.

### Phase I — Robustness pass (the largest surface this session)

The "no silent NaN" pass. Every valuation/scoring module now exposes
`dataSufficient` + `skipReason` when prerequisites aren't met:

- **Capital allocation**: skips when fewer than 3 periods of positive CNI
  (Paytm-style loss-maker case)
- **Moat scoring**: skips when fewer than 3 periods of positive RNOA
- **Cyclicality detector** (new module): peak/trough/midcycle classification
  via CV-based cycle detection + z-score extremes; surfaces "Tata Steel
  FY22 is at peak-cycle" so users don't naïvely extrapolate peak margins
- **Structural break detector** (new module): flags equity/revenue/NOA YoY
  changes too large to be organic — Reliance Jio Financial demerger,
  IFRS-16 transitions, M&A, capital raises; affected periods exposed
  so persistence calculations can exclude them
- **Mixed-conglomerate routing override**: `cfg.mixed_conglomerate_route_to`
  lets users consciously route ICICI Bank / Reliance through their
  dominant pipeline despite immaterial subsidiary signals (default fail-
  close behaviour preserved)

UI: amber banners at top of V3AnalyticsPanel surface every skip-reason and
cycle-position warning prominently, so issues aren't buried in diagnostics.

### Cross-cutting refactor — single engine pass

App.tsx was calling the engine twice (once for `recastData`, once for
`bankResult`). Consolidated into a single `processCompanyDataFull()` pass
driven by one `useMemo`. Roughly halves engine work on every config
keystroke.

## Current State of the Project

**Sector coverage matrix (after this session):**

| Company           | Routing                  | Pipeline         | Valuation models      | Status           |
|-------------------|--------------------------|------------------|-----------------------|------------------|
| ITC               | industrial               | Penman-Nissim    | 9 models + Ohlson     | Full (multi-std) |
| HDFC Bank         | financial-institution    | bankPipeline     | 3 bank models         | Full             |
| ICICI Bank        | mixed (override → bank)  | bankPipeline     | 3 bank models         | Full             |
| LIC               | financial-institution    | fail-close       | none                  | Insurance Phase E TBD |
| Power Grid        | industrial               | Penman-Nissim    | 9 models              | Full             |
| TCS               | industrial               | Penman-Nissim    | 9 models              | Full             |
| Tata Steel        | industrial               | Penman-Nissim    | 9 models + cyclicality flag | Full       |
| Bajaj Finance     | NBFC subtype             | bankPipeline     | 3 models, NBFC labels | Functional       |
| Paytm             | industrial               | Penman-Nissim    | none (skip-with-reason on capalloc + moat) | Robust skip |
| Reliance          | mixed (override → industrial) | Penman-Nissim | 9 models + structural-break flag | Full       |

10/10 companies in `public/data/companies/` route somewhere meaningful.
LIC fail-closes correctly (insurance pipeline is multi-week future work).

**Architectural patterns established this session:**

1. **Skip-with-reason** is now the standard for any module that can't
   compute meaningfully. Both `MoatScoreResult` and `CapAllocScoreResult`
   carry `dataSufficient` / `skipReason` / `<gate>Periods`. Future modules
   should follow this template.
2. **Path-aware standard detection** — uses both filename and folder name.
   Capitaline's actual export layout puts Standard files in a `standard/`
   folder with no filename suffix, so folder name is the reliable signal.
3. **Dominant standard via precedence with count tiebreaker** —
   Ind-AS > Revised Sch-VI > Standard > Unknown.
4. **Cycle-aware framing** doesn't normalize the recast itself, just flags
   whether the latest period is at a cycle extreme.
5. **Conscious routing override** for mixed-conglomerate companies —
   default fail-close preserved as the safe path; user explicitly takes
   responsibility by setting config.

## Files Created (this session)

### Engine

- `src/engine/standardAliases.ts` — multi-standard infra, 40 alias entries
- `src/engine/bankValuation.ts` — 3 bank valuation models (316 lines)
- `src/engine/cyclicalityDetector.ts` — peak/trough/midcycle (229 lines)
- `src/engine/structuralBreakDetector.ts` — demerger/M&A detection (~250 lines)

### Tests

- `src/engine/__tests__/standardAliases.spec.ts` (31 cases)
- `src/engine/__tests__/accountingStandardCoverage.spec.ts` (10 cases)
- `src/engine/__tests__/bankValuation.spec.ts` (18 cases)
- `src/engine/__tests__/cyclicalityDetector.spec.ts` (9 cases)
- `src/engine/__tests__/structuralBreakDetector.spec.ts` (9 cases)

### UI

- `src/components/FinancialInstitutionReport.tsx` — Bank tab content (~250 lines)

### Documentation

- `docs/NEXT-PHASE-ROADMAP.md` (~310 lines) — Phases A–J sequenced plan
- `docs/phase-a-validation-2026-05-17.md` (~280 lines) — real ITC validation
- `docs/company-coverage-status-2026-05-17.md` (~150 lines) — 10-company gap analysis
- `docs/session-summary-2026-05-17.md` (~150 lines) — mid-session checkpoint

### Skill

- `capitaline-multi-standard-ingestion` (data-science category) —
  workflow for handling Ind-AS + REV + Standard exports

## Files Modified (this session)

### Engine

- `src/engine/types.ts` — added `accounting_standard?` to RawPeriodData,
  added `mixed_conglomerate_route_to?` to EngineConfig
- `src/engine/capitalineParser.ts` — full-path threading through
  gridToPeriods, multi-standard period merge with provenance
- `src/engine/analysisTraceability.ts` — `accountingStandardCoverage`
  field + `computeAccountingStandardCoverage()` helper
- `src/engine/scopePolicy.ts` — mixed-conglomerate override logic
- `src/engine/capitalAllocationScoring.ts` — `dataSufficient` /
  `skipReason` / `profitablePeriods` fields
- `src/engine/moatScoring.ts` — same skip-with-reason pattern
- `src/engine/bankPipeline.ts` — Phase B4 valuation integration,
  `subtype` field on result
- `src/engine/analysisFamily.ts` — `borrowings` field on snapshot for NBFC
- `src/engine/v3Analytics.ts` — wired `cyclicality` + `structuralBreaks`
- `src/engine/pipeline.ts` — pass config to bank pipeline so it can
  produce Phase B4 valuation

### UI

- `src/App.tsx` — single engine pass refactor, new 'Bank' tab,
  pipeline result memo
- `src/components/V3AnalyticsPanel.tsx` — Phase I robustness banners
  (cyclicality / moat / capalloc / structural breaks)
- `src/components/__tests__/ForecastReport.spec.tsx` — added required
  `accountingStandardCoverage` to test fixtures

### Documentation

- `docs/COMPREHENSIVE-VALUATION-DESIGN.md` — pointer to companion roadmap

## Files Deleted (this session)

- `scripts/verify-phase-a-itc.spec.ts` — orphaned subagent leftover
  causing a vitest worker OOM

## What's Left to Do

In rough priority order:

### High value, small scope

1. **I3 — Loss-maker valuation alternative** — When capalloc skips, give
   users a revenue-multiple or reverse-DCF anchor instead of just a skip
   message. Real value for Paytm/Zomato/early-stage names. Maybe 3-4
   hours of work.

2. **I4 — Negative book value handling** — A handful of distressed PSUs /
   defaulted NBFCs have negative equity. EPV and DDM blow up; need fail-
   close. Smaller scope, similar pattern to existing skip-with-reason.

3. **Phase B5 — Bank quality flags** — NPA cycle position, deposit
   franchise stability, loan growth vs system credit growth. Validates
   B4 against real HDFC + ICICI cycle data. Substantial polishing.

### Medium scope

4. **NBFC-specific metrics** — Bajaj Finance currently routes through
   bank pipeline. CASA / cost-to-deposits don't apply; should be
   reinterpreted as cost-to-borrowings, NIM-on-AUM. Engine gives valid
   numbers today but the labels are bank-shaped.

5. **I5 — Single-period upload mode** — Currently might run with
   degenerate output. Should produce a "screening only" mode with
   explicit caveats.

### Large scope (multi-week)

6. **Phase E — Insurance pipeline** — LIC fail-closes correctly today.
   A real insurance pipeline needs premium-based metrics, embedded value,
   solvency ratios. Multi-week investment.

7. **Phase J — Batch + UI polish** — Compare multiple companies side-
   by-side, ranked watchlist, export to PDF.

### Backlog (known limitations, documented)

- **I7 currency detection** — Capitaline's `Curr. in` field is empty in
  static HTML exports. Auto-detection isn't possible from file content.
  All real workflows use Cr. Documented in roadmap; revisit only if a
  user reports a discrepancy.
- **I6 demerger detection beyond YoY threshold** — Current detector
  catches the obvious cases. Edge cases (slow-burn divestitures over
  3+ years) not yet handled.

## Important Decisions / Context You Should Know

### Real-world findings from ITC multi-standard validation

- **Capitaline restates the SAME FY range under all 3 formats** —
  multi-standard ingestion's value is no longer "extending the time
  series" but "label-mapping resilience" + "Old GAAP cross-check signal"
- **REV files produce identical numbers to INDAS** under different
  labels — REV ingestion is purely a label-resilience play for users
  who haven't downloaded INDAS exports
- **Standard files materially differ from INDAS** (~19% gap in Total
  Assets for ITC FY2025: 88,090 Cr vs 71,321 Cr) — useful as out-of-
  Ind-AS sanity check, NOT as a primary input

### HDFC Bank REV / Standard data is NOT urgent

The discussion concluded HDFC's existing 9-year Ind-AS coverage is more
than sufficient for the three Phase B4 models. Pre-Ind-AS bank data
followed Banking Regulation Act + RBI prudential norms (not Schedule VI),
so label translations would be much messier. **More valuable next: ICICI
Bank Ind-AS validation, Bajaj Finance NBFC-specific metrics path.**

### Data set is sufficient for comprehensive sector analysis

Confirmed during the 10-company status sweep: ITC (industrial) + HDFC
Bank + ICICI Bank (different bank profiles) + LIC (insurance fail-close)
+ Power Grid (utility/PSU) + TCS (IT services) + Tata Steel (cyclical)
+ Bajaj Finance (NBFC) + Paytm (loss-maker) + Reliance (mixed
conglomerate) covers every architecturally distinct sector type. Adding
pharma, auto, telecom, real estate, or a pure holdco wouldn't expose
new pipeline-level distinctions — just industrial pipeline runs against
different label sets.

### Three data hygiene issues found

1. **Power Grid `standalone/` has duplicate ProfitLossINDAS_.xls and
   ProfitLossINDAS_ (1).xls** — usually harmless because values match,
   worth deleting the (1) variant to avoid double-counting in label
   collision stats
2. **HDFC Bank uses capital-S `Standalone/` folder** while other companies
   use lowercase `standalone/`. Scope detector is case-insensitive, but
   future subfolder-listing UI should be too. Worth normalizing
3. **LIC has only 6 files** — expected for life insurance (different
   schedules: Form B-PL, Revenue Account, Solvency Statement). Engine
   correctly fail-closes today

### S-9.4C invariant must be preserved

Single-source-of-truth for capital cost (kw): valuation modules accept
`kwOverride` and never recompute kw internally. Phase B4 bank valuation
follows this — `ke_from_config` is computed once at the call site and
threaded through.

### Build / test pre-existing noise

- The patch tool's lint fallback flags pre-existing TS errors (jszip
  esModuleInterop, xlsx default-import, downlevelIteration, vitest type
  resolution). Real `npm run typecheck` is clean. Ignore the lint output
  on patches; trust `npm run typecheck`.
- One vitest worker OOM is pre-existing (reproduces on clean main with
  `git stash` + `vitest run`). Other 474 tests pass.

### Skill maintenance

Updated `capitaline-multi-standard-ingestion` skill mid-session with the
folder-based download workflow (Capitaline's actual export pattern, not
the original assumed zip workflow).

## Recommendation for Next Session

Test the deployed app on Vercel against each of the 10 companies. The
session shipped a lot of UI surface (Bank tab, Phase I banners, NBFC
labels, multi-standard provenance) — real use will surface what's
working and what needs polish before continuing engine work. Then
prioritize I3 (loss-maker alternative) + I4 (negative book value) since
they're small scope with high real-world value.

Avoid the temptation to start Phase E (insurance) — it's multi-week
work and LIC fail-closes correctly today, which is honest behaviour.

---

Total session impact: 20 commits, 5 new modules, 4 new test files,
4 new docs, 1 new skill update, 474 tests passing. Engine now handles
all 10 companies in `public/data/companies/` either with full valuation
or explicit skip-with-reason. Ready for real-world dogfooding.
