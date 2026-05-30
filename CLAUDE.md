# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands
- Dev server: `npm run dev`
- Build: `npm run build`
- Lint/Typecheck: `npm run typecheck`
- Test all: `npm test`
- Test single file: `npm test -- <path-to-test>` (e.g., `npm test -- src/lib/__tests__/companyRegistryStore.spec.ts`)
- Golden tests only: `npm run test:golden`
- Full Validation: `npm run validate` (typecheck, test, build)
- Release Validation: `npm run validate:release` (typecheck, golden tests, all tests, build)

## Tech Stack
- **Runtime**: Node.js ^20.19.0 || >=22.12.0 (ESM)
- **Framework**: Vite 7 + React 19 + TypeScript 5.9
- **Styling**: Tailwind CSS 4 (via `@tailwindcss/vite` plugin)
- **Testing**: Vitest 4
- **Deployment**: Vercel (serverless functions in `api/`, single-file build optional via `VITE_SINGLE_FILE=1`)
- **Path alias**: `@/` resolves to `src/` (configured in `vite.config.ts` and `tsconfig.json`)

## Architecture & Structure
The project is a financial analysis tool ("Penman V2 Analysis") focused on making valuation runs defensible through a "rigor ladder".

### Core Data Flow
1. **Ingestion**: Multi-source adapters (Capitaline, Screener, JSON, XBRL, Manual) convert data into canonical `RawPeriodData[]`.
2. **Orchestration**: `src/App.tsx` manages state and routes data through the analytical pipeline.
3. **Compute Pipeline**: `src/engine/pipeline.ts` implements a deterministic sequence: Sort → Recast → Ratios/Quality → Anomaly Detection.
4. **Analysis**: Valuation and Advanced Analytics (`src/engine/v3Analytics.ts`) provide governance outputs and confidence scoring.
5. **Presentation**: UI tabs consume shared `recastData`, guarded by a **Shared Trust Envelope** that ensures confidence levels are consistent across all surfaces.

### Server-Side Components
- `api/research/index.js` — shared research API endpoint; persists comparison-registry snapshots and other workspace state via `@vercel/blob`.
- Serverless functions live under `api/` and are automatically deployed by Vercel.

### Rigor Ladder
Valuation runs must pass through these sequential gates:
1. `syntactically-valid`: Basic data presence and parser fidelity (minimum threshold required).
2. `structurally-reconciled`: Explicit reconciliation of balance-sheet, cash-distribution, share-capital, debt-flow, and income-statement residuals.
3. `economically-plausible`: Economic sanity checks.
4. `valuation-eligible`: Ready for valuation models.
5. `production-ready`: Fully validated and ready for final reporting.

### Key Modules
| Directory | Purpose |
|-----------|---------|
| `src/engine/` | Core analytical logic: parsers, pipeline, rigor gates, valuation, anomaly detection (~93 files) |
| `src/components/` | UI surfaces: reports, panels, wizards, trust gates (~39 files) |
| `src/lib/` | Audit snapshots, company registry, shared research API, persistence |
| `api/` | Vercel serverless functions (research API) |
| `docs/` | Rigor plan, architecture specs, persistence notes, roadmaps |

### Shared Trust Envelope
The `AnalysisTraceabilityEnvelope` is the shared confidence signal consumed across all UI tabs. The current schema is exported from `src/engine/policyVersions.ts` as `TRACEABILITY_SCHEMA_VERSION` (currently `2026-06-traceability-v17`); persisted envelopes flow through `src/lib/envelopeMigrations.ts` for forward migration. It contains:
- `confidence` (status, tone, headline)
- `rigor` (current level, achieved levels, checkpoints)
- `parserFidelity` (status, score, summary, checks)
- `reconciliation` (status, summary, maxResidualRatio, checks)
- `mappingCoverage`

Trust gates are surfaced in: Valuation, Forecast, Quality, Ratios, Statements, Regression, Comparison, Academic Report, and V3 Analytics tabs.

### Guiding Principles & Specs
- **Defensibility**: Every output must be traceable and policy-scoped to be defensible under review.
- **Fail-Closed**: Structural or valuation blockers must fail closed (prevent downstream levels from clearing).
- **S-9.4C: Cross-Module Capital Cost Consistency**: Capital costs (`ke`, `kw`) must be derived consistently across all modules (Valuation, Forecast, Comparison). `kw` must be derived structurally and treated as read-only in the UI.

## Key Reference Documents
- `docs/financial-model-rigor-plan.md` — the master rigor plan; identify missing exit criteria here
- `docs/analysis-rigor-ladder.md` — current rigor ladder implementation details and reconciliation checks
- `RIGOR_KNOWLEDGE_BASE.md` — operational reference for data lineage, mapping layer, and debugging guidance
- `docs/comparison-registry-persistence.md` — comparison registry persistence design (local storage + shared research API)

## Development Workflow
To iterate on rigor gaps:
1. Identify a missing exit criterion in `docs/financial-model-rigor-plan.md`.
2. Check existing wiring in `src/engine`, `src/lib/auditSnapshot.ts`, or UI surfaces.
3. Implement the smallest end-to-end change that improves reviewer trust.
4. Update tests first around the changed contract.
5. Run `npm run validate` to verify.

## PR Workflow (autonomous — do not ask permission at each step)
After `gh pr create`, run the full cycle without stopping for confirmation. Stop only when (a) all checks are green and merge succeeds, (b) a check fails and the cause requires user judgment to fix, or (c) the user explicitly intervenes.

1. **Create the PR.** Use squash-merge conventional-commit titles (matches repo history: `feat(scope): subject (#N)`).
2. **Arm a Monitor on the checks** — do not poll, do not sleep, do not ask "want me to check?":
   ```
   Monitor: persistent=false, timeout_ms=1800000
   command: prev=""; while true; do
     cur=$(gh pr checks <PR> --json name,bucket --jq '.[]|"\(.name): \(.bucket)"' | sort)
     comm -13 <(echo "$prev") <(echo "$cur")
     prev=$cur
     gh pr checks <PR> --json bucket --jq 'all(.bucket!="pending")' | grep -q true && break
     sleep 60
   done
   ```
3. **On all-green:** auto-merge immediately with `gh pr merge <PR> --squash --delete-branch`. Report the merged SHA. No "want me to merge?" prompt.
4. **On any failure:** pull logs (`gh run view <run-id> --log-failed`), diagnose root cause, push a fix commit to the same branch, and let the Monitor pick up the re-run. Do NOT close-and-reopen, do NOT force-push, do NOT skip hooks.
5. **Do not** create a PR and then hand back to the user with "checks are pending" — that is the state the Monitor exists to handle.

Exceptions — DO stop and ask:
- Merge conflicts requiring semantic resolution.
- A failing check whose fix would change scope beyond what the PR was authorized for.
- CodeRabbit raises a substantive correctness issue (not a style nit) — surface it before merging.
- Any push to `main`/`master` directly, or any force-push to a shared branch.
