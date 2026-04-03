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
- `structurally-reconciled` now requires explicit balance-sheet, cash-distribution, share-capital, debt-flow, and income-statement residuals to stay under critical thresholds instead of relying only on recast presence and blocker counts
- the structural pack now includes a gross-borrowings debt-flow bridge backed by traced long-term and short-term borrowing lines versus `DebtProceeds + DebtRepayment`
- the structural pack now also includes an ending-cash bridge backed by traced `BS.FA.CashBank` balances versus the recast cash-flow movement implied by `CFO`, `Capex`, distributions, financing flows, and investment flows
- the structural pack now also includes income-statement bridges for `PAT + OCI = TCI`, `CNI = OI - NFE - MII`, `Core OI + UOI = OI`, and `Core NFE + UFE = NFE`
- the structural pack now also thresholds the detailed operating-cost bridge when `bridgeCoreOI` has at least `60%` source coverage, so high-coverage sales-to-Core-OI decompositions become part of structural clearance instead of staying informational only
- the valuation tab now carries the same trust gate into the user-facing surface, showing rigor level, parser fidelity, reconciliation status, and the next unresolved gate instead of relying on the signal card alone
- the forecast tab now carries that same trust gate before any scenario output, so forward-looking cases inherit the shared parser, reconciliation, and rigor disclosure instead of presenting a separate confidence language
- the quality tab now carries that same trust gate before any quality-factor scores, so strong-looking scorecards are not read out of context when parser or reconciliation trust is weak
- the ratios tab now carries that same trust gate before decomposition tables and trend charts, so ratio analysis does not present standalone confidence
- the regression tab now carries that same trust gate before before/after deltas and baseline-harness output, so regression evidence is read in the same trust context as the run it is benchmarking
- the comparison tab now carries a peer-trust gate plus per-company trust rows, so cross-company rankings do not stand alone without parser, reconciliation, and rigor context for each loaded peer
- the multi-company comparison registry now persists to local storage, so loaded peers and their trust state survive reloads instead of disappearing with React memory
- the academic report tab now carries that same trust gate before the memo body and exported-artifact controls, so the offline/audit-facing report surface does not present stronger confidence than the shared traceability envelope
- the V3 analytics tab now carries that same trust gate before dirty-surplus, anchor, sensitivity, and confidence interpretation, so this interpretation-heavy surface no longer drifts from the shared parser/reconciliation/rigor envelope

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
- `npm test` (`36` files, `109` tests)
- `npm run build`
- `npm test -- src/engine/__tests__/reconciliationResiduals.spec.ts`
- `npm test -- src/components/__tests__/V3AnalyticsPanel.spec.tsx`

Still not validated in this iteration:

- manual UI walkthrough
- deployed Vercel behavior
- live audit API behavior against production data

## Last Units Of Work

- added explicit analysis rigor levels to the traceability envelope and later bumped the schema version to `2026-04-traceability-v8`
- exported rigor level and ladder state into workbook metadata
- surfaced rigor level and remaining ladder steps in the run inspector
- added parser-fidelity scoring to traceability and wired it into the `syntactically-valid` gate
- added reconciliation-residual scoring to traceability and wired it into the `structurally-reconciled` gate
- extended reconciliation residual scoring beyond balance-sheet identities with a cash-distribution bridge check and a share-capital tie-out check
- extended reconciliation residual scoring again with a gross-borrowings debt-flow bridge backed by traced borrowing lines
- extended reconciliation residual scoring again with an ending-cash bridge backed by traced cash balances and the recast cash-flow movement
- extended reconciliation residual scoring into the income statement with comprehensive-income, CNI, core-OI, and core-NFE bridges
- extended reconciliation residual scoring into the detailed operating-cost bridge so high-coverage `bridgeCoreOI` support now participates in structural clearance
- fixed the ladder so structural failure prevents downstream economic/valuation levels from clearing
- surfaced reconciliation status and summary in workbook and run inspector
- surfaced the same traceability trust gate in the valuation tab so that valuation presentation does not drift from the shared envelope
- surfaced the same traceability trust gate in the forecast tab so scenario outputs do not drift from the shared envelope
- surfaced the same traceability trust gate in the quality tab so Piotroski/distress/fraud scorecards do not drift from the shared envelope
- surfaced the same traceability trust gate in the ratios tab so decomposition and trend analysis do not drift from the shared envelope
- surfaced the same traceability trust gate in the regression tab so before/after harness deltas do not drift from the shared envelope
- persisted per-company traceability in the comparison registry and surfaced a comparison-tab trust gate plus per-company trust rows before peer ranking output
- persisted the comparison registry itself to local storage so peer comparison survives reloads in the same workspace/browser
- surfaced the same traceability trust gate in the academic report tab so the memo/export surface does not drift from the shared envelope
- surfaced the same traceability trust gate in the V3 analytics tab so dirty-surplus, terminal-anchor, sensitivity, and confidence sections do not drift from the shared envelope
- re-ran typecheck, full tests, and build

## Next Good Problems

- make parser fidelity richer for non-Capitaline inputs by capturing source-specific parse diagnostics instead of only post-parse density heuristics
- extend comparison trust persistence beyond local browser storage into shared multi-workspace/server-backed surfaces so peer context survives beyond one browser environment
- see the current local-persistence slice in [`docs/comparison-registry-persistence.md`](./docs/comparison-registry-persistence.md)
