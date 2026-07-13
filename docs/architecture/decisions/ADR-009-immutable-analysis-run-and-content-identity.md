# ADR-009 — Immutable AnalysisRun and Content Identity

**Date:** 2026-07-11
**Status:** Accepted

## Context and decision

Analytical surfaces previously assembled results independently and used volatile audit/session identifiers. The authoritative analytical unit is now `AnalysisRunV1`: a versioned stable core plus instance metadata. SHA-256 of the canonical stable core is the reproducibility identity; run ID, creation time, and parent relation do not alter it. Large payloads are immutable content-addressed artifacts referenced by typed content refs.

## Superseded behavior

- UI-local recomputation and surface-specific analytical truth;
- treating an upload audit ID as the valuation identity;
- mutable result objects without content verification.

## Migration and schema impact

The legacy engine remains behind a deterministic executor. New consumers read run-backed projections. The schema is `2026-07-analysis-run-v1`; changes require a new version and migration/compatibility reader.

## Rollback

Disable run-backed selection and use the compatibility projection while retaining stored immutable artifacts. Never rewrite an existing run hash.

## Golden and contract tests

Stable-core hash equality across volatile instances, changed-input hash inequality, artifact verification, worker protocol, store persistence, and parent/child lineage tests are required.

## Telemetry

Record request ID, run ID, reproducibility hash, relation, stage transitions, terminal state, duration, and identity-verification failures. Do not log source payloads or secrets.
