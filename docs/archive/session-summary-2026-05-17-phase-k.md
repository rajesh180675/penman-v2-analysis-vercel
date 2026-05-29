# Session Summary — 2026-05-17 (Phase K — NBFC-Specific Metrics)

Continuation of the 2026-05-17 session, immediately after Phase J.
Tackled item #1 from the "still to ship" list — NBFC-native metrics so
Bajaj Finance and similar non-bank lenders are no longer forced through
the bank framing.

## Shipped (2 commits, 516 tests, build clean)

### Phase K1 — Engine: subtype-aware extraction & ratios

- **`44d42b3`** feat(nbfc): Phase K1 — NBFC-specific metrics and subtype-aware ratios
  - `BankPeriodMetrics` extended:
    - **Raw funding mix**: `nonConvertibleDebentures`, `termLoansFromBanks`,
      `termLoansFromInstitutions`, `termLoansFromOthers`
    - **Derived NBFC metrics**: `leverage` (Borrowings/Equity),
      `costOfBorrowings`, `yieldOnAdvances`, `spread` (yield − cost),
      `debtMix` (NCD/bank/institution/other shares of borrowings)
  - `computeBankRatios(current, prev, subtype)` now branches:
    - **NBFC framing**: NIM denominator is advances-only (no SLR
      investments to dilute it); spread/yield/cost/leverage/debtMix
      computed
    - **Bank framing**: existing NIM-on-earning-assets preserved;
      NBFC-specific fields stay null
  - `processBankData` resolves subtype first, threads it through
  - `bankMetrics` added to `FinancialInstitutionAnalysisResult` so UI/
    test consumers can read the full per-period metrics, not just the
    snapshot
  - `mappingSpec.bankBalanceSheet.advances` extended with
    `Loan Assets`, `Finance Receivables`, `Hire Purchase Assets`,
    `Lease Assets` so NBFC loan books are picked up regardless of label
  - `nbfcPipeline.spec.ts` — 10 unit tests using a Bajaj Finance-shaped
    fixture (FY23-FY25 silhouette in ₹Cr); existing test fixtures
    updated to include the new nullable fields

### Phase K2 — UI: surface NBFC metrics in FinancialInstitutionReport

- **`78573c2`** feat(ui): Phase K2 — surface NBFC metrics in FinancialInstitutionReport
  - New `NbfcMetricsSection` rendered only when subtype is `nbfc` and
    `bankMetrics` is present
  - **KPI grid** (latest snapshot): Leverage, Yield, Cost, Spread —
    spread renders red when negative (canonical NBFC distress signal)
  - **Trend table**: Leverage, Yield, Cost, Spread, NIM*, Credit Cost,
    ROE per period; footnote explains advances-only NIM denominator
  - **Debt mix grid**: NCDs / Bank Loans / Institutions / Others as
    percentage bars; footnote explains residual to commercial paper
  - Replaces the previous inline "NBFC caveat" under period snapshots,
    which is now redundant

## Validation status

- `npm run typecheck`: clean
- `npm run validate` (typecheck + tests + build): clean
- 516 tests passing across 75 test files (up from 506 at K start)
- All commits pushed to `origin/main`

## What this enables now

| Metric              | Bank framing (HDFC/ICICI)             | NBFC framing (Bajaj Finance, etc.)      |
|---------------------|----------------------------------------|------------------------------------------|
| NIM denominator     | Advances + Investments (incl. SLR)     | Advances only                            |
| Funding lens        | Deposits, CASA, cost-to-deposits       | Borrowings, NCD/loan mix, cost-of-debt  |
| Gearing             | Capital adequacy ratio (regulatory)    | Borrowings/Equity (leverage multiple)    |
| Margin lens         | NII / Avg Earning Assets                | Yield − Cost = Spread                    |
| Distress signal     | NPA cycle, NIM compression             | Spread compression, leverage spike       |

## Patterns established this session

- **Subtype-aware ratio computation** — `computeBankRatios` now takes a
  `subtype` parameter and branches its math accordingly. This is the
  template for any future financial-institution refinement (insurance,
  housing finance company, infrastructure lender), each of which has
  its own native framing.

- **Common-shape, divergent-meaning** — the `BankPeriodMetrics` type
  carries both bank-specific (CASA, NIM-on-earning-assets) and
  NBFC-specific (leverage, spread, debt mix) fields. Subtype gates which
  fields are populated; UI gates which fields are surfaced. No
  separate-shape proliferation, no mass-extension of unions.

- **Polarity-correct expressions** — for fields that can be either-sign
  (NFO, spread), check the sign explicitly rather than wrapping with
  `Math.max(0, ...)` and adding a sign-flipped term elsewhere. The
  Phase J4 loss-maker bug was a textbook example; J/K together
  established this as the house style.

## What's still to ship (from May 17 list, updated)

In rough priority order:

1. ~~**NBFC-specific metrics**~~ — **DONE Phase K**
2. **Currency/unit auto-detection** — Capitaline normally emits in Cr but
   some files use lakhs or absolute. Header parser today assumes Cr.
3. **Single-period uploads** — Currently might run with degenerate output.
   Should produce a "screening only" mode with explicit caveats.
4. ~~**Negative book value**~~ — **DONE Phase J**
5. **Demerger / M&A detection** — Partially shipped via structural-breaks
   (Phase I); could be tightened with explicit operator confirmation flow.
6. **Insurance pipeline (Phase E)** — LIC fail-closes correctly today.
7. **Phase B5 — Bank quality flags** — NPA cycle position, deposit
   franchise stability, loan growth vs system credit growth.
