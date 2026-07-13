# Penman V2 Principal Architecture Plan — Valuation Platform Greenfield Design

**Date:** 2026-07-10 (IST)
**Status:** Implemented in repository scope on 2026-07-11; see `2026-07-11-valuation-platform-plan-implementation-report.md` for validation and deployment dependencies
**Scope:** End-to-end analytical platform, with valuation correctness as the primary design center
**Current traceability schema observed:** `2026-06-traceability-v20`
**Implementation posture:** Correction-first strangler migration; no big-bang rewrite
**Primary audience:** Principal engineers, valuation-model owners, accounting-policy reviewers, security/platform owners, and release reviewers

---

## 1. Executive decision

Penman V2 should not add another standalone valuation formula as its next major investment. The repository already contains broad analytical coverage: Penman residual-income and residual-operating-income methods, FCFF and FCFE variants, owner-earnings and cash-statement DCF, EPV, reverse DCF, SOTP, relative valuation, Monte Carlo, bank/NBFC/insurance branches, quality overlays, and several advanced but incompletely integrated modules.

The limiting problem is that the platform does not yet guarantee that all of those capabilities operate on one authoritative set of facts, one clean analytical window, one market snapshot, one assumption set, one forecast state, and one trust decision. Several current contracts can also promote weak evidence, count non-models as models, or allow different UI surfaces to compute different answers for what appears to be the same run.

The target is therefore a **Valuation Case Engine** centered on an immutable, content-addressed `AnalysisRun`. One run must own the complete chain:

1. source artifacts;
2. canonical facts and actual fact-level provenance;
3. family classification and recast output;
4. sequential trust-gate results;
5. selected clean analysis window;
6. pinned market and macro snapshot;
7. sourced assumptions and ranges;
8. balanced forecast cases;
9. applicability-aware model results;
10. independence-aware valuation synthesis;
11. final trust envelope, publication snapshot, and reproducibility hash.

Every UI, workbook, comparison row, audit record, and API response must be a projection of that same run. UI components must not enrich or recompute the run independently.

This plan supersedes `docs/architecture/plans/2026-06-29-sophistication-roadmap.md` as forward execution guidance. It does not rewrite or invalidate the historical to-10x closure plans or prior ADRs.

---

## 2. Evidence base and current baseline

This design is grounded in a repository-wide architecture pass performed against the 2026-07-10 worktree.

### 2.1 Repository shape

- 937 repository files were inventoried.
- `src/` contains approximately 101K lines across engine, UI, libraries, hooks, and tests.
- 191 test files were identified across engine, components, libraries, scripts, and integration tests.
- The audited registry contains 33 companies spanning consumer, industrial, IT services, cyclical, conglomerate, telecom, utility, loss-maker, bank, NBFC, and insurance cases.
- The app exposes roughly 20 analysis/workflow tabs.
- The current worktree was already dirty and ahead of `origin/main`; this report does not claim that all observed changes are committed.

### 2.2 Validation observed during the review

- `npm run typecheck`: passed.
- `npm run lint:any`: passed, with engine total `16 <= 20`.
- Focused rigor/forecast/valuation suite: 10 files and 82 tests passed.
- `npm run build`: passed; 1,361 modules transformed.
- Registry validation: 33 companies and bundled ZIPs passed.
- Live valuation maturity scorecard: 8.5/10, 0 `CALC_ERROR`, and 0/33 fully production-ready under the complete checkpoint contract.
- The full default Vitest invocation exceeded ten minutes and timed out without emitting a test failure. This is a release-system concern, not proof of a failed test.
- Market access was unavailable during the live scorecard run, so all 33 rows reported market-freshness/reviewer-pack failures in that environment. These must not be interpreted as accounting-data failures.

### 2.3 Why existing roadmaps cannot be executed verbatim

The June 29 roadmap records 86 `any` occurrences and 10 missing-lineage rows. The observed worktree has an enforced engine total of 16 `any` occurrences and the live scorecard reports no missing lineage references. Conversely, the current worktree contains correctness and evidence-semantics risks that the older roadmap does not prioritize.

The correct response is to re-baseline from executable contracts, not to continue checking off historical task lists.

---

## 3. Current-state architecture

The present application is a client-heavy React system with a deterministic accounting engine and several parallel analytical paths.

```text
Capitaline / Screener / JSON / XBRL / Manual
                    |
                    v
           RawPeriodData[]
       (flat raw metric map per period)
                    |
                    v
       processCompanyDataFull
        /                   \
 industrial recast       FI pipeline
        |             bank/NBFC/insurance
        v                   |
 RecastPeriod[]             v
        |            BankPeriodMetrics[]
        +---------+---------+
                  |
                  v
     traceability / publication / UI
                  |
      several UI-local analytics builds
```

Strengths worth preserving:

- deterministic pure-function analytical modules;
- strict TypeScript settings;
- extensive golden and focused domain tests;
- explicit policy versions and envelope migrations;
- fail-closed intent throughout the rigor documents;
- audited real-company corpus;
- strong breadth across industrial and financial-institution valuation;
- source artifact hashing work in the current v20 worktree;
- evidence, holdout, anti-tautology, and model-applicability concepts already represented in code;
- lazy UI chunking and a successful production build;
- local and Vercel deployment modes.

The target architecture should reuse these assets while replacing ambiguous contracts and duplicate orchestration.

---

## 4. Findings and risk register

Severity meanings:

- **P0:** can materially misstate valuation, trust, access control, or maturity evidence;
- **P1:** prevents a coherent institutional architecture or creates substantial extension risk;
- **P2:** quality, maintainability, operability, or reviewer-experience debt.

### 4.1 Correctness and trust

| ID | Severity | Finding | Current evidence | Required disposition |
|---|---|---|---|---|
| INT-01 | P0 | Financial-institution UI market cap divides by `1e7` even though shares are already in crores. | `src/app/components/TabRouter.tsx:78-80`; engine paths multiply price by crore shares without the extra division. | Fix immediately and add unit/metamorphic tests across industrial and FI paths. |
| TRU-01 | P0 | Rigor checkpoints are independently evaluated rather than enforced as a prefix. Structural clearance does not require syntactic clearance; valuation and production omit the economic-sanity blocker. | `src/engine/analysisTraceability.ts:333-405` | Replace boolean checkpoint assembly with a monotonic gate evaluator. |
| TRU-02 | P0 | A failed reconciliation can be exposed as degraded when selected hard tie-outs pass. | `src/engine/analysisTraceability.ts:243-245` | Never promote a failed state. Separate overall failure from readiness sub-dimensions. |
| TRU-03 | P0 | Reconciliation can be `confirmed` when periods exist but no checks apply. | `src/engine/reconciliationResiduals.ts:751-774` | Add `insufficient-evidence` and `not-applicable`; confirmed must require a family-specific minimum pack. |
| DAT-01 | P0 | Per-period mapping-miss flags created by recast are overwritten by anomaly flags. | `src/engine/pipeline.ts:295-300`; mapping flags originate in `PenmanNissimEngine/recast.ts`. | Merge by stable signal ID and retain source/category provenance. |
| VAL-01 | P0 | Forecast years are represented by cloning the latest `RecastPeriod`; the same historical cash-flow object is reused for every forecast year. | `src/engine/forecastingEngine/scenarios.ts:396-482` | Introduce a distinct balanced forecast state; valuation must not consume synthetic `RecastPeriod` clones. |
| VAL-02 | P0 | Scenario headline median gives correlated RE and ReOI two votes against one owner-earnings DCF. | `src/engine/valuationCommandCenter/helpers.ts:53-59` | Collapse correlated formulations into one evidence family before synthesis. |
| VAL-03 | P0 | Invalid cash-DCF terminal economics silently produce zero terminal value while retaining a computed positive output. | `src/engine/cashFlowDcf.ts:124-135`; current spec accepts this. | Return `invalid` with failed guard; exclude from ranges and model counts. |
| VAL-04 | P1 | The default positive `ke` behaves as a permanent manual override, ordinarily bypassing CAPM branches and live risk-free updates. Default positive `kd_pretax` similarly bypasses inferred/market debt costs. | `src/engine/types/config.ts:168-173,264-280`; `PenmanNissimEngine.ts:75-84` | Replace scalar ambiguity with explicit cost-of-capital modes and evidence. |
| VAL-05 | P1 | `useAdvancedModels` reads `config.ke` directly instead of the shared resolver. | `src/hooks/useAdvancedModels.ts:37` | All models consume a pinned `CostOfCapitalResult`. |
| VAL-06 | P1 | The economic-sanity anchor and valuation-readiness anchor are separate policies; valuation does not consume the economic gate's selected anchor. | `analysisTraceability.ts` vs `valuationPolicy.ts` / `valuationCommandCenter/core.ts` | Create one `AnalysisWindow` selected before forecasting and valuation. |
| VAL-07 | P1 | Model breadth exceeds production integration. Credit-spread WACC, ESG-adjusted ke, FX hedging, lease adjustment, and real-options modules have no meaningful production entrypoint. | Modules under `src/engine/valuation/`; no non-test consumers found for most modules. | Wire through explicit applicability/data contracts or classify as experimental and exclude from maturity. |
| VAL-08 | P1 | Bank scenarios use fixed ROE/g/ke deltas and fixed probabilities rather than NIM, credit-cost, RWA, capital, and funding drivers. | `src/engine/bankValuation/scenarios.ts` | Replace with family-native forecast cases. |
| VAL-09 | P1 | Bank/NBFC triangulation uses an unweighted median of several highly correlated book/earnings lenses. | `src/engine/bankValuation/computeBankValuation.ts` | Group correlated lenses; use reliability and driver independence rather than model count. |
| VAL-10 | P1 | Bank SOTP entrypoint is a documented placeholder returning null. | `src/engine/bankValuation/sotp.ts` | Implement through segment/subsidiary facts or remove the advertised capability. |

