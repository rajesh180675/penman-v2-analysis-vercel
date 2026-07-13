# ADR-011 — Monotonic Gate Semantics and Insufficient Evidence

**Date:** 2026-07-11
**Status:** Accepted

## Context and decision

The rigor ladder is sequential. A failed or blocked lower gate prevents every higher level from being achieved. Missing evidence is not success. Gate and model results use explicit confirmed, failed, blocked, insufficient, not-applicable, not-computed, and invalid states as appropriate.

## Superseded behavior

- higher rigor surviving a downstream blocker;
- empty check packs resolving as confirmed;
- optional checks silently substituting for family minimum packs;
- computed labels on null, non-finite, or guarded outputs.

## Migration and schema impact

Traceability schema v20 carries the shared envelope. Envelope migrations preserve evidence but recompute or demote invalid achievement prefixes. Family minimum reconciliation packs are policy-versioned.

## Rollback

Rollback may restore an earlier policy bundle for comparison, but must never promote an invalid historical envelope. The safe fallback is syntactically-valid or blocked.

## Golden and contract tests

Prefix invariants, missing-pack cases, terminal demotion, mapping-flag preservation, empty evidence, family minimum checks, and corpus observed-state tests are required.

## Telemetry

Record each gate state, blocker code, first failed gate, achieved prefix, family pack, residual maxima, and any attempted promotion rejected by the invariant.
