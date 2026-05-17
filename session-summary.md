# Session Summary — Penman V2 Analysis

**Date:** 2026-05-17
**Branch:** `main` (all commits pushed to `origin/main`)
**Commits this session:** 16
**Tests:** 471 passing across 71 files
**Build:** clean (typecheck + Vite production build)

---

## What we accomplished

### Phase A — Multi-standard ingestion (Ind-AS + Revised Sch-VI + Standard) ✅

Engine now ingests Capitaline exports across all three Indian accounting standards and merges them with provenance tracking. Path-aware detection scans both filename AND folder names, so the actual Capitaline download layout (`revised schd/`, `standard/` subfolders) works without filename suffixes.

- 40 alias entries mapping REV/Standard labels to Ind-AS canonical
- Precedence: Ind-AS > Revised Sch-VI > Standard > Unknown
- Real ITC data validation: 20 files across 3 formats all detect correctly
- Discovery: Capitaline restates the SAME FY range across all 3 formats. REV vs INDAS values are identical, just different labels. Standard differs ~19% on Total Assets due to Ind-AS lease/intangible/investment-property additions.

### Phase A6 — Accounting-standard confidence in traceability envelope ✅

`AccountingStandardCoverage` field added to `AnalysisTraceabilityEnvelope`. UI can now show "13/15 periods Ind-AS, 2/15 Old GAAP" with confidence bands (high/medium/low/unknown).

### Phase B4 — Three bank valuation models ✅

Banks can't use Penman-Nissim's OA/FA reformulation (advances ARE the operating asset). New `bankValuation.ts` produces three equity-side models with skip-with-reason for each:

- **Justified P/B Gordon** — `(ROE - g) / (ke - g) × BV`
- **Equity Residual Income** — 5-year explicit forecast + Gordon terminal
- **Sustainable DDM** — `(EPS × payout) / (ke - g)`

Triangulated value = median of computed models. Sustainable ROE = median of last 5y, capped at 1.5× long-run (~19.5%).

### Phase I — Robustness pass (skip-with-reason throughout) 🟡 partial

Pattern: every valuation/scoring module returns explicit skip-with-reason instead of silently producing a misleading number on edge cases.

- **I1 Capital allocation** — `dataSufficient`/`skipReason`/`profitablePeriods` for Paytm-style loss-makers
- **I2 Scope override** — `cfg.mixed_conglomerate_route_to: "bank" | "nbfc" | "industrial" | null` lets ICICI Bank / Reliance route through dominant pipeline despite immaterial subsidiary signals; default fail-close preserved
- **Moat skip-reason** — same pattern, triggers when fewer than 3 periods of positive RNOA
- **Cyclicality detector** — CV-based classification with z-score peak/trough split. Tata Steel FY22 peak vs FY24 trough now flagged. Returns peak (P90) / trough (P10) / median anchors.
- **Structural break detector** — Reliance/Jio Financial spinoff (FY2024 equity drop ~₹1.4 L Cr) now flagged with affected periods. Detects equity drops/jumps, revenue drops/jumps, NOA drops/jumps with configurable thresholds. Each break carries a reason mapping to typical Indian corporate events (demerger, IPO/QIP, IFRS-16, etc.)
- **I7 Currency** — Documented as Cr-only assumption; Capitaline's `Curr. in` HTML field is empty in static export across all 10 sample companies, so auto-detection isn't possible.

### UI wiring ✅

- **Bank tab** in main TABS list with `FinancialInstitutionReport` component (period snapshots + 3 valuation cards + triangulation box + skip-reason cards)
- **NBFC subtype labels** — Bajaj Finance shows Borrowings/Loan Book instead of Deposits/Advances with caveat note about CASA/NIM-on-deposits not applying
- **V3 Analytics Panel banners** — Amber banners surface cyclicality (peak/trough/midcycle), moat low-confidence, capalloc low-confidence, and structural breaks at the top of the panel
- **App.tsx engine consolidation** — Single `processCompanyDataFull()` pass drives both `recastOutcome` and `bankResult`; halves engine work on config keystrokes

---

## Current state of the project

```
Branch: main
HEAD: 8c45403 (refactor(App): consolidate engine call)
Tests: 471/471 passing
Build: clean
Vercel: ready to deploy
```

**Test coverage by module:**

| Module                            | Tests |
|-----------------------------------|-------|
| standardAliases                   | 31    |
| accountingStandardCoverage        | 10    |
| bankValuation                     | 18    |
| capitalAllocationScoring (Phase I)| 5     |
| scopePolicy (mixed-conglomerate)  | 5     |
| cyclicalityDetector               | 9     |
| moatScoring (Phase I)             | 3     |
| structuralBreakDetector           | 9     |

---

## Files created this session

