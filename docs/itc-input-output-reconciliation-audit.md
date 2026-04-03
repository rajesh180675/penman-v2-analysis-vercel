# ITC Input / Output Reconciliation Audit

## Run audited

- Company: `ITC`
- Run ID: `243da112-8772-4c74-adda-b132017600c8`
- Source mode: `capitaline`
- Input blob: `audit-runs/243da112-8772-4c74-adda-b132017600c8/inputs/financiall data.zip`
- Output artifact: `audit-runs/243da112-8772-4c74-adda-b132017600c8/artifacts/institutional_workbook_2025-03-31.xlsx`

## Input artifact inspection

The persisted input ZIP was fetched from audit storage and decoded successfully.

Contained files:
- `BalanceSheetINDAS_.xls`
- `CashFlow_.xls`
- `ProfitLossINDAS_.xls`

This confirms the live run was based on a full three-statement Capitaline input package, not a partial upload.

## Analysis snapshot reconciliation

The live `analysis-snapshot` payload reconciles with the input artifact operationally:

- `companyId`: `ITC`
- `periodCount`: `15`
- first period: `2011-03-31`
- latest period: `2025-03-31`
- `rawData_count`: `15`
- `recastData_count`: `15`
- duplicate period ends: `0`

Latest-period derived output from the audited run:
- `Sales`: `75323.34`
- `CNI`: `34427.62`
- `OI`: `33047.49564842496`
- `UOI`: `15668.43`
- `ExceptionalItemsAfterTax`: `16293.29`
- `dirty_surplus`: `-21122.35`
- `cash_conversion_ratio`: `0.5334`

Latest-period terminal flags:
- `STRUCTURAL_EVENT`
- `CAPITAL_TRANSACTION_LIKELY`
- `PM_OUTLIER_CRITICAL`
- `ROCE_OUTLIER_CRITICAL`
- `RNOA_OUTLIER_CRITICAL`
- `INCREMENTAL_MARGIN_ANOMALY`
- `LARGE_PPE_DECLINE`

## Workbook artifact inspection

Workbook sheets observed:
- `Cover`
- `Recast Statements`
- `N&P Ratios`
- `Valuation`
- `Quality Scores`
- `Provenance Audit`
- `Mapping Discrepancies`

Important observations from the persisted workbook:

### Cover sheet
- `Company` was exported as `—`
- `Periods Analysed` was `15`
- valuation assumptions were shown normally

### Valuation sheet
The workbook still rendered full valuation outputs, including:
- `RE (CV3 — Gordon Growth)`
- `ReOI (CV03 — Gordon Growth)`
- `FCFF`
- `FCFE`

This happened despite the latest period carrying multiple severe terminal contamination flags.

### Provenance / discrepancy sheets
These were present and useful, but the discrepancy output still includes alias-noise style unmatched rows that do not necessarily indicate a real failed mapping.

## Core mismatch identified

Structural parsing succeeded.

But the economic trust layer was inconsistent:
- the run correctly detected severe latest-period abnormalities,
- yet the live run reported `quality_tier = Tier 1` and `valuation_blocked = false`,
- and the workbook exported full valuation outputs instead of visibly suppressing them.

This is the key ITC issue.

It is not a parser failure.
It is a valuation-gating failure.

## Root cause

Before the fix, `evaluateQualityGate()` in `src/engine/mappingAudit.ts` only used raw-data coverage and mapping gaps to decide `valuationBlocked`.
It did **not** incorporate `resolveValuationReadiness()` from the recast/anomaly layer.

That created a split-brain state:
- recast/anomaly logic knew the latest period was unsafe for terminal valuation,
- quality-gate logic still reported valuation as not blocked,
- workbook export then rendered valuation sheets as if the run were valuation-eligible.

## Fix implemented

### 1. Quality gate now incorporates valuation readiness

`src/engine/mappingAudit.ts`
- `evaluateQualityGate(...)` now accepts `recastPeriods`
- it calls `resolveValuationReadiness(recastPeriods)` when available
- if valuation readiness is `guarded`, `valuationBlocked` is now set to `true`
- the guarded-anchor reason is added to `blockingReasons`

### 2. Call sites now pass recast periods

Updated to thread recast periods into the quality gate:
- `src/App.tsx`
- `src/components/AcademicReport.tsx`
- `src/engine/goldenCompanySuite.ts`

### 3. Guarded workbook exports now suppress valuation outputs

`src/engine/excelExport.ts`
- when workbook metadata has `valuationStatus: "guarded"`, the Valuation sheet now suppresses full model outputs
- sensitivity grids and reverse-DCF sections are also suppressed
- the sheet explicitly states that valuation is guarded because the latest period is not safe for terminal-value work

This prevents a contaminated run from exporting persuasive but weak valuation numbers as if they were production-safe.

## Expected post-fix behavior for ITC-like runs

For runs like ITC where the latest period is terminal-contaminated:
- valuation readiness remains `guarded`
- quality gate now marks `valuationBlocked = true`
- analysis status escalates to blocked/guarded appropriately
- workbook export still identifies the run and anchor period,
- but suppresses full valuation outputs instead of presenting them as normal decision-grade outputs

## Conclusion

The ITC pipeline reconciles operationally from input ZIP to derived output workbook.

However, the audit exposed a real trust defect:
- contaminated terminal periods were detected but not enforced strongly enough in the quality gate and workbook export path.

That mismatch has now been addressed in code by wiring valuation readiness into the quality gate and suppressing guarded workbook valuation outputs.
