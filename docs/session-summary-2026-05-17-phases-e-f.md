# Session Summary — 2026-05-17 (Phases E1/E2/F/F2 — Company-Type Overlays)

Continuation of the 2026-05-17 session, after Phases I7/I8/I9/I10.
Tackled company-type-specific analysis improvements for IT-services
and cyclical companies.

## Shipped (6 commits, 634 tests, build clean)

### Phase E1 — IT-services detector

- **`c021d32`** feat(engine): Phase E1
  - `itServicesDetector.ts` — `detectITServices(periods)` → `ITServicesSignal`
  - Two-fingerprint detection: employee cost > 40% of revenue AND
    PPE < 10% of total assets (both must hold in the median period)
  - Returns `medianEmployeeCostRatio`, `medianPPERatio`, `reason`,
    `periodsAnalysed`
  - Graceful degradation: null ratios when data absent, false when < 2 periods
  - `PipelineResult.itServices: ITServicesSignal | null`
  - App.tsx blue advisory banner when `isITServices=true`: explains why
    RNOA/ATO decomposition is less meaningful, directs user to revenue
    growth, margin trend, FCFE yield, employee cost ratio instead
  - 14 tests: TCS-shaped fixture, ITC-shaped fixture, empty/single period,
    missing bridge, zero sales, borderline thresholds, high-employee+high-PPE

### Phase E2 — employeeCostRatio in Ratios

- **`793aba2`** feat(ratios): Phase E2
  - `Ratios.employeeCostRatio: number|null` — employee cost as fraction
    of revenue. Computed in `computeRatios` from `operatingCostBridge`.
  - 22 test fixture files updated with `employeeCostRatio: null`
  - `RatioReport.tsx` — "Employee Cost / Revenue" row added in PM/ATO
    section, directly below Core Sales PM. For TCS/Infosys shows 50-55%.

### Phase F — Wire cyclicality detector into pipeline + UI

- **`dae826e`** feat(engine): Phase F
  - `cyclicalityDetector.ts` was fully implemented but orphaned.
  - `PipelineResult.cyclicality: CyclicalityAssessment | null`
  - `assessCyclicality(results)` called at end of industrial pipeline
  - App.tsx orange banner when `cyclical-peak`: warns valuation will
    overstate intrinsic value; shows latest vs median metric
  - App.tsx sky-blue banner when `cyclical-trough`: warns valuation will
    understate; same metric display
  - Both banners show the reason string from `assessCyclicality`

### Phase F2 — Cycle-normalised terminal RE anchor

- **`bb00c41`** feat(valuation): Phase F2
  - `ValuationReport.tsx`: `cyclicalTerminalREAnchor` memo — when
    `cyclicalNormalization.cyclical=true`, scales `lastRE` by
    `(medianRNOA / latestRNOA)` so CV3 terminal anchor reflects
    mid-cycle earnings rather than peak/trough
  - `computeValuation` called with `cyclicalTerminalREAnchor` as the
    `terminalREAnchor` param (already existed in the function signature,
    was never populated from cyclicality before)
  - Null-safe: anchor is null when RNOA values are missing/zero or
    company is not cyclical — falls back to as-reported lastRE
  - Effect: Tata Steel at peak (FY22 25%+ EBITDA margin) now produces
    a CV3 intrinsic value anchored on the 10Y median margin

### Phase I3 — Wire loss-maker valuation into pipeline + UI

- **`17e0365`** feat(pipeline): Phase I3
  - `lossMakerValuation.ts` was fully implemented but orphaned.
  - `PipelineResult.lossMaker: LossMakerValuationResult | null`
  - `ValuationReport.tsx` — new "Loss-Maker Valuation Anchors" section:
    revenue KPI grid, revenue multiple card, reverse-DCF card,
    path-to-profitability checklist with GREEN/AMBER/RED badge

## Validation status

- `npm run typecheck`: clean
- `npm run validate` (typecheck + tests + build): clean
- 634 tests passing across 81 test files
- All commits pushed to `origin/main`

## Patterns established this session

- **Orphan modules wired** — `lossMakerValuation.ts`, `cyclicalityDetector.ts`,
  `itServicesDetector.ts` were all fully implemented but never called from
  the pipeline. This session closed all three loops. Pattern: always check
  if a module is actually wired into `PipelineResult` before assuming it works.

- **Advisory banners, not blockers** — IT-services and cyclicality detections
  are advisory. The industrial pipeline still runs; the UI explains the
  limitation. Same pattern as distress (Phase J) and screening mode (Phase I8).

- **Cycle-median as terminal anchor** — `terminalREAnchor` param in
  `computeValuation` was designed for this use case but never populated.
  The wiring is now in `ValuationReport.tsx` via `cyclicalTerminalREAnchor`.

## Remaining work

1. **B5.5** — Vision-LLM extractor for HDFC/ICICI/SBI/Kotak
   `quality_indicators.json`. See `docs/bank-quality-indicators-design.md`.
2. **Phase E3** — IT-services: skip RNOA/ATO decomposition in moat scorer
   when `isITServices=true`; replace with PE + FCFE focus.
3. **Phase F3** — Cyclical: wire `cyclicalNormalization.normalizedMargin`
   as the terminal margin anchor in the forecasting engine (currently only
   wired in ValuationReport CV3).
4. **Phase C5** — Mixed-conglomerate routing: Reliance, ICICI Bank with
   insurance/AMC subsidiaries. Currently fail-closes.