### 4.2 Evidence and model-governance integrity

| ID | Severity | Finding | Current evidence | Required disposition |
|---|---|---|---|---|
| AUD-01 | P0 | Audit code adds `TELECOM_NATIVE` and `UTILITY_RAB` from a strategy stamp, not from a computed sector-specific result. | `scripts/lib/auditCompanyRun.ts:1117-1126` | Maturity derives only from typed model results. |
| AUD-02 | P0 | Reverse DCF and evidence-weighted synthesis are counted as models even though reverse DCF is price-derived and synthesis is an aggregator. | `computedIndustrialModelNames` in `auditCompanyRun.ts` | Separate intrinsic models, market-implied diagnostics, relative lenses, and aggregators. |
| LIN-01 | P1 | `RawPeriodData` remains a flat mixed key/value map without per-fact artifact/cell/context provenance. | `src/engine/types/raw.ts` | Introduce `CanonicalFact` and a `FactSet`. |
| LIN-02 | P1 | Lineage is reconstructed post hoc using static recipes and synthetic derived-key names. | `src/engine/lineageBuilder.ts` | Generate transformation lineage while resolving facts and computing outputs. |
| LIN-03 | P1 | The lineage checksum is FNV-like drift detection, not cryptographic content identity. | `lineageBuilder.ts:320-333` | Use SHA-256 over canonical serialization for run and evidence identities. |
| EVD-01 | P1 | Assumption ledger rows have `sourceRef` and `sourcePeriodWindow` set to null while claiming clean-history or reported-history sources. | `src/engine/valuationEvidence/assumptionLedger.ts:55-56` | Assumption resolvers must emit actual evidence references and windows. |
| EVD-02 | P1 | Several confidence scores, scenario probabilities, and artifact probabilities are hand-tuned heuristics without calibration evidence. | `forecastingEngine/scenarios.ts`, `greenfieldPipeline/confidence.ts`, detector constants | Rename uncalibrated probabilities to scores; calibrate before interpreting as probabilities. |

### 4.3 Greenfield sidecar

| ID | Severity | Finding | Current evidence | Required disposition |
|---|---|---|---|---|
| GRN-01 | P0 | Default greenfield mode is `adjusted-with-audit`. | `src/engine/types/config.ts:182` | Default to `as-reported-only` until adjustment invariants clear. |
| GRN-02 | P0 | Lease adjuster can subtract lease liabilities from `FO_FinancialDebtExLease`, which is already an ex-lease field when sourced from recast. | `greenfieldPipeline/l1Normalize.ts:122`; `adjusters/index.ts:59-64` | Correct semantics; express adjustments as balanced transformations. |
| GRN-03 | P0 | Dirty-surplus adjustment sets the detected residual to zero without reconstructing the accounting flow. | `adjusters/index.ts:70-80` | No zeroing residuals. Reclassification must identify counterpart facts and preserve identities. |
| GRN-04 | P1 | Adjustment validation checks only a narrow field set and a small subset of identities. | `greenfieldPipeline/validateAdjustments.ts` | Validate all affected statements, bridges, units, signs, and lineage. |
| GRN-05 | P1 | Adjusted confidence awards bonuses based on a suggested adjuster and heuristic score, not necessarily a validated accepted transformation. | `greenfieldPipeline/confidence.ts` | Confidence derives from accepted transformations and evidence, never suggestions. |
| GRN-06 | P1 | The sidecar runs only after industrial recast and does not authoritatively feed forecast/valuation. | `src/engine/pipeline.ts:340-367` | Reuse its detectors in the new signal stage; do not promote the current sidecar into a second source of truth. |

### 4.4 Application and run coherence

| ID | Severity | Finding | Current evidence | Required disposition |
|---|---|---|---|---|
| APP-01 | P0 | Traceability, Dashboard, and Valuation can build different command-center outputs for the same apparent run. | `useAuditAnalysis.ts`, `DashboardView.tsx`, `ValuationReport.tsx` | Compute once in the run executor. |
| APP-02 | P1 | Analytical depth and anti-tautology are added at the Valuation UI seam, so persisted/shared envelopes may be weaker than the displayed run. | `ValuationReport.tsx:156-170`; ADR-007 consequence | Finalize trust after valuation, before persistence/publication. |
| APP-03 | P1 | `TabRouter` carries a broad prop bundle and an `AnyResult` escape hatch. | `src/app/components/TabRouter.tsx:31-67` | Route by `runId` and typed selectors from an analysis-run store. |
| APP-04 | P1 | Market data is fetched at App level and again inside Valuation, potentially with different provider/symbol resolution and timestamps. | `AppShell.tsx`; `ValuationReport.tsx` | One market-data coordinator; refresh creates a new snapshot/version. |
| APP-05 | P2 | Several narrative and fallback messages describe historical support states that no longer match the implemented FI paths. | `TabRouter.tsx` fallback copy and historical docs | Generate capability copy from model applicability rather than hard-coded prose. |

### 4.5 Platform, security, and persistence

| ID | Severity | Finding | Current evidence | Required disposition |
|---|---|---|---|---|
| SEC-01 | P0 | Client code can read a `VITE_KV_REST_API_TOKEN` and send it directly to KV. | `src/lib/kvClient.ts:22-31,97,137,160` | Remove all storage credentials from browser bundles; server-side repository only. |
| SEC-02 | P0 | “Authenticated” identity is a local-storage string and can be freely impersonated. | `src/lib/identity.ts` | Server-established user, organization, and workspace principal. |
| SEC-03 | P0 | Live market providers require audit-admin auth in Vercel, while the browser hook sends only `x-penman-local`. | `api/market-data/snapshot.js:523-526`; `useLiveMarketData.ts:53-56` | Use session authorization or a public, tightly rate-limited market proxy; never expose admin token. |
| SEC-04 | P0 | Browser audit-event persistence does not send an admin header and does not fall back to the stored run token for events. | `src/lib/audit.ts:154-166,245-259` | Define a coherent run-scoped write protocol or authenticated session protocol. |
| PER-01 | P1 | Research persistence is global by company path, not tenant/workspace scoped. Comparison registry is one global snapshot. | `api/research/index.js` | Namespace by organization/workspace/user and enforce authorization server-side. |
| PER-02 | P1 | Vercel Blob optimistic concurrency is read-then-write with an acknowledged race. | `api/research/_store.js` | Transactional metadata store with atomic revision checks. |
| PER-03 | P1 | Local Express and Vercel handlers duplicate research, audit, and market logic and already differ in supported providers and behavior. | `server/routes/*` vs `api/*` | Shared application services with storage/HTTP adapters. |
| PER-04 | P1 | Research reads have fixed list limits and no robust cursor contract; payload validation is mostly `isRecord`. | `api/research/index.js` | Versioned schemas, validation, pagination, retention, and quotas. |
| SEC-05 | P2 | Production CSP is report-only. | `vercel.json` | Observe violations, remove blockers, then enforce CSP. |

### 4.6 Testing, performance, and documentation

| ID | Severity | Finding | Required disposition |
|---|---|---|---|
| TST-01 | P1 | Default full tests exceeded ten minutes locally and provided no incremental progress output. | Tier tests and publish timing/shard telemetry. |
| TST-02 | P1 | Current tests validate some unsafe contracts, including zero terminal value under invalid DCF economics. | Replace example expectations with fail-closed result-state tests. |
| TST-03 | P1 | E2E validates navigation and labels but not critical numeric equivalence, market-cap units, or cross-surface run identity. | Add numeric E2E and run-hash assertions. |
| TST-04 | P2 | Coverage thresholds are broad and low relative to valuation risk. | Risk-tier coverage and mutation testing for formulas/gates. |
| DOC-01 | P1 | Historical roadmaps and current code disagree on schema, type debt, lineage status, and supported capabilities. | Generate baselines from code and mark plans as proposed/completed/superseded. |

---

## 5. Architecture principles and non-negotiable invariants

### Principle 1 — One run, one truth

