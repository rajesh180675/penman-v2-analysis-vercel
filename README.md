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

The repo already had broad phase-8 coverage: golden-company fixtures, release gates, workbook traceability, audit snapshots, and valuation-readiness policy. The gap closed in this iteration was that the plan defined explicit rigor levels, but the product only exposed a coarse blocked/guarded/production-ready badge.

Current focus now implemented:

- traceability snapshots classify each run on the ladder:
  - `syntactically-valid`
  - `structurally-reconciled`
  - `economically-plausible`
  - `valuation-eligible`
  - `production-ready`
- the workbook cover and traceability sheet now export that level
- the run inspector now shows the achieved and remaining levels explicitly

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
- `npm test` (`27` files, `86` tests)
- `npm run build`

Still not validated in this iteration:

- manual UI walkthrough
- deployed Vercel behavior
- live audit API behavior against production data

## Last Units Of Work

- added explicit analysis rigor levels to the traceability envelope and bumped the schema version to `2026-04-traceability-v6`
- exported rigor level and ladder state into workbook metadata
- surfaced rigor level and remaining ladder steps in the run inspector
- extended snapshot/export tests to lock the new contract
- installed dependencies locally and re-ran typecheck, tests, and build

## Next Good Problems

- connect the rigor ladder to parser-fidelity metrics so `syntactically-valid` is not inferred only from raw-period presence
- tighten `structurally-reconciled` with explicit identity residual thresholds instead of coverage/blocking proxies
- feed the same rigor ladder into the academic/debug export surfaces so all artifacts agree
