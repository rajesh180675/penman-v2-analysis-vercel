# ADR Process and Template

## Purpose

Architectural Decision Records (ADRs) capture **why** a non-obvious technical choice was made, so a reviewer six months later doesn't have to reconstruct the reasoning from PR diffs.

We use ADRs for:
- Schema bumps (each bump from `v8 -> v9 -> ... -> v12` gets its own ADR)
- Architectural overrides of an upstream brief or plan (e.g. "lineage as sidecar, not envelope")
- Cross-cutting infrastructure decisions (feature flags, migration telemetry)
- Major data-model or protocol changes that span multiple modules

We do NOT need ADRs for:
- Bug fixes
- Refactors that preserve external behavior
- New tests
- Documentation-only changes

## File Layout

```
docs/adr/
  000-process-and-template.md   <- this file
  001-concept-identity-layer.md
  002-economic-sanity-gates.md
  003-unusual-item-taxonomy.md
  004-lineage-sidecar.md
  ...
```

ADRs are sequentially numbered and never renumbered. Once a number is assigned it is permanent.

## Status Lifecycle

`Proposed` -> `Accepted` -> `Superseded by NNN` (or `Deprecated`)

A `Superseded by NNN` ADR is preserved as-is. The replacement ADR links back to it.

## Cross-Linking

- Reference ADRs from `docs/analysis-rigor-ladder.md` when the decision affects the rigor ladder.
- Reference ADRs from the relevant `RIGOR_KNOWLEDGE_BASE.md` section if it changes data lineage or mapping.
- Inside an ADR, link to: the PR that landed it, the spec it overrides (if any), and the verification artifacts (test specs, ADRs that depend on it).

## Template

```markdown
# ADR-NNN: <Title>

- **Status:** Proposed | Accepted | Superseded by ADR-MMM | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <names or roles>
- **PR:** #<num>
- **Supersedes:** ADR-XXX (if any)
- **Superseded by:** ADR-YYY (if any)

## Context

What problem does this decision solve? What constraints made other approaches unattractive? Cite concrete file paths, sizes, prior PRs, telemetry — not abstract reasoning.

## Decision

The smallest possible statement of what we are doing.

## Consequences

### Positive
- Bullet
- Bullet

### Negative / Tradeoffs
- Bullet
- Bullet

### Neutral
- Bullet

## Alternatives Considered

### Alternative A: <name>
What it was. Why we did not pick it.

### Alternative B: <name>
Same.

## Verification

How we know the decision is working as intended:
- [ ] Spec file: `path/to/spec.ts`
- [ ] Telemetry: `trace("...", "...")` event seen in DebugPanel
- [ ] Manual check: <description>

## References

- Link to original brief or plan
- Link to follow-up ADRs that build on this one
- Link to external docs (specs, papers, rfcs) if any
```

## Authoring Rules

1. **One ADR per decision.** A schema bump and a feature-flag introduction are two separate decisions even if they ship in the same PR.
2. **Past tense for the decision.** "We chose X" not "We will choose X". The ADR is written after the decision is made, not as a proposal.
3. **Cite empirical evidence.** "envelope is currently 14MB at rest" beats "envelope is large".
4. **Name the alternatives you rejected.** A decision is only credible if you considered the obvious other choices and explained why they lost.
5. **Keep it short.** A good ADR fits on one screen. If yours runs longer, the decision is probably composite — split it.
