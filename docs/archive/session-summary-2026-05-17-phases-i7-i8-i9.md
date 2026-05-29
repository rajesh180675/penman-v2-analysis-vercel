# Session Summary — 2026-05-17 (Phases I7 / I8 / I9 — Data Integrity & UX)

Continuation of the 2026-05-17 session, after Phases J, K, and B5.
Three data-integrity and UX items from the "still to ship" list.

## Shipped (3 commits, 620 tests, build clean)

### Phase I7 — Currency unit auto-detection

- **`d983a1a`** feat(parser): Phase I7
  - `detectCurrencyUnit(grid)` — scans first 10 rows for a
    'Curr. in' / 'Currency' / 'Unit' / 'Denomination' label row.
    Returns CurrencyUnit: Crores / Lakhs / Millions / Thousands /
    Absolute / Unknown. Returns null when no currency row found
    (caller assumes Crores — the historical default).
  - `UNIT_TO_CR_MULTIPLIER` — scaling factors to ₹ Crores.
  - `gridToPeriods` gains a `multiplier` param — scaling applied at
    parse time so all raw_metric_values are always in ₹ Crores.
  - Per-file detection in the main parse loop; dominant unit resolved
    across all files in the ZIP (most-frequent non-Unknown wins).
  - Warning emitted when unit is non-Crores — surfaces in debug panel.
  - `RawPeriodData.currency_unit` — optional audit/traceability field.
  - 28 unit tests covering all six unit strings, case variants, empty
    grid, no currency row, unrecognised unit → Unknown, scanRows
    boundary, label keyword variants, empty value cells skipped.

### Phase I8 — Single-period screening mode

- **`9ed1f18`** feat(scope): Phase I8
  - `ScopeAssessment.screeningOnly?: boolean` — true when exactly one
    period uploaded. Not blocked — pipeline still runs.
  - `ScopeAssessment.screeningReason?: string` — human-readable.
  - All six return paths in `assessAnalysisScope` carry the fields.
  - Rigor ladder capped at `syntactically-valid` when screeningOnly:
    structurally-reconciled, economically-plausible, valuation-eligible,
    production-ready all blocked with explicit detail messages.
  - App.tsx amber banner: what still works (ratios, quality flags,
    EPV, bank metrics), what is disabled (growth rates, trend signals,
    mean-reversion, V_RE_CV*, rigor ladder), prompt to upload ≥3 years.
  - 15 unit tests: screeningOnly detection for 0/1/2/5/null/undefined
    periods, reason text, all return paths, bank path, two-period path.

### Phase I9 — Demerger / M&A structural break confirmation flow

- **`8bb2582`** feat(pipeline): Phase I9
  - `EngineConfig.excluded_periods?: string[]` — list of period_end
    strings to exclude. Applied before recast, ratios, anomaly
    detection, and valuation — entire pipeline sees only the clean
    post-break window.
  - `PipelineResult.structuralBreakPeriods: string[]` — period_ends
    where S-5.1 STRUCTURAL_EVENT (dirty surplus spike) fired. Always
    present (empty when no breaks detected).
  - `processCompanyDataFull` filters by excluded_periods before scope
    detection and all downstream processing.
  - App.tsx amber banner when breaks detected and no exclusions set:
    - Lists break period(s) with dates
    - "Exclude pre-break periods" button: computes all periods before
      the earliest break and sets excluded_periods
    - "Keep all periods (I understand the risk)" button: sets
      excluded_periods=[] to suppress banner without excluding
  - Slate info bar when exclusions active: shows excluded periods +
    "Clear exclusions" button.
  - 9 unit tests: structuralBreakPeriods always an array, empty input,
    break detection, exclusion filtering, no-op for non-existent period,
    exclude-all, excluded periods don't re-appear in break list.

## Validation status

- `npm run typecheck`: clean
- `npm run validate` (typecheck + tests + build): clean
- 620 tests passing across 80 test files
- All commits pushed to `origin/main`

## Patterns established this session

- **Currency normalisation at parse time** — all raw_metric_values
  are always in ₹ Crores regardless of source unit. The unit is
  recorded in `currency_unit` for audit but never needs to be
  re-applied downstream. This is the right place to normalise.

- **screeningOnly as a non-blocking flag** — single-period uploads
  don't throw or block; they run and produce what they can, but the
  rigor ladder caps and the UI explains the limitation. Same pattern
  as equityModelsBlocked (Phase J) and distressBlocksValuation (Phase J5).

- **User-confirmed exclusions via EngineConfig** — period exclusions
  live in config (not a separate state slice) so they flow through
  the pipeline memo automatically. The UI sets config; the engine
  re-runs. No special wiring needed.

- **Structural break surfacing without auto-exclusion** — the engine
  detects breaks and surfaces them; the user decides whether to exclude.
  Auto-exclusion would be wrong (some demergers are intentional and
  the pre-break history is still useful for context).

## Remaining work

1. **Insurance pipeline (Phase E)** — LIC fail-closes correctly today.
   Building a real insurance pipeline is a multi-week investment.
2. **B5.5 fixture data** — vision-LLM extractor for HDFC/ICICI/SBI/Kotak
   quality_indicators.json. Deferred. See
   `docs/bank-quality-indicators-design.md` for extraction strategy.
3. **Vodafone Idea upload** — user mentioned uploading Vodafone Idea
   data. The negative-equity handling (Phase J) is in place. Upload
   and verify the distress banner + loss-maker valuation path.
