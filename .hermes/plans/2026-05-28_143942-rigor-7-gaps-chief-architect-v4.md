# Plan v4 — Chief Architect: Rigor Ladder to 10/10 (Production-Grade)

**Created:** 2026-05-28
**Status:** Draft v4 — supersedes v3 (`2026-05-28_143130-rigor-7-gaps-implementation.md`)
**Repo:** penman-v2-analysis
**Author posture:** Chief architect, accountable for shipping safely to a live Vercel deployment

---

## Why v4

v3 was an engineer's checklist. This is the architect's contract. The brief identified 7 gaps. Closing them is necessary but not sufficient. Production-grade means **the system stays reliable while gaps are closed** — schema migrations must not break persisted state, memory must not regress, gates must be reversible, performance budgets must be enforced, and rollout must be observable.

The four loose ends v3 underspecified:

1. **Schema versioning strategy** — 4 sequential bumps (v9→v12) without a migration story. Real users have v8 envelopes in localStorage and audit blobs.
2. **Memory & bundle budgets** — Gap 4 lineage and Gap 7 residuals add per-run state; uncapped, they reintroduce the churn we just removed in PR #134.
3. **Feature flags & kill switches** — every new gate (Gap 1 critical-concept block, Gap 2 economic block, Gap 7 residual downgrade) can produce false positives that brick valuation. We need to disable them without redeploying.
4. **Operational gates** — what does "done" mean? Currently: tests pass + PR merged. That ships bugs. Done = shipped + observed clean for 1 release cycle + rollback rehearsed.

---

## Empirical context (re-verified for v4)