A user-visible run has one immutable `AnalysisRun`. All surfaces select from it. No component may recompute valuation, enrich trust, resolve a different market snapshot, or silently choose another anchor.

### Principle 2 — Facts precede statements

Parsers produce facts, not a loose period-wide dictionary. A fact has unit, scope, statement owner, dimensions, filing version, and source location before it can participate in core analysis.

### Principle 3 — Provenance is produced, not reconstructed

Every transformation records its input fact IDs and policy IDs at execution time. Static recipes may explain a formula but cannot count as evidence that a specific number used specific source cells.

### Principle 4 — Gates are monotonic

Achieved rigor levels are always a prefix of the ordered ladder. If gate `n` is not passed, no gate after `n` can be achieved. Diagnostic computation may continue, but it is explicitly unblessed.

### Principle 5 — No success from missing evidence

`confirmed` requires a defined minimum evidence pack. Missing inputs result in `insufficient-evidence`, `not-applicable`, or `skipped`; never a green state.

### Principle 6 — Result states are explicit

All model, gate, parser, reconciliation, forecast, and persistence operations distinguish `computed/passed`, `skipped/not-applicable`, `insufficient-evidence`, and `invalid/failed`.

### Principle 7 — Correlated formulas do not vote independently

RE, ReOI, FCFE, FCFF, AEG, and other algebraically linked formulations may be useful cross-checks but do not automatically create independent confidence. Independence is declared and verified at the evidence-input level.

### Principle 8 — Market price explains expectations, not intrinsic truth

Reverse DCF and market-implied outputs receive zero weight in intrinsic confidence. Relative valuation remains a separately labeled market lens.

### Principle 9 — Assumptions are first-class, sourced data

An assumption has value, unit, source type, evidence reference, period window, mode, range/distribution, reviewer state, and version. A scalar in `EngineConfig` is not sufficient evidence.

### Principle 10 — Family economics are explicit

Industrial, bank, NBFC, insurance, telecom, utility, conglomerate, cyclical, retail, and loss-maker cases may share infrastructure but do not share inappropriate statements or drivers.

### Principle 11 — Units are enforced at boundaries

Market price, INR absolute, INR crore, absolute shares, crore shares, percentages, basis points, dates, and period frequencies cannot be mixed by untyped arithmetic at API/UI/engine boundaries.

### Principle 12 — Time is pinned

Market, macro, peer, policy, and source data are timestamped and pinned into the run. A refresh creates a new snapshot or child run; it never mutates a signed run.

### Principle 13 — Secrets and authorization remain server-side

No `VITE_*` storage credential, admin token, or provider secret is emitted to the browser. Client identity is never accepted as authorization proof.

### Principle 14 — Migrate by strangler

The current engine remains available while new contracts are introduced beside it. Differential golden tests establish parity or explicitly document intended differences. Legacy paths are deleted only after consumers move.

---

## 6. Target logical architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Source adapters                                                     │
│ Capitaline · Screener · XBRL · JSON · Manual · Market · Sidecars    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Artifact + Fact layer                                               │
│ SourceArtifact → CanonicalFact → FactSet → fact validation          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Analysis core                                                       │
│ classify family → recast → reconcile → economic gates → window      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
               ┌────────────────┴────────────────┐
               v                                 v
┌───────────────────────────┐       ┌─────────────────────────────────┐
│ Assumption resolver        │       │ Pinned market/macro/peer pack   │
│ sources · ranges · modes   │       │ timestamps · source provenance  │
└──────────────┬────────────┘       └─────────────────┬───────────────┘
               └────────────────┬─────────────────────┘
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Forecast Case Engine                                                │
│ family-native drivers → balanced projected statements → validation  │
└───────────────────────────────┬─────────────────────────────────────┘
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Valuation Model Catalog                                             │
│ applicability → execute → guard → typed result → evidence group      │
└───────────────────────────────┬─────────────────────────────────────┘
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Synthesis + release gates                                           │
│ family collapse · reliability · uncertainty · divergence · trust    │
└───────────────────────────────┬─────────────────────────────────────┘
                                v
┌─────────────────────────────────────────────────────────────────────┐
│ Immutable AnalysisRun                                               │
│ hash · versions · evidence refs · outputs · trust · publication      │
└──────────────┬────────────────┬─────────────────┬───────────────────┘
               v                v                 v
              UI             workbook          audit/API
```

The core should remain framework-independent TypeScript. Browser execution uses a Web Worker adapter; CLI/audit and server execution import the same core package.

---

## 7. Proposed module boundaries

This is a target layout, not a requirement for one mass move.

```text
src/
  domain/
    artifacts/
    facts/
    policies/
    gates/
    analysis-run/
    assumptions/
    forecasting/
    valuation/
      catalog/
      models/
      synthesis/
      uncertainty/
    evidence/
  families/
    industrial/
    bank/
    nbfc/
    insurance/
    telecom/
    utility/
    conglomerate/
    cyclical/
    loss-maker/
  adapters/
    capitaline/
    screener/
    xbrl/
    json/
    manual/
    market/
  application/
    execute-analysis/
    repositories/
    publications/
  platform/
    browser-worker/
    local-fs/
    server-http/
    blob-artifacts/
    relational-metadata/
  ui/
    analysis-run/
    tabs/
```

Do not introduce a class hierarchy for the whole pipeline. ADR-006 correctly rejected that abstraction when the live system had a readable dispatch fork. The new executor should use an exhaustive discriminated-union switch for family-specific stages. A catalog is justified for valuation models because there are many independently applicable model implementations with common governance requirements.

---

## 8. Core domain contracts

### 8.1 Source artifact

```ts
interface SourceArtifact {
  artifactId: `sha256:${string}`;
  fileName: string;
  mediaType: string;
  byteLength: number;
  sourceMode: "capitaline" | "screener" | "xbrl" | "json" | "manual" | "sidecar";
  acquiredAt: string | null;
  filingAsOf: string | null;
  issuerId: string;
  scope: "consolidated" | "standalone" | "segment" | "unknown";
  parserVersion: string;
  contentClass: string;
}
```

Artifact bytes live in content-addressed object storage. Metadata lives in the transactional metadata store.

### 8.2 Canonical fact

Persist exact source numerics as canonical decimal strings. Convert to bounded branded numeric values only when entering computation.

```ts
interface CanonicalFact {
  factId: string;
  issuerId: string;
  conceptId: string;
  rawLabel: string;
  statement: "BS" | "IS" | "CF" | "OCI" | "EQUITY" | "SEGMENT" | "MARKET";
  period: {
    start: string | null;
    end: string;
    kind: "instant" | "duration";
    frequency: "annual" | "quarterly" | "ttm" | "unknown";
  };
  value: {
    decimal: string;
    currency: "INR" | string | null;
    sourceScale: "absolute" | "thousand" | "lakh" | "million" | "crore" | "ratio" | "count";
    normalizedUnit: "INR_CRORE" | "CRORE_SHARES" | "FRACTION" | "COUNT" | "TEXT";
  };
  scope: "consolidated" | "standalone" | "segment" | "unknown";
  dimensions: Record<string, string>;
  accountingStandard: "ind-as" | "ifrs" | "revised-sch-vi" | "standard" | "unknown";
  filingVersion: string;
  origin: {
    artifactId: SourceArtifact["artifactId"];
    sheet: string | null;
    row: number | null;
    column: number | null;
    cellRange: string | null;
    xbrlContextId: string | null;
    parserMethod: string;
  };
  confidence: "exact" | "mapped" | "inferred" | "manual";
}
```

Fact identity must include issuer, concept, period, scope, dimensions, filing version, and source artifact. Restatements are new facts, not overwrites.

### 8.3 Transformation DAG

```ts
interface TransformationNode {
  nodeId: string;
  outputId: string;
  operation: string;
  formulaVersion: string;
  inputIds: string[];
  policyDecisionIds: string[];
  parameters: Record<string, string | number | boolean | null>;
  resultUnit: string;
  warnings: string[];
}
```

Every material recast, ratio, forecast, model, and per-share number references its transformation node. Formula descriptions remain useful documentation but do not substitute for `inputIds`.

### 8.4 Analysis window

```ts
interface AnalysisWindow {
  windowId: string;
  includedPeriods: string[];
  excludedPeriods: Array<{
    period: string;
    reasonCode: string;
    evidenceRefs: string[];
    policy: "automatic" | "analyst-confirmed";
  }>;
  anchorPeriod: string | null;
  selectionStatus: "confirmed" | "guarded" | "blocked";
  rationale: string[];
}
```

One window is selected after reconciliation/economic checks and is consumed by all forecasts and intrinsic models. A model may request a narrower window but must declare and justify it.

### 8.5 Family output

```ts
type FamilyAnalysis =
  | { family: "industrial"; statements: IndustrialRecast }
  | { family: "bank"; statements: BankAnalyticalState }
  | { family: "nbfc"; statements: NbfcAnalyticalState }
  | { family: "insurance"; statements: InsuranceAnalyticalState }
  | { family: "telecom"; statements: TelecomAnalyticalState }
  | { family: "utility"; statements: UtilityAnalyticalState };
