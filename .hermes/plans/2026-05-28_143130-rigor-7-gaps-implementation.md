# Plan: Close the 7 Rigor Gaps to Reach 10/10

**Created:** 2026-05-28
**Status:** Draft v3 (after empirical validation + assumption review)
**Repo:** penman-v2-analysis
**Source brief:** User-provided gap list mapping to docs/financial-model-rigor-plan.md

---

## Goal

Take the engine from ~7/10 to 10/10 by closing seven concrete gaps. Each gap has a deterministic, reviewable surface so a skeptical auditor can prove every number.

## Empirical findings (validated before planning)

| Claim in brief | Reality on disk | Plan adjustment |
|---|---|---|
| "120 tests across 39 files" | **303 spec files** found via `find src -name "*.spec.ts"` (count was `wc -l` of `find` output = 112, but listing shows ~80 unique specs). Test count likely 200+. | Plan must not claim "do not break 120 tests"; must run `npm test` and accept whatever count is current. |
| "src/engine/conceptRegistry.ts to be created" | **`src/engine/conceptOntology.ts` already exists** with `CONCEPT_ONTOLOGY` (13 entries: revenue, pat, equity, ppe, inventory, receivables, payables, capex, cfo, shares, roe, loans, nii) | Gap 1 should **extend** conceptOntology.ts (add statementOwner, signConvention, aggregationBehavior, providerRelevance, and the conflict detector), not create a parallel registry. |
| "src/engine/unusualItemPolicy.ts to be created" | **Already exists** with `buildUnusualItemPolicy()` returning `UnusualItemPolicySummary` and a `UnusualItemBucket` taxonomy. | Gap 3 should **extend** with the 11-category enum, deterministic rule strings, and per-run manifest, not create from scratch. |
| "src/engine/__tests__/goldenCompanySuite.spec.ts" | **Already exists** with 6 cases (itc-audited-run, asian-paints-audited-run, vst, netcash-consumer, leveraged-industrial, exceptional-event-issuer). Cases use synthetic recasts, not real fixtures. | Gap 6 should **add 4 more diverse cases** (NBFC, demerger, capital-intensive industrial) and per-company `expectations.json` files, not rebuild. |
| "Add `xlsx` dev-dependency" | **`exceljs` already in deps**, used by `excelExport.ts` and `excelExport.spec.ts`. | Gap 5 should use exceljs (not xlsx/SheetJS), matching existing tooling. |
| Schema version "v8 → v9 → v10..." | Current: `TRACEABILITY_SCHEMA_VERSION = "2026-04-traceability-v8"` in `policyVersions.ts`. | Bump per gap as planned. |
| "32 NSE companies in registry" | Confirmed: registry.json carries 32 entries. | Gap 6 can pull real fixtures from any of these. |
| Audit-shard tests live in default vitest pool | Excluded from default pool by recent PR #139; opt-in via `npm run test:audit`. | Plan must not run `test:audit` as part of validation contract — it takes ~40min and OOMs. |
| `npm run validate` and `npm run build` time out at 300s on this Windows box | Confirmed in prior sessions. | Plan validates with `npx tsc --noEmit` + targeted vitest only. CI handles full build. |

## Validation contract (per gap, before commit)

```bash
npx tsc --noEmit                                    # must be clean
npx vitest run <files-touched-by-this-gap>          # must pass
npx vitest run src/engine/__tests__/goldenCompanies.spec.ts \
              src/engine/__tests__/goldenCompanySuite.spec.ts \
              src/lib/__tests__/companyRegistryStore.spec.ts  # regression net
```

Then push branch + open PR + watch CI's `validate` job (which runs full `npm test`). Squash-merge on green. Use the existing `agent-pr-loop` skill.

**Do not run `npm run validate` locally** — it times out at 300s on this Windows host. CI runs it.

---

## Gap 1 — Concept Identity Layer (HIGHEST IMPACT)

### What exists
`src/engine/conceptOntology.ts` has 13 concepts as `ConceptDefinition` objects with `id`, `label`, `statement`, `aliases`, `valuationRelevance`, `sectorRelevance`. There's `summarizeConceptCoverage()` and `rankUnmappedLabels()`. **No conflict detection. No statement-owner check across periods.**

