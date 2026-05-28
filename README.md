# Penman V2 Analysis Vercel

This repository is the working implementation of the financial-model rigor plan in [`docs/financial-model-rigor-plan.md`](./docs/financial-model-rigor-plan.md). The current stage is not "finish the whole plan"; it is to close rigor gaps one by one while keeping the audited company suite, workbook export, and UI surfaces aligned.

## Task

The task is to make a Penman-style valuation run defensible under review:

- raw inputs must be traceable and policy-scoped
- structural and valuation blockers must fail closed
- exports and UI must report confidence honestly
- real-company golden cases must keep passing as rigor checks tighten

Primary references:
- operations / build / deploy: [`docs/OPERATIONS_MANUAL.md`](./docs/OPERATIONS_MANUAL.md)

## Rigor Feature Flags

The 7-gap rigor ladder rollout (plan v4) introduced four runtime kill switches read from `import.meta.env.VITE_RIGOR_*`. Default is enabled. Set the literal string `"false"` (case-insensitive) to disable. Disabling a flag turns its gate into "compute and surface but don't gate rigor" (soft-block). Flip in Vercel env to disable a gate without redeploying code.

| Flag | Gate | Affects |
|---|---|---|
| `VITE_RIGOR_CONCEPT_IDENTITY_BLOCK` | Gap 1 / ADR-001 | Caps rigor at `structurally-reconciled` when the concept identity layer reports unresolved critical conflicts. |
| `VITE_RIGOR_ECONOMIC_SANITY_BLOCK` | Gap 2 / ADR-002 | Caps rigor at `structurally-reconciled` when no clean anchor period is found within `MAX_ANCHOR_LOOKBACK_PERIODS` (= 3). |
| `VITE_RIGOR_TERMINAL_ELIGIBILITY_BLOCK` | Gap 3 / ADR-003 | Caps rigor at `economically-plausible` when the unusual-item manifest flags a terminal-blocking classification. |
| `VITE_RIGOR_RESIDUAL_SCORE_DOWNGRADE` | Gap 7 / PR-G | Downgrades `production-ready` to `valuation-eligible` when the run's overall residual score exceeds 40. |

Telemetry: each gate emits a `trace("config", "...")` event when it fires; sanitizer rejections of stale envelopes (v8 → v12) emit `recordSchemaMigration(...)` events visible in the Debug panel.

- beginner walkthrough (Bajaj Finance case study): [`docs/CASE_STUDY_BAJAJ_FINANCE.md`](./docs/CASE_STUDY_BAJAJ_FINANCE.md)

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
- the statements tab now carries that same trust gate before recast balance-sheet, income-statement, and free-cash-flow tables, so the core recast pack does not present structural output without parser, reconciliation, and rigor context
- the regression tab now carries that same trust gate before before/after deltas and baseline-harness output, so regression evidence is read in the same trust context as the run it is benchmarking
- the comparison tab now carries a peer-trust gate plus per-company trust rows, so cross-company rankings do not stand alone without parser, reconciliation, and rigor context for each loaded peer
- the multi-company comparison registry now persists through both local storage and the shared research API, so loaded peers and their trust state survive reloads and can hydrate across shared/server-backed workspace flows instead of disappearing with React memory
- the academic report tab now carries that same trust gate before the memo body and exported-artifact controls, so the offline/audit-facing report surface does not present stronger confidence than the shared traceability envelope
- the V3 analytics tab now carries that same trust gate before dirty-surplus, anchor, sensitivity, and confidence interpretation, so this interpretation-heavy surface no longer drifts from the shared parser/reconciliation/rigor envelope
- non-Capitaline parser fidelity now consumes source-native parser diagnostics from Screener, JSON, manual, and XBRL ingestion instead of relying only on post-parse density heuristics
- JSON ingestion now fails loud on invalid metric value types instead of silently accepting non-numeric payload contamination
- XBRL parser diagnostics now have focused automated coverage in Vitest by mocking the minimal `DOMParser` surface the parser consumes, so the XBRL path is no longer an unvalidated exception inside the non-Capitaline parser-fidelity contract
- the Vite manual chunk plan no longer forces a circular `engine-regression` ↔ `engine-v3-analytics` edge; regression, V3 analytics, and the academic report now ship in one shared `engine-advanced-analytics` chunk so production builds validate without that warning

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
- `npm test` (`39` files, `120` tests)
- `npm run build`
- `npm test -- src/lib/__tests__/companyRegistryStore.spec.ts` (`1` file, `5` tests)

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
- surfaced the same traceability trust gate in the statements tab so the recast balance-sheet, income-statement, and cash-flow pack do not drift from the shared envelope
- surfaced the same traceability trust gate in the regression tab so before/after harness deltas do not drift from the shared envelope
- persisted per-company traceability in the comparison registry and surfaced a comparison-tab trust gate plus per-company trust rows before peer ranking output
- persisted the comparison registry itself through a versioned local snapshot plus a shared research-API snapshot so peer comparison survives reloads and can hydrate beyond a single browser environment
- tightened comparison-registry sanitation so persisted trust only restores when the per-company traceability payload still matches the `2026-04-traceability-v8` envelope shape
- surfaced the same traceability trust gate in the academic report tab so the memo/export surface does not drift from the shared envelope
- surfaced the same traceability trust gate in the V3 analytics tab so dirty-surplus, terminal-anchor, sensitivity, and confidence sections do not drift from the shared envelope
- added source-native parser diagnostics for Screener, JSON, manual, and XBRL ingestion and wired them into parser fidelity scoring
- tightened JSON ingestion so invalid non-numeric metric values fail during parse instead of entering the analytical object
- added a focused `src/engine/__tests__/xbrlParser.spec.ts` suite that validates clean XBRL diagnostics, degraded XBRL diagnostics, and parser-error fail-loud behavior without requiring a browser test runtime
- removed the Vite circular chunk warning by consolidating regression, V3 analytics, and academic-report manual chunking into one `engine-advanced-analytics` bundle
- added a focused `src/components/__tests__/RecastStatements.spec.tsx` server-render spec so the statements trust gate is covered alongside the other shared-envelope surfaces
- re-ran typecheck, full tests, and build

## Next Good Problems

- decide whether the debug and workspace surfaces should also consume the shared traceability envelope where they present run-level conclusions rather than raw diagnostics
- review whether the larger shared `engine-advanced-analytics` chunk should later be split again through actual dependency extraction instead of manual chunk forcing
- extend the shared comparison registry beyond the current single shared snapshot into explicit workspace/user scoping if multiple independent peer sets need to coexist
- see the current persistence slice in [`docs/comparison-registry-persistence.md`](./docs/comparison-registry-persistence.md)
