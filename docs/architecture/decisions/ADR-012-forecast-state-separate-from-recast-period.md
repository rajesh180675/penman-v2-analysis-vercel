# ADR-012 — ForecastState Separate from RecastPeriod

**Date:** 2026-07-11
**Status:** Accepted

## Context and decision

Historical recast periods and projected financial statements have different provenance and invariants. Forecasts use explicit `ForecastState` contracts with projected balance sheet, income statement, cash flow, roll-forwards, drivers, and validation residuals. Historical `RecastPeriod` objects are not cloned into forecasts.

## Superseded behavior

- object-spread cloning of historical periods;
- stale historical cash-flow values in projected years;
- UI-local forecast recomputation;
- presenting heuristic scenario weights as calibrated probability.

## Migration and schema impact

Legacy scenarios are adapted into explicit cases and labelled `not-assigned` where no probability calibration exists. Run-backed UI consumes worker-produced forecast artifacts. Forecast schema changes require versioned refs.

## Rollback

The legacy forecast report may remain for isolated compatibility tests, but production selection must show pending/blocked rather than recompute outside the run.

## Golden and contract tests

Statement identities, roll-forward residuals, scenario ordering, deterministic forecasts, no historical clone, rolling-origin no-lookahead, benchmark skill, and thin-sample degradation are required.

## Telemetry

Record case ID, horizon, validation residuals, ordering status, calibration status, sample size, benchmark metric, skill, and no-lookahead declaration.