```
src/engine/
  standardAliases.ts                                   (NEW, 350 lines)
  bankValuation.ts                                     (NEW, 316 lines)
  cyclicalityDetector.ts                               (NEW, 229 lines)
  structuralBreakDetector.ts                           (NEW, 220 lines)

src/engine/__tests__/
  standardAliases.spec.ts                              (NEW, 31 cases)
  accountingStandardCoverage.spec.ts                   (NEW, 146 lines)
  bankValuation.spec.ts                                (NEW, 243 lines)
  cyclicalityDetector.spec.ts                          (NEW, 173 lines)
  structuralBreakDetector.spec.ts                      (NEW, 160 lines)

src/components/
  FinancialInstitutionReport.tsx                       (NEW, 200 lines)

docs/
  NEXT-PHASE-ROADMAP.md                                (NEW companion to design doc)
  phase-a-validation-2026-05-17.md                     (NEW real-data validation report)
  company-coverage-status-2026-05-17.md                (NEW per-sector gap analysis)
  session-summary-2026-05-17.md                        (NEW interim summary)
  session-summary.md                                   (this file)
```

## Files modified this session

```
src/engine/
  types.ts                          — accounting_standard?, mixed_conglomerate_route_to
  capitalineParser.ts               — multi-standard ingestion with provenance
  analysisTraceability.ts           — AccountingStandardCoverage interface + helper
  capitalAllocationScoring.ts       — dataSufficient/skipReason/profitablePeriods
  moatScoring.ts                    — dataSufficient/skipReason/positiveRNOAPeriods
  scopePolicy.ts                    — mixed_conglomerate_route_to override
  bankPipeline.ts                   — borrowings field threading + valuation hook
  analysisFamily.ts                 — borrowings on FinancialInstitutionPeriodSnapshot
  pipeline.ts                       — pass config to bank pipeline for valuation
  v3Analytics.ts                    — wire cyclicality + structuralBreaks

src/
  App.tsx                           — Bank tab + bankResult + engine consolidation
  components/V3AnalyticsPanel.tsx   — Phase I robustness banners

docs/
  COMPREHENSIVE-VALUATION-DESIGN.md — pointer to companion roadmap
  NEXT-PHASE-ROADMAP.md             — marked Phase A/A6/B4 shipped, I7 documented

scripts/                            (orphan removed)
  verify-phase-a-itc.spec.ts        — DELETED
```

---

## What's left to do

In rough priority order:

### High-value next session

1. **I4 — Negative book value handling**
   - **Test company:** Vodafone Idea (IDEA) — actively traded, persistent negative net worth from AGR liability + accumulated losses. Capitaline has full coverage.
   - Other candidates: Suzlon (CDR years), Spicejet (intermittent)
   - EPV and DDM need to fail-closed when CSE ≤ 0 with explicit "negative book value — equity-side valuation undefined" reason
   - Justified P/B model is meaningless on negative equity (sign flip distorts ratio)
   - Suggest replacement framing: enterprise value (EV/Sales, EV/EBITDA), recovery value, net asset realization

2. **I3 — Loss-maker valuation alternative**
   - When capalloc skips, give the user revenue-multiple or reverse-DCF anchor instead of just a skip message
   - Real value for Paytm/Zomato/early-stage names
   - Probably a new `lossMakerValuation.ts` with enterprise-value framing

3. **Vercel deployment test of all current work**
   - Take a fresh look at the deployed app with everything shipped this session
   - Identify UI rough edges before adding more engine surface

### Medium priority

4. **Phase B5 — Bank quality flags** (NPA cycle position, deposit franchise stability, loan growth vs system credit growth)

5. **NBFC-native metrics path** — true cost-to-AUM, asset-under-management disclosure parsing instead of just relabeling Deposits → Borrowings

### Larger investments

6. **Phase E — Insurance pipeline** — multi-week work to unblock LIC. Premium-based metrics, embedded value, solvency margins.

7. **I5 — Single-period upload mode** — produce a "screening only" mode with explicit caveats

---

## Important decisions and context

### Patterns established

**Skip-with-reason is the standard pattern** for any module that can't compute meaningfully on a given dataset. Both `MoatScoreResult` and `CapAllocScoreResult` carry `dataSufficient` / `skipReason` / `<gate>Periods`. Future modules should follow.

**Path-aware standard detection** uses both filename AND folder name. Capitaline's actual export layout puts Standard files in a `standard/` folder with no filename suffix. The detection function inspects every `/`-or-`\`-separated path segment.

**Dominant standard via precedence with count tiebreaker** — Ind-AS (4) > Revised Sch-VI (3) > Standard (2) > Unknown (1). Used for both file routing and traceability confidence.

**Cycle-aware framing doesn't normalise** the recast itself, just flags whether the latest period is at a cycle extreme so users can apply their own judgement on which anchor to trust.

**Conscious routing override** for mixed-conglomerate companies — default fail-close is preserved as the safe path; user explicitly takes responsibility by setting `cfg.mixed_conglomerate_route_to`.

### Hard-won discoveries

