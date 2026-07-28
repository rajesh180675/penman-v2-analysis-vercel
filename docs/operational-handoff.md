# Operational Handoff — Plan v4 Rigor Ladder Rollout

This document is the operational summary written **after** all 8 PRs of plan v4 (`.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md`) merged to `main`. Use it for incident response, audit prep, and rollback drills.

## What shipped

| PR | Branch | Schema | Closes |
|---|---|---|---|
| PR-0 | infra/feature-flags-adr-migration-helpers | — | Cross-cutting infra (flags, telemetry, ADR template) |
| PR-A | rigor/concept-identity-v9 | v8 → v9 | Gap 1 (ADR-001) |
| PR-B | rigor/economic-sanity-v10 | v9 → v10 | Gap 2 (ADR-002) |
| PR-C | rigor/unusual-item-taxonomy-v11 | v10 → v11 | Gap 3 (ADR-003) |
| PR-D | rigor/lineage-sidecar-v12 | v11 → v12 | Gap 4 (ADR-004) |
| PR-E | rigor/workbook-regression-tests | — | Gap 5 |
| PR-F | rigor/golden-suite-expansion | — | Gap 6 |
| PR-G | rigor/residuals-dashboard | — | Gap 7 |
| PR-H | rigor/smaller-items | — | Plan v4 N-2 documentation, operational handoff |

Current envelope schema: **`2026-06-traceability-v19`**.

## Valuation maturity baseline

Plan 0 adds the living valuation maturity scorecard as the audit baseline for future modeling PRs:

- Baseline artifact: `docs/valuation-maturity-scorecard.md` — read the current score there, not from this file.
- Decision record: `docs/adr/008-valuation-maturity-scorecard.md`.
- Target score: **10.0/10**.

This section deliberately does not restate the current score. It used to say
**6.1/10** (`developing`) while the generated artifact said 8.5 and the code
produced 7.6 — three numbers for one measurement, two of them hand-copied and
both wrong. A generated value copied into a hand-maintained doc is stale from the
moment the generator runs again, so the pointer is the durable form.

Run these after valuation-modeling or source-contract PRs:

```bash
npx tsx scripts/valuation-scorecard.ts --format json
npx tsx scripts/valuation-scorecard.ts --format md
npm run test:audit
```

Expected skips are not bugs. `EXPECTED_SKIP_MISSING_SIDECAR`, `EXPECTED_SKIP_INSUFFICIENT_HISTORY`, and `EXPECTED_SKIP_UNSUPPORTED_SOURCE` identify missing source/model contracts that should reduce maturity without being mislabeled as `CALC_ERROR`.

## Where the surfaces live

| Surface | Path | Notes |
|---|---|---|
| Feature flag module | `src/lib/featureFlags.ts` | Reads `import.meta.env.VITE_RIGOR_*`. |
| Schema migration helper | `src/lib/schemaMigration.ts` | Logs to `traceLogger`; ring-buffers in `localStorage` at `penman.schema-migrations.v1` (cap 100). |
| Concept identity layer | `src/engine/conceptOntology.ts` | `detectConflicts`, `summarizeConceptIdentity`. |
| Economic sanity gates | `src/engine/economicSanityGates.ts` | `evaluateEconomicSanity`, anchor lookback. |
| Unusual-item taxonomy | `src/engine/unusualItemPolicy.ts` | `CLASSIFICATION_RULES`, `summarizeUnusualItemManifest`. |
| Per-number lineage | `src/engine/lineageBuilder.ts` + `src/engine/lineageTypes.ts` | Sidecar pattern; persists at `snapshot.lineage`. |
| Residuals store | `src/lib/residualsStore.ts` | Per-company localStorage (`penman.residuals.<id>.v1`), 100-entry / 5MB caps. |
| ADR directory | `docs/adr/` | 000 (process), 001-004 (gap ADRs). |
| Workbook regression contract | `docs/workbook-regression-contract.md` | Sheet manifest + labeled-cell contract. |
| Rigor ladder doc | `docs/analysis-rigor-ladder.md` | Pointer to all 4 gap ADRs. |

## How to disable a gate without redeploying

1. Vercel project settings → Environment Variables.
2. Add the flag (see README "Rigor Feature Flags" table) with value `"false"`.
3. Redeploy is optional — Vercel reads env vars at build time, but the values can be picked up by next preview deploy.
4. Confirm in DebugPanel: the gate still computes and surfaces, but `rigor.currentLevel` does not stop on it.

## How to roll back a schema bump

The escalation order:

1. **Soft-disable via flag** (preferred). 2 minutes.
2. **Revert PR on main** via `gh pr revert`. ~10 minutes including CI.
3. **Schema rollback**. Hard. Once `vN+1` envelopes exist in audit blobs, older readers cannot parse them. Path:
   - Confirm no v(N+1) envelopes are in production audit blobs (query the Vercel Blob index).
   - If clean: revert the schema bump PR, redeploy.
   - If not clean: ship a `v(N+1).1` hotfix that strips the offending fields rather than rolling the schema back.

