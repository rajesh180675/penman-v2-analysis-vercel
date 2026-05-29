# Session Summary — 2026-05-16 (Phase 3)

## What We Accomplished

### Phase 3: New Valuation Frameworks (4 commits)

| # | Commit | What |
|---|--------|------|
| 1 | Bank mapping via mappingSpec | `bankPipeline.ts` rewritten — all label lookups now delegate to `CapitalineMappingSpec.bankBalanceSheet` / `bankProfitLoss`. Eliminated parallel `BANK_METRIC_KEYS` object. `mappingSpec.ts` bank sections expanded with `totalAssets`, `totalEquity`, `advances`, `deposits`, `borrowings`, `cashAndBalanceWithRBI`, `interestExpended`, `otherIncome`, `operatingExpenses`, `provisions` — single source of truth. |
| 2 | Graham-Dodd EPV | New `grahamDoddEPV.ts` (330 lines). Industrial EPV: normalize CoreOI margin (median, trimmed for 7+ periods), NOPAT = normalizedCoreOI × (1 − medianTaxRate), EPV = NOPAT / WACC. Asset value = NOA. Franchise value = EPV − V_A. Interpretations: strong-franchise / franchise / competitive / depressed-earnings. Bank EPV: equity-based, normalized ROE × book value / ke. 3×3 sensitivity grid. 23 tests. |
| 3 | Relative valuation | New `relativeValuation.ts` (280 lines). Industrial: PE, EV/CoreOI, PB, PS with historical bands (min/median/max), currentPercentile, premiumToSector, impliedFairValue. Bank: PB, PE, Price/NII. Composite implied fair value = median of sector-implied values. `multiplePositionLabel()` and `multipleSignal()` helpers. 27 tests. |
| 4 | Scope-aware loader | New `scopeAwareLoader.ts` (310 lines). Runs consolidated + standalone through pipeline, aligns periods, computes subsidiary contribution (absolute + % of consolidated) for Sales, PAT, CoreOI, CSE, NOA, CFO. Trend detection (growing/stable/shrinking). `validateSOTPAgainstSubsidiaryContribution()` cross-checks SOTP subsidiary allocation vs observed financial gap. 17 tests. |

### Test Status

- **321 tests, 62 test files — all passing**
- New tests: grahamDoddEPV (23), relativeValuation (27), scopeAwareLoader (17)
- Golden tests still pass: ITC + Asian Paints

---

## Current State of the Project

### Architecture (updated)

```
Raw Capitaline HTML (.xls)
    │
    ├── capitalineParser.ts ──── Universal parser (BS/PL/CF)
    ├── segmentParser.ts ─────── Segment finance parser
    └── scopeDetection.ts ────── Consolidated/Standalone detection
         │
         ▼
    scopePolicy.ts ──── Company type detection (signal-based)
         │
         ├── Industrial ──► PenmanNissimEngine.ts ──► v3Analytics.ts ──► 9 models + Ohlson CV
         │                                            ├── segmentSOTPBridge.ts ──► SOTP
         │                                            ├── grahamDoddEPV.ts ──► EPV + franchise value
         │                                            └── relativeValuation.ts ──► PE/PB/EV bands
         │
         └── Bank/NBFC ──► bankPipeline.ts ──► NII, NIM, ROA, credit cost
                                               ├── grahamDoddEPV.ts ──► bank EPV (ROE-based)
                                               └── relativeValuation.ts ──► PB/PE/Price-NII

scopeAwareLoader.ts ──── Consolidated + Standalone → subsidiary contribution
```

### Files Created This Session

| File | Lines | Purpose |
|------|-------|---------|
| `src/engine/grahamDoddEPV.ts` | 330 | Graham-Dodd EPV: industrial + bank, sensitivity grid |
| `src/engine/relativeValuation.ts` | 280 | PE/PB/EV-EBITDA historical bands, sector comparison |
| `src/engine/scopeAwareLoader.ts` | 310 | Consolidated+standalone alignment, subsidiary contribution |
| `src/engine/__tests__/grahamDoddEPV.spec.ts` | 200 | 23 EPV tests |
| `src/engine/__tests__/relativeValuation.spec.ts` | 260 | 27 relative valuation tests |
| `src/engine/__tests__/scopeAwareLoader.spec.ts` | 170 | 17 scope-aware loader tests |

### Files Modified This Session

| File | Change |
|------|--------|
| `src/engine/bankPipeline.ts` | Rewrote to use mappingSpec instead of hardcoded BANK_METRIC_KEYS |
| `src/engine/mappingSpec.ts` | Expanded bankBalanceSheet + bankProfitLoss sections (30 → 50 labels) |

---

## What's Left To Do

### Phase 4: Data Breadth & UI

1. **Multi-standard stitching** — Ind-AS + Revised Sch-VI + Old GAAP for 15+ year history. Capitaline exports exist in 3 formats (header says "Balance Sheet IND" / "Balance Sheet REV" / no suffix). Need standard-aware label aliases and period merging.

2. **Quarterly data** — TTM computation, seasonality detection, recent trend. Capitaline quarterly exports have same HTML format. Only last 5-8 years available.

3. **Economic moat scoring** — ROIC persistence over 10Y, competitive advantage period (CAP) estimation, moat width classification (wide/narrow/none).

4. **Capital allocation scoring** — dividend policy consistency, buyback quality, reinvestment ROIC vs cost of capital.

5. **Monte Carlo integration** — wire segment-level uncertainty (EBIT share variance) into existing MC module.

6. **UI views** — bank dashboard tab, SOTP waterfall chart, segment comparison charts, EPV vs RE triangulation panel.

### Phase 5: Later

7. **Insurance pipeline** — embedded value, solvency, persistency
8. **Real estate/holding company** — NAV model, stake valuation
9. **Peer group engine** — auto-select peers by sector + size
10. **PDF report generation** — formatted investment memo

---

## Important Decisions & Context

1. **Bank mapping is now single-source** — `CapitalineMappingSpec.bankBalanceSheet` / `bankProfitLoss` is the only place bank label aliases live. `bankPipeline.ts` reads from it directly.

2. **EPV uses conservative WACC** — 80% equity weight × ke + 20% debt weight × kd_aftertax. Proper kw from `deriveKwFromStructure` can replace this when capital structure data is available.

3. **Relative valuation uses recast data** — CoreOI (not EBITDA), CSE (not book value from raw), NOA (not total assets). Consistent with Penman-Nissim reformulation.

4. **Scope-aware loader is additive** — it calls `processCompanyDataFull()` twice (consolidated + standalone) and aligns results. No changes to the core pipeline.

5. **Subsidiary contribution validates SOTP** — `validateSOTPAgainstSubsidiaryContribution()` cross-checks SOTP subsidiary allocation % against the observed consolidated-standalone PAT gap. Flags divergence > 20pp.

6. **321 tests, all green** — golden suite (ITC + Asian Paints) still passes after all changes.

---

## Git Log (this session)

```
1b8b641 feat: scope-aware data loader — consolidated+standalone alignment, subsidiary contribution analysis
47857f3 feat: Phase 3 — Graham-Dodd EPV, relative valuation, bank mapping via mappingSpec
3e4128f docs: session summary 2026-05-16
```

All pushed to `main` on `https://github.com/rajesh180675/penman-v2-analysis-vercel.git`.
