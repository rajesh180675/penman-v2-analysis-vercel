# ADR-013 — Valuation Model Catalog and Independence-Aware Synthesis

**Date:** 2026-07-11
**Status:** Accepted

## Context and decision

Model existence, UI display, and analytical independence are distinct. A versioned catalog governs applicability, required facts, guards, maturity, wiring, outputs, and independence groups. Intrinsic synthesis collapses correlated variants to one vote per group before calculating weighted quantiles. Market-implied/reverse models explain expectations and do not vote in intrinsic value.

## Superseded behavior

- counting files or labels as production models;
- treating formula variants as independent evidence;
- including invalid/non-finite results in ranges;
- allowing reverse DCF to increase intrinsic confidence.

## Migration and schema impact

Legacy outputs pass through catalog adapters. Catalog documentation is generated and freshness-checked in validation. Definitions can be added compatibly; changes to identity, maturity, or independence group are governed policy changes.

## Rollback

Disable a definition or mark it experimental/not-wired. Never delete historical catalog versions referenced by runs.

## Golden and contract tests

Catalog binding, expected skips, finite outputs, correlated-variant collapse, deterministic p20/p50/p80, reverse quarantine, divergence, and generated-doc freshness are required.

## Telemetry

Record definition/version, applicability, state, missing requirements, guard failures, independence group, reliability, synthesis inclusion/exclusion, and divergence contribution.