## Audit prep checklist

For an external audit / review, surface these artifacts:

- [ ] DebugPanel migration telemetry → confirms zero unmigrated envelopes (v8/v9/v10/v11 all rejected with telemetry).
- [ ] `docs/adr/00*.md` — read the deciders, alternatives, and verification sections.
- [ ] `docs/workbook-regression-contract.md` — pinned sheet manifest.
- [ ] `public/data/companies/*/expectations.json` — golden-case envelope expectations (5 mandatory companies).
- [ ] `npm run test:golden` — exercise golden cases.
- [ ] `npm run build` — chunk sizes; flag any chunk over 500KB gzipped.
- [ ] Vercel preview deploy of the latest commit — visual smoke test.

## Known follow-ups (deferred from plan v4 PR-H)

These were originally listed as "smaller items" in the plan but each requires a non-trivial refactor; tracked here so reviewers can see them:

- **Trust-gate badges in DebugPanel + CompanyWorkspace.** Plan v4 PR-H item A. The shared envelope is consumed in 7 tabs; DebugPanel and CompanyWorkspace still surface raw diagnostics. Adding the badge is straightforward; the deferral is so we don't bundle an unrelated UI change into the PR-G squash.
- **Parser-fidelity parity for non-Capitaline parsers.** Plan v4 PR-H item B. Screener / XBRL / Manual / JSON parsers each need their own `coercionCount` plumbed through `parserFidelity.checks`. Per-parser specs already exist; the parity work is a follow-up PR per parser.
- **Vite chunk split for `vendor-file-parsing` (1MB).** Plan v4 PR-H item C. The largest chunk is 1MB pre-gzip; rollupOptions.output.manualChunks tweak likely yields a 30-40% split. Defer until a build performance regression actually fires.

## Open questions still needing answers

From plan v4 §"Open items still needing answers" — none of these blocked the rollout but should be closed:

1. **Capital-transaction thresholds** — `BUYBACK_PCT_OF_CSE = 0.05`, `RIGHTS_PCT_OF_CSE = 0.10`. Confirm vs Indian regulatory norms with a finance reviewer.
2. **`MAX_ANCHOR_LOOKBACK_PERIODS = 3`** — is 3 the right ceiling? Could be 5 for industries with biennial cycles.
3. **Reliance Industries fixture** — needs ZIP inspection to confirm demerger periods present. Alternative: Tata Motors. Currently expectations.json codifies Reliance with a `demerger-fixture` profile but the actual fixture is whatever is in `public/data/companies/Reliance Industries/`.
4. **Cross-device residuals sync** — should it ship enabled? Default off keeps PR-G simpler. Reuse `sharedResearchApi.ts` if/when needed.

## Incident response

If a deploy turns red after a schema bump:

1. Open Vercel deploy logs; look for `trace("config", "schemaMigration", ...)` entries — these are the sanitizer rejecting stale envelopes (expected after a bump).
2. If users report "all my comparison companies are gone": expected on the first run after a schema bump. Sanitizer rejected the v(N-1) envelopes. They re-run the pipeline; envelope is rebuilt at vN.
3. If users report "the gate is wrong": flip the corresponding `VITE_RIGOR_*_BLOCK=false` flag in Vercel env. Reproduce the false positive on a preview deploy and patch the gate logic in a fix PR.
4. If `npm run validate` fails on `main`: branch protection prevents direct push, so this can't happen unintentionally. If it does happen via admin override, every subsequent PR is blocked until the underlying break is fixed (per `agent-pr-loop` skill notes). Fix the break, push to main, re-enable protection.

## Definition of done — overall

The system is 10/10 when a skeptical reviewer can:

1. ✅ Open a run and see the canonical concept registry prove each metric has exactly one identity (Gap 1, ADR-001)
2. ✅ See the engine's automatic clean-anchor selection with skip log (Gap 2, ADR-002)
3. ✅ Audit every unusual item's classification rule and rationale (Gap 3, ADR-003)
4. ✅ Inspect lineage for any of 8 key numbers via `snapshot.lineage` (Gap 4, ADR-004)
5. ✅ Open the regression-tested workbook (Gap 5, `docs/workbook-regression-contract.md`)
6. ✅ See 5 golden companies with diverse profiles codified in `expectations.json` (Gap 6)
7. ✅ See per-run residuals persisted with production-ready downgrade enforced (Gap 7)

PLUS:

8. ✅ Schema migrations are observable, reversible, and forward-compatible (PR-0)
9. ✅ Every gate is feature-flagged (4 flags, README documented)
10. ✅ Memory and bundle budgets are enforced (caps in lineage / residuals / unusual-item manifests)
11. ✅ All 8 PRs squash-merged on green CI with zero rollbacks
