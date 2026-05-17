# Session Summary — 2026-05-17

Major hardening + extension session focused on multi-format ingestion,
multi-company robustness, and surfacing skip-with-reason throughout the
valuation stack.

## Shipped (14 commits, 462 tests, build clean)

### Phase A — Multi-standard ingestion (Ind-AS + REV + Standard)

- **`30e86ad`** feat(parser): Phase A multi-standard ingestion
  - `standardAliases.ts` — 40 alias entries mapping REV/Standard labels to Ind-AS canonical
  - `standardFromFilename(path)` — detects standard from filename suffix AND folder name
  - Parser merges across standards with precedence (Ind-AS > REV > Standard > Unknown)
  - Tags every `RawPeriodData` with `accounting_standard`
  - 31 unit tests, including path-aware folder detection for real Capitaline layouts

- **`2a1f73d`** fix(parser): detect standard from folder, not just filename
  - Real ITC layout has `revised schd/`, `standard/` folders with no filename suffix
  - Updated regex to walk the entire path, including parent folders

- **`f4b81e2`** feat(parser): 7 alias additions from real ITC validation
  - Long-term Loans and Advances, Loan Assets-Long Term, Term Loan Borrowings,
    Long Term Provisions, Trade Payables, Total Other Long Term Liabilities,
    Long Term Loans and Advances - Total
  - Coverage report at `docs/phase-a-validation-2026-05-17.md`

### Phase A6 — Accounting-standard confidence in traceability envelope

- **`2e0f19b`** feat(traceability): Phase A6
  - `AccountingStandardCoverage` field on `AnalysisTraceabilityEnvelope`
  - confidence band: high (all Ind-AS), medium (REV gap-fills), low (Standard contributes), unknown (no provenance)
  - `dominantStandard` tiebreaker: count first, then precedence
  - 10 unit tests

### Phase B4 — Three bank valuation models

- **`342fb59`** feat(bank): Phase B4 bank valuation
  - `bankValuation.ts` — Justified P/B Gordon, Equity Residual Income with 5y fade, Sustainable DDM
  - Each model independently skips with reason when prerequisites fail
  - Triangulation: median of computed models
  - Sustainable ROE: median of last 5y, capped at 1.5× long-run (≈19.5%)
  - 18 unit tests covering all skip paths

### Phase I — Robustness pass: skip-with-reason throughout

- **`74c5f83`** feat(capalloc): Phase I — capital allocation skip-with-reason
  - `dataSufficient`/`skipReason`/`profitablePeriods` on `CapAllocScoreResult`
  - Triggers when fewer than 3 periods of positive CNI
  - 5 unit tests covering Paytm-like, Zomato-like, boundary, null/NaN, backwards-compat

- **`d675328`** feat(scope): Phase I — mixed-conglomerate routing override
  - `cfg.mixed_conglomerate_route_to: "bank" | "nbfc" | "industrial" | null`
  - Allows ICICI Bank / Reliance to be consciously routed through dominant pipeline
  - Default fail-close behaviour preserved
  - 5 unit tests

- **`7d7b425`** feat(cyclicality): Phase I — peak/trough/midcycle detector
  - `cyclicalityDetector.ts` — CV-based classification with z-score peak/trough split
  - Handles Tata Steel-style FY22 peak vs FY24 trough
  - Returns peak (P90) / trough (P10) / median anchors for cycle-aware framing
  - Wired into `V3AnalyticsBundle.cyclicality`
  - 9 unit tests

- **`fbfb6af`** feat(moat): Phase I — moat skip-with-reason for loss-makers
  - `dataSufficient`/`skipReason`/`positiveRNOAPeriods` on `MoatScoreResult`
  - Triggers when fewer than 3 periods of positive RNOA
  - 3 unit tests

### UI wiring

- **`65617c8`** feat(ui): Phase B4 bank valuation in FinancialInstitutionReport
  - New 'Bank' tab with period snapshots + 3 valuation cards + triangulation box
  - `bankResult` flows through App.tsx via new `processCompanyDataFull()` call
  - Skip-with-reason cards for models that couldn't compute