```

Conglomerate, cyclical, retail, IT-services, consumer, and loss-maker behavior may initially be overlays on industrial state. Promote an overlay to a family only when its statement identities and forecast mechanics genuinely differ.

### 8.6 Assumption evidence

```ts
interface SourcedAssumption<T> {
  assumptionId: string;
  key: string;
  value: T;
  unit: string;
  mode: "derived" | "manual-override" | "sector-prior" | "management-guidance" | "market-implied";
  evidenceRefs: string[];
  periodWindow: { from: string; to: string; observations: number } | null;
  range: { low: T; high: T; method: string } | null;
  distribution: {
    family: "point" | "normal" | "lognormal" | "triangular" | "empirical";
    parameters: Record<string, number>;
  } | null;
  confidence: "high" | "medium" | "low" | "unavailable";
  reviewerState: "system" | "reviewed" | "overridden" | "locked";
}
```

Market-implied assumptions are explicitly ineligible for intrinsic-confidence weighting.

### 8.7 Forecast case

```ts
interface ForecastCase<TProjectedState> {
  caseId: string;
  label: string;
  family: FamilyAnalysis["family"];
  analysisWindowId: string;
  assumptionIds: string[];
  horizonYears: number;
  probability: number | null;
  probabilityStatus: "calibrated" | "heuristic" | "not-assigned";
  projected: TProjectedState[];
  validation: ForecastValidationReport;
  transformationRefs: string[];
}
```

`probability` remains null unless calibrated or explicitly supplied. Heuristic weights must not be displayed as empirical likelihoods.

### 8.8 Valuation model definition and result

```ts
interface ValuationModelDefinition<TInput> {
  modelId: string;
  modelVersion: string;
  family: FamilyAnalysis["family"] | "cross-family";
  category: "intrinsic" | "relative" | "market-implied" | "optionality";
  independenceGroup: string;
  requirements: FactRequirement[];
  applicable(input: ModelContext): ApplicabilityResult;
  execute(input: TInput): ValuationModelResult;
}

type ValuationModelResult =
  | {
      status: "computed";
      modelId: string;
      modelVersion: string;
      caseId: string;
      enterpriseValue: number | null;
      equityValue: number | null;
      perShare: number | null;
      unit: "INR_CRORE" | "INR_PER_SHARE";
      evidenceRefs: string[];
      transformationRefs: string[];
      diagnostics: Record<string, number | string | boolean | null>;
      guardResults: GuardResult[];
    }
  | {
      status: "skipped" | "not-applicable" | "insufficient-evidence";
      modelId: string;
      reasonCode: string;
      missingRequirements: FactRequirement[];
    }
  | {
      status: "invalid";
      modelId: string;
      reasonCode: string;
      failedGuards: GuardResult[];
    };
```

Aggregators and reverse-DCF diagnostics implement separate interfaces and never appear as intrinsic models.

### 8.9 Gate result

```ts
type GateStatus =
  | "passed"
  | "warned"
  | "failed"
  | "insufficient-evidence"
  | "not-applicable"
  | "observed-not-enforced";

interface GateResult {
  gateId: string;
  gateVersion: string;
  stage: string;
  status: GateStatus;
  blocksNext: boolean;
  evidenceRefs: string[];
  checks: GateCheck[];
  summary: string;
}
```

Feature flags may change `blocksNext` to false and mark `observed-not-enforced`; they must never rewrite `failed` to `passed`.

### 8.10 Immutable analysis run

```ts
interface AnalysisRun {
  schemaVersion: string;
  runId: string;
  parentRunId: string | null;
  issuerId: string;
  createdAt: string;
  asOf: string;
  status: "running" | "completed" | "blocked" | "failed";
  sourceArtifactIds: string[];
  factSetRef: ContentRef;
  policyBundleRef: ContentRef;
  modelCatalogRef: ContentRef;
  familyAnalysisRef: ContentRef | null;
  analysisWindow: AnalysisWindow | null;
  marketSnapshotRef: ContentRef | null;
  assumptionSetRef: ContentRef | null;
  forecastCaseRefs: ContentRef[];
  modelResultRefs: ContentRef[];
  synthesisRef: ContentRef | null;
  gateResults: GateResult[];
  trustEnvelope: AnalysisTraceabilityEnvelope;
  publicationRef: ContentRef | null;
  reproducibilityHash: `sha256:${string}`;
}
```

Canonical serialization excludes non-deterministic UI state. Given the same content refs and versions, repeated execution must produce the same reproducibility hash.

---

## 9. Execution stages and fail-closed semantics

The executor owns stage order. Stages may emit diagnostics after a blocker, but later stages cannot be blessed.

| Stage | Input | Output | Blocking contract |
|---|---|---|---|
| 0. Request validation | analysis request | validated request | invalid config/unit/scope blocks ingestion |
| 1. Artifact ingestion | files/source payload | source artifacts | unreadable/unsafe artifact blocks parsing |
| 2. Fact extraction | source artifacts | fact set | parser fidelity below threshold blocks canonicalization |
| 3. Concept normalization | fact set | mapped fact set | critical identity ambiguity blocks core recast |
| 4. Family classification | mapped facts + explicit choice | family decision | ambiguous material mixed family blocks automatic routing |
| 5. Recast | family decision + facts | family state | missing family minimum contract blocks reconciliation |
| 6. Structural reconciliation | family state + facts | reconciliation pack | critical residual or insufficient required pack blocks economic gate |
| 7. Economic validation | reconciled state | economic pack | no defensible anchor/window blocks forecast/valuation blessing |
| 8. Window selection | gate evidence | analysis window | no usable window blocks forecast/valuation |
| 9. Assumption resolution | window + policies + sources | assumption set | unavailable critical assumptions skip affected models |
| 10. Forecast | family state + assumptions | forecast cases | identity failure invalidates case |
| 11. Model execution | cases + model catalog | model results | each model guards independently; no fabricated fallback |
| 12. Synthesis | computed model results | valuation distribution/range | insufficient independent groups yields guarded/blocked synthesis |
| 13. Release/trust | all stage evidence | final envelope/publication | only prefix-achieved rigor can be reported |

### 9.1 Ladder invariant

For ordered gates `G[0..n]`:

```ts
achieved(G[i]) => every(G.slice(0, i), achieved)
```

Property tests must generate arbitrary gate combinations and prove the published achieved set is always a prefix.

### 9.2 Reconciliation minimum packs

Each family declares required and optional checks.

Examples:

- Industrial required pack: reported assets vs recast assets, equity/liability side, CSE/MI bridge, cash bridge where statements exist, share-capital bridge when per-share valuation is requested, and operating/income bridge coverage.
- Bank required pack: assets/liabilities/equity, advances/deposits/funding consistency, interest-income/expense basis, capital adequacy evidence where valuation uses growth.
- NBFC required pack: AUM/loan assets, borrowings, equity, NII, provisioning/ECL, and regulatory capital evidence.
- Insurance required pack: policyholder/shareholder funds, reserves, premium/claims, solvency, EV/VNB sidecar identity.
- Telecom required pack: spectrum/licence assets and obligations, network PPE/leases, AGR/regulatory obligations, capex and network opex.
- Utility required pack: gross/net rate base, CWIP, depreciation, regulatory deferrals, allowed-return evidence, and debt.

If a required pack cannot be evaluated, status is `insufficient-evidence`, never `confirmed`.

---

## 10. Forecast Engine 2.0

### 10.1 Do not reuse `RecastPeriod` for projected states

Historical recast data and projected financial states have different semantics. A projected state needs explicit source assumptions, previous-state links, balancing flows, and validation. It must not inherit stale cash flows, trace maps, reported tax expense, or historical flags through object spread.

### 10.2 Industrial projected state

At minimum, each year must explicitly derive:

- revenue;
- operating margin and operating income;
- NOA components or a validated aggregate NOA;
- working capital;
- PPE/ROU/intangibles and depreciation/amortization;
- maintenance and growth capex;
- taxes on operating and financing income;
- FCFF and owner earnings;
- NFO, debt issuance/repayment, cash and financing expense;
- CNI, OCI, dividends, buybacks, issues and CSE roll-forward;
- diluted and end-period share bases;
- minority-interest bridge where applicable.

Required identities include:

```text
OI_t                 = Sales_t × operating_margin_t
NOA_t                = operating assets_t − operating liabilities_t
FCFF_t               = OI_t − ΔNOA_t
CSE_t                = CSE_(t-1) + CNI_t + OCI_owner_t
                       − dividends_t − buybacks_t + share_issues_t
