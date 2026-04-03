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

## Current Heuristic

The ladder is intentionally conservative and uses existing signals only:

- `syntactically-valid`
  - raw periods exist and no engine error was recorded
- `structurally-reconciled`
  - recast data exists, scope is supported, and no blocking issues remain
- `economically-plausible`
  - structural blockers are cleared and valuation-critical issues are not blocking
- `valuation-eligible`
  - the run is not guarded and valuation status is `warning` or `production-ready`
- `production-ready`
  - `analysisStatus.status === "production-ready"`

This is a real improvement in clarity, but it is still a heuristic layer. It does not yet use explicit parser-fidelity scoring or reconciliation residual thresholds from the full rigor plan.

## What Was Validated

- snapshot tests: [`src/engine/__tests__/auditSnapshot.spec.ts`](../src/engine/__tests__/auditSnapshot.spec.ts)
- workbook export tests: [`src/engine/__tests__/excelExport.spec.ts`](../src/engine/__tests__/excelExport.spec.ts)
- full test suite: `npm test`
- typecheck: `npm run typecheck`
- production build: `npm run build`

## Follow-On Work

- replace raw-period presence with parser-fidelity quality as the entry condition for `syntactically-valid`
- replace blocking-count heuristics with reconciliation-pack residual thresholds for `structurally-reconciled`
- carry the same ladder into other export/report surfaces so no artifact drifts from traceability
