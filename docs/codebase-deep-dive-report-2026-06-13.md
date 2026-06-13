# Penman V2 Analysis — End-to-End Codebase & Documentation Review

**Date:** 13 June 2026  
**Scope:** Source code, tests, docs, reference material, validation results  
**Method:** Parallel subagent deep-dive + direct tool validation  
**Branch:** `main` (`a4b65274`)

---

## 1. Executive Summary

Penman V2 is a mature, domain-driven financial-analysis application built on **Vite 7 + React 19 + TypeScript 5.9 + Tailwind 4 + Vitest 4**. It ingests Capitaline/Screener/XBRL/JSON/manual financial statements, recasts them into a canonical `RecastPeriod[]`, and runs Penman–Nissim residual-income, bank/NBFC/insurance, SOTP, EPV, reverse-DCF, and anomaly-detection models.

**Validation status: GREEN.**
- `npm run typecheck` — clean
- `npm test` — **1,799 passed, 9 skipped**, 186 test files (185 passed, 1 skipped)
- `npm run test:golden` — **7 passed** (ITC, Asian Paints, release gate)
- `npm run build` — success, ~2 min 19 s

Despite green CI, the codebase carries **architectural hygiene risks** (duplicate type definitions, JS/TS split in `api/`, scripts excluded from `tsc`, workspace clutter) and **documentation drift** (stale maturity scores, schema-version claims that need verification, retroactive ADR backlog). No production-ready rigor rows exist yet across 33 audited companies, even though the maturity scorecard now reads 8.5/10 — the score reflects fixed predicates and market-data wiring more than full analytical maturity.

---

## 2. Validation & Quality Metrics

| Check | Command | Result | Notes |
|---|---|---|---|
| Typecheck | `npm run typecheck` | ✅ pass | `tsc --noEmit` clean |
| Full test suite | `npm test` | ✅ pass | 1,799 tests passed, 9 skipped (`advancedModelsCyclical.spec.ts` skips when real ZIPs absent) |
| Golden tests | `npm run test:golden` | ✅ pass | 7 tests: ITC audited run, Asian Paints audited run, release gate |
| Production build | `npm run build` | ✅ pass | 2 m 19 s; largest chunk `vendor-file-parsing` is ~1.03 MB gzipped |

### Code-size metrics
| Category | Count / Lines |
|---|---|
| TS source files (`src/`) | 489 `.ts` |
| TSX component files (`src/`) | 204 `.tsx` |
| TS/TSX source lines | ~19,536 |
| JavaScript (`api/`, `scripts/`) | ~3,315 lines |
| Markdown docs (`docs/`, `references/`, root) | ~23,022 lines |
| Test files | 190 `.spec.ts(x)` files |
| Tracked files total | ~1,017 |
| Untracked files in working tree | 208 (mostly Paltalk/personality-engine scratch files) |

