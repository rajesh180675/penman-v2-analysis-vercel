# Valuation Platform Greenfield Plan — Implementation Report

**Date:** 2026-07-11 (IST)
**Plan implemented:** `2026-07-10-principal-architecture-valuation-platform-greenfield-design.md`
**Architecture owner posture:** Principal-architecture implementation and verification record
**Repository scope:** Penman V2 Analysis application, engine, platform contracts, publications, security baseline, and release gates
**Status:** Repository-scoped implementation complete; production infrastructure adapters and provider choices remain explicit deployment dependencies

---

## 1. Executive outcome

The repository now has a content-addressed valuation-case spine instead of relying on independently recomputed UI surfaces. A finalized `AnalysisRunV1` binds source/fact, policy, model catalog, family analysis, analysis window, market snapshot, assumptions, forecast cases, model results, trust gates, and publication references into one canonical SHA-256 identity. Browser execution is moved behind a worker protocol, persisted only after identity and artifact verification, and projected into valuation, forecast, quality, ratio, statement, comparison, report, and audit-facing UI surfaces.

The implementation also corrects the high-risk integrity findings identified in the plan: unit ambiguity, financial-institution market-cap scaling, false model-success states, non-monotonic trust, missing evidence promotion, UI-local forecast recomputation, correlated-model double voting, reverse-DCF contamination, undeclared manual capital-cost inputs, and maturity-score inflation.

This is a strangler implementation. Existing analytical functions remain available behind compatibility adapters where needed, but the authoritative browser path now executes once and reads from the immutable run materialization. Advanced models that do not satisfy the production contract remain explicitly experimental instead of being counted as production capability.

## 2. Architectural invariants delivered

| Invariant | Delivered mechanism | Verification posture |
|---|---|---|
| One run, one truth | `AnalysisRunV1`, stable-core hashing, browser run store, run-backed selectors | Deterministic-hash and store integration tests |
| Facts precede statements | Canonical `FactSet`, source adapters, stable fact identity | Fact adapter and identity tests |
| Provenance is produced | Cell origins plus transformation DAG/content refs | Lineage and executor tests |
| Gates are monotonic | Sequential gate results and terminal-outcome trust demotion | Traceability, pipeline, and executor tests |
| Missing evidence cannot succeed | Explicit blocked/not-applicable/not-computed states and fail-closed guards | Model and sector execution tests |
| Correlated variants vote once | Independence-group collapse before synthesis | Synthesis tests |
| Price is not intrinsic evidence | Reverse DCF quarantined from intrinsic synthesis | Evidence synthesis tests |
| Assumptions are first-class | Sourced assumption set with mode, evidence, rationale, and hash | Analysis-case and capital-cost tests |
| Forecasts are projected states | Balanced `ForecastState`, explicit residuals, no recast cloning | Forecast-state and UI contract tests |
| Time is pinned | Unified window, as-of date, market snapshot, assumption refs | Executor materialization tests |
| Units are boundary contracts | Branded units and corrected FI/industrial conversions | Unit and metamorphic tests |
| Publications identify the run | Shared run ID and reproducibility hash in global UI, report, bundle, and workbook | Typecheck and workbook assertions |

## 3. Wave-by-wave implementation

### Wave 0 — Integrity reset

Implemented the correctness, trust, scorecard, greenfield-safety, and server-boundary reset:

- corrected crore-share, price, enterprise/equity, bank, and market-cap scaling paths;
- introduced or strengthened branded unit boundaries and unit-focused tests;
- made cost-of-capital override modes explicit, with rationale/evidence required for manual inputs;
- removed success-by-default behavior from incomplete valuation paths;
- enforced monotonic rigor checkpoints so a downstream blocker invalidates later levels;
- merged pipeline and greenfield flags without losing native blockers;
- hardened missing/weak evidence behavior in scope, reconciliation, terminal, and quality gates;
- redesigned maturity scoring so documentation, stubs, or unused modules do not count as production integration;
- decomposed oversized FI quality/NBFC modules into bounded implementation modules;
- added authenticated audit-run access checks and tightened server validation/rate-limit headers;
- replaced report-only CSP with an enforced CSP and added HSTS, COOP, and CORP headers.

