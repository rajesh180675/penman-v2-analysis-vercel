# Analysis Rigor Ladder

## Why This Exists

`docs/financial-model-rigor-plan.md` defines five review standards:

- `syntactically valid`
- `structurally reconciled`
- `economically plausible`
- `valuation eligible`
- `production-ready`

Before this change, the product exposed only the coarse analysis badge (`blocked`, `guarded`, `production-ready`). That was useful, but it did not answer the more precise reviewer question: "what level of correctness has this run actually earned?"

## What Changed

The shared traceability envelope in [`src/engine/analysisTraceability.ts`](../src/engine/analysisTraceability.ts) now computes:

- `rigor.currentLevel`
- `rigor.currentLabel`
- `rigor.summary`
- `rigor.achievedLevels`
- `rigor.pendingLevels`
- `rigor.checkpoints`

That envelope is consumed in:

- [`src/lib/auditSnapshot.ts`](../src/lib/auditSnapshot.ts)
- [`src/engine/excelExport.ts`](../src/engine/excelExport.ts)
- [`src/components/RunInspector.tsx`](../src/components/RunInspector.tsx)
- [`src/components/ValuationReport.tsx`](../src/components/ValuationReport.tsx)
- [`src/components/ForecastReport.tsx`](../src/components/ForecastReport.tsx)
- [`src/components/QualityReport.tsx`](../src/components/QualityReport.tsx)
- [`src/components/RatioReport.tsx`](../src/components/RatioReport.tsx)

## Current Heuristic

The ladder is intentionally conservative, and it now uses explicit parser-fidelity and reconciliation summaries instead of treating raw-period or recast presence as enough.

- `syntactically-valid`
  - parser fidelity clears a minimum threshold and no engine error was recorded
- `structurally-reconciled`
  - recast data exists, scope is supported, no blocking issues remain, and explicit recast identity residuals stay below critical thresholds
- `economically-plausible`
  - structural reconciliation is actually achieved and valuation-critical issues are not blocking
- `valuation-eligible`
  - the run is not guarded and valuation status is `warning` or `production-ready`
- `production-ready`
  - `analysisStatus.status === "production-ready"`

The traceability envelope now includes:

- `parserFidelity.status`
- `parserFidelity.score`
- `parserFidelity.summary`
- `parserFidelity.checks`
- `reconciliation.status`
- `reconciliation.summary`
- `reconciliation.maxResidualRatio`
- `reconciliation.checks`

Comparison trust no longer disappears on reload or stay trapped in one browser. The app now persists the multi-company registry, including per-company v8 traceability envelopes, through both local storage and the shared research API so the comparison trust gate can survive reloads and shared workspace hydration. See [`docs/comparison-registry-persistence.md`](./comparison-registry-persistence.md).

This is a real improvement in clarity, but it is still only a partial reconciliation slice. Structural reconciliation currently thresholds recast identity residuals for:

- `OA + FA = TA`
- `CSE + MI + FO + OL = TA`
- `NOA - NFO - CSE - MI = 0`
- `PAT + OCI = TCI` when traced comprehensive-income evidence exists
- `CNI = OI - NFE - MII`
- `Core OI + UOI = OI`
- `Core NFE + UFE = NFE`
- `d_t = FCF - NFE + ΔNFO`
- `Share Capital ÷ Face Value = End-Period Shares`
- `Δ Gross Borrowings = Debt Proceeds + Debt Repayment` when traced borrowing lines exist
- `Δ Cash and Bank = CFO - Capex - Distributions + Equity/Financing/Investment Flows` when traced cash balances and core cash-flow lines exist

Capitaline runs also still have richer parser-fidelity evidence than other modes because they use parse-debug signals such as file presence, header detection, period consistency, and parser noise. Other source modes still rely on lighter post-parse density heuristics rather than rich source-native diagnostics.

## What Was Validated

