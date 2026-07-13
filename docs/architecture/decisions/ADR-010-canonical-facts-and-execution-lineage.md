# ADR-010 — Canonical Fact Schema and Execution-Time Lineage

**Date:** 2026-07-11
**Status:** Accepted

## Context and decision

Static formula recipes cannot prove which source cell supplied a published number. Every source adapter must emit source artifacts and canonical facts with issuer, scope, period, concept, unit, value, origin, parser version, and confidence. Transformations are recorded as a DAG during execution and referenced by material computed results.

## Superseded behavior

- reconstructing provenance after computation;
- source-label-only lineage;
- collapsing consolidated and standalone facts;
- assigning high confidence from a formula description alone.

## Migration and schema impact

Adapters may emit canonical facts alongside `RawPeriodData` during the strangler period. Fact/artifact/DAG identities are content hashes. Adding concepts is compatible; changing identity fields or unit semantics requires a schema version.

## Rollback

Retain the raw compatibility adapter but demote lineage confidence and publication eligibility when fact/DAG references are unavailable.

## Golden and contract tests

Adapter parity, stable identities, restatement/scope distinction, Capitaline cell-origin capture, DAG root reachability, and material-number reference coverage are required.

## Telemetry

Publish artifact/fact counts, mapping coverage, lineage coverage, unresolved concepts, DAG node counts, and broken-reference counts by run and source mode.