### Recent commits
- `a4b65274` feat: align checkpoint and scorecard logic with actual status values (#267)
- `3c65b3c1` feat: wire Yahoo Finance market data into audit pipeline (#266)
- `294915c9` feat: implement production-ready checkpoint contract and scorecard v2 (#265)
- `33d940ac` feat(engine): hard-tieout reconciliation promotion, sector-native strategy IDs (#264)
- `eb52387b` docs(scorecard): record valuation maturity baseline (#263)

---

## 3. Architecture Inventory

### 3.1 Directory topology

| Directory | Files (approx.) | Purpose |
|---|---|---|
| `src/engine/` | 373 (224 src, 142 test) | Core finance logic: parsers, recasting, valuation, rigor, anomaly detection |
| `src/components/` | 215 (196 src, 19 test) | React UI: reports, panels, charts, wizards, debug tooling |
| `src/lib/` | 52 (32 src, 20 test) | Persistence, registry, audit snapshots, feature flags, migrations, shared API |
| `api/` | 15 | Vercel serverless functions (research, audit, market data, blackboard, cron) |
| `scripts/` | 20 | Build-time validators, batch auditors, scorecard generator, fixture/sidecar scripts |
| `server/` | — | Local Express mirror of Vercel `/api/*` routes |
| `public/data/companies/` | — | Gitignored raw Capitaline ZIPs + `registry.json` |

### 3.2 Core engine (`src/engine`)

**Pipeline entry points:**
- `processCompanyDataFull()` (`pipeline.ts`) → `PipelineResult`
- `processCompanyData()` → `RecastPeriod[]`
- `processBankData()` (`bankPipeline.ts`) for financial institutions
- `buildValuationCommandCenter()` (`valuationCommandCenter/`) for multi-model triangulation

**Key architectural patterns:**
- **Shared Trust Envelope:** `AnalysisTraceabilityEnvelope` is the single confidence signal consumed by Valuation, Forecast, Ratio, Quality, Statements, Regression, V3 Analytics, and Academic Report tabs.
- **Rigor ladder:** five sequential levels (`syntactically-valid` → `structurally-reconciled` → `economically-plausible` → `valuation-eligible` → `production-ready`) with feature-flagged gates in `src/lib/featureFlags.ts`.
- **Company-type-adaptive routing:** explicit `company_type` dropdown is primary; `assessAnalysisScope()` is fallback. Industrial → Penman–Nissim; bank/NBFC/insurance → bank pipeline.
- **S-9.4C capital-cost consistency:** `kw` derived structurally via `deriveKwFromConfig()` and treated read-only in UI.
- **Dual-scope support:** consolidated + standalone loaded together; gap surfaced as subsidiary contribution.
- **Policy versioning:** pinned in `src/engine/policyVersions.ts` — `TRACEABILITY_SCHEMA_VERSION = "2026-06-traceability-v19"`.

**Notable sub-modules:**
- `PenmanNissimEngine/` — residual-income valuation
- `bankValuation/`, `bankPipeline.ts` — bank/NBFC/insurance
- `v3Analytics.ts` — Ohlson reversion CV, analytical depth, anti-tautology
- `anomalyDetection/` — reconciliation/economic sanity checks
- `valuationCommandCenter/` — SOTP, triangulation, command-center hero
- `valuationEvidence/` — assumption ledger, evidence-weighted synthesis
- `capitalineParser.ts` — 4-strategy parser for AngularJS HTML `.xls` exports

### 3.3 UI layer (`src/components`)

- Dashboard-first layout: `DashboardView.tsx`, `KPITile.tsx`, `CompanyHeaderCard.tsx`, `PenmanDecompositionChart.tsx`.
- Report tabs: `ValuationReport`, `RatioReport`, `ForecastReport`, `QualityReport`, `AcademicReport`, `ComparisonReport`, `FinancialInstitutionReport`, `AtlasReport`, `BusinessModelReport`.
- Shared design system in `shared/DesignSystem.tsx` (`MetricCard`, `VerdictBanner`, `ConfidenceBadge`, etc.).
- Charts built with Recharts + D3; PDF export via `html2canvas`/`jspdf`; Excel export via `exceljs`/`jszip`.
- Debug tooling: `TraceabilityPanel`, `MappingAuditGrid`, `TraceLogViewer`.

### 3.4 Persistence / lib (`src/lib`)

- `companyRegistryStore.ts` — local registry CRUD
- `sharedResearchApi.ts` — Vercel blob-backed shared workspace
- `auditSnapshot.ts` / `audit.ts` — audit run snapshots and access tokens
- `kvClient.ts` — Vercel KV wrapper with `localStorage` fallback
- `envelopeMigrations.ts` — forward migrations v8 → v19
- `featureFlags.ts` — kill-switches for new rigor gates
- `traceLogger.ts` — structured ring-buffer event tracing

### 3.5 Server / API (`api/`)

- `api/research/index.js` — main research CRUD + comparison-registry storage
- `api/audit/inspector.js` / `monitor*.js` — audit inspection and monitoring
- `api/market-data/snapshot.js` — Alpha Vantage / Upstox / NSE / Yahoo Finance proxy
- `api/blackboard/` — experimental multi-agent blackboard store
- `api/cron/monitor-audit.js` — cron monitor entry

**Important:** `api/` files are **plain JavaScript** and are **excluded from `tsconfig.json`**, so they are not typechecked by `npm run typecheck`.

---

## 4. Documentation Review

### 4.1 Documents read

High-impact docs reviewed in the repo:
- `docs/financial-model-rigor-plan.md` — master rigor plan
- `docs/analysis-rigor-ladder.md` — current rigor implementation
- `RIGOR_KNOWLEDGE_BASE.md` — operational reference / continuity doc
- `docs/COMPREHENSIVE-VALUATION-DESIGN.md` — aspirational 10-part design
- `docs/valuation-maturity-scorecard.md` + `docs/adr/008-valuation-maturity-scorecard.md`
- `docs/adr/001-concept-identity-layer.md` through `006-pipeline-strategy-pattern.md`
- `docs/NEXT-PHASE-ROADMAP.md`, `docs/poly-paradigm-valuation-plan.md`, `docs/sector-native-modelling-plan.md`, `docs/reinvestment-runway-and-share-basis-plan.md`, `docs/operational-handoff.md`
- `CLAUDE.md`, `README.md`
- Hermes skill reference corpus (~100 files at `C:\Users\rajesh\AppData\Local\hermes\skills\software-development\penman-v2-analysis\references\`)

### 4.2 Documentation status

| Document | Status | Key issue |
|---|---|---|
| `docs/financial-model-rigor-plan.md` | Mostly implemented, some exit criteria aspirational | Source-cell tie-out, cross-device residual sync, 10+ golden companies still open |
| `docs/analysis-rigor-ladder.md` | Current implementation spec | Parser fidelity lighter for non-Capitaline modes; three schema bumps (v15/v16/v17) shipped without ADRs |
| `RIGOR_KNOWLEDGE_BASE.md` | Authoritative reference | Confirms v19 schema; lists open Phases 2–4 (S-9.4C completion, god-module decomposition, ADR-006 spine) |
| `docs/COMPREHENSION-VALUATION-DESIGN.md` | **Stale** | Header says "PLAN MODE — no implementation yet" but sections are shipped; 6/10 score is outdated |
| `docs/valuation-maturity-scorecard.md` | **Inconsistent with ADR/operational-handoff** | Live file shows **8.5/10**, but `docs/operational-handoff.md` and skill reference still cite **6.1/10** |
| `docs/adr/008-valuation-maturity-scorecard.md` | Needs refresh | Records 6.1/10 baseline; should be updated to current 8.5/10 or replaced by regeneration |

### 4.3 Contradictions & stale data

1. **Maturity score mismatch.** The checked-in scorecard now reports **8.5/10** after PRs #265–#267, while `operational-handoff.md` and the Hermes skill reference still say **6.1/10**.
2. **Schema version.** Both `analysis-rigor-ladder.md` and `RIGOR_KNOWLEDGE_BASE.md` claim `TRACEABILITY_SCHEMA_VERSION` is `2026-06-traceability-v19`. The code (`src/engine/policyVersions.ts:8`) confirms this.
3. **ADR backlog.** Schema bumps v15 (SOTP), v16 (FX neutrality), and v17 (evidence locking) shipped without ADRs. `analysis-rigor-ladder.md` notes ADR-009/010 are queued.
4. **"10/10" capability vs score.** The 8.5/10 score is driven by fixed predicates, Yahoo Finance market-data wiring, and scorecard alignment — not by full sector-native coverage. **0/33 audited rows reach `production-ready` rigor**; most are capped at `structurally-reconciled` or `economically-plausible`.

---

## 5. Key Findings

### 5.1 Code-level issues

| Issue | Location | Severity | Detail |
|---|---|---|---|
| Duplicate interface | `src/engine/types/traceabilityEnvelope.ts:31` and `:47` | Low / hygiene | `AccountingStandardCoverage` declared twice; TypeScript merges them, so it compiles, but it is a maintenance trap |
| JS/TS split | `api/*.js` vs rest of app | Medium | API files excluded from `tsconfig.json`; no static type safety on serverless endpoints |
| Scripts untyped by `tsc` | `scripts/*.ts` | Medium | Scripts use `tsx` at runtime but are not included in `tsconfig.json`; errors surface only when run |
| Large engine files | `analysisTraceability.ts` (~636 lines), `pipeline.ts` (~359 lines) | Medium | Multiple responsibilities; decomposition candidate |
| Registry logic in UI | `src/components/data-entry/companyRegistry.ts` | Low | Registry serialization arguably belongs in `src/lib/` |
| Experimental blackboard | `api/blackboard/`, `src/lib/afesBlackboardSnapshot.ts` | Low | Not obviously wired into main app surface |
| Workspace clutter | repo root | Low / hygiene | 208 untracked files (Paltalk probes, logs, personality-engine scratch) unrelated to Penman |
| Empty root `tests/` | `tests/` | Low | Misleading; all tests live in `__tests__` subfolders |

### 5.2 Documentation issues

- Stale maturity-score figures in `operational-handoff.md` and skill reference.
- `COMPREHENSIVE-VALUATION-DESIGN.md` needs a status banner distinguishing shipped vs aspirational.
- Missing retroactive ADRs for v15/v16/v17.

### 5.3 Analytical / product gaps

From docs, skill references, and the live scorecard:

| Gap | Evidence | Impact |
|---|---|---|
| No production-ready rows | Scorecard: 0/33 production-ready | Reviewer-grade defensibility not yet achieved |
| Source-lineage incomplete | 10/33 rows lack first-class source-lineage evidence | Hard tie-out harder |
| Sector-native coverage thin | Telecom/utility capped at `economically-plausible`; insurance relies on sidecar EV; real estate/holding companies unsupported | Valuation gaps for major sectors |
| God modules | `PenmanNissimEngine`, `valuationCommandCenter`, `bankValuation`, `capitalineParser` still flagged for decomposition | Velocity and review friction |
| Automated spec evolution | No system turns unmatched-label audit logs into `MappingSpec.yaml` suggestions | Mapping coverage grows manually |
| Cross-device residual sync | Deferred | Residuals dashboard local-only by default |
| Market-data gap | SHRIRAMFINAN 404 from Yahoo Finance | One audited row lacks fresh market evidence |

---

## 6. Risks

1. **Type-safety gap on server boundary.** `api/` JavaScript is not typechecked; contract drift between `api/research/index.js` and `src/lib/sharedResearchApi.ts` is possible.
2. **Scripts fail at runtime, not compile time.** `scripts/` are TypeScript but excluded from `tsc`; CI does not catch type errors in batch auditors or scorecard generator.
3. **Documentation drift confuses future agents.** Multiple stale scores and outdated plan-mode claims reduce the value of the extensive doc corpus.
4. **Scorecard optimism vs reality.** 8.5/10 headline masks 0 production-ready rows and thin sector-native coverage; this can mislead prioritization.
5. **Workspace hygiene.** 208 untracked files make `git status` noisy and increase the risk of accidentally committing unrelated files.

---

## 7. Recommendations

### Immediate (this week)

1. **Fix the duplicate `AccountingStandardCoverage` interface** in `src/engine/types/traceabilityEnvelope.ts`.
2. **Reconcile stale maturity-score figures:** regenerate `docs/valuation-maturity-scorecard.md` with `scripts/valuation-scorecard.ts` and update `docs/operational-handoff.md` + the Hermes skill reference to match.
3. **Add a status banner** to `docs/COMPREHENSIVE-VALUATION-DESIGN.md` showing shipped / partial / not-started sections.

### Short-term (next 2–4 weeks)

4. **Typecheck `api/` and `scripts/`:** extend `tsconfig.json` to include them (or add a separate `tsconfig.scripts.json`) and wire into CI.
5. **Author retroactive ADRs** for traceability schema v15, v16, v17, or explicitly drop them from the queue and update `analysis-rigor-ladder.md`.
6. **Move registry serialization** from `src/components/data-entry/companyRegistry.ts` to `src/lib/`.
7. **Clean workspace:** add `.gitignore` rules or delete unrelated untracked files to restore `git status` signal.

### Strategic (next quarter)

8. **Drive production-ready rigor rows** by completing source-lineage evidence and hard-tieout reconciliation rather than adding new valuation models.
9. **Lift sector-native caps** for telecom/utility and insurance (per `sector-native-telecom-utility-valuation.md` and `insurance-onboarding-and-verification.md`).
10. **Decompose god modules** (`PenmanNissimEngine`, `valuationCommandCenter`, `bankValuation`, `capitalineParser`) per `module-decomposition.md`.
11. **Automated mapping evolution:** build a pipeline from unmatched-label audit logs to proposed `mappingSpec.ts` additions.

---

## 8. Conclusion

Penman V2 is a well-tested, cleanly building, analytically ambitious codebase. The shared trust-envelope / rigor-ladder architecture is a genuine strength, and the CI surface is green. The main work ahead is **hygiene and honesty**: close the JS/TS split, fix doc drift, and resist interpreting the 8.5/10 maturity score as near-completion while 0 rows are production-ready and sector-native coverage remains thin. Prioritize source-lineage completeness and sector-native correctness before expanding the model zoo.

---

*Report generated by Hermes Agent. No source files were modified.*