- snapshot tests: [`src/engine/__tests__/auditSnapshot.spec.ts`](../src/engine/__tests__/auditSnapshot.spec.ts)
- focused reconciliation residual tests: [`src/engine/__tests__/reconciliationResiduals.spec.ts`](../src/engine/__tests__/reconciliationResiduals.spec.ts)
- workbook export tests: [`src/engine/__tests__/excelExport.spec.ts`](../src/engine/__tests__/excelExport.spec.ts)
- surface summary tests: [`src/engine/__tests__/valuationTraceabilitySummary.spec.ts`](../src/engine/__tests__/valuationTraceabilitySummary.spec.ts)
- quality-surface smoke test: [`src/components/__tests__/QualityReport.spec.tsx`](../src/components/__tests__/QualityReport.spec.tsx)
- ratio-surface smoke test: [`src/components/__tests__/RatioReport.spec.tsx`](../src/components/__tests__/RatioReport.spec.tsx)
- full reconciliation residual contract: [`src/engine/__tests__/reconciliationResiduals.spec.ts`](../src/engine/__tests__/reconciliationResiduals.spec.ts)
- full test suite: `npm test` (`36` files, `109` tests)
- typecheck: `npm run typecheck`
- production build: `npm run build`

## Follow-On Work

- deepen parser fidelity for screener, XBRL, manual, and JSON inputs with source-native anomaly counts
- carry the same ladder and reconciliation summary into other report surfaces beyond valuation, forecast, quality, and ratios so no artifact drifts from traceability
- partition the shared comparison registry into explicit workspace or user scopes if multiple peer sets need to coexist

## Concept Identity Gate (Schema v9, ADR-001)

The traceability envelope at `2026-06-traceability-v9` adds a `conceptIdentity` field that proves each canonical concept (revenue, equity, NOA, etc.) has exactly one identity across the run. When `unresolvedCriticalCount > 0` and `VITE_RIGOR_CONCEPT_IDENTITY_BLOCK` is on (default), the run cannot reach `valuation-eligible`.

Conflict classes:
- `cross-statement-conflict` — registry alias appears under two different statement owners
- `duplicate-source` — two raw labels both resolve to the same concept in one period
- `unresolved` — required core concept has no match in the latest period

Persisted v8 envelopes are rejected on read; the sanitizer logs the migration via `recordSchemaMigration()` so DebugPanel can surface volume to ops. See [`docs/adr/001-concept-identity-layer.md`](adr/001-concept-identity-layer.md).

## Unusual-Item Taxonomy (Schema v11, ADR-003)

Envelope `2026-06-traceability-v11` adds a `unusualItemManifest` field that classifies each "exceptional / extraordinary / unusual" raw label against an ordered rule set of 11 categories (plus `unclassified` fall-through):

`demerger-scheme-effect`, `discontinued-operations`, `impairment`, `asset-sale-gain-loss`, `fair-value-change`, `litigation`, `restructuring`, `one-time-tax`, `buyback`, `special-dividend`, `capital-return`.

Each classification carries a category, the matched regex pattern, a rationale template, and three booleans: `affectsCoreOI`, `affectsTerminalEligibility`, `affectsCleanSurplus`. The manifest's `terminalEligibilityBlocked` flag feeds Gap 2's Check A. When `VITE_RIGOR_TERMINAL_ELIGIBILITY_BLOCK` is on (default), an unresolved terminal-blocking item caps rigor at `economically-plausible`. See [`docs/adr/003-unusual-item-taxonomy.md`](adr/003-unusual-item-taxonomy.md).

## Economic Sanity Gates (Schema v10, ADR-002)

Envelope `2026-06-traceability-v10` adds an `economicSanity` field that walks periods latest → oldest until it finds a clean anchor within `MAX_ANCHOR_LOOKBACK_PERIODS` (= 3). Five per-period checks:

- `terminal-period-contamination` (block) — major capital event in this period (buyback ≥ 5% CSE, issuance ≥ 10% CSE, or terminal-blocking unusual item)
- `dirty-surplus-integrity` (warn → block on 2 consecutive years) — dirty surplus residual ≥ 4% of CSE
- `implausible-rnoa-jump` (warn) — \|ΔRNOA\| ≥ 30pp without known cause
- `demerger-discontinued-contamination` (block) — parser or manifest signal
- `anchor-period-selection` — summary of the walk-back

`status === "blocked"` + `VITE_RIGOR_ECONOMIC_SANITY_BLOCK` on (default) caps rigor at `structurally-reconciled`. See [`docs/adr/002-economic-sanity-gates.md`](adr/002-economic-sanity-gates.md).