NFO_t                = financing obligations_t − financial assets_t
NOA_t                = CSE_t + MI_t + NFO_t
cash movement_t      = CFO_t + CFI_t + CFF_t
terminal growth      = terminal reinvestment rate × terminal ROIC
```

Scenario leverage is a target constraint that determines financing actions; it must not directly overwrite CSE without a roll-forward.

### 10.3 Forecast validation

Each case validates:

- balance-sheet equality;
- clean-surplus owner basis;
- cash bridge;
- debt and interest consistency;
- tax consistency;
- share-count bridge;
- terminal `discount rate - growth` spread;
- `g = reinvestment × return` consistency;
- finite values and allowed bounds;
- monotonic scenario ordering where policy requires it;
- no use of future observations in historical-vintage cases.

A failed identity makes the forecast case `invalid`, not merely lower confidence.

### 10.4 Scenario weights and uncertainty

Current heuristic weights remain labeled heuristic during migration. The target has two complementary outputs:

1. named deterministic cases for reviewer discussion;
2. a correlated probabilistic distribution for range estimation.

Distribution parameters come from:

- clean-window historical residuals;
- sector priors with dated source/version;
- management guidance, separately labeled;
- analyst overrides with reviewer identity;
- macro regimes where supported;
- forecast holdout calibration.

Correlations must be explicit: growth, margins, working capital, capex, credit cost, funding costs, and terminal economics are not independent random draws.

---

## 11. Cost-of-capital architecture

Replace ambiguous scalar precedence with an explicit policy and result.

```ts
type CostOfEquityPolicy =
  | { mode: "capm"; riskFreeSource: string; betaSource: string; erpSource: string }
  | { mode: "manual"; ke: PercentFraction; rationale: string; evidenceRefs: string[] };

type CostOfDebtPolicy =
  | { mode: "reported-effective" }
  | { mode: "credit-spread"; ratingSource: string; curveSource: string }
  | { mode: "manual"; kdPretax: PercentFraction; evidenceRefs: string[] };
```

`CostOfCapitalResult` includes:

- `ke`, `kdPretax`, `kdAfterTax`, and `kw`;
- source mode and evidence for each component;
- risk-free/ERP/curve dates;
- beta and leverage basis;
- structural weights and period;
- scenario adjustments as derived assumptions;
- warnings, guard results, and version.

Rules:

- base `kw` remains structurally derived and read-only;
- scenario risk changes create child results and never mutate the base result;
- all industrial valuation, forecasting, moat, capital allocation, reverse DCF, dashboard, and exports consume the same result;
- financial institutions use cost of equity and family-appropriate capital constraints rather than industrial WACC;
- credit-spread WACC is not considered shipped until it is selected by this resolver with dated evidence;
- ESG adjustments, if retained, are displayed as an optional sensitivity until their empirical and policy basis is approved.

---

## 12. Valuation model catalog and synthesis

### 12.1 Catalog responsibilities

The catalog answers:

- Is the model applicable to this family and company state?
- Are all required facts and assumptions present?
- Is the selected window adequate?
- Which evidence-independence group does it belong to?
- Which model and policy version ran?
- Did the model compute, skip, lack evidence, or fail a guard?
- Is the output enterprise value, equity value, or per-share value?

### 12.2 Model categories

Do not combine these categories in a model count:

- intrinsic models;
- relative/peer models;
- market-implied expectation diagnostics;
- optionality overlays;
- synthesis/aggregators;
- quality and distress overlays.

### 12.3 Independence groups

Initial groups:

- accrual residual-income family;
- direct cash-statement family;
- dividend/distribution family;
- asset/book-value family;
- operational-driver family;
- segment/SOTP family;
- peer-market family;
- optionality family;
- market-price diagnostic family.

Independence is not granted merely because formulas have different names. A model definition declares its group, and audit tests verify its material inputs differ from other groups.

### 12.4 Synthesis policy

The authoritative synthesis proceeds in this order:

1. validate model result states;
2. collapse algebraically correlated variants within each family;
3. assign reliability from evidence coverage, forecast skill, family applicability, and guard quality;
4. produce family-level value distributions;
5. combine independent intrinsic families;
6. expose relative valuation separately as a challenge/market context;
7. quarantine reverse DCF as expectations only;
8. compute divergence and widen/block rather than average disagreement away;
9. emit a distribution or defensible range with driver attribution.

Do not use raw min/max endpoints when a low-reliability peer value can dictate the range. Use weighted distributions or robust quantiles, while still displaying every model result to reviewers.

### 12.5 Terminal economics

Every terminal model must return `invalid` when its discount spread, reinvestment consistency, or continuing-value guard fails. It may not substitute zero terminal value and remain computed.

Required terminal disclosures:

- share of total value from terminal value;
- terminal growth, return, reinvestment, margin, and turnover;
- fade duration and competitive-pressure assumption;
- discount-rate spread;
- source/evidence for the terminal prior;
- sensitivity and saturation state;
- guard failures.

---

## 13. Sector-native valuation specifications

### 13.1 Delivery order

1. Utility and telecom, because the audit currently stamps native model labels without distinct computed models.
2. Bank and NBFC deepening, because there is substantial existing code but driver/scenario and UI-unit gaps remain.
3. Insurance, because embedded-value support exists but needs a first-class family contract.
4. Conglomerate/segment and cyclical deepening.
5. Retail/unit-economics and loss-maker optionality cases where data is available.

### 13.2 Utility regulated-asset-base case

Required facts/drivers:

- gross and net PPE/rate base;
- CWIP and commissioning schedule;
- regulatory assets/liabilities and deferrals;
- allowed equity return and tariff framework;
- depreciation and operating expenses;
- regulated debt/equity structure;
- demand/availability/capacity drivers;
- receivable/subsidy cycles;
- tax and disallowance policy.

Models:

- RAB × allowed-return DCF;
- dividend/equity cash-flow cross-check;
- replacement/book-value and peer yield/P-B context;
- SOTP for generation/transmission/distribution where segmented.

### 13.3 Telecom network case

Required facts/drivers:

- subscribers, ARPU, churn, data usage, and market share;
- spectrum/licence asset vintages and payment obligations;
- AGR/regulatory obligations;
- tower/network leases and ROU liabilities;
- network capex split between maintenance, capacity, and spectrum;
- EBITDA-to-cash conversion;
- financing/refinancing and dilution;
- enterprise-to-equity bridge.

Models:

- subscriber/ARPU operating-driver DCF;
- lease- and spectrum-adjusted FCFF;
- EV/subscriber and EV/EBITDA relative context;
- distressed/restructuring scenario for negative-equity cases.

### 13.4 Bank case

Drivers:

- loan and deposit growth;
- asset and liability yields;
- NIM and fee income;
- operating expense/cost-to-income;
- slippages, credit cost, recoveries, and provisions;
- RWA density, CET1/CRAR, payout and capital raising;
- book-value roll-forward and dilution.

Models:

- multi-stage equity residual income;
- justified P/B using sustainable driver forecasts;
- dividend model consistent with capital requirements;
- segment/subsidiary SOTP where facts exist;
- peer P/B/ROE context, separately labeled.

### 13.5 NBFC case

Extend the bank case with:

- AUM/loan book segment growth;
- funding mix and spreads;
- ALM and liquidity mismatch;
- Stage 1/2/3 ECL transitions;
- securitization/co-lending/off-book exposure;
- regulatory tier and capital buffer;
- ROA × leverage decomposition.

The CRAR and ECL governors become forecast constraints, not after-the-fact value multipliers.

### 13.6 Insurance case

Required facts/drivers:

- embedded value and adjustments;
- APE/VNB/VNB margin;
- persistency cohorts;
- premium, claims, expenses and combined ratio where relevant;
- solvency and required capital;
- investment spread and product mix;
- RoEV bridge.

Models:

- EV roll-forward plus new-business value;
- appraisal value with sourced multiples only as a cross-check;
- shareholder cash-flow/solvency model;
- peer EV/VNB context.

Generic bank P/B, RI, and DDM outputs may be displayed as clearly labeled sanity brackets but never substitute for missing EV/VNB evidence.

### 13.7 Conglomerate and segment case

- Each segment receives its own family/template, driver set, cost of capital, and model result.
- Corporate costs, associates, minority interest, intercompany eliminations, holding debt, tax leakage, and hold-company discount are explicit bridge rows.
- A segment without adequate evidence is `insufficient-evidence`; its value is not silently inferred from another segment.

### 13.8 Cyclical case

- Normalize prices, volumes, utilization, margins, capex, and working capital across a cycle.
- Separate maintenance and expansion capital.
- Use mid-cycle operating state and replacement/economic asset context.
- Terminal values do not extrapolate peak margins or spot commodity prices.
- Scenario probabilities are linked to observable regime definitions and backtests.

### 13.9 Retail and unit-economics case

Where operational facts exist, forecast:

- store count/openings/closures;
- mature vs new-store revenue;
- same-store growth;
- revenue per store/area;
- capex and lease burden per store;
- working-capital intensity;
- cohort margin maturation.

Fallback aggregate industrial valuation remains available but is labeled lower-depth when operational sidecars are missing.

---

## 14. Greenfield pipeline disposition

The current `greenfieldPipeline` is not deleted immediately, but it is not promoted as a second analytical spine.

### Retain

- detector taxonomy and focused tests;
- explicit signal suppression concepts;
- analysis-window concepts;
- adjustment audit-entry shape as an input to the new transformation design;
- as-reported vs adjusted comparison UI ideas;
- freshness/frequency diagnostics.

### Change before any authoritative use

- default mode to `as-reported-only`;
- rename `p_artifact` to `heuristicArtifactScore` until calibrated;
- remove confidence bonuses for suggested/no-op adjustments;
- correct lease field semantics;
- prohibit residual-zeroing;
- express every adjustment as a balanced transformation with input fact IDs, counterpart effects, units, and validation;
- create immutable as-reported and adjusted views rather than mutating cloned periods;
- use the shared gate engine and shared evidence model;
- support family-specific detectors or explicitly mark family applicability.

### Delete after migration

- duplicate confidence scale once trust gates own confidence;
- duplicate unit aliases;
- post-recast normalization that reinterprets already-normalized fields;
- any adapter that turns uncalibrated detector output directly into a terminal blocker without family policy.

---

## 15. Application and UI architecture

### 15.1 Analysis-run store

Introduce a typed application store keyed by `runId`. This can be implemented with React context plus an external store/reducer initially; a new state-management dependency is not required to establish the contract.

```ts
interface AnalysisApplicationState {
  activeRunId: string | null;
  runs: Record<string, AnalysisRunSummary>;
  runLoadState: Record<string, "idle" | "loading" | "ready" | "error">;
  scenarioDrafts: Record<string, ScenarioDraft>;
}
```

Heavy run payloads remain in the repository/cache and are accessed through selectors.

### 15.2 Compute once

- `executeAnalysis(request)` runs in a Web Worker in the browser.
- CLI and server use the same executor directly.
- React components never call `processCompanyDataFull`, `buildValuationCommandCenter`, `computeValuation`, or equivalent model functions.
- A component may run presentation-only formatting and local chart transforms.

### 15.3 Market refresh semantics

- One market-data coordinator resolves provider and canonical symbol.
- The snapshot includes price, shares, rate, timestamps, provider, warnings, and source IDs.
- Refreshing market data creates a new market snapshot and a child valuation run or a clearly versioned derived view.
- Signed/published runs remain immutable.

### 15.4 Scenario editing

- User edits create a scenario draft.
- Running a draft produces a child `AnalysisRun` referencing the parent historical/fact state and a new assumption set.
- UI displays the exact assumption diff and changed valuation drivers.
- Overrides require rationale and are included in the reproducibility hash.

### 15.5 Tab contracts

Tabs receive `runId` plus narrow UI actions. Example:

```tsx
<ValuationTab runId={activeRunId} />
```

Selectors provide `selectValuationSummary`, `selectTrustEnvelope`, `selectForecastCase`, and similar typed views. This removes the broad `TabRouter` prop bundle and prevents cross-tab drift.

### 15.6 Publication and export

- Publication snapshot is finalized from the completed run.
- Workbook, PDF, academic report, comparison registry, and audit inspector consume that snapshot or the same run refs.
- Analytical depth and anti-tautology are persisted run outputs, not UI-time enrichments.
- Exports include run hash, model versions, policy versions, market as-of, assumption set, gate ledger, and evidence refs.

---

## 16. Platform, security, and persistence architecture

### 16.1 Server-side boundary

The browser communicates only with authenticated application APIs. It never communicates directly with KV/blob metadata stores using reusable credentials.

### 16.2 Principal and tenancy

Every persisted object is scoped by:

```text
organization_id / workspace_id / user_id / resource_id
```

Authorization derives from a server-validated session. Anonymous local mode may use an explicit local principal, but it is not presented as multi-tenant authentication.

### 16.3 Storage split

Use two storage classes:

1. **Transactional metadata store** for users, workspaces, issuers, run metadata, revisions, locks, annotations, indexes, and retention state.
2. **Content-addressed object store** for source artifacts, fact sets, family outputs, forecast payloads, model results, publications, and large audit artifacts.

The exact relational vendor should be selected by ADR. The contract requires atomic transactions and revision checks; it does not require a particular provider.

### 16.4 Repository interfaces

```ts
interface AnalysisRunRepository {
  create(run: AnalysisRunDraft, idempotencyKey: string): Promise<AnalysisRun>;
  get(scope: WorkspaceScope, runId: string): Promise<AnalysisRun | null>;
  list(scope: WorkspaceScope, query: RunQuery): Promise<CursorPage<AnalysisRunSummary>>;
  finalize(scope: WorkspaceScope, runId: string, expectedRevision: number): Promise<AnalysisRun>;
}