### Wave 1 — Immutable AnalysisRun and compute-once execution

Implemented under `src/engine/analysisRun/` and `src/app/analysisRun/`:

- versioned run/core/instance contracts;
- canonical stable-core projection and SHA-256 reproducibility identity;
- identity verification that excludes volatile instance metadata;
- content-addressed artifacts and reference verification;
- root/child lineage with explicit fork reasons;
- legacy-backed executor as the strangler compatibility seam;
- deterministic staged execution with cancellation and fail-closed terminal outcomes;
- typed worker protocol, worker adapter, browser worker, and browser client;
- UI execution coordinator and immutable selected-run store;
- verified persistence before a run becomes selectable;
- shared run identity status bar across all application tabs.

The legacy executor calls each expensive analytical seam once per run, records stage/gate results, and materializes a read-only projection. React no longer performs the authoritative analytical computation in render paths.

### Wave 2 — Canonical facts and lineage

Implemented under `src/engine/facts/` and the Capitaline parser integration:

- source artifact, canonical fact, fact-set, value, period, scope, unit, and confidence contracts;
- stable identities for source artifacts and facts;
- adapters for legacy raw data plus Capitaline, Screener, JSON, XBRL, and manual source modes;
- Capitaline cell-origin capture at parse time;
- compatibility conversion into current `RawPeriodData` without discarding canonical facts;
- transformation DAG nodes and roots for recast/analytical derivations;
- content-addressed lineage artifacts carried by the run executor;
- fact and transformation references on computed model outputs.

This establishes the production contract for provenance. Source-specific coverage can now expand without changing the downstream run identity model.

### Wave 3 — Unified window, assumptions, capital cost, and ForecastState

Implemented under `src/engine/analysisCase/`, `src/engine/costOfCapital/`, and `src/engine/forecastState/`:

- one `UnifiedAnalysisWindow` selected from economic sanity and valuation-readiness evidence;
- included/excluded periods, anchor, blocker codes, rationale, and a content hash;
- one sourced assumption set with explicit modes, evidence references, rationale, ranges, and identity;
- unified cost-of-capital resolution used across industrial and FI paths;
- structurally derived `kw` and explicit manual-override governance;
- balanced industrial projected states with balance sheet, income statement, cash flow, roll-forward, and residual checks;
- explicit scenario ordering and non-probabilistic legacy scenario labels;
- run-backed forecast UI that consumes projected states and does not recompute locally;
- rolling-origin forecast holdout evaluation;
- a no-lookahead declaration, last-observation-carried-forward benchmark, benchmark skill, sample-size threshold, and calibrated/degraded states.

A blocked analysis window now demotes the shared envelope and prevents later trust levels from remaining achieved.

### Wave 4 — Model catalog, independence, and synthesis

Implemented under `src/engine/modelCatalog/` and `src/engine/valuationEvidence/`:

- a versioned catalog of 43 model definitions;
- model category, family applicability, maturity, wiring, input, guard, output, and independence-group metadata;
- compatibility adapters that convert legacy output into explicit model result states;
- catalog-generated Markdown documentation;
- a freshness check included in `npm run validate`;
- evidence-weighted contribution collapse to one maximum-reliability vote per independence group;
- deterministic weighted p20/p50/p80 synthesis;
- divergence diagnostics;
- reverse-DCF quarantine from intrinsic-value voting;
- anti-tautology reporting that includes calibration, benchmark, sample, no-lookahead, and independence evidence.

Real options, ESG, FX, and lease-specific advanced models remain catalogued as experimental/not-wired. They are deliberately excluded from production maturity and synthesis counts.

### Wave 5 — Sector-native cases

Implemented under `src/engine/sectorCases/`:

- runtime contracts, registry, adapters, calculators, execution boundary, and tests;
- utility regulated-asset-base case;
- telecom network case;
- bank case;
- NBFC case;
- insurance case;
- conglomerate/SOTP case;
- cyclical mid-cycle case;
- retail/unit-economics case;
- catalog binding verification;
- unknown-field, unknown-model, and binding-mismatch rejection;
- explicit evidence, guards, transformation references, and fail-closed non-computed results.

The implementation supplies production formula and execution contracts. Automatic family/case inference and complete real-company sidecar sourcing remain data-onboarding work, not silently inferred capability.

### Wave 6 — Platform, model operations, publication, and release controls

Implemented under `src/platform/`, publication/export modules, scripts, and deployment configuration:

- validated local/server-session principals and organization/workspace scope;
- immutable, versioned analysis-run repository contract;
- workspace partitioning and runtime input/size validation;
- idempotency receipts and request fingerprints;
- optimistic finalization compare-and-swap;
- cursor pagination bound to query filters;
- artifact repository with raw-byte SHA-256, copy-on-write/read, ref verification, and explicit retention purge;
- append-only per-run event hash chains with revision-linked events;
- irreversible publication lock;
- application service coordinating runs, artifacts, events, finalization, listing, and locking;
- local reference adapters used by the browser store;
- global run-identity surface plus report, IC bundle, manifest, trace appendix, and workbook run stamps;
- enforced deployment security headers;
- catalog freshness and bundle-budget release gates;
- truthful audit/maturity scorecard and corpus baselines.

## 4. Authoritative runtime flow

1. Source adapters produce artifacts and canonical facts.
2. The browser coordinator creates a root or child execution request with pinned inputs.
3. The worker executes the deterministic legacy-backed stage pipeline once.
4. The executor selects the unified window, resolves sourced assumptions/capital cost, creates forecast states, executes applicable models, synthesizes independent evidence, and applies terminal trust semantics.
5. Stable analytical content is hashed into `AnalysisRunV1.reproducibilityHash`.
6. The store re-verifies the run hash and every artifact hash/byte length.
7. The platform service creates metadata, finalizes revision 2, and appends hash-chained create/finalize events.
8. Only the persisted, verified run becomes the selected UI run.
9. Tabs, reports, bundles, and workbooks consume projections from that selected run and display the same analytical identity.

## 5. Publication and reviewer contract

`AnalysisPublicationSnapshot` now includes a bounded `runIdentity` projection containing:

- run ID;
- reproducibility hash;
- run schema and executor versions;
- analysis-window reference;
- market-snapshot reference;
- assumption-set reference;
- model-result references.

The immutable identity appears in the application status bar, academic memo/PDF content, IC bundle trace appendix, IC bundle manifest, workbook cover, and workbook traceability sheet. The upload/audit ID remains a separate field. This prevents reviewers from mistaking ingestion-session identity for analytical-content identity.

## 6. Validation evidence

Validation completed during implementation:

| Gate | Result |
|---|---|
| TypeScript | `npm run typecheck` passed |
| Standard suite | 208 files passed, 1 skipped; 1,923 tests passed, 9 skipped |
| Golden release cases | 2 files, 7 tests passed |
| Company audit shard 0 | 11 tests passed |
| Company audit shard 1 | 11 tests passed |
| Company audit shard 2 | 13 tests passed |
| Workbook run identity | 10 tests passed, including distinct audit/run IDs and hash stamp |
| Numeric/run-coherence E2E | 2 real-company Playwright cases passed in 1.5 minutes |
| Model catalog freshness | 43 definitions, generated documentation current |
| `any` budget | Passed, 16 occurrences against maximum 20 |
| Traceability schema check | Passed for v20 |
| Production build | Passed; 1,416 modules transformed |
| Bundle budget | Passed; 72 chunks, 1,408.0 KB total gzip; worker 152.5 KB gzip |

The full standard suite required approximately 642 seconds on this Windows workspace. Direct Vitest startup occasionally encounters a Windows/esbuild sandbox directory-access error before test collection; rerunning the same files through the normal `npm test -- <files>` path succeeds. This is an environment startup issue, not an assertion failure.

