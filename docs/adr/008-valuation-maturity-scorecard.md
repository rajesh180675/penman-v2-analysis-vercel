# ADR-008: Valuation maturity scorecard

- **Status:** Accepted
- **Date:** 2026-06-04
- **Deciders:** Rajesh, Hermes Agent
- **PR:** #(this PR)
- **Schema bump:** none

## Context

Plan 0 of the 10/10 roadmap requires the project to measure valuation maturity honestly before adding more models. Before this decision, `scripts/audit-all-companies.ts` could show whether individual companies computed, skipped, or failed, but there was no stable weighted roll-up that told reviewers where the product stood against the roadmap.

The live-corpus baseline at the time of this decision, after PRs #259-#262, was 33 audited companies, 0 `CALC_ERROR` rows, and a valuation maturity score of 6.1/10 (read the current score from the generated artifact, not from this record). The largest gaps are sector-native coverage, cross-paradigm independence, and traceability/reconciliation/fail-closed gates. Treating these as ad hoc notes would make progress hard to compare across future PRs.

## Decision

We chose a generated Plan 0 valuation maturity scorecard with eight weighted score families:

1. Industrial core valuation
2. Bank/NBFC/insurance coverage
3. Sector-native coverage
4. Cross-paradigm independence
5. Traceability/reconciliation/fail-closed gates
6. Data freshness/source tieout
7. Workbook/reviewer defensibility
8. Engineering/release quality

The canonical generator is `scripts/valuation-scorecard.ts`, with reusable scoring logic in `scripts/lib/valuationMaturityScorecard.ts`. The checked-in baseline artifact is `docs/valuation-maturity-scorecard.md`.

Expected skips are explicit source/data-contract gaps, not calculation failures. In short: expected skips are explicit source/data-contract gaps, not calculation failures. `EXPECTED_SKIP_MISSING_SIDECAR`, `EXPECTED_SKIP_INSUFFICIENT_HISTORY`, and `EXPECTED_SKIP_UNSUPPORTED_SOURCE` reduce maturity until the required source or model contract is implemented, but they must not be counted as `CALC_ERROR`.

## Consequences

### Positive

- Reviewers get one stable baseline score and eight component scores after every modeling wave.
- Expected skips stay visible without being mislabeled as code failures.
- The scorecard makes the next highest-leverage work obvious: sector-native models, independent evidence, and deeper traceability.

### Negative / Tradeoffs

- The scorecard is a policy artifact, not a mathematically inevitable grade; weights must be reviewed if the roadmap changes.
- The checked-in Markdown artifact can go stale if the generator is not rerun after model or corpus changes.

### Neutral

- No traceability schema bump was required because the scorecard is an audit/documentation artifact, not a persisted envelope field.

## Alternatives Considered

### Alternative A: keep only per-company audit output

Rejected. Per-company rows are necessary for debugging, but they do not answer the reviewer question: "How mature is the system overall, and where is the next bottleneck?"

### Alternative B: use one unweighted percentage of non-error rows

Rejected. A 0-error corpus can still be analytically immature if sector-native economics, source tieout, or independent valuation lenses are missing. The weighted family structure keeps these gaps visible.

### Alternative C: treat expected skips as failures

Rejected. That would conflate source-contract absence with broken code and incentivize unsafe behavior: forcing unsupported companies through generic valuation paths just to improve a green count.

## Verification

- [x] Spec file: `scripts/__tests__/valuationScorecard.spec.ts`
- [x] Spec file: `scripts/__tests__/valuationMaturityDocs.spec.ts`
- [x] CLI JSON: `npx tsx scripts/valuation-scorecard.ts --format json`
- [x] CLI Markdown: `npx tsx scripts/valuation-scorecard.ts --format md`
- [x] Audit harness: `npm run test:audit`
- [x] Full validation: `npm run validate`

## References

- Plan 0: `.hermes/plans/2026-06-04_172742-plan-0-baseline-audit-scorecard.md`
- Baseline artifact: `docs/valuation-maturity-scorecard.md`
- Rigor ladder: `docs/analysis-rigor-ladder.md`
