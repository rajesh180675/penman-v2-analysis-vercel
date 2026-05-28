# ADR-003: Unusual-Item Taxonomy (Schema v10 → v11)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Deciders:** Chief architect (autonomous execution per plan v4)
- **PR:** rigor/unusual-item-taxonomy-v11
- **Plan:** `.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md` (PR-C)
- **Builds on:** [ADR-002](002-economic-sanity-gates.md)

## Context

Pre-v11, "unusual items" were classified implicitly via `RecastPeriod.spec_flags` (a boolean signal) and `unusualItemPolicy.buildUnusualItemPolicy` (operating/financial buckets keyed on recast values). A reviewer reading the audit could see *that* an item was excluded from Core OI, but not *why* — there was no per-item rationale, no taxonomy, no link back to the raw label.

That's a defensibility gap. When an analyst is asked "why did Profit on Sale of Investments — ₹450cr — leave Core OI?", the answer needs to be traceable to a specific classification rule with a matched pattern, not an opaque policy decision.

Empirical anchor:
- `src/engine/unusualItemPolicy.ts` had 148 lines, no taxonomy, no per-label rationale.
- `RecastPeriod.spec_flags[*].affects_terminal` was the only signal Gap 2 (PR-B) had to consume; without a taxonomy, terminal-eligibility blocking was binary not categorized.

## Decision

Bumped the envelope schema from `2026-06-traceability-v10` to `2026-06-traceability-v11`. Bumped `UNUSUAL_ITEM_POLICY_VERSION` from `2026-03-phase7` to `2026-06-phase8`.

Added a 12-category taxonomy (`UnusualItemCategory`) with 11 explicit rules + an `unclassified` fall-through:

| Category | Affects CoreOI | Affects Terminal | Affects Clean Surplus |
|---|---|---|---|
| `demerger-scheme-effect` | ✓ | ✓ | ✓ |
| `discontinued-operations` | ✓ | ✓ | — |
| `impairment` | ✓ | — | — |
| `asset-sale-gain-loss` | ✓ | — | — |
| `fair-value-change` | ✓ | — | ✓ |
| `litigation` | ✓ | — | — |
| `restructuring` | ✓ | — | — |
| `one-time-tax` | ✓ | — | — |
| `buyback` | — | ✓ | — |
| `special-dividend` | — | — | — |
| `capital-return` | — | ✓ | — |
| `unclassified` | — | — | — |

Each rule is a `(category, regex patterns, rationaleTemplate)` tuple. Patterns use word boundaries (`\b`) so "interest" doesn't match "interest-rate hedge" unless the latter is a separate token. Order matters: more-specific rules above more-generic ones.

The new envelope field:

```ts
unusualItemManifest: {
  totalUnusualImpactOnCoreOI: number;
  terminalEligibilityBlocked: boolean;
  classifications: UnusualItemClassification[];   // capped at 500
  unclassifiedCount: number;
  truncated: boolean;
}
```

`terminalEligibilityBlocked` is consumed by Gap 2's Check A (terminal-period-contamination). When `isEnabled("rigor.terminalEligibilityBlock")` is on (default), an unresolved terminal-blocking unusual item caps rigor at `economically-plausible` (cannot reach `valuation-eligible`).

A label-screening keyword list (`CANDIDATE_KEYWORDS`) ensures we only scan raw labels that look unusual — we don't classify every metric, only those whose normalized form contains a marker word like "exceptional", "extraordinary", "impairment", "buyback", etc. This keeps false-positive rate low.

We also propagate existing `RecastPeriod.spec_flags[*].affects_terminal` into the manifest as synthetic `capital-return` entries so reviewers see them in the same surface.

## Consequences

### Positive
- Each unusual item now ships with a category, rationale template, and the literal regex pattern that matched. A reviewer can audit every exclusion.
- Gap 2's Check A consumes the manifest, so `affectsTerminalEligibility` flags propagate into the anchor algorithm with no special-casing.
- Rigor block is reversible — `VITE_RIGOR_TERMINAL_ELIGIBILITY_BLOCK=false` soft-disables.

### Negative / Tradeoffs
- Adds ~260 lines to `unusualItemPolicy.ts`. Plan v4 N-2 budget (≤50 lines per gap) overshot here; rationale is the rule table itself is the artifact and lives in code rather than a separate config. Reviewer can verify by looking at `CLASSIFICATION_RULES`.
- Existing v10 envelopes in localStorage are now rejected on read. Same migration story as v8→v9→v10.

### Neutral
- Existing `buildUnusualItemPolicy` callers are unchanged; the new `classifyRunUnusualItems`, `summarizeUnusualItemManifest`, `CLASSIFICATION_RULES`, `MAX_UNUSUAL_ITEM_CLASSIFICATIONS` are additive exports.

## Alternatives Considered

### A. Move the rule table to a YAML config
Co-locate with `CapitalineIndASDetailedMappingSpec.yaml`. Rejected for now: rules need TypeScript types (regex objects), and YAML escaping for `\b` is error-prone. Revisit when we need ops to edit the rules without a code redeploy.

### B. Skip the candidate-keyword screen and scan every raw label
Simpler code path. Rejected: thousands of "Sales", "Tax Expense", "Depreciation" labels would trip into `unclassified` and bloat the manifest. The keyword screen is a high-precision pre-filter.

### C. Use a learned classifier (LLM or BERT)
Higher recall on edge cases. Rejected as overkill for a deterministic, auditable taxonomy. Rules are reproducible; classifiers aren't.

## Verification

- [x] `src/engine/__tests__/unusualItemPolicy.spec.ts` — 29 cases (regression on existing API, 11 categories × pos+neg, terminal-eligibility propagation from spec_flags, cap-at-500 truncation, rationale + matched pattern shape, CoreOI impact aggregation)
- [x] `src/lib/__tests__/companyRegistryStore.spec.ts` updated to v11 round-trip and v10 rejection
- [x] `src/components/__tests__/ForecastReport.spec.tsx` fixtures updated
- [x] RunInspector surfaces "Unusual items" status row with classification count, terminal-blocked flag, and unclassified count
- [x] Telemetry: `trace("config", "unusualItemManifest:built", ...)` fires when classifications are present; `recordSchemaMigration()` fires when sanitizer rejects v10 envelopes
- [x] Gap 2 anchor algorithm consumes manifest entries with `affectsTerminalEligibility: true`

## References

- Plan v4: `.hermes/plans/2026-05-28_143942-rigor-7-gaps-chief-architect-v4.md` § PR-C
- ADR-001: concept identity layer (v9)
- ADR-002: economic sanity gates (v10)
- Feature flag module: `src/lib/featureFlags.ts`
- Schema migration helper: `src/lib/schemaMigration.ts`