interface ArtifactRepository {
  put(scope: WorkspaceScope, bytes: Uint8Array, metadata: ArtifactMetadata): Promise<ContentRef>;
  get(scope: WorkspaceScope, ref: ContentRef): Promise<ArtifactPayload | null>;
}
```

Local filesystem and deployed implementations share the application services and differ only at repository adapters.

### 16.5 API design

Proposed versioned endpoints:

```text
POST   /api/v1/workspaces/:workspaceId/artifacts
POST   /api/v1/workspaces/:workspaceId/analysis-runs
GET    /api/v1/workspaces/:workspaceId/analysis-runs/:runId
GET    /api/v1/workspaces/:workspaceId/analysis-runs?cursor=...
POST   /api/v1/workspaces/:workspaceId/analysis-runs/:runId/scenarios
POST   /api/v1/workspaces/:workspaceId/analysis-runs/:runId/publish
POST   /api/v1/workspaces/:workspaceId/analysis-runs/:runId/lock
GET    /api/v1/market-snapshots/:symbol
```

Requirements:

- runtime schema validation at every boundary;
- idempotency keys for writes;
- atomic revision/ETag checks;
- cursor pagination;
- explicit size limits and content types;
- retention and deletion policy;
- structured error codes;
- correlation/run IDs;
- no secrets in query strings;
- no global comparison snapshot.

### 16.6 Market-data service

- Server resolves canonical instrument IDs.
- Provider adapters implement timeouts, retries, cache policy, quota telemetry, and provider-specific parsing.
- Cache snapshots by provider/instrument/as-of.
- A missing or stale source is explicit; no default `7%` rate is labeled live.
- Manual fallback is a sourced manual assumption, not a provider snapshot.
- Browser access uses the user session and a narrow rate-limited endpoint.

### 16.7 Audit protocol

- Run creation establishes authorization through the user session, not a client-generated access token alone.
- Events are append-only, idempotent, and linked to a run revision.
- Sensitive payloads are stored as content refs, not repeated in event logs.
- Hash chain/signature can be added for signed publications.
- Retention jobs operate on indexed metadata rather than listing entire blob prefixes.

### 16.8 Security hardening

- Remove `VITE_KV_*TOKEN` handling.
- Prohibit admin tokens in browser storage or prompts.
- Enforce CSP after report-only telemetry is clean.
- Add CSRF/session protections appropriate to the chosen auth model.
- Persist rate limits for deployed APIs where abuse matters; in-memory serverless maps are insufficient.
- Sanitize telemetry and never log raw financial artifacts, tokens, emails, or full payloads.
- Add dependency, secret-scanning, and artifact-content validation gates.

---

## 17. Testing and verification architecture

### 17.1 Test tiers

| Tier | Purpose | Target runtime |
|---|---|---:|
| Fast contract | units, gates, formulas, parsers, model guards | <= 3 min |
| Standard PR | all non-corpus unit/component/integration tests | <= 10 min |
| Corpus shards | 33-company pipeline/valuation audits | <= 20 min parallel |
| Release | standard + golden + corpus + build + bundle + numeric E2E | <= 30 min |
| Scheduled research | long backtests, mutation tests, calibration sweeps | asynchronous/nightly |

Targets must be measured in CI before enforcement and adjusted by evidence.

### 17.2 Property and metamorphic tests

Required properties:

- achieved rigor levels form a prefix;
- a failed required check cannot produce a passed higher gate;
- no applicable-check set cannot become confirmed;
- price × crore shares equals INR crore market cap;
- per-share value × diluted crore shares equals equity value in INR crore;
- unit round trips are stable;
- forecast balance sheet balances within configured tolerance;
- cash and clean-surplus bridges close;
- increasing `ke` cannot increase a plain discounted-cash value with other inputs fixed;
- increasing distributable cash cannot reduce value with other inputs fixed;
- invalid terminal spread never produces a computed model result;
- reverse DCF never enters intrinsic synthesis;
- two models in one independence group cannot increase independent-lens count;
- scenario order violations are explicit failures/warnings, not silently sorted away;
- repeated execution with identical content refs yields identical run hash.

### 17.3 Golden-company contracts

Golden cases should assert behaviors, not brittle single-point outputs alone:

- ITC: clean-surplus and industrial multi-lens case;
- DMART: lease and retail/unit-economics behavior;
- HDFC Bank/SBIN: bank capital and market-cap unit behavior;
- Bajaj Finance/Muthoot/Shriram/Chola: NBFC funding, ECL and capital constraints;
- HDFC Life/LIC: EV/VNB and insurance fail-closed behavior;
- Bharti/Idea: telecom native-driver applicability;
- NTPC/Power Grid: utility RAB applicability;
- Reliance/Grasim/L&T: segment/SOTP bridges;
- Tata Steel/UltraTech: cyclical normalization;
- Paytm: loss-maker/optionality and negative-FCF skips;
- Dabur/Titan/SBIN/Tata Steel: reconciliation blocker regression cases.

Expectations include ranges, invariants, model applicability, result states, evidence coverage, and gate levels.

### 17.4 Historical-vintage backtesting

- Store source and market snapshots by as-of date.
- Re-run forecasts using only information available at the historical date.
- Measure driver error, statement error, value-range coverage, signal calibration, and rank performance.
- Compare against naive baselines such as last observation, trailing median, and sector prior.
- Do not award “forecast skill” merely because the forecast matches a median derived from the same held-out value.
- Publish sample size and confidence intervals.

### 17.5 Differential migration tests

For each migration stage:

- execute legacy and new path on the same fixture;
- classify deltas as expected correction, neutral refactor, or regression;
- require reviewer approval for intended valuation changes;
- retain a machine-readable delta artifact.

### 17.6 UI numeric E2E

Add assertions that:

- bank market cap equals price × crore shares;
- Dashboard, Valuation, report, and export display the same run hash and base value;
- market refresh creates a new snapshot/version;
- an invalid model is labeled invalid and excluded;
- a blocked gate prevents production-ready presentation everywhere;
- signed/locked runs cannot be silently changed by assumption edits.

### 17.7 Mutation and coverage

Use mutation tests for:

- continuing-value denominators;
- enterprise/equity bridges;
- share-unit conversions;
- gate comparisons and thresholds;
- reconciliation status selection;
- scenario ordering;
- capital-cost precedence;
- model inclusion/exclusion.

Risk-critical domain modules should target high branch coverage, but behavior and mutation survival are more important than a blanket percentage.

---

## 18. Observability and model operations

### 18.1 Telemetry events

Emit structured, sanitized events for:

- stage start/completion/failure and duration;
- parser and fact counts by source/statement;
- gate transition with status and evidence count;
- selected family and analysis window;
- assumption source-mode counts;
- forecast validation residuals;
- model applicability and result status;
- synthesis independent-group count and divergence;
- market provider/freshness without secrets;
- run finalization/publication/lock;
- schema migration and reproducibility mismatch.

### 18.2 Model catalog operations

Maintain a generated catalog report with:

- model/version/status;
- production call sites;
- supported families;
- required fact coverage across the 33-company corpus;
- golden cases;
- last calibration date;
- backtest metrics;
- owner/reviewer;
- deprecation state.

A module existing on disk is not evidence that a model is production-ready.

### 18.3 Scorecard redesign

The maturity scorecard must derive from typed results:

- model counts from `status: computed` only;
- independent groups from computed intrinsic results only;
- aggregators and reverse DCF excluded from model counts;
- sector-native credit only when a native model emits a finite guarded value;
- lineage credit only for real fact/transform refs;
- market freshness evaluated against a pinned source timestamp;
- reviewer-pack parity compared to the exact completed run;
- checked-in Markdown generated and freshness-checked in CI.

---

## 19. Migration strategy

### 19.1 Strangler sequence

```text
Legacy engine remains live
        |
        +--> introduce new contracts and adapters
        |
        +--> execute shadow AnalysisRun on golden/corpus fixtures
        |
        +--> compare and approve deltas
        |
        +--> adapt existing UI to AnalysisRun selectors
        |
        +--> move one family/model group at a time
        |
        '--> delete legacy orchestration and duplicate UI computation
