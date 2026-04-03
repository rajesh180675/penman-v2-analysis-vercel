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

This is a real improvement in clarity, but it is still only a first reconciliation slice. Structural reconciliation currently thresholds recast identity residuals for:

- `OA + FA = TA`
- `CSE + MI + FO + OL = TA`
- `NOA - NFO - CSE - MI = 0`

Capitaline runs also still have richer parser-fidelity evidence than other modes because they use parse-debug signals such as file presence, header detection, period consistency, and parser noise. Other source modes still rely on lighter post-parse density heuristics rather than rich source-native diagnostics.

## What Was Validated

- snapshot tests: [`src/engine/__tests__/auditSnapshot.spec.ts`](../src/engine/__tests__/auditSnapshot.spec.ts)
- workbook export tests: [`src/engine/__tests__/excelExport.spec.ts`](../src/engine/__tests__/excelExport.spec.ts)
- surface summary tests: [`src/engine/__tests__/valuationTraceabilitySummary.spec.ts`](../src/engine/__tests__/valuationTraceabilitySummary.spec.ts)
- quality-surface smoke test: [`src/components/__tests__/QualityReport.spec.tsx`](../src/components/__tests__/QualityReport.spec.tsx)
- full test suite: `npm test`
- typecheck: `npm run typecheck`
- production build: `npm run build`

## Follow-On Work

- extend reconciliation thresholds into cash-flow and share-data packs
- deepen parser fidelity for screener, XBRL, manual, and JSON inputs with source-native anomaly counts
- carry the same ladder and reconciliation summary into other report surfaces beyond valuation, forecast, and quality so no artifact drifts from traceability
