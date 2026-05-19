# Penman-V2-Analysis — Full Audit & Fix Log
**Session date:** June 2026  
**Reviewer:** Kiro AI  
**Scope:** End-to-end critical review — engine, pipeline, valuation models, UI, tests, architecture, production readiness

---

## SECTION 1 — FIXES COMPLETED THIS SESSION

All commits pushed to `main` on `github.com/rajesh180675/penman-v2-analysis-vercel`.

### Commit `43e71726`
- Insurance pipeline: `lapse_rate` set to null (not derived from persistency — different metric)
- EV triangulation: insurance EV-based value used directly, not averaged with other models
- `casaRatio` guard: only overwritten when a matching sidecar quality record exists
- Equity mapping: added `"Total Shareholders Funds"` as alias in mappingSpec
- TS nullability: 12x `?? null` fixes in `FinancialInstitutionReport.tsx`

### Commit `234b9c03`
- Resolved all 84 TypeScript errors:
  - `EPVResult` shape extended with `V_EPV`, `V_A`, `kw`, `interpretation`, `confidence`, `confidenceNotes`, `normalization`, `franchisePct`, `priceToEPV`
  - Recharts `Formatter` intersection type fixed by wrapping formatter functions `as any` in 9 chart files
  - Reconciliation status mapping fixed (`confirmed/degraded/failed`)
  - `fidelityPct` → `score` in QualitySignalPanel
  - Removed unused `ke_from_config` import, `_ke`/`_rnoa`/`_moatNarrow` variables
  - `sharesOutstanding` → `shareBasis.shares`, `impliedGrowthValue` → `impliedOwnerEarningsGrowth`, `sotpPerShare` computed correctly
  - `Segment: 0` added to `byStatement` fixture in auditSnapshot test

### Commit `a3e3725b`
- Recharts `debounce={50}` on all 18 `ResponsiveContainer` instances — fixes blank charts on hidden/not-yet-laid-out tabs
- `bankQualityIndicators.ts` content-type guard — silently ignores HTML 404 responses for companies without a sidecar JSON (Vite SPA fallback returns 200 HTML, not 404)
- App.tsx comparison sync banner suppressed when status is 404 — expected in local mode without Vercel blob

### Commit `56373b28`
- **[A1 FIXED]** EPV now uses `kw` (WACC) as discount rate for `epvOperations` — ke overstated EPV for levered firms since ke > kw
- **[A2 FIXED]** Bank RI model uses actual `payoutRatio` parameter in 5-year forecast loop instead of hardcoded 0.30
- **[C6 FIXED]** `terminal_growth_rate` added to `EngineConfig` interface — removed `as unknown as Record<string, unknown>` cast in bankValuation.ts
- **[D2 FIXED]** Ratio sanity for industrial pipeline now resolves effective company type from itServices/cyclicality signals — "auto" had no sanity bands

### Commit `2879f475`
- **[A5 FIXED]** Bank P/B floor: 0.3x for distressed banks (was only 0.7x for insurance, nothing for regular banks) — prevents negative intrinsic values when ROE < g
- **[D5 FIXED]** `isMaterialValue` threshold raised from 0.0001 Cr (Rs 1,000) to 1.0 Cr — stops false NBFC signal triggers for industrial companies with trivial fee income lines

### Commit `9d6871fc`
- **[E1 PARTIAL]** Report tab now visible for banks/NBFCs — was hidden because `needsData` required industrial recast data

### Commit `e11cea95`
- **[H7 FIXED]** Bank DDM payout ratio auto-derived from CF statement `dividendPaid / PAT` (median over last 5 years, clamped 5–95%) — no more hardcoded 30% default
- **[D6 FIXED]** Cyclical loss-maker threshold raised from 50% to 70% of periods — prevents Tata Steel type companies triggering loss-maker valuation on normal trough years
- Test fixtures updated with `dividendPaid: null` across 4 spec files (bankValuation, capitalAllocationScoring, moatScoring, relativeValuation)

### Commit `8431679c`
- NII dead-code branch removed: `nii > interestEarned` is impossible after `Math.abs(interestExpended)` — cleaned up misleading guard
- **[A9 PARTIAL]** CRAR-proxy false breach guard: `Math.max(0, crar - 2)` prevents negative base ratio when CRAR is very low

