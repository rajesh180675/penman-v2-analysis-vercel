# ADR-015 — Server-Side Principal, Tenancy, and Storage Split

**Date:** 2026-07-11
**Status:** Proposed

## Context and decision

Browser-provided identity and reusable provider tokens are not authorization. Deployed reads and writes must derive principal, organization, and workspace from an authenticated server session. Transactional metadata belongs in a database; immutable bytes belong in content-addressed object storage; append-only audit events are hash chained. The same service contract is used by local reference and deployed adapters.

Provider selection for identity, database, object storage/KMS, and distributed rate limiting remains open, so this ADR cannot be accepted for deployment yet.

## Superseded behavior

- browser-direct shared persistence credentials;
- spoofable local identity as authorization;
- object/blob storage as a mutable indexed database;
- per-instance memory rate limiting presented as durable control.

## Migration and schema impact

Repository contracts define workspace partitioning, idempotency, optimistic finalization, pagination, retention, artifact verification, events, and publication locks. Production migrations must preserve run/content hashes and introduce database revision constraints and object lifecycle policies.

## Rollback

Use local single-workspace adapters only in explicitly local mode. A deployed rollback must be read-only or provider-level; it must not fall back to browser credentials or weaken workspace authorization.

## Golden and contract tests

Repository conformance, cross-workspace isolation, CAS conflicts, idempotency, cursor/filter binding, raw-byte hash verification, retention/restore, event-chain integrity, publication lock, auth denial, and distributed rate-limit tests are required.

## Telemetry

Record principal/workspace IDs, operation, decision, revision, idempotency outcome, storage latency, rate-limit decision, and audit-event hash. Redact tokens, signed URLs, and source payloads.

## Acceptance condition

Select providers, perform threat review, implement deployed adapters/APIs, pass local/deployed conformance and restore drills, and verify zero reusable persistence/provider credentials in browser bundles.
