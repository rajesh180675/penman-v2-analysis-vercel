# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands
- Build: `npm run build`
- Lint/Typecheck: `npm run typecheck`
- Test all: `npm test`
- Test single file: `npm test -- <path-to-test>` (e.g., `npm test -- src/lib/__tests__/companyRegistryStore.spec.ts`)
- Full Validation: `npm run validate` (typecheck, test, build)
- Release Validation: `npm run validate:release` (typecheck, golden tests, all tests, build)

## Architecture & Structure
The project is a financial analysis tool ("Penman V2 Analysis") focused on making valuation runs defensible through a "rigor ladder".

### Core Data Flow
1. **Ingestion**: Multi-source adapters (Capitaline, Screener, JSON, XBRL, Manual) convert data into canonical `RawPeriodData[]`.
2. **Orchestration**: `src/App.tsx` manages state and routes data through the analytical pipeline.
3. **Compute Pipeline**: `src/engine/pipeline.ts` implements a deterministic sequence: Sort $\rightarrow$ Recast $\rightarrow$ Ratios/Quality $\rightarrow$ Anomaly Detection.
4. **Analysis**: Valuation and Advanced Analytics (`src/engine/v3Analytics.ts`) provide governance outputs and confidence scoring.
5. **Presentation**: UI tabs consume shared `recastData`, guarded by a **Shared Trust Envelope** that ensures confidence levels are consistent across all surfaces.

### Rigor Ladder
Valuation runs must pass through these sequential gates:
1. `syntactically-valid`: Basic data presence and parser fidelity (minimum threshold required).
2. `structurally-reconciled`: Explicit reconciliation of balance-sheet, cash-distribution, share-capital, debt-flow, and income-statement residuals.
3. `economically-plausible`: Economic sanity checks.
4. `valuation-eligible`: Ready for valuation models.
5. `production-ready`: Fully validated and ready for final reporting.

### Key Components
- `src/engine`: Core analytical logic and rigor gate implementations.
- `src/lib/auditSnapshot.ts`: Manages traceability and snapshots of the rigor state (Schema `2026-04-traceability-v8`).
- UI Trust Gates: A shared trust envelope is surfaced across multiple tabs (Valuation, Forecast, Quality, Ratios, Statements, Regression, Comparison, Academic Report, V3 Analytics).
- Data Ingestion: Supports Capitaline (multi-strategy extraction), Screener, JSON, manual, and XBRL formats.
- Persistence: The Comparison Registry is persisted using a combination of local storage and a **Shared Research API**.

### Guiding Principles & Specs
- **Defensibility**: Every output must be traceable and policy-scoped to be defensible under review.
- **Fail-Closed**: Structural or valuation blockers must fail closed (prevent downstream levels from clearing).
- **S-9.4C: Cross-Module Capital Cost Consistency**: Capital costs (`ke`, `kw`) must be derived consistently across all modules (Valuation, Forecast, Comparison). `kw` must be derived structurally and treated as read-only in the UI.

## Development Workflow
To iterate on rigor gaps:
1. Identify a missing exit criterion in `docs/financial-model-rigor-plan.md`.
2. Check existing wiring in `src/engine`, `src/lib/auditSnapshot.ts`, or UI surfaces.
3. Implement the smallest end-to-end change that improves reviewer trust.
4. Update tests first around the changed contract.
5. Run `npm run validate` to verify.