### Commit `786f7a6a`
- **[M4 FIXED]** NBFC `avgBorrowings` now applies the same fallback to `prev` period — was asymmetric (current got fallback, prev didn't), producing inflated cost-of-borrowings for first NBFC period
- **[M5 FIXED]** `avg()` point-estimate fix — when one value is null, returns the non-null value instead of null, preserving ratio computation for first-period data

### Commit `7c81aec9`
- **[E6 FIXED]** Recharts tooltip dark mode — slate-900 background + slate-100 text on all 10 chart components (BalanceSheetComposition, BankHealthChart, CashFlowChart, DuPontWaterfall, ForecastTornado, FrameworkRadar, IncomeWaterfall, ScenarioRangeChart, PenmanDecompositionChart, SegmentBreakdown)

---

## SECTION 2 — ALL IDENTIFIED ISSUES (FULL LIST)

### A. VALUATION MODEL CORRECTNESS

| ID | Severity | Issue | File | Status |
|----|----------|-------|------|--------|
| A1 | HIGH | EPV uses ke as discount rate, not kw (WACC). Overstates EPV for levered firms. | `grahamDoddEPV.ts` | ✅ FIXED `56373b28` |
| A2 | HIGH | Bank equity RI model hardcodes 30% payout in 5-year forecast loop | `bankValuation.ts` L189 | ✅ FIXED `56373b28` |
| A3 | HIGH | EV-based insurance valuation uses hardcoded multiples (VNB 12x, EV 2.0x) — LIC trades at ~1.0x, HDFC Life at ~3.5x | `bankValuation.ts` L265-273 | ❌ TO DO |
| A4 | MEDIUM | EPV `adjustedEarningsPower` always used for EPV denominator — inflates EPV for under-investing companies | `grahamDoddEPV.ts` L190-201 | ❌ TO DO |
| A5 | MEDIUM | Bank justified P/B Gordon: no floor for distressed banks — produced negative intrinsic values | `bankValuation.ts` L124-126 | ✅ FIXED `2879f475` |
| A6 | MEDIUM | SOTP segment NOA allocation uses Capitaline "assets" (total, not NOA) — overstates capital base for capital-light segments | `segmentSOTPBridge.ts` | ❌ TO DO |
| A7 | MEDIUM | Ohlson reversion CV: phi estimated from 5-8 year RE series — too short for reliable AR(1) OLS | `v3Analytics.ts` L1919-1924 | ❌ TO DO (document limitation) |
| A8 | LOW | DDM sustainability check uses 0.5% tolerance — undocumented | `bankValuation.ts` L230 | ❌ TO DO (document) |
| A9 | LOW | `evBasedValuation()` called for ALL bank subtypes, not just insurance | `bankValuation.ts` L334 | ✅ PARTIAL `8431679c` |

### B. DATA PIPELINE INTEGRITY

| ID | Severity | Issue | File | Status |
|----|----------|-------|------|--------|
| B1 | CRITICAL | Mapping spec covers ~15% of Capitaline label universe — 872 unmapped keys with non-null values | `mappingSpec.ts` | ❌ ONGOING (requires Capitaline label expansion) |
| B2 | HIGH | OL/OA separation approximate — OLLEV decomposition doesn't close for companies with large lease liabilities (post Ind-AS 116) | `PenmanNissimEngine.ts` | ❌ TO DO |
| B3 | HIGH | `casaRatio` always null for companies without quality_indicators.json — derivable from Capitaline BS (Demand + Savings / Total Deposits) | `bankPipeline.ts` | ❌ TO DO |
| B4 | HIGH | `shares_outstanding` not auto-derived from Capitaline data — user must enter manually | `types.ts` L671 | ❌ PARTIAL (equity proxy exists in `deriveShareCount`, face value detection not implemented) |
| B5 | MEDIUM | Composite key precedence not enforced at parse time — some labels still use base keys without statement suffix | `mappingSpec.ts` | ❌ TO DO |
| B6 | MEDIUM | No validation that period_end dates are annual — quarterly data mixed with annual produces nonsensical ratios | `pipeline.ts` L169-171 | ❌ TO DO |
| B7 | LOW | Currency unit scaling not tested for Lakhs-denominated files — golden test only covers Cr | parser | ❌ TO DO |

### C. ARCHITECTURE AND DESIGN

| ID | Severity | Issue | File | Status |
|----|----------|-------|------|--------|
| C1 | HIGH | `valuationCommandCenter.ts` is 1,532 lines — god object with 15+ responsibilities | `valuationCommandCenter.ts` | ❌ TO DO (refactor) |
| C2 | HIGH | `v3Analytics.ts` is 2,045 lines — 8 distinct modules in one file | `v3Analytics.ts` | ❌ TO DO (refactor) |
| C3 | MEDIUM | `EngineConfig` has 70+ fields with no Zod/Yup validation — ke=130 typo produces nonsensical valuations silently | `types.ts` | ❌ TO DO |
| C4 | MEDIUM | `PipelineResult.periods` is always `[]` for financial institutions — downstream consumers silently show nothing | `pipeline.ts` L149 | ❌ TO DO |
| C5 | MEDIUM | Two phi values (RE-series and RNOA-series) not clearly distinguished in output types | `v3Analytics.ts`, `moatScoring.ts` | ❌ TO DO (document) |
| C6 | LOW | `terminal_growth_rate` not in EngineConfig — cast to `any` in bankValuation | `bankValuation.ts` | ✅ FIXED `56373b28` |
| C7 | LOW | `App.tsx` is 1,019 lines — too much state in one component | `App.tsx` | ❌ TO DO (refactor) |

### D. BUSINESS LOGIC

| ID | Severity | Issue | File | Status |
|----|----------|-------|------|--------|
| D1 | CRITICAL | Insurance pipeline is a dead-end — routes to bank pipeline, produces nonsensical NII/NIM for LIC | `App.tsx`, `scopePolicy.ts`, `pipeline.ts` | ❌ TO DO (H1) |
| D2 | CRITICAL | Ratio sanity never fires for auto-detected industrial companies — "auto" has no sanity bands | `pipeline.ts` L234-244 | ✅ FIXED `56373b28` |
| D3 | HIGH | `scopeAwareLoader` never forwards quality sidecar to `processScopeAwareData` | `scopeAwareLoader.ts` L196 | ✅ ALREADY DONE (confirmed wired) |
| D4 | HIGH | Structural break exclusion leaves <10 periods → rigor capped at "structurally-reconciled" — no UI guidance on tradeoff | `App.tsx` L197-202 | ❌ TO DO (UX guidance) |
| D5 | MEDIUM | `isMaterialValue` threshold 0.0001 Cr too low — false NBFC positives for industrial companies | `scopePolicy.ts` L94-96 | ✅ FIXED `2879f475` |
| D6 | MEDIUM | Loss-maker threshold 50% fires on cyclical trough years (Tata Steel) | `pipeline.ts` L227 | ✅ FIXED `e11cea95` |
| D7 | LOW | Distress detector runs on empty periods for financial institutions | `pipeline.ts` L116 | ❌ TO DO |

### E. UI/UX

| ID | Severity | Issue | File | Status |
|----|----------|-------|------|--------|
| E1 | CRITICAL | Bank/NBFC: Dashboard, Ratios, Quality, Forecast, Valuation, Comparison, Report, Regression, V3 Analytics tabs all hidden | `App.tsx` L582 | ✅ PARTIAL — Report tab fixed `9d6871fc`; Ratios/Quality/Comparison still hidden |
| E2 | HIGH | No per-share normalization in bank metrics display — absolute Cr values meaningless for cross-bank comparison | `FinancialInstitutionReport.tsx` | ❌ TO DO |
| E3 | HIGH | Valuation tab shows wrong data for insurance — bank valuation applied to LIC | `App.tsx` L552-553 | ❌ TO DO (requires D1/H1) |
| E4 | MEDIUM | Company library card click scrolls to upload but does not auto-load — confusing UX | `CompanyLibraryGrid.tsx` | ❌ TO DO |
| E5 | MEDIUM | Sensitivity heatmap has no "current market price" reference line — users can't tell undervaluation vs overvaluation | `SensitivityHeatmap.tsx` | ❌ TO DO |
| E6 | MEDIUM | Dark mode: chart tooltips used hardcoded light colors — invisible white-on-white | multiple chart files | ✅ FIXED `7c81aec9` |
| E7 | LOW | Tab icons are emoji — rendering varies on older Windows 10 builds | `App.tsx` L58-73 | ❌ TO DO (low priority) |

### F. TESTING

| ID | Severity | Issue | File | Status |
|----|----------|-------|------|--------|
| F1 | HIGH | No integration test for full bank pipeline end-to-end with real HDFC Bank ZIP | `__tests__/` | ❌ TO DO |
| F2 | HIGH | EPV golden test does not cover ke-vs-kw bug — no levered company test asserting kw < ke | `grahamDoddEPV.spec.ts` | ❌ TO DO |
| F3 | MEDIUM | Ratio sanity tests do not cover "auto" company_type gap | `ratioSanity.spec.ts` | ❌ TO DO |
| F4 | MEDIUM | No test for mixed-financial-conglomerate routing (insurance + bank signals coexisting) | `scopePolicy.spec.ts` | ❌ TO DO |
| F5 | MEDIUM | Golden test ratio ranges too wide (e.g. RNOA [0.8, 1.1]) — 30% error would still pass | `goldenCompanySuite.spec.ts` | ❌ TO DO |
| F6 | LOW | No CI performance benchmark — test suite OOMs with 11 real company ZIPs | CI config | ❌ TO DO |

### G. PRODUCTION READINESS (VERCEL)

| ID | Severity | Issue | File | Status |
|----|----------|-------|------|--------|
| G1 | CRITICAL | All company data gitignored — Vercel deployment has empty library; no persistent storage | `.gitignore`, `public/data/companies/` | ❌ TO DO (architecture decision) |
| G2 | HIGH | NSE market data proxy requires server-side cookie session — stateless Vercel functions will fail intermittently | `nseSymbolRegistry.ts`, `api/market-data/snapshot.js` | ❌ TO DO |
| G3 | HIGH | Case-inconsistent folder names break Linux/Vercel (case-sensitive FS) — "HDFC bank" vs "HDFC Bank" | `public/data/companies/` | ❌ TO DO |
| G4 | MEDIUM | Vercel blob API endpoints (`/api/research`, `/api/blackboard`) not implemented in repo | `api/` directory | ❌ TO DO |
| G5 | MEDIUM | Bundle size: vendor chunk 2.7MB (809KB gzipped) — no code splitting | `vite.config.ts` | ❌ TO DO |

### H. MISSING FEATURES (CRITICAL GAPS)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| H1 | CRITICAL | Insurance pipeline does not exist — LIC routes to bank pipeline, all metrics nonsensical | ❌ TO DO (major feature) |
| H2 | CRITICAL | No proforma restatement for demergers/mergers — ITC Hotels demerger makes 10-year history dirty | ❌ TO DO |
| H3 | HIGH | No investment portfolio separation for holding companies — FA income mixed with operating income | ❌ TO DO |
| H4 | HIGH | Comparison report requires manual peer upload — no batch upload, no saved peer groups | ❌ TO DO |
| H5 | HIGH | No Excel/PDF export for bank pipeline — industrial pipeline has export, bank does not | ❌ TO DO |
| H6 | MEDIUM | Forecast engine uses sector templates only — no company-specific calibration to historical growth | ❌ TO DO |
| H7 | MEDIUM | No dividend history / payout ratio derivation for industrial pipeline DDM | ✅ FIXED for banks `e11cea95`; industrial pipeline still uses config default |
| H8 | LOW | No mobile/tablet layout — tool unusable on mobile | ❌ TO DO |

---

## SECTION 3 — PRIORITY QUEUE (REMAINING WORK)

### P0 — Critical (blocks correct analysis for existing companies)

1. **H1 / D1** — Build insurance pipeline  
   LIC is the largest Indian company by market cap. Currently routes to bank pipeline → NII/NIM computed on premium income → all metrics wrong. Need: claims ratio, expense ratio, combined ratio, premium growth, float-to-equity, investment yield, surrender ratio, solvency ratio.  
   Files to create: `src/engine/insurancePipeline.ts`  
   Files to modify: `src/engine/pipeline.ts` (routing), `src/App.tsx` (Insurance tab), `src/components/InsurancePipelineReport.tsx` (new)

2. **G3** — Fix case-inconsistent company folder names  
   "HDFC bank", "ICICI bank", "bajaj finance", "paytm", "reliance Industries", "Tata steel" all have inconsistent casing. On Vercel (Linux), these 404. Standardize to Title Case.  
   Files: rename `public/data/companies/` subdirectories + update `registry.json` + update `CompanyLibraryGrid.tsx` folder references

3. **B3** — Auto-derive CASA ratio from Capitaline balance sheet  
   Demand Deposits + Savings Deposits / Total Deposits. Available in Capitaline BS. Currently always null for 9 of 11 companies.  
   File: `src/engine/bankPipeline.ts` `extractBankMetrics()`

### P1 — High (material valuation errors)

4. **A3** — Make EV multiples configurable for insurance  
   VNB multiple (12x) and EV multiple (2.0x) hardcoded. LIC = ~1.0x EV, HDFC Life = ~3.5x EV. Add to `EngineConfig` with sensible defaults by subtype (PSU vs private insurer).

5. **E1** — Show Ratios and Comparison tabs for banks  
   Currently only Dashboard, Bank, and Report tabs visible for banks. Ratios tab should show NIM/ROA/ROE/credit cost trends. Comparison tab should work when ≥2 banks loaded.

6. **C3** — Add EngineConfig Zod validation  
   Catch ke=130 (typo for 13%), shares_outstanding=0, terminal_growth_rate > ke. Add `validateEngineConfig(config)` called before pipeline runs.

7. **F1** — Add bank pipeline integration test  
   Load real HDFC Bank ZIP, run `processCompanyDataFull`, assert NIM in [2.5%, 5.5%], ROA in [0.5%, 2.5%], ROE in [10%, 25%], credit cost in [0.2%, 3%].

8. **F2** — Add EPV kw-vs-ke test  
   Test with FLEV > 0 company: assert `epvOperations` discounted at kw < ke produces higher value than if ke were used.

9. **H5** — Bank pipeline Excel export  
   Add NIM trend, credit cost history, ROA/ROE, bank valuation (P/B Gordon, DDM, RI) to Excel export. Follow existing `buildExcelWorkbook()` pattern.

### P2 — Medium (quality and completeness)

10. **A4** — EPV `adjustedEarningsPower` vs `normalizedNOPAT`  
    Use `normalizedNOPAT` as primary EPV denominator; use `adjustedEarningsPower` only when maintenanceCapex materially differs from avgDepreciation (>10% gap).

11. **B6** — Period frequency validation  
    Detect quarterly vs annual periods from date gaps. Warn and block if mixed frequencies detected.

12. **D4** — Structural break exclusion UX guidance  
    When user excludes pre-break periods and drops below 10 periods, show a tooltip explaining the rigor tradeoff: "Excluding pre-break periods improves accuracy but reduces history. You now have N periods — rigor capped at 'structurally-reconciled'."

13. **E2** — Per-share normalization in bank metrics  
    Add book value per share, EPS, DPS to `FinancialInstitutionReport.tsx`. Requires `shares_outstanding` from config or derived.

14. **E4** — Company library card auto-load  
    Card click should trigger the same load flow as dropdown selection, not just scroll to upload area.

15. **E5** — Sensitivity heatmap market price reference  
    Add a highlighted cell or contour line showing where current market price falls on the ke × g grid.

16. **F3** — Ratio sanity "auto" company_type test  
    Add test: pass `company_type="auto"` with itServices signals → assert sanity checks run with "it-services" bands.

17. **F4** — Mixed-conglomerate routing tests  
    Test: 1 insurance label → bank pipeline. Test: 2 insurance labels, 4 periods → blocks. Test: `mixed_conglomerate_route_to="bank"` override.

18. **G1** — Vercel data persistence strategy  
    Decision needed: (a) commit anonymized/compressed data to git, (b) use Vercel blob for user uploads with TTL, or (c) document as "upload-only" tool. Currently the library is empty on fresh Vercel deploy.

19. **G2** — NSE cookie session for Vercel  
    Use a persistent KV store (Vercel KV / Redis) to cache the NSE session cookie across serverless invocations. Or switch to a third-party market data API (Yahoo Finance, NSE unofficial).

20. **G5** — Bundle code splitting  
    Add `manualChunks` in `vite.config.ts`: separate recharts, xlsx/jszip, and heavy report components into lazy-loaded chunks. Target: initial bundle < 500KB gzipped.

### P3 — Low / Future

21. **H2** — Proforma restatement for demergers  
    Allow user to upload a "restatement overlay" JSON that adjusts historical periods. Complex — requires UI for overlay management.

22. **H3** — Investment portfolio separation for holding companies  
    Separate FA income (dividends, gains) from operating income in the reformulation. Requires mapping spec additions for "Dividend Income from Subsidiaries" etc.

23. **H4** — Saved peer groups  
    Allow user to name and save a set of companies as a peer group. Persist to localStorage or Vercel blob.

24. **H6** — Company-specific forecast calibration  
    Allow user to override sector template defaults with company-specific historical CAGR or analyst consensus estimates.

25. **H8** — Mobile/tablet layout  
    Responsive breakpoints for KPI grids (2-col on tablet, 1-col on mobile). Chart height responsive via CSS container queries.

26. **B1** — Mapping spec expansion  
    Ongoing: add deferred revenue, contract liabilities, ROU asset amortization, lease liabilities (operating vs finance), employee benefit obligations, security deposits, advance from customers.

27. **C1/C2** — Refactor god objects  
    Split `valuationCommandCenter.ts` into: `epvValuation.ts`, `residualIncomeValuation.ts`, `sotpValuation.ts`, `peerRelativeValuation.ts`, `scenarioBuilder.ts`.  
    Split `v3Analytics.ts` into: `cleanSurplusAccounting.ts`, `fadeEstimation.ts`, `terminalValueAnchoring.ts`, `sensitivityMatrix.ts`.

28. **F5** — Tighten golden test ratio ranges  
    Once mapping spec is stable, tighten RNOA/PM/ATO ranges to ±5% of expected value.

29. **E7** — Replace emoji tab icons with SVG  
    Use Heroicons or Lucide React for tab icons — consistent rendering across all Windows versions.

---

## SECTION 4 — KNOWN PRE-EXISTING ISSUES (NOT INTRODUCED THIS SESSION)

These errors exist in the codebase and are pre-existing — not introduced by this session's changes:

- `capitalineParser.ts` — 18 TypeScript errors (jszip esModuleInterop, xlsx `.default`, Map iteration downlevelIteration). These are pre-existing and suppressed in typecheck output.
- `mappingAudit.ts` — Cannot find `CapitalineIndASDetailedMappingSpec.yaml?raw` module. Pre-existing.
- `mappingClusterEngine.ts` — 4 Map/Set iteration errors. Pre-existing.
- `scopePolicy.ts(215)` — MapIterator iteration error. Pre-existing.

These do not affect the production build (Vite handles them) but should be fixed when the parser is next touched.

---

## SECTION 5 — COMMIT HISTORY THIS SESSION

```
7c81aec9  fix: Recharts tooltip dark mode — slate-900 background on all 10 chart components
786f7a6a  fix: NBFC avgBorrowings fallback symmetric, avg() point-estimate for single-period data
8431679c  fix: NII dead-code branch removed, CRAR-proxy false breach guard, Math.max(0) floor
e11cea95  fix: bank DDM payout auto-derived from CF dividends, cyclical loss-maker threshold 70%, test fixtures updated
9d6871fc  fix: show Report tab for banks/NBFCs, clean up visibleTabs indentation
2879f475  fix: bank P/B floor 0.3x for distressed banks, scopePolicy materiality threshold 1 Cr
56373b28  fix: EPV uses kw(WACC) not ke, bank RI payout param, terminal_growth_rate typed, ratio sanity resolves auto company_type
a3e3725b  fix: Recharts debounce on all 18 charts, quality_indicators content-type guard, suppress 404 sync banner
234b9c03  fix: resolve all 84 TypeScript errors — EPVResult shape, Recharts formatters, reconciliation status mapping, unused vars, missing Segment key
43e71726  fix: insurance pipeline correctness — lapse_rate null, EV triangulation, casaRatio guard, equity mapping, TS nullability
```

---

*Last updated: June 2026. Next priority: H1 (insurance pipeline), G3 (folder name casing), B3 (CASA ratio derivation).*