- **`f48be0c`** feat(ui): Phase I — V3 panel surfaces skip-reasons
  - Amber banners at top of V3AnalyticsPanel
  - Cyclicality (peak/trough/midcycle), moat low-confidence, capalloc low-confidence

### Documentation

- `docs/code-review-2026-05-17.md` (181 lines, 18-commit review summary)
- `docs/NEXT-PHASE-ROADMAP.md` (companion to design doc, sequenced execution plan)
- `docs/phase-a-validation-2026-05-17.md` (real ITC data validation)
- `docs/company-coverage-status-2026-05-17.md` (10-company sector gap analysis)

## Validation status

- `npm run typecheck`: clean
- `npm run validate` (typecheck + tests + build): clean
- 462 tests passing across 69 test files
- Commits pushed to `origin/main`

## What this enables now

| Company           | Before                          | After                                               |
|-------------------|---------------------------------|-----------------------------------------------------|
| ITC               | Industrial Penman-Nissim        | Same + multi-standard 15Y history (FY2011-FY2025)   |
| HDFC Bank         | Metrics only, no valuation      | 3 valuation models + triangulation + UI tab         |
| ICICI Bank        | Fail-closed (mixed-conglomerate)| Optional override route → bank pipeline             |
| Reliance          | Fail-closed (Jio Financial)     | Optional override route → industrial pipeline       |
| Tata Steel        | Latest-period biased            | Cyclical-peak/trough warning surfaced               |
| Paytm             | Misleading 'narrow moat' / score | Skip-with-reason: 'no positive RNOA history'        |
| Bajaj Finance     | NBFC subtype detected, untested | Bank pipeline runs (NBFC-specific metrics TBD)      |
| LIC               | Fail-closed (correct)           | Same — insurance pipeline is separate work          |

## What's still to ship

In rough priority order:

1. **NBFC-specific metrics** — Bajaj Finance currently routes through bank
   pipeline but CASA/deposits/cost-to-income don't apply. NIM-on-AUM,
   credit cost on advances, leverage on borrowings are NBFC-native.
2. **Currency/unit auto-detection** — Capitaline normally emits in Cr but
   some files use lakhs or absolute. Header parser today assumes Cr.
3. **Single-period uploads** — Currently might run with degenerate output.
   Should produce a "screening only" mode with explicit caveats.
4. **Negative book value** — A handful of distressed PSU / defaulted NBFC
   companies have negative equity. EPV and DDM blow up; need fail-closed.
5. **Demerger / M&A detection** — Large jumps in equity or revenue should
   flag a structural break and exclude from time-series persistence.
6. **Insurance pipeline (Phase E)** — LIC fail-closes correctly today.
   Building a real insurance pipeline (premium-based metrics, embedded
   value, solvency) is a multi-week investment.
7. **Phase B5 — Bank quality flags** — NPA cycle position, deposit
   franchise stability, loan growth vs system credit growth.

## Patterns established this session

- **Skip-with-reason** is now the standard pattern for any module that
  can't compute meaningfully on a given dataset. Both `MoatScoreResult`
  and `CapAllocScoreResult` carry `dataSufficient` / `skipReason` /
  `<gate>Periods`. Future modules should follow.

- **Path-aware standard detection** uses both filename and folder name.
  Capitaline's actual export layout puts Standard files in a `standard/`
  folder with no filename suffix.

- **Dominant standard via precedence with count tiebreaker** —
  Ind-AS > Revised Sch-VI > Standard > Unknown. Used for both file
  routing and traceability confidence.

- **Cycle-aware framing** doesn't normalise the recast itself, just
  flags whether the latest period is at a cycle extreme so users can
  apply their own judgement on which anchor to trust.

- **Conscious routing override** for mixed-conglomerate companies —
  default fail-close is preserved as the safe path; user explicitly
  takes responsibility by setting `cfg.mixed_conglomerate_route_to`.
