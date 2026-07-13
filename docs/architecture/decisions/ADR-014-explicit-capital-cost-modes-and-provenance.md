# ADR-014 — Explicit Cost-of-Capital Modes and Provenance

**Date:** 2026-07-11
**Status:** Accepted

## Context and decision

Capital cost is shared analytical evidence, not a UI field. One resolver produces `ke`, debt cost, weights, tax treatment, and `kw` from sourced assumptions. Manual modes require explicit selection, rationale, and evidence. `kw` is structurally derived and read-only to downstream consumers.

## Superseded behavior

- undeclared numeric overrides;
- different `ke`/`kw` derivations in valuation, forecast, comparison, bank, and export paths;
- treating a default value as sourced evidence;
- accepting a directly editable `kw`.

## Migration and schema impact

Configuration retains compatibility fields with explicit modes. The sourced assumption set and resolver result are content-addressed run inputs. Policy changes require golden-delta review.

## Rollback

Select the prior capital-cost policy bundle for a child run. Existing run results remain immutable. Missing evidence falls back only through an explicitly governed default mode and cannot be labelled sourced.

## Golden and contract tests

Cross-module equality, unit consistency, manual-mode evidence, structural `kw`, bank terminal RI, debt-cost modes, and assumption-change hash tests are required.

## Telemetry

Record modes, evidence types, ranges, staleness, derived weights, ke/kd/kw, warnings, and policy version; never log private provider credentials.
