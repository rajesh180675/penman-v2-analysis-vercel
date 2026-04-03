# Penman V2 Analysis Vercel

This repository is the working implementation of the financial-model rigor plan in [`docs/financial-model-rigor-plan.md`](./docs/financial-model-rigor-plan.md). The current stage is not "finish the whole plan"; it is to close rigor gaps one by one while keeping the audited company suite, workbook export, and UI surfaces aligned.

## Task

The task is to make a Penman-style valuation run defensible under review:

- raw inputs must be traceable and policy-scoped
- structural and valuation blockers must fail closed
- exports and UI must report confidence honestly
- real-company golden cases must keep passing as rigor checks tighten

Primary references:

- plan: [`docs/financial-model-rigor-plan.md`](./docs/financial-model-rigor-plan.md)
- latest audit context: [`audit-report-2026.md`](./audit-report-2026.md)
- prior architecture/reporting work: [`ARCHITECTURE_AND_SPEC_REPORT.md`](./ARCHITECTURE_AND_SPEC_REPORT.md)
- current rigor-level implementation note: [`docs/analysis-rigor-ladder.md`](./docs/analysis-rigor-ladder.md)

## Current Position

The repo already had broad phase-8 coverage: golden-company fixtures, release gates, workbook traceability, audit snapshots, valuation-readiness policy, and an explicit rigor ladder. The gap closed in this iteration was that `structurally-reconciled` still relied on a weak proxy instead of explicit reconciliation residual thresholds.

Current focus now implemented:

- traceability snapshots classify each run on the ladder:
  - `syntactically-valid`
  - `structurally-reconciled`
  - `economically-plausible`
  - `valuation-eligible`
  - `production-ready`
- the workbook cover and traceability sheet now export that level
- the run inspector now shows the achieved and remaining levels explicitly
- parser fidelity is now a first-class traceability signal with a status, score, and summary
- `syntactically-valid` now requires parser fidelity to clear a minimum threshold instead of relying only on raw-period presence
- reconciliation is now a first-class traceability signal with a status, summary, max residual, and check list
- `structurally-reconciled` now requires explicit recast identity residuals to stay under critical thresholds instead of relying only on recast presence and blocker counts
- the valuation tab now carries the same trust gate into the user-facing surface, showing rigor level, parser fidelity, reconciliation status, and the next unresolved gate instead of relying on the signal card alone

## How To Iterate

1. Read [`docs/financial-model-rigor-plan.md`](./docs/financial-model-rigor-plan.md) and identify one missing exit criterion that is not fully expressed in code.
2. Check whether the gap is already partially wired in `src/engine`, `src/lib/auditSnapshot.ts`, workbook export, or inspector UI before adding new surfaces.
3. Implement the smallest end-to-end change that improves reviewer trust.
4. Add or update tests first around the contract you changed.
5. Run validation and record exactly what passed.
6. Update this README and the handoff notes in `~/.ariana-ralph-notes/`.

## Validation Criteria

Baseline validation for any rigor change:

- `npm run typecheck`
- `npm test`
- `npm run build`

Validated in this iteration:

- `npm run typecheck`
- `npm test` (`28` files, `89` tests)
- `npm run build`

Still not validated in this iteration:

- manual UI walkthrough
- deployed Vercel behavior
- live audit API behavior against production data

## Last Units Of Work

- added explicit analysis rigor levels to the traceability envelope and later bumped the schema version to `2026-04-traceability-v7`
- exported rigor level and ladder state into workbook metadata
- surfaced rigor level and remaining ladder steps in the run inspector
- added parser-fidelity scoring to traceability and wired it into the `syntactically-valid` gate
- added reconciliation-residual scoring to traceability and wired it into the `structurally-reconciled` gate
- fixed the ladder so structural failure prevents downstream economic/valuation levels from clearing
- surfaced reconciliation status and summary in workbook and run inspector
- surfaced the same traceability trust gate in the valuation tab so that valuation presentation does not drift from the shared envelope
- re-ran typecheck, full tests, and build

## Next Good Problems

- extend reconciliation thresholds into cash-flow and share-data packs instead of only recast balance-sheet identities
- make parser fidelity richer for non-Capitaline inputs by capturing source-specific parse diagnostics instead of only post-parse density heuristics
- feed the same rigor ladder and reconciliation summary into the remaining report surfaces beyond the valuation tab so all artifacts agree