## 7. Corpus truth changes

The all-company audit found that three observed baselines overstated current rigor:

- Asian Paints: observed state corrected to syntactically valid, reconciliation failed, economic blocked, concept valuation-blocked;
- NTPC: observed state corrected to syntactically valid, reconciliation failed, economic passed, concept valuation-blocked;
- Reliance Industries: observed state corrected to syntactically valid, reconciliation failed, economic blocked, concept valuation-blocked.

These are fail-closed observed-baseline corrections supported by critical reconciliation evidence. Their nested target states were preserved, so remediation goals were not weakened to make tests pass.

## 8. Production dependencies and deliberate non-claims

The following are not claimed as deployed production infrastructure:

1. **External identity provider and authenticated tenancy.** The principal/workspace contract and authorization boundary exist, but the deployed IdP/session provider must be selected and integrated.
2. **Transactional database adapter.** Repository semantics, validation, CAS, idempotency, pagination, and reference in-memory adapters exist. A production Postgres/managed-database adapter and migrations require an infrastructure decision.
3. **Durable object-store adapter.** Artifact semantics and verification exist. Production object storage, encryption/KMS, lifecycle policies, and signed download URLs require provider configuration.
4. **Distributed rate limiter.** Server handlers are hardened, but durable cross-instance rate limiting needs a transactional/Redis-compatible provider. An in-memory serverless limiter is not represented as durable protection.
5. **Complete real-company sector sidecars.** Sector-native execution contracts are implemented. Each issuer still requires governed source onboarding and evidence mapping; no automatic case inference is claimed.
6. **Advanced experimental models.** Real options, ESG, FX, and lease models remain explicitly experimental/not-wired until their facts, calibration, guards, and goldens satisfy the catalog contract.
7. **Historical-vintage data warehouse.** No-lookahead calibration semantics are implemented, but broad point-in-time backtesting requires licensed vintage data.
These dependencies do not weaken the local architecture contract. They are the remaining deployment program and must be resolved through ADRs before claiming multi-tenant production readiness.

## 9. Recommended productionization sequence

1. Adopt ADRs for IdP/session, transactional database, object store/KMS, and distributed rate limiting.
2. Implement database and artifact adapters against the existing repository conformance suites.
3. Expose the application service through authenticated, workspace-scoped API endpoints.
4. Run migration and failure-injection tests for idempotency, optimistic finalization, event-chain integrity, retention, and publication lock.
5. Onboard sector sidecars issuer by issuer with source licenses and golden-company review.
6. Expand the Playwright numeric contract from the current industrial/FI critical paths to downloaded workbook parsing and multi-company comparison rows.
7. Add point-in-time market/fundamental vintages and expand forecast calibration from contract-level to portfolio-level evidence.

## 10. Architecture decisions

The composite plan is now split into ADR-009 through ADR-016 under `docs/architecture/decisions/`. ADR-009 through ADR-014 and ADR-016 are accepted and reflect implemented repository contracts. ADR-015 remains proposed until identity, database, object-store/KMS, and distributed-rate-limit providers are selected and their deployed adapters pass conformance and restore drills.

## 11. Definition-of-done assessment

The repository-scoped definition of done is met:

- authoritative analytical content is immutable and content-addressed;
- run execution is compute-once and worker-backed;
- facts, lineage, window, market, assumptions, forecasts, models, gates, synthesis, and publications have explicit contracts;
- weak or missing evidence fails closed;
- model maturity and independence are governed;
- sector cases execute through validated catalog bindings;
- run metadata, artifacts, and event chains have repository/service boundaries;
- publications expose the same run identity;
- industrial/FI numeric E2E proves cross-tab run coherence and the crore-share market-cap boundary;
- standard, golden, corpus, type, catalog, schema, build, and bundle gates pass.

Multi-tenant deployed production readiness remains conditional on the external infrastructure decisions listed in Section 8. The architecture intentionally exposes those dependencies instead of hiding them behind browser storage or optimistic status labels.
