# Architecture Decision Records

This directory records the binding decisions extracted from the 2026-07 valuation-platform architecture plan.

| ADR | Decision | Status |
|---|---|---|
| ADR-009 | Immutable AnalysisRun and content identity | Accepted |
| ADR-010 | Canonical fact schema and execution-time lineage | Accepted |
| ADR-011 | Monotonic gate semantics and insufficient evidence | Accepted |
| ADR-012 | ForecastState separate from RecastPeriod | Accepted |
| ADR-013 | Valuation model catalog and independence-aware synthesis | Accepted |
| ADR-014 | Explicit cost-of-capital modes and provenance | Accepted |
| ADR-015 | Server-side principal, tenancy, and storage split | Proposed |
| ADR-016 | Sector-native case contracts and maturity-credit rule | Accepted |

`ADR-015` is proposed because repository contracts are complete but the production identity, database, object-storage/KMS, and distributed-rate-limit providers have not been selected.