| Fact | Source of truth | Plan implication |
|---|---|---|
| Schema version | `src/engine/policyVersions.ts:8` → `"2026-04-traceability-v8"` | 4 bumps planned. Each must include a sanitizer guard. |
| LocalStorage namespaces in use | `penman.audit.pending-events.v1`, `pending-failures.v1`, `recent-runs.v1`, `company-registry.v1`+`.v2`, `research.workspace.v1`+`.v2`, `penman_trace_log` | New stores must follow the `penman.<feature>.<vN>` convention. |
| Audit snapshot size budget | `auditSnapshot.ts` is 82 lines, but writes the **full envelope + rawData + recastData**. ZIPs are 14MB each at rest. Audit blob cap is 64MB (`VITE_AUDIT_MAX_UPLOAD_BYTES`). | Gap 4 lineage must NOT bloat the envelope unbounded; cap or sidecar it. |
| `pipeline.ts` size | 328 lines | Lineage threading must not turn it into a 1000-line monster. Keep builder pattern external. |
| `types.ts` size | 1054 lines | New types added per gap; budget +50 lines per gap, refactor at +250. |
| Existing shared-API endpoints | `fetchSharedComparisonRegistry`, `syncSharedComparisonRegistry` in `src/lib/sharedResearchApi.ts` | Gap 7 residuals can reuse this pattern; don't add a new API surface. |
| Branch protection | `main` requires `validate` status check; admins enforced (per PR #134 verification) | Every PR is gated by full `npm test`. CI is the merge oracle, not local. |
| `npm run validate` local timeout | 300s (Windows host) | All local validation is targeted: tsc + relevant vitest only. |
| Existing feature flag plumbing | None in code; only env vars (`VITE_AUDIT_*`) | Need to introduce a **lightweight runtime feature-flag** module before Gap 1. |
| Test count | 80+ spec files (was reported as "120 tests" in brief; actual count higher) | Validation contract uses `vitest run` on touched + regression net; full count is whatever CI reports. |

---

## Architectural posture & non-negotiables

These are inviolable across all 7 gaps.

### N-1: Schema bumps are reversible
Every envelope schema bump (v9-v12) ships with:
- Sanitizer in `companyRegistrySnapshot.ts` that **rejects** older envelopes with `null` (forces re-run, never silently re-hydrates)
- Sanitizer in `auditSnapshot.ts` that **omits** older envelopes from comparison views
- Migration telemetry: log via `trace("config", "schemaMigration", { from: "v8", to: "v9", count })`
- ADR file at `docs/adr/<NNN>-traceability-schema-vN.md` documenting why the bump

### N-2: Every new gate has a kill switch
Gates that block valuation or downgrade rigor must be guarded by a **feature flag** read from `import.meta.env`:
- `VITE_RIGOR_CONCEPT_IDENTITY_BLOCK` (Gap 1)
- `VITE_RIGOR_ECONOMIC_SANITY_BLOCK` (Gap 2)
- `VITE_RIGOR_TERMINAL_ELIGIBILITY_BLOCK` (Gap 3, derived from Gap 2)
- `VITE_RIGOR_RESIDUAL_SCORE_DOWNGRADE` (Gap 7)

Default: `"true"` in production, but flippable to `"false"` via Vercel env to disable a gate without code redeploy. Soft-block: when flag is off, gate computes and surfaces in UI but **does not** affect rigor level.

### N-3: Memory budgets are explicit
Every new persisted/memoized state has a budget:

| Surface | Budget | Enforcement |
|---|---|---|
| `lineage` field in envelope | ≤50KB per run | Gap 4 caps `transformationSteps` at 20 entries, `policyDecisionsApplied` at 10 |
| `residualsStore` per company | ≤100 entries (per brief) + total store ≤5MB | Gap 7 measures size before write; evicts oldest companies if total > 5MB |
| `conceptIdentity.conflicts` | ≤200 conflicts | Gap 1 truncates and logs warning |
| `unusualItemManifest.classifications` | ≤500 classifications (rare ceiling) | Gap 3 truncates |
| Idle-tick allocation | 0 net allocations on idle pages (regression of PR #134) | Add a manual benchmark task in `scripts/perf-idle-allocation.mjs` |

### N-4: No new top-level tabs
Per brief process rule. All new surfaces extend existing components: `RunInspector`, `ValuationReport`, `DebugPanel`, `ResidualsPanel-as-DebugSubpanel`. Confirm in PR review.

### N-5: No `any` in new code
Per brief process rule. ESLint already enforces; new modules must export their primary types.

### N-6: Bundle size budget
Each gap adds ≤30KB gzipped to the production bundle. Measured via `npm run build` chunk reports in CI. PR fails review if exceeded without justification.

### N-7: Lineage is sidecar, not envelope
**Architectural correction from v3.** The brief says "store the full lineage map in the traceability envelope." Real-world implication: envelope is JSON-stringified for audit blobs, comparison registry, localStorage. 8 numbers × 12 periods × ~1KB each = 96KB. Multiplied across 32 companies in registry = 3MB just for lineage. **Lineage goes in the audit snapshot only**, not the envelope; envelope carries a `lineageRef` (boolean + checksum), and the snapshot is fetched on-demand by the run inspector.

### N-8: The pipeline must remain pure
`pipeline.ts` continues to be a deterministic, side-effect-free function of (rawData, config, sidecars). Gates and lineage are computed in **layered** post-processors, not threaded through math code. Math correctness is one concern; auditability is another concern.

### N-9: Fail loud, never fail silent
Gates that block rigor must produce a human-readable reason string visible in the UI. No silent downgrades. Every block path has a corresponding "why" in the run inspector.

### N-10: Test pyramid
- **Unit:** every new module has a `__tests__/<module>.spec.ts` with ≥5 cases (positive, negative, edge, regression, schema-bump round-trip)
- **Integration:** golden suite (Gap 6) exercises real ZIPs end-to-end through the new gates
- **Workbook:** Gap 5 asserts cell-level
- **Schema-migration:** dedicated spec asserting v8→v9 reject path
- **Idle-perf:** scripted measurement in `scripts/perf-idle-allocation.mjs`, run quarterly, not in CI

---

## Cross-cutting infrastructure (do FIRST, before Gap 1)

These three foundations unlock the gap PRs. Build them in **PR-0** before any gap PR.

### CC-A: Feature flag module
**File:** `src/lib/featureFlags.ts`
**Surface:**
```ts
export type FlagName =
  | "rigor.conceptIdentityBlock"
  | "rigor.economicSanityBlock"
  | "rigor.terminalEligibilityBlock"
  | "rigor.residualScoreDowngrade";

export function isEnabled(name: FlagName): boolean;
```
Reads `import.meta.env.VITE_RIGOR_<UPPER_NAME>`. Default policy: enabled. `"false"` literal disables. Test: `__tests__/featureFlags.spec.ts` covers default-on, explicit-off, malformed-value-defaults-to-on.

### CC-B: ADR directory
**File:** `docs/adr/000-process-and-template.md` and template.
Each subsequent schema bump or major architectural decision gets a numbered ADR (001, 002...).

### CC-C: Migration telemetry helper
**File:** `src/lib/schemaMigration.ts`
**Surface:**
```ts
export function recordSchemaMigration(from: string, to: string, ctx: { source: "envelope"|"registry"|"snapshot"; companyId?: string }): void;
```
Logs via `trace("config", "schemaMigration", ...)`. Bumps a counter in `localStorage["penman.schema-migrations.v1"]` capped at 100 entries. Surface count in DebugPanel for ops visibility.

### PR-0 (cross-cutting infrastructure)
**Branch:** `infra/feature-flags-adr-migration-helpers`
**Scope:** CC-A + CC-B + CC-C only. No gap logic.
**Tests:** unit specs for featureFlags + schemaMigration helpers; ADR template files exist.
**Risk:** zero (pure additions, no behavior change).
**Merge gate:** typecheck + targeted vitest + CI green.

---

## Gap-by-gap (chief architect detail)

Each gap below carries: rationale, scope cuts, contract (types + observable behavior), files, tests, risks, observability, kill switch, definition of done, rollback.

---

### PR-A — Gap 1: Concept Identity Layer (schema → v9)

#### Rationale
Highest leak: a single concept can have two identities across periods (e.g., "Trade Receivables" mapped to BS in 2022 and silently to IS in 2024). This corrupts ratios and makes audit irreproducible.

#### Scope cuts (NOT in this PR)
- Don't refactor `summarizeConceptCoverage` or `rankUnmappedLabels` — they keep working.
- Don't add concept editing UI; conflicts surface read-only.

#### Contract
**Extend `ConceptDefinition` in `src/engine/conceptOntology.ts`:**
```ts
export type StatementOwner = "BS" | "IS" | "CF" | "SD";
export type SignConvention = "asset" | "liability" | "income" | "expense" | "flow";
export type AggregationBehavior = "sum" | "latest" | "none";
export type DataProvider = "Capitaline" | "Screener" | "XBRL" | "JSON" | "Manual";

export interface ConceptDefinition {
  id: string;
  label: string;
  statement: "BalanceSheet" | "ProfitLoss" | "CashFlow" | "Derived";  // existing, retained
  statementOwner: StatementOwner;             // new — strictly derived from `statement`
  signConvention: SignConvention;             // new
  aggregationBehavior: AggregationBehavior;   // new
  aliases: string[];                          // existing
  valuationRelevance: "core" | "supporting" | "optional";  // existing
  sectorRelevance?: string[];                 // existing
  providerRelevance?: DataProvider[];         // new — empty = all providers
}

export type ConflictClass =
  | "exact" | "alias" | "fuzzy-review" | "cross-statement-conflict"
  | "duplicate-source" | "unresolved";

export interface ConceptConflict {
  conceptId: string;
  conflictClass: ConflictClass;
  rawLabels: string[];
  statements: string[];
  affectedPeriods: string[];
  resolution?: string;
}

export function detectConflicts(
  rawData: RawPeriodData[],
  registry?: ConceptDefinition[]   // default: CONCEPT_ONTOLOGY
): ConceptConflict[];
```

**Add to envelope (`AnalysisTraceabilityEnvelope`):**
```ts
conceptIdentity: {
  status: "clean" | "conflicts-present" | "valuation-blocked";
  conflictCount: number;
  unresolvedCriticalCount: number;
  conflicts: ConceptConflict[];   // capped at 200, with `truncated: true` flag
};
```

**Gate behavior:**
- `unresolvedCriticalCount > 0` AND `isEnabled("rigor.conceptIdentityBlock")` ⇒ rigor cannot reach `valuation-eligible`
- When flag is off: surface in UI but don't block

**Schema bump:** `policyVersions.ts` → `"2026-06-traceability-v9"`. Sanitizer in `companyRegistrySnapshot.ts` returns `null` for any envelope where `schemaVersion !== TRACEABILITY_SCHEMA_VERSION`. `recordSchemaMigration("v8", "v9", ...)` called when reject happens.

#### Files
| File | Change |
|---|---|
| `src/engine/conceptOntology.ts` | Extend types, add ~15 derived concepts (NOA/NFO/CSE/OA/OL/FA/FO/CoreOI/UOI/NFE/CNI/RNOA + others), export `detectConflicts` |
| `src/engine/types.ts` | Add `conceptIdentity` to envelope (≤50 lines) |
| `src/engine/analysisTraceability.ts` | Compute conceptIdentity; gate behind feature flag |
| `src/engine/policyVersions.ts` | Bump to v9 |
| `src/lib/companyRegistrySnapshot.ts` | Strict version check + reject + telemetry |
| `src/components/RunInspector.tsx` | New status row (matches existing parser fidelity row pattern) |
| `src/engine/__tests__/conceptIdentity.spec.ts` | NEW — see test matrix below |
| `docs/adr/001-concept-identity-layer.md` | NEW |
| `docs/analysis-rigor-ladder.md` | Document new gate |

#### Test matrix (`conceptIdentity.spec.ts`)
1. Clean registry lookup: every concept in CONCEPT_ONTOLOGY has unique id
2. Alias resolution: each defined alias resolves correctly
3. Cross-statement conflict: same alias appears in BS and IS in same period → `cross-statement-conflict` class
4. Duplicate source: two raw labels both resolve to `noa` in one period → `duplicate-source` class
5. Unresolved critical: required concept has no match in latest period → `unresolved` class
6. Schema-bump round-trip: envelope serialized at v8 returns null from sanitizer; v9 round-trips clean
7. Feature flag off: gate computes but rigor unchanged
8. Conflict cap: 250 synthetic conflicts truncated to 200 with `truncated: true`

#### Observability
- New trace category usage: `trace("rigor", "conceptIdentity:detected", { conflictCount, unresolvedCriticalCount })`
- DebugPanel shows current envelope schema version + last migration count
- RunInspector surface row green/amber/red by `conceptIdentity.status`

#### Risks
| Risk | Severity | Mitigation |
|---|---|---|
| False-positive conflicts in golden companies | High | Run goldenCompanies + goldenCompanySuite as part of PR's targeted vitest BEFORE push. If any company regresses, fix the alias list before merge. |
| Persisted v8 envelopes silently break comparison view | Med | Sanitizer rejects with telemetry; UI shows "X companies need re-run" in DebugPanel |
| Lint rule for `any` blocks something legitimate | Low | Use `unknown` and narrow |

#### Definition of Done
- [ ] PR merged on green CI
- [ ] All 32 golden registry companies still produce traceability envelope (re-run after merge)
- [ ] DebugPanel shows zero migration errors after 1 day of internal use
- [ ] No bundle size regression beyond +5KB gzipped
- [ ] ADR-001 referenced from `analysis-rigor-ladder.md`

#### Rollback
1. Set Vercel env `VITE_RIGOR_CONCEPT_IDENTITY_BLOCK=false` → gate goes soft
2. If pathological: revert PR-A on `main`, push, redeploy. Persisted v9 envelopes are forward-compat (extra fields ignored at v8).

---

### PR-B — Gap 2: Economic Sanity Gates (schema → v10)

#### Rationale
Structural reconciliation says "the math adds up." Economic sanity says "the math is meaningful." Terminal-period contamination (e.g., a one-time impairment in the most recent period) silently corrupts terminal value and hence intrinsic value.

#### Scope cuts
- Re-use existing residual computations from `fcfeDirtySurplus.ts` (Check B); don't reinvent.
- Re-use thresholds from `corporateActions.ts` (Check A); make them shared constants.
- Don't add automatic anchor selection UI controls; surface read-only.

#### Contract
**`src/engine/economicSanityGates.ts`:**
```ts
export type GateCheckId =
  | "terminal-period-contamination"
  | "dirty-surplus-integrity"
  | "implausible-rnoa-jump"
  | "demerger-discontinued-contamination"
  | "anchor-period-selection";

export interface GateCheckResult {
  checkId: GateCheckId;
  passed: boolean;
  reason: string;
  severity: "block" | "warn";
  affectedPeriods: string[];
}

export interface EconomicSanitySummary {
  status: "passed" | "warned" | "blocked";
  anchorPeriod: string | null;
  anchorReason: string;
  skippedPeriods: { period: string; reason: string }[];
  failedChecks: GateCheckResult[];
}

export function evaluateEconomicSanity(
  periods: RecastPeriod[],
  rawData: RawPeriodData[],
  unusualManifest?: UnusualItemClassification[]
): EconomicSanitySummary;
```

**Anchor algorithm (deterministic):**
```
for period in periods.reverse():
  if all (A,B,C,D) pass for this period:
    return { anchor: period, skipped: above }
  else:
    skipped.push({ period, reason: failedChecks.map(c => c.checkId).join(",") })
return { anchor: null, blocked: true, reason: "no clean period in N-period window" }
```

**Envelope:**
```ts
economicSanity: EconomicSanitySummary;
```

**Gate behavior:**
- `economicSanity.status === "blocked"` AND `isEnabled("rigor.economicSanityBlock")` ⇒ rigor stops at `structurally-reconciled`
- `"warned"` ⇒ reaches `economically-plausible` carrying warning forward to `valuation-eligible`

**Schema bump:** v10. Sanitizer guards as before.

#### Files
| File | Change |
|---|---|
| `src/engine/economicSanityGates.ts` | NEW (~250 lines) |
| `src/engine/types.ts` | Add `economicSanity` field |
| `src/engine/analysisTraceability.ts` | Compute + gate + chain rigor |
| `src/engine/policyVersions.ts` | v10 |
| `src/lib/companyRegistrySnapshot.ts` | Sanitizer guard updated |
| `src/components/ValuationReport.tsx` | Anchor period in header (first-class) |
| `src/engine/__tests__/economicSanityGates.spec.ts` | NEW — 5 checks × pos/neg + anchor algorithm + flag-off |
| `docs/adr/002-economic-sanity-gates.md` | NEW |
| `docs/analysis-rigor-ladder.md` | Document |

#### Resolved open questions from v3
| Q | Decision |
|---|---|
| Major-capital-transaction thresholds | Centralize as exported constants in `corporateActions.ts` (`BUYBACK_PCT_OF_CSE = 0.05`, `RIGHTS_PCT_OF_CSE = 0.10`); economicSanityGates imports them. Single source of truth. |
| Dirty-surplus residual reuse | `fcfeDirtySurplus.computeDirtySurplusResidual()` called from Check B; do NOT duplicate. |
| RNOA jump cause-known check | If a major capital transaction (per Check A) AND an unusual item (per Gap 3 manifest) BOTH explain the jump, suppress Check C. Order: Gap 3 manifest must be threaded into evaluateEconomicSanity. |

#### Test matrix
1. Check A pos: latest-period buyback >5% CSE → block
2. Check A neg: small buyback → pass
3. Check B pos: 4% CSE residual two consecutive years → block
4. Check C pos: RNOA jump 30pp without capital event → warn
5. Check C neg: RNOA jump 30pp WITH capital event → suppress (no warn)
6. Check D pos: demerger flag in penultimate period → contaminated
7. Check E: clean N=3, contaminated N=4,5 → anchor=N=3, skipped logged
8. Check E all-bad: every period contaminated → status=blocked, anchor=null
9. Feature flag off: status=blocked but rigor unchanged
10. Schema round-trip v10

#### Risks
| Risk | Severity | Mitigation |
|---|---|---|
| Existing golden suite regresses (cases like `EXCEPTIONAL_EVENT_CO`) | High | Update those cases' expectations FIRST — test-driven. They should expect status="blocked" or "warned" now. |
| Gate stacks with Gap 1 → both block → user sees nothing valuable | Med | UI surfaces ALL block reasons, not just first. |
| Anchor algorithm picks too-old period when latest is barely contaminated | Med | Constant `MAX_ANCHOR_LOOKBACK_PERIODS = 3`; beyond that, status=blocked even if old period clean |

#### Observability
- `trace("rigor", "economicSanity:anchorSelected", { period, skippedCount })`
- `trace("rigor", "economicSanity:blocked", { reason })`
- Vercel deploy: monitor logs for spike in `economicSanity:blocked` events post-deploy

#### Definition of Done
Same DoD shape as PR-A plus:
- [ ] All 6 existing golden suite cases re-validated with updated expectations
- [ ] `MAX_ANCHOR_LOOKBACK_PERIODS` documented in ADR-002

#### Rollback
1. `VITE_RIGOR_ECONOMIC_SANITY_BLOCK=false` → soft
2. Revert PR-B if pathological. v10 envelopes forward-compat with v9 readers.

---

### PR-C — Gap 3: Unusual-Item Policy (schema → v11)

#### Rationale
Today: implicit classification via `spec_flags`. Tomorrow: deterministic taxonomy with rationale. A reviewer reading the audit can see exactly why "Profit on sale of investments — ₹450cr" was classified as `asset-sale-gain-loss` and excluded from CoreOI.

#### Contract
**Extend `unusualItemPolicy.ts`:**
```ts
export type UnusualItemCategory =
  | "asset-sale-gain-loss" | "fair-value-change" | "impairment"
  | "litigation" | "restructuring" | "demerger-scheme-effect"
  | "one-time-tax" | "discontinued-operations" | "buyback"
  | "special-dividend" | "capital-return" | "unclassified";

export interface ClassificationRule {
  category: UnusualItemCategory;
  patterns: RegExp[];
  rationaleTemplate: string;
}

export const CLASSIFICATION_RULES: ClassificationRule[] = [...];

export interface UnusualItemClassification {
  period: string;
  rawLabel: string;
  value: number;
  category: UnusualItemCategory;
  affectsCoreOI: boolean;
  affectsTerminalEligibility: boolean;
  affectsCleanSurplus: boolean;
  classificationSource: "rule-based" | "heuristic" | "manual";
  rationale: string;     // contains matched pattern + reasoning
  matchedPattern?: string;
}

export function classifyRunUnusualItems(
  recastData: RecastPeriod[],
  rawMetrics: RawPeriodData[]
): UnusualItemClassification[];
```

**Envelope:**
```ts
unusualItemManifest: {
  totalUnusualImpactOnCoreOI: number;
  terminalEligibilityBlocked: boolean;
  classifications: UnusualItemClassification[];   // capped at 500
  unclassifiedCount: number;
};
```

`terminalEligibilityBlocked = classifications.some(c => c.affectsTerminalEligibility)`. Wired into Gap 2's Check A (additional contamination signal).

**Schema bump:** v11. Bump `UNUSUAL_ITEM_POLICY_VERSION` to `"2026-06-phase8"`.

#### Files
| File | Change |
|---|---|
| `src/engine/unusualItemPolicy.ts` | Extend (DON'T break existing `buildUnusualItemPolicy`) |
| `src/engine/types.ts` | Add `unusualItemManifest` |
| `src/engine/analysisTraceability.ts` | Wire manifest into envelope |
| `src/engine/economicSanityGates.ts` | Consume manifest in Check A |
| `src/engine/policyVersions.ts` | v11 + UNUSUAL_ITEM_POLICY_VERSION bump |
| `src/lib/companyRegistrySnapshot.ts` | Sanitizer guard |
| `src/engine/__tests__/unusualItemPolicy.spec.ts` | EXTEND — ≥22 cases (11 categories × pos+neg) + flag-off |
| `docs/adr/003-unusual-item-taxonomy.md` | NEW |

#### Test matrix
For each of 11 categories: 1 positive test (rule fires) + 1 negative test (close-but-not-match). Plus:
- Multi-category collision: rawLabel matches both `impairment` and `restructuring` → first-match-wins, with rationale noting the alternative.
- Cap at 500 with `truncated: true` flag.

#### Risks
- Regex patterns may over-match (e.g., "interest" includes "interest-rate hedge"). Mitigation: use word boundaries (`\b`) in patterns.
- Existing `buildUnusualItemPolicy` callers must keep working. Mitigation: new `classifyRunUnusualItems` is additive, doesn't replace.

#### Definition of Done
Same shape as PR-A/B plus:
- [ ] 22 test cases pass
- [ ] Manifest visible in run inspector

#### Rollback
- `VITE_RIGOR_TERMINAL_ELIGIBILITY_BLOCK=false` → manifest computed but Gap 2 ignores `terminalEligibilityBlocked`
- Revert if needed

---

### PR-D — Gap 4: Per-Number Lineage (schema → v12; sidecar pattern)

#### Rationale
Source-to-output traceability per number. Brief said "in envelope"; we override (N-7) to **sidecar** to keep envelope size bounded.

#### Architectural decision (overrides brief)
**Lineage lives in audit snapshot, not envelope.**
- Envelope carries: `lineageRef: { hasLineage: boolean; conceptCount: number; checksum: string } | null`
- Audit snapshot at `auditSnapshot.ts` carries the full `lineage: Record<string, NumberLineage>`
- RunInspector fetches snapshot to drill down

This keeps envelope serialization fast and bounds localStorage growth.

#### Contract
**`src/engine/lineageTypes.ts`:**
```ts
export interface NumberLineage {
  conceptId: string;
  period: string;
  finalValue: number;
  sourceMetricKeys: string[];        // capped at 50
  sourceStatements: ("BS"|"IS"|"CF"|"SD")[];
  transformationSteps: string[];     // capped at 20
  policyDecisionsApplied: string[];  // capped at 10
  confidence: "high"|"medium"|"low"|"estimated";
  warnings: string[];
}

export class LineageBuilder {
  add(conceptId: string, period: string): NumberLineageDraft;
  build(): Record<string, NumberLineage>;
  size(): number;     // bytes estimate
}
```

**Instrumented numbers (8):** NOA, NFO, CSE, CoreOI, RNOA, IntrinsicValuePerShare, FreeCashFlow, PAT.

Each transformation calls `lineageBuilder.addStep(conceptId, period, step, sourceKeys, decisions)`. Builder enforces caps; over-cap entries replace with `"... (N more)"`.

**Provenance sheet** added to `excelExport.ts`. Sheet renders 8 numbers × periods × source/transforms/policies. Self-contained (works without UI).

**RunInspector accordion** drills into lineage.

**Schema bump:** v12.

#### Files
| File | Change |
|---|---|
| `src/engine/lineageTypes.ts` | NEW |
| `src/engine/lineageBuilder.ts` | NEW (cap enforcement, builder pattern) |
| `src/engine/recast.ts` (or pipeline.ts) | Optional builder param; null = no-op (default) |
| `src/engine/valuation.ts` | Same |
| `src/engine/pipeline.ts` | Aggregate lineage; populate envelope `lineageRef` + snapshot `lineage` |
| `src/lib/auditSnapshot.ts` | Add `lineage` field to snapshot output |
| `src/engine/types.ts` | `lineageRef` on envelope |
| `src/engine/excelExport.ts` | Provenance sheet |
| `src/engine/policyVersions.ts` | v12 |
| `src/lib/companyRegistrySnapshot.ts` | Sanitizer (must NOT pull lineage from envelope) |
| `src/components/RunInspector.tsx` | Accordion drilldown |
| `src/engine/__tests__/numberLineage.spec.ts` | NEW |
| `docs/adr/004-lineage-sidecar.md` | NEW (explains override of brief) |

#### Test matrix
1. NOA lineage present, sourceKeys non-empty
2. Unusual-item exclusion appears in policyDecisionsApplied
3. Builder caps at 20 transformation steps with truncation marker
4. Builder size() returns reasonable estimate
5. envelope.lineageRef matches snapshot.lineage checksum
6. Snapshot serialization size <100KB for 12-period typical case
7. Builder = null path: pipeline produces same numbers, lineage absent
8. Provenance sheet present + populated in workbook (assertion via exceljs)

#### Memory & perf budgets
- Lineage builder: ≤50KB per run
- Pipeline runtime regression budget: <10% slower than baseline
- Workbook generation regression budget: <5% slower

#### Risks
| Risk | Severity | Mitigation |
|---|---|---|
| Threading builder through `recast.ts` mutates hot path | High | Builder is **opt-in via param**, defaults to null, null = zero overhead |
| Snapshot size explodes for 32-company comparison | Med | Snapshot is per-run, not aggregated; sized check in tests |
| Workbook drift breaks Gap 5 tests | Med | Gap 5 PR comes after; expectations updated in same PR |

#### Definition of Done
- [ ] 8 numbers have lineage
- [ ] Provenance sheet present
- [ ] RunInspector drilldown works
- [ ] Pipeline benchmark within 10% of baseline (manual measurement, capture in ADR-004)
- [ ] Snapshot fixture size <100KB

#### Rollback
- Lineage builder is opt-in; calling `pipeline()` without builder returns same numbers (lineage absent)
- Revert PR-D: envelope `lineageRef` field becomes orphaned in v12 envelopes; sanitizer drops it.

---

### PR-E — Gap 5: Workbook Regression Tests

#### Rationale
Generated XLSX is the auditor-facing artifact. Schema drift = silent audit corruption.

#### Contract
Extend `src/engine/__tests__/excelExport.spec.ts` (already 388 lines). Add 5 new `it()` blocks:

1. **Sheet manifest:** assert exact list of sheet names matching the documented contract; fail on add or remove
2. **Cover assertions:** company name, run ID, generation timestamp, rigor level all match envelope
3. **Traceability assertions:** parser fidelity, reconciliation, rigor level match envelope
4. **Valuation assertions:** IV per share within ±0.01 of in-memory `ValuationResult`
5. **Provenance assertions** (depends on PR-D): all 8 lineage rows present, sourceKeys non-empty

**Documentation:** `docs/workbook-regression-contract.md` enumerates exact sheet names, cell coordinates, assertion contracts.

#### Files
| File | Change |
|---|---|
| `src/engine/__tests__/excelExport.spec.ts` | EXTEND |
| `docs/workbook-regression-contract.md` | NEW |

#### Risks
- Sheet schema changes are sometimes intentional. The contract doc explains how to update tests when changing intentionally — "edit doc + test in same PR." Reviewer enforces.

#### Definition of Done
- [ ] 5 new it() blocks pass
- [ ] Contract doc published
- [ ] Deliberate sheet rename causes test failure (manually verified)

#### Rollback
Pure test additions; revert PR-E removes the assertions, no behavior impact.

---

### PR-F — Gap 6: Golden Suite Expansion

#### Rationale
1 documented golden company → blind to edge cases. 5 covers happy path, demerger, BFSI, capital-intensive.

#### Decisions resolved from v3
| Q | Decision |
|---|---|
| Synthetic vs real for demerger | **Real:** Reliance Industries (RIL has confirmed demergers in last 5y; verify by inspecting `corporateActions.ts` flags on its loaded ZIP. If RIL data lacks them, fall back to synthetic `EXCEPTIONAL_EVENT_CO` retained in suite + add Tata Motors.) |
| Which clean industrial | Asian Paints (already in registry, clean ind-AS profile) |
| Which BFSI | HDFC Bank (already in registry; tests bank-pipeline path) |
| Which capital-intensive | NTPC (already in registry; high debt, regulated) |

#### Contract
For each, create `public/data/companies/<folder>/expectations.json`:
```json
{
  "companyId": "asian-paints",
  "companyName": "Asian Paints Ltd",
  "expectedRigorLevel": "valuation-eligible",
  "expectedParserFidelityStatus": "pass",
  "expectedReconciliationStatus": "pass",
  "expectedEconomicSanityStatus": "passed",
  "expectedConceptIdentityStatus": "clean",
  "keyMetricTolerances": {
    "RNOA": { "min": 0.20, "max": 0.50 },
    "ROCE": { "min": 0.18, "max": 0.45 },
    "NFO_to_CSE": { "min": -0.10, "max": 0.30 }
  },
  "expectedAnomalyFlags": [],
  "expectedUnusualItemCount": { "min": 0, "max": 2 },
  "expectedRunsCleanWorkbook": true
}
```

Extend `goldenCompanySuite.ts` and its spec file to load each expectations file alongside the ZIP, run full pipeline, assert against expectations.

#### Files
| File | Change |
|---|---|
| `public/data/companies/Asian Paints/expectations.json` | NEW |
| `public/data/companies/Reliance Industries/expectations.json` | NEW (or alternative) |
| `public/data/companies/HDFC Bank/expectations.json` | NEW |
| `public/data/companies/NTPC/expectations.json` | NEW |
| `public/data/companies/Bajaj Finance/expectations.json` | NEW (codify existing case) |
| `src/engine/goldenCompanySuite.ts` | Add real-data cases (load via parseCapitalineZip from path) |
| `src/engine/__tests__/goldenCompanySuite.spec.ts` | Extend with new assertions |

#### Risks
- ZIP parsing in tests may add 5+ seconds to suite. Mitigation: gate behind opt-in if needed; default suite includes them since they're integration cases.
- Tolerance bands too tight → flaky. Mitigation: bands cite the source quarter the values came from.

#### Definition of Done
- [ ] 5 expectations files merged
- [ ] Suite passes locally + CI
- [ ] One deliberate fixture mutation causes failure (manual sanity check)

---

### PR-G — Gap 7: Residuals Dashboard

#### Architectural notes (overrides v3)
- Persisted store in localStorage with `penman.residuals.<companyId>.v1` keys (one per company, not one giant blob — bounds individual writes)
- Total size cap: **5MB across all companies**, evicting oldest-company-oldest-entry on overflow
- Reuse shared API pattern from `sharedResearchApi.ts` for cross-device sync (optional; default off via flag)

#### Contract
```ts
export interface RunResidualSummary {
  runId: string;
  timestamp: string;
  companyId: string;
  schemaVersion: string;
  parserResiduals: { unresolvableRowCount: number; numericParseErrorCount: number; blankRowRate: number; };
  mappingResiduals: { unresolvedCriticalCount: number; unresolvedSupportingCount: number; conflictCount: number; };
  identityResiduals: { maxResidualRatio: number; failedCheckCount: number; };
  valuationBridgeResiduals: { intrinsicValueSensitivity: number; terminalValueShare: number; };
  overallResidualScore: number;  // 0-100, lower better
}

export function appendRunResidualSummary(s: RunResidualSummary): void;
export function readResidualHistory(companyId: string, limit?: number): RunResidualSummary[];
export function getStoreSizeBytes(): number;
```

**Eviction policy:**
- Per-company cap: 100 entries (drop oldest)
- Global cap: 5MB. On overflow, drop oldest entry across all companies until under cap.

**Production-ready downgrade gate:**
```
if isEnabled("rigor.residualScoreDowngrade")
   && residualScore > 40
   && claimedRigor === "production-ready":
  downgrade to "valuation-eligible"
  add reason: "Residual score X exceeds production threshold of 40"
```

**Intrinsic value sensitivity computation:**
Decision: compute once at envelope build by re-running valuation with `config.rnoa_shock = ±0.10`. Cache result in envelope. Cost: 2 extra valuation runs per envelope build (~50ms acceptable).

**ResidualsPanel:** SVG sparkline + table + threshold badge. Lives as **sub-panel of DebugPanel**.

#### Files
| File | Change |
|---|---|
| `src/lib/residualsStore.ts` | NEW |
| `src/components/ResidualsPanel.tsx` | NEW |
| `src/components/DebugPanel.tsx` | Mount sub-panel |
| `src/engine/analysisTraceability.ts` | Compute summary; downgrade gate |
| `src/engine/valuation.ts` | RNOA-shock entrypoint for sensitivity |
| `src/lib/__tests__/residualsStore.spec.ts` | NEW |

#### Test matrix
1. Append + read round-trip
2. Per-company cap at 100
3. Global 5MB cap eviction
4. Persistence survives reload (localStorage mock)
5. overallResidualScore in [0,100]
6. Production-ready downgrade fires
7. Feature flag off: no downgrade
8. Sensitivity computation: RNOA +10% changes IV by expected magnitude

#### Risks
- LocalStorage quota exceeded by other features: residualsStore catches and logs; doesn't crash app
- Sparkline rendering performance: SVG with 100 points; trivial

#### Definition of Done
- [ ] Per-run summary persists
- [ ] Panel visible in DebugPanel
- [ ] Production-ready blocked when score >40 (and flag on)
- [ ] All 8 tests pass

---

### PR-H — Smaller Items

Single PR combining items A, B, C from brief. Discrete, independent, low-risk.

| Item | Files | Test |
|---|---|---|
| A: trust-gate badges in DebugPanel/workspace | DebugPanel.tsx, CompanyWorkspace.tsx | Visual snapshot or assertion of badge presence |
| B: parser fidelity parity for non-Capitaline | screenerParser.ts, jsonParser.ts, xbrlParser.ts, manualEntryParser.ts | per-parser specs add coercionCount |
| C: chunk split | vite.config.ts | `npm run build` shows no circular warnings |

---

## Sequencing & dependencies

```
PR-0 (CC infra)              ── must merge first ──┐
                                                   ▼
PR-A (Gap 1)  ─ schema v9  ─ depends on PR-0
PR-B (Gap 2)  ─ schema v10 ─ depends on PR-A (envelope merge order)
PR-C (Gap 3)  ─ schema v11 ─ depends on PR-B (Check A consumes manifest)
PR-D (Gap 4)  ─ schema v12 ─ depends on PR-A,B,C (lineage references all gates)
PR-E (Gap 5)  ─ depends on PR-D (Provenance sheet exists)
PR-F (Gap 6)  ─ depends on PR-A,B,C (expectations reference new fields)
PR-G (Gap 7)  ─ depends on PR-A,B (residual computation needs gates)
PR-H (smalls) ─ independent
```

Strict serialization for PR-A through PR-D (all touch `analysisTraceability.ts`). PR-E,F,G,H can parallelize after PR-D.

Estimated calendar: 2-3 days per envelope-touching PR (review + CI + observation), so PR-0 → PR-D ≈ 10 days. PR-E/F/G/H in parallel ≈ 4 days. Total ~14 days at chief-architect cadence (1 PR/day with bake time).

---

## CI/CD gates (per PR)

Mandatory before squash-merge:
1. Targeted vitest (touched files + regression net) green locally
2. `npx tsc --noEmit` clean locally
3. CI `validate` job green (full `npm test`)
4. CodeRabbit review clean OR comments addressed
5. Vercel preview deployed and inspected for visual regression
6. ADR file present and linked from `analysis-rigor-ladder.md`

For envelope-touching PRs (A/B/C/D) additionally:
7. Schema-migration spec passes (rejects old envelope, accepts new)
8. Bundle size diff <30KB gzipped (CI logs build output; reviewer checks)
9. After merge: monitor production logs for 24h before next PR

---

## Backout / rollback playbook

For any PR, in priority order:

1. **Soft-disable via feature flag** (if PR introduced a flag): set flag false in Vercel env, redeploy (~2 min)
2. **Revert PR on main**: `gh pr revert <num>` or manual revert PR (~10 min round trip including CI)
3. **Schema rollback**: harder. v12→v11 means re-running pipelines for affected runs. Sanitizer rejects → forces re-run. Document in incident log.

For envelope schema bumps specifically: **never roll back schema if v(N+1) envelopes exist in audit blobs** — older readers can't parse them. Instead, ship a v(N+1.1) hotfix that strips problematic fields.

---

## Operational handoff (post-merge of all PRs)

Once all 8 PRs merged:

- [ ] `docs/analysis-rigor-ladder.md` reflects all 7 gaps closed
- [ ] `docs/adr/000`-`004` (and any others) cross-linked
- [ ] `docs/workbook-regression-contract.md` published
- [ ] Feature flags documented in `README.md` env section
- [ ] Memory/perf benchmarks captured in ADR-004 (lineage)
- [ ] Backout playbook tested at least once on a non-production preview
- [ ] DebugPanel surfaces schema migration counter for ops
- [ ] Sanitizer telemetry shows zero unmigrated envelopes after 1 release cycle

---

## Definition of Done (overall, 10/10 criteria)

The system is 10/10 when a skeptical reviewer can:

1. ✅ Open a run and see the canonical concept registry prove each metric has exactly one identity (Gap 1)
2. ✅ See the engine's automatic clean-anchor selection with skip log (Gap 2)
3. ✅ Audit every unusual item's classification rule and rationale (Gap 3)
4. ✅ Click any of 8 key numbers in inspector and trace source → transformation → policy (Gap 4)
5. ✅ Open the generated XLSX and find Provenance sheet matching in-memory output (Gap 4 + 5)
6. ✅ See 5 golden companies with diverse risk profiles all passing tolerance bands (Gap 6)
7. ✅ See residuals trending in the dashboard, with production-ready downgrades enforced (Gap 7)

PLUS:

8. ✅ Schema migrations are observable, reversible, and forward-compatible
9. ✅ Every gate is feature-flagged
10. ✅ Memory and bundle budgets enforced
11. ✅ All 8 PRs squash-merged on green CI with zero rollbacks

---

## Risks not in any single gap (cross-cutting)

| Risk | Owner | Mitigation |
|---|---|---|
| Cumulative bundle bloat across 7 gaps | Reviewer | 30KB/PR budget; track in CI |
| Multiple schema bumps confuse users with stale localStorage | Ops | Sanitizer rejects loudly; DebugPanel shows migration count |
| Flaky tests slow CI | Reviewer | Test rigor PR-D includes flake-fix; if any spec >5s, flag |
| Gate cascades produce useless "all-blocked" UX | UX | UI surfaces ALL block reasons, not just first |
| Vercel env flags drift between preview/prod | Ops | Document in `README.md`; add `npm run env:audit` script |

---

## Open items still needing answers

1. **Capital-transaction thresholds** — proposed `BUYBACK_PCT_OF_CSE = 0.05`, `RIGHTS_PCT_OF_CSE = 0.10`. Confirm vs Indian regulatory norms.
2. **MAX_ANCHOR_LOOKBACK_PERIODS = 3** — is 3 the right ceiling? Could be 5 for industries with biennial cycles.
3. **Lineage sidecar vs envelope** — overrides brief. Confirm acceptable to product owner before PR-D.
4. **Reliance Industries fixture** — needs ZIP inspection to confirm demerger periods present. Alternative: Tata Motors.
5. **Cross-device residuals sync** — should it ship enabled? Default off keeps PR-G simpler.

---

## Iteration log

| Iter | Changed | Why |
|---|---|---|
| v1 | Initial transcription of brief | First pass |
| v2 | Verified files; found existing conceptOntology, unusualItemPolicy, exceljs | Prevent duplicate creation |
| v3 | Added empirical context (registry size, schema version, CI constraints) | Executor grounding |
| **v4** | **Added cross-cutting infra (PR-0), feature flags, schema-migration helpers, lineage-sidecar override, memory/bundle budgets, observability per gap, rollback playbook, DoD criteria, operational handoff. Resolved 3 open questions from v3.** | **Chief-architect view: ship safely, not just code-complete** |