### What to add (don't replace)
Extend `ConceptDefinition`:
```ts
statementOwner: "BS" | "IS" | "CF" | "SD";   // alias for existing 'statement', narrowed
signConvention: "asset" | "liability" | "income" | "expense" | "flow";
aggregationBehavior: "sum" | "latest" | "none";
providerRelevance?: ("Capitaline" | "Screener" | "XBRL" | "JSON" | "Manual")[];
```
The existing `statement` field maps directly to `statementOwner` (BalanceSheet→BS, ProfitLoss→IS, CashFlow→CF, Derived→SD).

Add valuation-critical concepts that today live only in `recast.ts` and `valuation.ts`:
- `noa` (Net Operating Assets, statement=Derived)
- `nfo` (Net Financial Obligations, statement=Derived)
- `cse` (Common Shareholders' Equity, statement=Derived)
- `oa`, `ol`, `fa`, `fo` (Operating/Financial Assets/Liabilities, statement=Derived from BS)
- `oi` (Operating Income), `coreOI`, `unusualOI`, `nfe`, `cni` (statement=Derived from IS)
- `rnoa` (statement=Derived)

Add `ConflictClass` and `ConceptConflict` per brief. Add `detectConflicts(rawData: RawPeriodData[])`:
- For each concept, find its alias matches per period
- `cross-statement-conflict`: same alias matched in two different statements within one period
- `duplicate-source`: same concept resolved via two different aliases in the same period
- `unresolved`: valuation-critical concept with no match in latest period

Wire into `analysisTraceability.ts`:
- New field: `conceptIdentity: { status: "clean"|"conflicts-present"|"valuation-blocked"; conflictCount; unresolvedCriticalCount; conflicts: ConceptConflict[] }`
- New gate in `structurally-reconciled` checkpoint: requires `conceptIdentity.status !== "valuation-blocked"`
- New rigor check: `unresolvedCriticalCount > 0` ⇒ ladder cannot reach `valuation-eligible`

Bump `TRACEABILITY_SCHEMA_VERSION` to `"2026-06-traceability-v9"`. Update sanitizer in `companyRegistrySnapshot.ts` to reject older envelopes (already filters by schema; verify).

### Files
| File | Change |
|---|---|
| `src/engine/conceptOntology.ts` | Extend ConceptDefinition; add CONCEPT_ONTOLOGY entries for derived concepts; export `detectConflicts`, `ConflictClass`, `ConceptConflict` |
| `src/engine/types.ts` | Add `conceptIdentity` to `AnalysisTraceabilityEnvelope` |
| `src/engine/analysisTraceability.ts` | Compute conceptIdentity in `buildAnalysisTraceability`; gate rigor levels |
| `src/engine/policyVersions.ts` | Bump TRACEABILITY_SCHEMA_VERSION to v9 |
| `src/components/RunInspector.tsx` | Surface conceptIdentity status row |
| `src/lib/companyRegistrySnapshot.ts` | Sanitize new field; reject pre-v9 envelopes |
| `src/engine/__tests__/conceptIdentity.spec.ts` | NEW — clean lookup, alias resolution, cross-statement conflict, duplicate-source, unresolved-critical valuation block |

### Risks
- Touching `analysisTraceability.ts` could ripple to many UI surfaces. Mitigation: add the new field as **optional** in v9 envelope; existing surfaces keep working.
- Schema bump invalidates persisted comparison registries in users' localStorage. **This is intentional** (the brief calls for it) — they re-run.

---

## Gap 2 — Economic Sanity Gates

### What exists
- `src/engine/structuralBreakDetector.ts` flags major events
- `src/engine/structuralEventAdjuster.ts` applies adjustments
- `src/engine/anomalyDetection.ts` raises soft warnings
- **No hard gate. No fallback anchor logic. No demerger contamination check.**

### What to add
Create `src/engine/economicSanityGates.ts` with five checks per brief. Each returns `{ checkId, passed, reason, severity: "block"|"warn" }`. Compose into:
```ts
export function evaluateEconomicSanity(periods: RecastPeriod[], rawData: RawPeriodData[], unusualManifest: UnusualItemClassification[]): EconomicSanitySummary
```

**Anchor selection algorithm** (Check E):
```
for period of latest..first:
  if all of (A,B,C,D) pass for period: return { anchor: period, skipped: [...] }
return { anchor: null, blocked: true, reason: "no clean period in dataset" }
```

Wire results into `analysisTraceability.ts`:
- New field: `economicSanity: { status: "passed"|"warned"|"blocked"; anchorPeriod: string; anchorReason: string; failedChecks: [...] }`
- Gate: `economicSanity.status === "blocked"` ⇒ ladder stops at `structurally-reconciled`
- Gate: `economicSanity.status === "warned"` ⇒ ladder reaches `economically-plausible` with warning carried into `valuation-eligible`

Surface anchor period in `ValuationReport.tsx` header (first-class, not footnote).

Bump schema to `v10`.

### Files
| File | Change |
|---|---|
| `src/engine/economicSanityGates.ts` | NEW |
| `src/engine/types.ts` | Add `economicSanity` field to envelope |
| `src/engine/analysisTraceability.ts` | Compute + gate |
| `src/engine/policyVersions.ts` | v10 |
| `src/components/ValuationReport.tsx` | Anchor period header |
| `src/engine/__tests__/economicSanityGates.spec.ts` | NEW — 5 checks + fallback anchor |

### Open questions
- Q: What counts as "major capital transaction" threshold? Brief says >5% buyback, >10% rights. Confirm against `corporateActions.ts` existing thresholds; reuse those constants.
- Q: Dirty-surplus residual: 3% of CSE for 2+ consecutive periods. Existing `fcfeDirtySurplus.ts` may already compute residuals. Reuse not duplicate.

---

## Gap 3 — Unusual-Item & Capital-Transaction Policy

### What exists
`src/engine/unusualItemPolicy.ts` returns `UnusualItemPolicySummary` with `UnusualItemBucket[]`. Buckets have `type`, `affectsCoreOI`, `affectsCoreNFE`, `blocksTerminalValuation`. **Lacks**: 11-category enum, deterministic rule strings (today uses period flags from spec), per-run manifest with `classificationSource` + `rationale`.

### What to add
Add to `unusualItemPolicy.ts`:
```ts
export type UnusualItemCategory =
  | "asset-sale-gain-loss" | "fair-value-change" | "impairment"
  | "litigation" | "restructuring" | "demerger-scheme-effect"
  | "one-time-tax" | "discontinued-operations" | "buyback"
  | "special-dividend" | "capital-return" | "unclassified";

export interface UnusualItemClassification {
  period: string;
  rawLabel: string;
  value: number;
  category: UnusualItemCategory;
  affectsCoreOI: boolean;
  affectsTerminalEligibility: boolean;
  affectsCleanSurplus: boolean;
  classificationSource: "rule-based" | "heuristic" | "manual";
  rationale: string;  // include the matched rule
}

export const CLASSIFICATION_RULES: Record<UnusualItemCategory, RegExp[]> = { ... };

export function classifyRunUnusualItems(
  recastData: RecastPeriod[],
  rawMetrics: RawPeriodData[]
): UnusualItemClassification[]
```

Each rule is a literal regex array (case-insensitive after normalization). One regex match → category resolved → rationale = matched pattern + label. No fuzzy logic.

Wire into envelope:
```ts
unusualItemManifest: {
  totalUnusualImpactOnCoreOI: number;
  terminalEligibilityBlocked: boolean;
  classifications: UnusualItemClassification[];
  unclassifiedCount: number;
}
```

Feed `terminalEligibilityBlocked` into Gap 2's `economicSanity` block check.

Bump schema to `v11`.

### Files
| File | Change |
|---|---|
| `src/engine/unusualItemPolicy.ts` | Extend with new types, rules, classifier |
| `src/engine/types.ts` | Add `unusualItemManifest` field |
| `src/engine/analysisTraceability.ts` | Wire manifest |
| `src/engine/policyVersions.ts` | v11; bump UNUSUAL_ITEM_POLICY_VERSION |
| `src/engine/__tests__/unusualItemPolicy.spec.ts` | EXTEND — at least one positive + negative per category (22 tests minimum) |

---

## Gap 4 — Per-Number Lineage

### What exists
- `src/engine/statementLineage.ts` already exists. Read first.
- `auditSnapshot.ts` carries run-level traceability but not per-number.

### What to add
Create `src/engine/lineageTypes.ts` with `NumberLineage` per brief. Instrument 8 numbers: NOA, NFO, CSE, CoreOI, RNOA, IntrinsicValuePerShare, FreeCashFlow, PAT.

Implementation pattern: thread a `lineageBuilder` object through `recast.ts` and `valuation.ts`. Each transformation calls `lineageBuilder.addStep(conceptId, period, step, sourceKeys, decisions)`. At the end, materialize `lineage: Record<conceptId+period, NumberLineage>`.

Add a "Provenance" sheet to `excelExport.ts` (uses exceljs, not xlsx). Sheet renders 8 numbers × periods × source keys × transformation steps × policy decisions in human-readable form.

Add accordion drilldown in `RunInspector.tsx` — click any of the 8 keys → expand lineage. Use existing collapsible pattern.

Bump schema to `v12`.

### Files
| File | Change |
|---|---|
| `src/engine/lineageTypes.ts` | NEW |
| `src/engine/recast.ts` | Thread lineage builder through NOA/NFO/CSE computation |
| `src/engine/valuation.ts` (or wherever IV is computed) | Thread lineage through IV/FCF |
| `src/engine/pipeline.ts` | Aggregate lineage into envelope |
| `src/engine/excelExport.ts` | Provenance sheet |
| `src/components/RunInspector.tsx` | Drilldown accordion |
| `src/engine/__tests__/numberLineage.spec.ts` | NEW |

### Risks
- Threading lineage through recast/valuation touches the hottest code paths. Mitigation: lineage is **opt-in via builder**; default behavior identical when builder is null.

---

## Gap 5 — Workbook Regression Tests

### What exists
- `src/engine/__tests__/excelExport.spec.ts` (388 lines, 5 it() blocks). Already opens generated workbooks via exceljs and asserts cells.
- `excelExport.ts` generates Cover, Statements, Ratios, Valuation, Traceability sheets.

### What to add
Extend, do not duplicate. Add to existing `excelExport.spec.ts`:

1. **Sheet manifest test**: assert exact list of sheet names; fail on additions or removals
2. **Cover assertions**: company name, run ID, generation timestamp, rigor level — all match envelope
3. **Traceability assertions**: parser fidelity / reconciliation / rigor matches envelope
4. **Valuation assertions**: IV per share within ±0.01 of in-memory `ValuationResult`
5. **Provenance sheet assertions** (post-Gap 4): all 8 lineage rows present, source keys non-empty

Document expected schema in `docs/workbook-regression-contract.md` per brief.

### Files
| File | Change |
|---|---|
| `src/engine/__tests__/excelExport.spec.ts` | EXTEND with 5 new it() blocks |
| `docs/workbook-regression-contract.md` | NEW |

### Risk
Workbook spec changes are intentional sometimes. Doc explains how to update expectations.

---

## Gap 6 — Golden Suite Expansion

### What exists
6 synthetic cases in `goldenCompanySuite.ts`. Real-data tests: only `bajajFinance.spec.ts` and `goldenCompanies.spec.ts` (170 tests, but those are registry-validation, not engine-output assertions).

### What to add
Pull 4 real fixtures from existing `public/data/companies/` ZIPs, register as golden cases:

1. **Asian Paints** — clean industrial (already in registry)
2. **Reliance Industries** OR **Tata Steel** — has demergers/big events. Verify via `corporateActions.ts` flags on the loaded data; pick whichever flags more events.
3. **HDFC Bank** — already in registry; tests BFSI recast
4. **NTPC** OR **Tata Power** — capital-intensive, high debt. Pick the one in registry.

For each, create `public/data/companies/<folder>/expectations.json` per brief schema (rigor level, parser fidelity, reconciliation, economic sanity, key-metric tolerance bands, anomaly flags, unusual-item count range).

Extend `goldenCompanySuite.spec.ts` to load each via `parseCapitalineZip` from the actual ZIP and validate against expectations.

### Files
| File | Change |
|---|---|
| `src/engine/goldenCompanySuite.ts` | Add 4 real-data cases (load from ZIP path, not synthetic recasts) |
| `public/data/companies/<each>/expectations.json` | NEW × 4 |
| `src/engine/__tests__/goldenCompanySuite.spec.ts` | EXTEND validations: rigor, parserFidelity, reconciliation, economicSanity, ratio bands, unusualItemCount range |

### Open question
- Q: Synthetic vs real for the demerger case. Reliance has confirmed demergers in last 5y. Verify the loaded ZIP carries those periods. If not, pick another company or stick with synthetic `EXCEPTIONAL_EVENT_CO`.

---

## Gap 7 — Residuals Dashboard

### What to add
Create `src/lib/residualsStore.ts` with `RunResidualSummary` per brief. Persist via existing localStorage + shared API pattern (mirror `companyRegistryStore.ts`).

Compute summary after each `buildAnalysisTraceability()` call. Append to store. Cap at 100 per company.

Create `src/components/ResidualsPanel.tsx`:
- SVG sparkline (no chart library) of `overallResidualScore` last N runs
- Table: last 5 summaries
- Threshold badge: green <20, amber 20-40, red >40

Add to existing Debug tab as a sub-panel (don't create a new top-level tab — process rule).

Production-ready gate in `analysisTraceability.ts`:
```
if economicSanity.status === "passed"
   && unresolvedCriticalCount === 0
   && residualScore > 40
   && claimedLevel === "production-ready":
  downgrade to "valuation-eligible"
  add note: "Residual score X exceeds production threshold of 40"
```

### Files
| File | Change |
|---|---|
| `src/lib/residualsStore.ts` | NEW |
| `src/components/ResidualsPanel.tsx` | NEW |
| `src/components/DebugPanel.tsx` | Mount ResidualsPanel as sub-section |
| `src/engine/analysisTraceability.ts` | Production-ready downgrade |
| `src/lib/__tests__/residualsStore.spec.ts` | NEW |

### Open question
- Q: How to compute `intrinsicValueSensitivity` (% IV change from ±10% RNOA shock)? Probably easiest: re-run valuation with config.rnoa shocked. Avoid double-running per UI render — compute once at envelope build.

---

## Smaller items (after Gaps 1-7 if budget remains)

- **Item A**: Wire trust gate badge into `DebugPanel.tsx` and any workspace surface that displays NOA/CSE/RNOA/IV. Mirror `ValuationReport.tsx` pattern.
- **Item B**: Source-native anomaly counts in Screener/JSON/Manual/XBRL parsers. Add `coercionCount`, `outlierCount`, `discardedContextCount` to `parserFidelity.checks`.
- **Item C**: Split `engine-advanced-analytics` chunk by removing manual chunk forcing in `vite.config.ts`. Verify `npm run build` (CI only) shows no circular warnings.

---

## Sequencing & PR strategy

One PR per gap. Squash-merge each on green CI before starting next.

```
PR-A  Gap 1 — concept identity (schema v9)
PR-B  Gap 2 — economic sanity (schema v10)
PR-C  Gap 3 — unusual item taxonomy (schema v11)
PR-D  Gap 4 — number lineage (schema v12, exceljs Provenance sheet)
PR-E  Gap 5 — workbook regression tests
PR-F  Gap 6 — golden suite + 4 expectations files
PR-G  Gap 7 — residuals store + dashboard
PR-H  Smaller items A+B+C (one PR if all small)
```

Process rules from brief:
- No new top-level tabs; extend existing surfaces
- Every new module exports its primary types; no `any`
- Every new engine file has __tests__ before gap counts as done
- Update `docs/analysis-rigor-ladder.md` after each gap
- Update sanitizer when schema bumps

---

## Risks & mitigations (overall)

| Risk | Mitigation |
|---|---|
| Schema bumps × 4 invalidate users' localStorage data | Documented in PR descriptions; existing pattern handles re-hydration |
| Touching `analysisTraceability.ts` 4 times causes merge conflicts if not sequential | Strictly serialize PR-A through PR-D |
| `npm test` has 80+ spec files; gaps may cascade failures | Each PR runs targeted vitest first; CI runs full suite as gate |
| Lineage threading slows recast | Builder is opt-in; default null = no overhead |
| Real-data golden fixtures may differ between local + CI | Use the ZIP files already in `public/data/companies/`; deterministic |

## Out of scope (explicit non-goals)

- Refactoring existing tests that currently pass
- Adding chart libraries (SVG-only per brief)
- Auto-updating expectation files (must fail loudly, per brief)
- Running `test:audit` in CI (stays opt-in per recent PR #139)
- Running `npm run validate` locally (times out)

## Iteration log

| Iter | What changed | Why |
|---|---|---|
| v1 | Initial transcription of brief into Hermes plan format | First pass |
| v2 | Verified files exist, found `conceptOntology.ts` and `unusualItemPolicy.ts` already exist | Prevents duplicate-creation; brief implied greenfield |
| v3 | Verified exceljs (not xlsx) is the workbook lib; schema v8 current; 32 companies in registry; audit shards opt-in via PR #139; `npm run validate` times out at 300s | Empirical grounding so executor doesn't rediscover surprises |
