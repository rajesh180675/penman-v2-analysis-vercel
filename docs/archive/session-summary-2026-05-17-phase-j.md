# Session Summary — 2026-05-17 (Phase J — Negative Net Worth Handling)

Continuation of the 2026-05-17 session. Tackled item #4 from the
"still to ship" list — fail-closed handling for distressed companies
with negative net worth, using Vodafone Idea as the canonical fixture.

## Shipped (5 commits, 506 tests, build clean)

### Phase J1 — Financial distress detector

- **`77ac48a`** feat(distress): Phase J1 — financial distress detector
  - `distressDetector.ts` — pure function over `RecastPeriod[]`:
    - `severity`: none / warning / severe / critical
    - `equityModelsBlocked` convenience flag
    - `negativeEquityPeriods`, `latestCSE`, `latestNFO`, `latestCFO`,
      `runwayYearsAtCFOBurn`, `reasons[]`
  - Severity ladder:
    - **warning**: isolated negative-equity period in history, latest CSE positive
    - **severe**: latest CSE ≤ 0 OR ≥2 consecutive negative-equity periods
    - **critical**: severe + ≥3 consecutive + latest CFO ≤ 0
  - Wired into `PipelineResult.distress`; emitted on every code path
  - 11 unit tests including Vodafone-shaped fixture and boundaries

### Phase J2 — Fail-closed equity-side valuation

- **`349a38c`** feat(valuation): Phase J2 — fail-closed equity-side valuation
  - `computeValuation` gains `equityModelsBlocked` / `equityBlockedReason`
  - When latest CSE ≤ 0:
    - `V_RE_CV1` / `V_RE_CV2` / `V_RE_CV3` set to `null`
    - `V_no_growth` / `growthValue` / `growthFraction` set to `null`
    - per-share RE / DDM / AEG / FCFE intrinsic + implied PB / PE / MOS / impliedGrowth all skipped
    - **Enterprise-side** `V_ReOI_CV01/02/03` continue to publish (anchor on NOA/NFO, not CSE)
  - Type ripple: `ValuationResult.V_RE_CV*: number | null`
  - Updated callers: `baselineGuardrails`, `regressionHarness`, `monteCarloWorker`,
    `forecastingEngine`, `ValuationReport`, `AcademicReport`, `ComparisonReport`,
    `ForecastReport`, `RegressionReport`, `V3AnalyticsPanel`
  - `ValCard` now accepts nullable `value` and renders skip-with-reason
    amber card when blocked
  - `negativeEquityValuation.spec.ts` — 3 tests pinning the contract

### Phase J3 — UI distress banners

- **`1cc8759`** feat(ui): Phase J3 — surface distress signal in valuation reports
  - `ValuationReport`: top-of-report distress banner with severity-aware styling
    (red for critical, amber-strong for severe, amber-light for warning)
  - Each reason rendered as a bullet so reviewers see the full picture
  - Equity-blocked banners include guidance line pointing to enterprise-side anchors
  - `V3AnalyticsPanel`: distress banner first in the existing robustness banner
    stack (alongside cyclicality, moat, capalloc, structural-breaks, loss-maker)
  - New `danger` tone (red) for critical severity

### Phase J4 — Loss-maker valuation correctness for net-debt firms

- **`63bfcf8`** fix(loss-maker): Phase J4 — correct equity value for net-debt distressed firms
  - **Bug 1**: `equityValueCr = impliedEVCr - max(0, NFO) + (-NFO)` double-deducted
    debt for net-debt names. Fix: `equity = EV - NFO` (single, polarity-correct).
    Worked accidentally on net-cash names (Paytm, Zomato) before.
  - **Bug 2**: `cashPerShare` and `runwayYears` used `-NFO` unconditionally,
    producing negative values for net-debt firms. Fix: gate `netCashCr` on
    `NFO < 0`; null cash-per-share and runway when not in a net-cash position.
  - 2 new tests: Vodafone Idea fixture (net-debt) + Paytm-shape regression (net-cash)

### Phase J5 — Distress gates rigor ladder advancement

- **`3d2bb9c`** feat(rigor): Phase J5 — distress gates valuation-eligible
  - `analysisTraceability.buildAnalysisTraceability` runs `detectDistress`
    alongside reconciliation residual evaluation
  - Critical or severe distress blocks `valuation-eligible` advancement even
    when reconciliation is clean and analysis status is not "guarded"
  - Warning-only distress does not block (latest CSE is healthy)
  - Blocked checkpoint's `detail` string explains the distress-driven block
  - 3 tests in `distressRigorGate.spec.ts`

## Validation status

- `npm run typecheck`: clean
- `npm run validate` (typecheck + tests + build): clean
- 506 tests passing across 75 test files (up from 498 at session start)
- All commits pushed to `origin/main`

## What this enables now

| Company           | Before                                    | After                                                |
|-------------------|-------------------------------------------|------------------------------------------------------|
| Vodafone Idea     | V_RE deeply negative, misleading numbers  | Skip-with-reason; enterprise-side V_ReOI publishes   |
| Distressed PSUs   | Same broken equity valuations             | Same fail-closed contract                            |
| Suzlon-class      | (any negative-net-worth firm)             | Distress banner + rigor gate                         |
| ITC / TCS / etc   | No regression                             | Same as before                                       |

## Patterns established this session

- **Severity ladder** (none / warning / severe / critical) becomes the
  template for any future "distress signal" detector. Severe and above
  block downstream models; warning is informational.

- **Polarity-correct enterprise math** — `equity = EV - NFO` works for
  both net-cash (NFO < 0) and net-debt (NFO > 0) firms. Splitting on
  polarity is a code smell that produces double-counting bugs (J4).

- **Equity-side vs enterprise-side separation** — when equity-side
  models fail, enterprise-side (V_ReOI, FCFF, segment SOTP, EV-based
  comparables) remains valid. Surface this distinction in skip messages
  so users know which anchors to trust.

- **Rigor-ladder gating from runtime signals** — `analysisTraceability`
  now consumes a runtime detector to decide ladder advancement, not just
  static config or upload-time metadata. This is the right place for
  signals that can only be known after recast (segment cyclicality,
  distress, structural breaks, etc).

## What's still to ship (from May 17 list, updated)

In rough priority order:

1. **NBFC-specific metrics** — Bajaj Finance currently routes through bank
   pipeline but CASA/deposits/cost-to-income don't apply.
2. **Currency/unit auto-detection** — Capitaline normally emits in Cr but
   some files use lakhs or absolute. Header parser today assumes Cr.
3. **Single-period uploads** — Currently might run with degenerate output.
   Should produce a "screening only" mode with explicit caveats.
4. ~~**Negative book value**~~ — **DONE Phase J**
5. **Demerger / M&A detection** — Partially shipped via structural-breaks
   (Phase I); could be tightened with explicit operator confirmation flow.
6. **Insurance pipeline (Phase E)** — LIC fail-closes correctly today.
   Building a real insurance pipeline is a multi-week investment.
7. **Phase B5 — Bank quality flags** — NPA cycle position, deposit
   franchise stability, loan growth vs system credit growth.
