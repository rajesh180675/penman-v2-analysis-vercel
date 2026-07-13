# ADR-016 — Sector-Native Case Contracts and Maturity Credit

**Date:** 2026-07-11
**Status:** Accepted

## Context and decision

Generic industrial substitutions are misleading for regulated utilities, telecom networks, banks, NBFCs, insurers, conglomerates, cyclicals, and unit-economics businesses. Each sector case has an explicit runtime input contract, catalog binding, evidence requirements, guards, transformation refs, and result state. Maturity credit requires a real-company data contract, golden case, expected skips, and finite governed output.

## Superseded behavior

- synthetic sector-model labels;
- generic DCF substitution presented as sector-native;
- computed status without required sector facts;
- maturity credit from module existence or documentation.

## Migration and schema impact

Eight sector case types are registered. Unknown fields/models and binding mismatches fail closed. Issuer onboarding adds governed sidecars without changing generic run identity semantics.

## Rollback

Mark an affected catalog definition experimental/not-wired and return an actionable insufficient-evidence or not-applicable result. Never substitute an unrelated model silently.

## Golden and contract tests

Runtime validation, case/catalog binding, guards, missing requirements, finite result, expected skips, transformation refs, and real-company corpus evidence are required before production maturity credit.

## Telemetry

Record case type, definition/version, input contract version, evidence completeness, guard outcomes, output state, missing requirements, and maturity-credit decision.