```

### 19.2 Compatibility adapter

Initially, an adapter may package current `RawPeriodData`, `RecastPeriod`, bank results, command-center output, and traceability into `AnalysisRunV1`. Such a run is labeled `legacy-derived` and cannot claim fact-level lineage until the fact layer lands.

### 19.3 Schema policy

- Do not bump traceability schema for internal scaffolding that is not persisted.
- The first persisted `AnalysisRun` requires a separate run schema, not endless expansion of the traceability envelope.
- Envelope remains the bounded trust summary inside the run.
- Every schema bump ships migrator, sanitizer, fixture, downgrade/rollback note, and documentation pin in one PR.
- Content-addressed immutable payloads generally do not migrate in place; metadata can reference a newly derived version.

### 19.4 Feature rollout

- shadow-only;
- internal comparison;
- opt-in per company/family;
- default-on with legacy fallback;
- legacy read-only;
- legacy deletion after corpus and publication parity.

No rollout flag may convert a failed check into passed. Flags select enforcement or implementation path and remain visible in the run.

---

## 20. Delivery plan and PR packages

### Wave 0 — Integrity reset

#### PR 0.1 — Unit and model-result correctness

- fix FI market-cap conversion;
- add unit-safe helpers at UI/API boundaries;
- make cash-DCF invalid terminal spread return `invalid`/null during transitional API;
- audit financial-institution per-share/market-cap bridges;
- correct misleading hard-coded model reason strings.

Acceptance:

- industrial and FI market-cap unit property tests;
- no invalid terminal model contributes to triangulation;
- focused model tests green.

#### PR 0.2 — Monotonic trust ladder

- introduce `insufficient-evidence` reconciliation state;
- remove failed-to-degraded promotion;
- require syntactic → structural → economic → valuation → production prefix;
- retain feature-flag enforcement state separately;
- merge recast and anomaly flags.

Acceptance:

- property tests for arbitrary gate combinations;
- failed reconciliation never reaches structural;
- blocked economic gate never reaches valuation;
- no-check pack is not confirmed.

#### PR 0.3 — Scorecard truth

- remove synthetic model labels from strategy IDs;
- exclude reverse DCF and aggregators from intrinsic model counts;
- count only finite computed results;
- distinguish independent groups, categories, and expected skips;
- regenerate baseline.

Acceptance:

- each model ledger entry references a result object;
- no `sector-native` group with null result;
- score may decrease; correctness is the objective.

#### PR 0.4 — Greenfield safe mode

- default as-reported-only;
- fix double lease subtraction;
- disable dirty-surplus zeroing;
- remove unvalidated confidence bonuses;
- add explicit experimental status in Debug UI.

#### PR 0.5 — Browser/server auth stopgap

- remove browser KV-token path from production configuration;
- repair market endpoint/browser authorization contract;
- repair audit event write contract;
- document local vs deployed behavior and fail closed on unconfigured auth.

### Wave 1 — AnalysisRun foundation

#### PR 1.1 — Pure contracts and canonical hashing

- `AnalysisRunV1`, `ContentRef`, gate result, model result, market snapshot and assumption interfaces;
- canonical serializer and SHA-256 hash;
- deterministic hash specs.

#### PR 1.2 — Legacy-backed run executor

- orchestrate the current pipeline once;
- build command center once;
- finalize analytical depth/anti-tautology before persistence;
- pin one market snapshot;
- produce a legacy-derived completed run.

#### PR 1.3 — Worker and CLI adapters

- browser Web Worker execution;
- CLI/audit uses same executor;
- stage progress events and cancellation.

#### PR 1.4 — UI run store and selectors

- replace broad derivation chain with `runId` selectors;
- migrate Dashboard and Valuation first;
- assert same run/model values;
- then migrate forecast, report, comparison, inspector and exports.

### Wave 2 — Fact and lineage foundation

#### PR 2.1 — Artifact/fact schema

- source artifact contract;
- canonical fact contract;
- unit/scope/dimension/filing identity;
- validation and canonical serialization.

#### PR 2.2 — Capitaline fact adapter

- preserve file/sheet/row/column/range;
- emit facts alongside current raw periods;
- compare mapping parity.

#### PR 2.3 — Screener/XBRL/JSON/manual adapters

- source-native origin fields;
- explicit unsupported provenance states;
- no fabricated artifact locator.

#### PR 2.4 — Transformation DAG and lineage publication

- instrument recast/material outputs;
- replace post-hoc source claims;
- store content-addressed lineage payload;
- envelope carries bounded cryptographic ref.

### Wave 3 — Window, assumptions, forecast, and cost of capital

#### PR 3.1 — Unified `AnalysisWindow`

- merge economic-sanity and valuation-anchor policies;
- user-confirmed exclusions produce child run;
- all models consume window ID.

#### PR 3.2 — Sourced assumption set

- resolver interfaces;
- evidence refs and period windows;
- explicit manual modes;
- overrides and diffs.

#### PR 3.3 — Unified cost-of-capital result

- CAPM/manual modes;
- debt-cost modes;
- structural weights;
- dated evidence;
- migrate all consumers.

#### PR 3.4 — Industrial ForecastState

- balanced projected statements;
- no recast cloning;
- full validation;
- transitional adapter into existing valuation formulas only where semantically safe.

#### PR 3.5 — Forecast calibration

- rolling-origin holdouts;
- naive baseline comparison;
- calibration status and range widening;
- heuristic vs calibrated probability labels.

### Wave 4 — Model catalog and synthesis

#### PR 4.1 — Model catalog

- register current industrial models;
- applicability and result-state contracts;
- generated catalog report;
- experimental/deprecated statuses.

#### PR 4.2 — Independence-aware synthesis

- family collapse;
- robust weighted distributions;
- reverse-DCF quarantine;
- divergence handling;
- authoritative range and driver attribution.

#### PR 4.3 — Advanced-module disposition

- wire credit-spread WACC where evidence exists;
- wire lease checks as model/gate inputs;
- classify real options, ESG and FX modules as production, experimental, or deprecated;
- remove false maturity credit.

### Wave 5 — Sector-native cases

- PR 5.1: utility RAB case;
- PR 5.2: telecom network case;
- PR 5.3: bank driver forecast and capital constraints;
- PR 5.4: NBFC funding/ECL/CRAR case;
- PR 5.5: insurance EV/VNB/RoEV case;
- PR 5.6: segment/conglomerate bridge;
- PR 5.7: cyclical and retail operational cases.

Each PR requires a real-company data contract, at least one golden case, expected skips, and a finite computed result before the audit grants native-model credit.

### Wave 6 — Platform and model operations

- PR 6.1: authenticated principal/workspace schema;
- PR 6.2: transactional run metadata repository;
- PR 6.3: content-addressed artifact repository;
- PR 6.4: versioned APIs and shared local/deployed services;
- PR 6.5: event/audit/lock protocol;
- PR 6.6: enforced CSP, persistent rate limits, retention and restore;
- PR 6.7: CI test tiers, timing reports, mutation and numeric E2E;
- PR 6.8: generated model catalog and scorecard freshness gate.

---

## 21. Acceptance metrics

### Integrity

- zero paths that promote a failed lower gate to a higher achieved rigor level;
- zero `confirmed` reconciliation packs without their family minimum checks;
- zero duplicate `/1e7` share/market-cap conversions;
- zero invalid model results included in value ranges;
- zero synthetic sector-native model labels;
- zero price-derived assumptions eligible for intrinsic confidence.

### Run coherence

- Dashboard, Valuation, Forecast, report, comparison, workbook, and audit expose one run hash;
- one market snapshot ID per completed run;
- one analysis-window ID per intrinsic model result unless a documented narrower window is declared;
- repeated deterministic execution yields identical hash.

### Lineage

- 100% of material published numbers have actual fact and transformation refs;
- no high-confidence lineage based solely on static formula recipes;
- artifact and run identities use SHA-256 canonical hashes;
- restated and consolidated/standalone facts remain distinguishable.

### Forecast and valuation

- every computed forecast case passes required statement identities;
- terminal `g`, reinvestment, and return are mutually consistent;
- model applicability and expected skips are explicit across all 33 companies;
- independent-lens counts derive only from finite computed intrinsic results;
- calibrated forecasts report sample size, benchmark and no-look-ahead status;
- valuation ranges expose model-family and driver attribution.

### Security/platform

- zero reusable persistence/admin/provider tokens in browser bundles;
- all deployed resource reads/writes authorized by server principal and workspace scope;
- atomic revision checks for mutable metadata;
- cursor pagination and retention on collections;
- local and deployed modes pass the same service contract suite;
- restore drill succeeds from metadata and content-addressed artifacts.

### Delivery quality

- standard PR suite meets measured runtime budget;
- corpus audit runs in bounded shards with progress output;
- numeric E2E covers industrial and FI critical paths;
- risk-critical gate/formula mutations are killed;
- generated model catalog and maturity scorecard are current in CI.

---

## 22. Proposed ADR sequence

This composite design was split into decision-sized ADRs under `docs/architecture/decisions/` on 2026-07-11. ADR-009 through ADR-014 and ADR-016 are accepted; ADR-015 remains proposed pending production provider selection and deployed conformance/restore evidence.

1. **ADR-009 — Immutable AnalysisRun and content identity**
2. **ADR-010 — Canonical fact schema and execution-time lineage**
3. **ADR-011 — Monotonic gate semantics and insufficient evidence**
4. **ADR-012 — ForecastState separate from RecastPeriod**
5. **ADR-013 — Valuation model catalog and independence-aware synthesis**
6. **ADR-014 — Explicit cost-of-capital modes and provenance**
7. **ADR-015 — Server-side principal, tenancy, and storage split**
8. **ADR-016 — Sector-native case contracts and maturity-credit rule**

Each ADR must list superseded behavior, migration impact, schema impact, rollback, golden tests, and telemetry.

---

## 23. Alternatives considered

### Add more valuation models first

Rejected. Existing breadth is already high, while current orchestration can double-count correlated models, count non-models, and compute inconsistent outputs across surfaces.

### Big-bang rewrite

Rejected. The existing engine has substantial tested accounting knowledge and a real-company corpus. Replacing it wholesale would discard evidence and make valuation deltas difficult to review.

### Promote the current greenfield sidecar into the primary pipeline

Rejected in its current form. It is industrial-only, post-recast, contains unsafe adjustments, uses duplicate confidence semantics, and does not authoritatively feed valuation.

### Revive a generic class-based pipeline strategy

Rejected. ADR-006 correctly identified premature abstraction. Use explicit family unions and a readable exhaustive switch. Apply catalog/registry mechanics only where many model implementations genuinely share governance contracts.

### Keep UI-local enrichment for performance

Rejected. It creates run drift and weakens persisted audit evidence. Performance is addressed with one worker execution and selectors/caching.

### Continue using `RecastPeriod` for forecasts

Rejected. Historical and projected states have different invariants, provenance, and validation needs. Object-spread reuse already carries stale cash-flow fields.

### Continue browser-direct KV

Rejected. It exposes credentials and treats spoofable local identity as authorization. Server-side tenancy and repositories are required.

### Keep Blob as both metadata database and artifact store

Rejected for mutable indexed metadata. Blob remains appropriate for immutable content-addressed payloads; transactions and queries require a metadata store.

---

## 24. Key risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Valuation deltas reduce apparent maturity score | Stakeholder concern | Treat score decreases caused by honest classification as correctness wins; publish before/after ledger. |
| Fact schema migration is large | Schedule and regression risk | Emit facts alongside current raw periods, use parity tests, migrate one adapter at a time. |
| Sector data is unavailable | Model cannot compute | Expected skip with exact missing requirements; never generic substitution. |
| AnalysisRun payload becomes too large | Browser/storage performance | Content refs, chunked immutable payloads, bounded envelope, lazy selectors. |
| Worker/server numerical drift | Reproducibility risk | Same core package, canonical fixtures, deterministic hash and runtime parity tests. |
| Probabilistic model creates false precision | Reviewer trust risk | Label heuristic vs calibrated, publish sample sizes, retain deterministic scenarios. |
| Cost-of-capital changes affect many outputs | Broad regression risk | Central resolver, golden deltas, explicit manual compatibility mode. |
| Platform work delays domain work | Delivery risk | Run Wave 0 and AnalysisRun contracts in parallel with platform foundation; do not block local analytical progress on full auth rollout. |
| Historical plan/document drift recurs | Governance risk | Generate catalogs/scorecards from code and enforce freshness pins in CI. |

---

## 25. Definition of done

The greenfield program is complete when a skeptical valuation reviewer and principal engineer can select any supported company and prove:

1. which exact artifact and fact supplied every material number;
2. which family path, policy versions, clean window, market snapshot, and assumptions were used;
3. that every required structural and economic gate passed in order;
4. that forecasts reconcile as projected financial statements rather than synthetic historical clones;
5. which models were applicable, computed, skipped, insufficient, or invalid;
6. which models are genuinely independent and how their evidence affected synthesis;
7. that market-implied expectations did not leak into intrinsic confidence;
8. that every surface and export references the same immutable run hash;
9. that the run can be reproduced from content refs and versions;
10. that access, persistence, retention, and audit history are workspace-scoped and server-authorized;
11. that the corpus, numeric E2E, property, mutation, build, and release gates pass within bounded runtime;
12. that unsupported cases fail closed with an actionable missing-data contract rather than a green badge or fabricated fallback.

Until those conditions hold, the product may be reviewer-useful and analytically broad, but it must not describe itself as fully production-ready.

---

## 26. Immediate next action

Begin Wave 0 with two test-first branches of work:

1. **Trust integrity:** monotonic ladder, reconciliation result states, mapping-flag preservation, and scorecard truth.
2. **Valuation integrity:** FI market-cap units, invalid terminal economics, correlated-model voting, and greenfield safe mode.

Do not start a new sector or formula until both branches land and the 33-company scorecard is regenerated from corrected semantics.
