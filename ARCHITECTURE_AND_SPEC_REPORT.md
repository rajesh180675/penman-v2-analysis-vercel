# Penman V2 Deep-Dive + Spec Upgrade Report

## 1) Architecture Deep Dive

### Frontend orchestration (`src/App.tsx`)
- `App` is the root orchestration shell: ingestion, config state, computed recast state, tab routing, and quality gating.
- Core flow:
  1. User uploads/parses data in `DataEntry`.
  2. `rawData` is stored in app state.
  3. `recastData` is derived reactively with `processCompanyData(rawData, config)`.
  4. Reports/tabs read the same `recastData` and `config`.
- Fail-fast behavior:
  - `evaluateQualityGate(rawData)` determines if valuation is blocked.
  - If parse succeeds but engine recast fails, app routes to `Debug`.

### Ingestion layer (`src/engine/*Parser.ts`, `jsonIngestion.ts`)
- Multi-source ingestion adapters convert source formats into canonical `RawPeriodData[]`:
  - Capitaline ZIP/XLS(HTML)
  - Screener tab-delimited
  - JSON
  - XBRL
  - Manual wizard
- `capitalineParser.ts` uses multi-strategy extraction (`xlsx`, DOM-table, regex, SpreadsheetML) + header detection + statement-aware composite keys (`metric__Statement`).

### Core compute layer (`src/engine/pipeline.ts`, `PenmanNissimEngine.ts`)
- Deterministic pipeline:
  1. Sort periods chronologically.
  2. `computeRecastPeriod` (BS, IS, CF recast + trace map).
  3. `computeRatios`, `computeResidualIncome`, `computeQuality`.
  4. `runAnomalyDetection` and attach per-period `spec_flags`.
- Core valuation uses `computeValuation(...)` with RE/ReOI/FCFF/FCFE/AEG outputs.

### Advanced analytics layer (`src/engine/v3Analytics.ts`)
- Builds spec-level governance outputs:
  - Data validation
  - Dirty-surplus framework
  - Event flags
  - Terminal anchor selection
  - Confidence scoring
  - Cross-section assertions
- Uses `CanonicalOutputRegistry` to detect cross-section consistency violations.

### Report/visualization layer (`src/components/*Report.tsx`)
- Domain-specific renderers consume shared `recastData`.
- `ValuationReport` already enforced S-9.4 (derived `kw`, config-driven `ke`).
- `ForecastReport` had a policy drift (manual `kw` + partial config + unsafe casts) before this upgrade.

## 2) New Spec Design Implemented

## S-9.4C: Cross-Module Capital Cost Consistency

**Problem found**
- `ForecastReport` diverged from engine policy:
  - `ke` hardcoded as `rf + erp` even when explicit `config.ke` exists.
  - `kw` was user-editable input (violates S-9.4 derived-only rule).
  - `computeValuation(..., config as any)` bypassed type safety.

**Spec rule**
- All valuation-bearing modules must:
  1. Derive `ke` via `ke_from_config(config)`.
  2. Derive `kw` structurally via `deriveKwFromStructure(...)`.
  3. Treat `kw` as read-only in UI (display-only, not an input field).
  4. Pass strongly typed `EngineConfig` (no `any` casts).

## 3) Implementation Changes

### File changed
- `src/components/ForecastReport.tsx`

### What changed
- `Props.config` upgraded to full `EngineConfig`.
- `ke` baseline changed to `ke_from_config(config)`.
- Added `kwDerived` via `deriveKwFromStructure(cur, prev, ke, rf, config)`.
- Removed manual `kw` input state (`kw_inp`, `setKw`).
- Scenario generation and sensitivity now use derived `kw`.
- Monte Carlo uses derived `kw` as distribution mean.
- Removed `config as any` in all valuation calls; now fully typed.
- UI now shows `kw` as derived read-only field labeled `Derived, S-9.4`.

## 4) Verification

- Build:
  - `npm run build` passed.
- Tests:
  - `npx vitest run` passed.
  - 4 test files, 23 tests all green.

## 5) Impact

- Eliminates valuation policy drift between Forecast and Valuation modules.
- Restores a single source of truth for capital-cost logic.
- Improves type safety and reduces silent drift risk from `any` casting.
- Keeps forecasting UX consistent with existing S-9.4 governance language across the app.

## 6) Additional Critical Fixes (End-to-End pass)

### 6.1 `ComparisonReport` valuation mispricing bug
- File: `src/components/ComparisonReport.tsx`
- Issue:
  - Cross-company valuation used `ke = rf + erp` and `kw = rf` hardcoded.
  - This materially misprices and can invert peer ranking/upside ordering.
- Fix:
  - Switched to `ke_from_config(config)`.
  - Derived `kw` per company using `deriveKwFromStructure(latest, prev, ke, rf, config)`.
  - Fallback to `risk_free_rate` only when a company has fewer than 2 periods.

### 6.2 Silent error swallowing in `ForecastReport`
- File: `src/components/ForecastReport.tsx`
- Issue:
  - Scenario valuation and sensitivity wrapped in `try/catch` blocks that suppressed failures.
  - Hidden failures can ship stale/invalid valuation output without visibility.
- Fix:
  - Removed silent `catch` swallowing for valuation path.
  - Forecast computation now fails loud through normal React error boundaries/stack traces.