- **Capitaline restates entire history under chosen format**: same FY range across all 3 formats. Multi-standard ingestion's value is "label-mapping resilience" + "Old GAAP cross-check signal", NOT "extending the time series".
- **REV files produce identical numbers to INDAS** under different labels — REV ingestion is purely label-resilience for users who haven't downloaded INDAS exports.
- **Standard files materially differ from INDAS** (~19% gap in Total Assets) — useful as out-of-Ind-AS sanity check, NOT as a primary input.
- **Capitaline's `Curr. in` HTML field is empty** in static export across all 10 sample companies. Currency auto-detection from file content isn't possible. Cr is the universal assumption.
- **Subagent + browser File API in vitest workers** blocks long-running real-file parsing; Python regex validation is faster for ad-hoc data inspection.
- **Pre-existing patch-tool lint noise** — jszip esModuleInterop, xlsx default-import, downlevelIteration warnings should be ignored. Real `tsc --noEmit` via `npm run typecheck` is the source of truth.

### 10-company data coverage

Sufficient for comprehensive sector analysis — don't need more companies:

| Company        | Sector type             | Pipeline route                |
|----------------|-------------------------|-------------------------------|
| ITC            | Industrial conglomerate | Penman-Nissim                 |
| HDFC Bank      | Private bank            | Bank pipeline + Phase B4      |
| ICICI Bank     | Bank with subs          | Bank (with override)          |
| LIC            | Life insurance          | Fail-closed (insurance TBD)   |
| Power Grid     | Utility/PSU             | Penman-Nissim                 |
| TCS            | IT services             | Penman-Nissim                 |
| Tata Steel     | Cyclical/commodity      | Penman-Nissim + cyclicality   |
| Bajaj Finance  | NBFC                    | Bank pipeline + NBFC subtype  |
| Paytm          | Loss-maker fintech      | Penman-Nissim + capalloc skip |
| Reliance       | Mixed conglomerate      | Industrial (with override)    |

### Data hygiene items noticed but not fixed

- Power Grid `standalone/` has duplicate `ProfitLossINDAS_.xls` and `ProfitLossINDAS_ (1).xls`
- HDFC Bank uses capital-S `Standalone/` while ITC/ICICI/TCS use lowercase `standalone/`
- LIC has only 6 files (no SegmentFinance, no Investment) — expected, blocks LIC analysis until insurance pipeline ships

### Project-wide constraints (preserved)

- Fail-closed gating; no silent NaN
- S-9.4C: single-source-of-truth for capital cost (kw)
- Push directly to `origin/main` per explicit user instruction
- Capitaline `Curr. in` field is empty; engine assumes Cr
- User downloads files into folder structure (no zip workflow); folder names indicate format

### Commit log this session

```
8c45403 refactor(App): consolidate engine call — single processCompanyDataFull pass
ad6893a feat(structural-breaks): Phase I — detect demerger / M&A / capital raise
838e2c9 feat(ui): NBFC subtype-aware FinancialInstitutionReport labels
1228cbe docs(roadmap): I7 currency detection — empty Curr. field documented
98e8d33 docs: session summary 2026-05-17 — interim
f48be0c feat(ui): Phase I — surface cyclicality/moat/capalloc skip-reasons in V3 panel
65617c8 feat(ui): Phase B4 — wire bank valuation into FinancialInstitutionReport
fbfb6af feat(moat): Phase I — skip-with-reason for loss-makers
7d7b425 feat(cyclicality): Phase I — peak/trough/midcycle detection
d675328 feat(scope): Phase I — mixed-conglomerate routing override
74c5f83 feat(capalloc): Phase I robustness — surface skip-with-reason for loss-makers
342fb59 feat(bank): Phase B4 — three bank valuation models with skip-with-reason
2e0f19b feat(traceability): Phase A6 — wire accounting-standard coverage into envelope
f4b81e2 feat(parser): add 7 alias entries from real ITC REV/Standard data validation
2a1f73d docs(roadmap): mark Phase A shipped, document folder-based download workflow
30e86ad feat(parser): Phase A — multi-standard ingestion (Ind-AS + REV + Standard)
```

---

## How to resume

```bash
cd C:\Users\rajesh\WindsurfAPI\penman-v2-analysis
git pull origin main
npm install              # if dependencies changed
npm run validate         # baseline check (typecheck + tests + build)
npm run dev              # start local dev server
```

**Read first:**
- `docs/COMPREHENSIVE-VALUATION-DESIGN.md` — long-term vision
- `docs/NEXT-PHASE-ROADMAP.md` — sequenced execution plan with shipped/pending markers
- `docs/company-coverage-status-2026-05-17.md` — per-company status
- `CLAUDE.md` — project conventions

**Recommended next move:** I4 (negative book value) using Vodafone Idea as test fixture. Smaller scope than insurance pipeline, immediately useful for distressed-company analysis, and continues the well-established skip-with-reason pattern from this session.
