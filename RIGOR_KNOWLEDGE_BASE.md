# Rigor Knowledge Base: Penman V2 Analysis

This document serves as the authoritative technical reference for the data lineage and rigor framework of the Penman V2 Analysis system. It is designed to ensure continuity across AI sessions and developer handoffs.

## 1. High-Level Objective
The goal is to make valuation runs **defensible under review**. This is achieved by ensuring every output is traceable back to raw source data and passing through a series of sequential "Rigor Gates" before being considered "Production-Ready."

## 2. The Data Lineage (The "Golden Path")

The system follows a strict linear pipeline:
`Raw Capitaline Data` $\rightarrow$ `Mapping Spec` $\rightarrow$ `Recast Engine` $\rightarrow$ `Rigor Gates` $\rightarrow$ `Analysis Outputs`

### A. Raw Input Layer
- **Source**: Financial data provided by Capitaline.
- **Structure**: Key-Value pairs where keys are labels (e.g., `"Total Assets"`) and values are numeric.
- **Fragility**: Labels can change across companies or time periods, leading to "Out-of-spec" errors.

### B. Mapping Layer (`CapitalineIndASDetailedMappingSpec.yaml`)
- **Purpose**: Acts as the "dictionary" that translates inconsistent raw labels into canonical Penman metrics.
- **Mechanism**:
    - **Exact Match**: Matches the label exactly.
    - **Fuzzy Match**: Normalizes text (lowercase, removes special characters) to find a match.
    - **Composite Summation**: For fields like `FA.cash_bank`, the system sums multiple mapped labels while ensuring no raw source is double-counted.
- **Priority**: Prefers matches from the requested statement (BalanceSheet > ProfitLoss > CashFlow).

### C. Recast Layer (`src/engine/PenmanNissimEngine.ts`)
- **Purpose**: Transforms mapped metrics into standardized financial statements (Recast Balance Sheet, Recast Income Statement).
- **Key Logic**: Uses `pickOneWithSource` and `sumWithDistinctSource` to build the canonical view.
- **Traceability**: Every single value in the Recast layer is tagged with its source label and match type (Exact, Fuzzy, or Derived), enabling a full "Provenance Audit."

### D. Rigor Layer (`src/engine/analysisTraceability.ts`)
A run must clear 5 sequential gates. Failure at any gate "fails-closed," blocking all subsequent levels.

1. **`syntactically-valid`**:
    - Checks if raw data is present and parser fidelity is above the minimum threshold.
2. **`structurally-reconciled`**:
    - The most critical gate. Validates structural residuals.
    - Checks: Balance Sheet identity, Cash-Distribution bridge, Share-Capital tie-out, Debt-Flow bridge, and Income Statement bridges.
3. **`economically-plausible`**:
    - Checks for economic sanity and valuation-critical blockers.
4. **`valuation-eligible`**:
    - Confirms the run is ready for model application (not "guarded" by fallbacks).
5. **`production-ready`**:
    - Final release checks passed.

## 3. Critical Constraints & Rules

### S-9.4C: Capital Cost Consistency
- **Rule**: Capital costs ($k_e, k_w$) must be derived once and used consistently across all modules.
- **Enforcement**: $k_w$ must be derived structurally and treated as read-only in the UI to prevent manual overrides that would break the model's internal logic.

### Traceability Envelope (Schema Version)
- The `AnalysisTraceabilityEnvelope` is the shared confidence signal.
- The current schema version is exported from [`src/engine/policyVersions.ts`](src/engine/policyVersions.ts) as `TRACEABILITY_SCHEMA_VERSION` (currently `2026-06-traceability-v22`). Treat that constant as the single source of truth; do not pin a literal version in prose. Persisted envelopes from older versions are walked forward by [`src/lib/envelopeMigrations.ts`](src/lib/envelopeMigrations.ts).
- It contains: `confidence` (status, tone, headline), `rigor` (current level, achieved levels), `parserFidelity`, `reconciliation`, `mappingCoverage`, and valuation-time enrichments such as `analyticalDepth` / `antiTautology` when those surfaces have run.

## 4. Current Gaps & Improvement Roadmap

### Identified Fragilities
- **Label Dependency**: The system is currently fragile because it relies on string labels.
- **Audit Gaps**: Some runs fail so early that no traceability envelope is generated, creating "black holes" in the audit log.

### What Shipped

The roadmap that lived here previously listed work that has since landed. Each row links to the ADR (or plan PR) that documents the rationale and verification.

| Concept | Status | Reference |
|---------|--------|-----------|
| Concept Identity (Metric IDs) | Shipped | [ADR-001](docs/adr/001-concept-identity-layer.md) |
| Economic Sanity Gates | Shipped | [ADR-002](docs/adr/002-economic-sanity-gates.md) |
| Unusual Item Taxonomy | Shipped | [ADR-003](docs/adr/003-unusual-item-taxonomy.md) |
| Lineage Sidecar (Per-Number Traceability) | Shipped | [ADR-004](docs/adr/004-lineage-sidecar.md) |
| Branded Primitives | Shipped (PR-1.4 partial; PR-1.4a/b/c follow-on) | [ADR-005](docs/adr/005-branded-primitives.md) |
| Pipeline Strategy Pattern (metadata-only canary) | Shipped | [ADR-006](docs/adr/006-pipeline-strategy-pattern.md) |
| Pre-Flight Envelopes / Migration Runner | Shipped (Plan 6 PR-6.4) | [`src/lib/envelopeMigrations.ts`](src/lib/envelopeMigrations.ts) |

### Open Roadmap
Items that genuinely have not shipped yet:

1. **Phases 2-4 of the 6.9 → 10 plan**: residual de-tautologization, S-9.4C kw consistency, audit-shard regression contracts, full god-module decomposition (`PenmanNissimEngine`, `valuationCommandCenter`, `bankValuation`, `capitalineParser`), and ADR-006 strategy spine resolution (load-bearing or delete).
2. **VCC decomposition**: pure solver/DCF cluster extraction is in progress; remaining sub-modules (forecasting glue, sector overlays, narrative renderer) still pending.
3. **Retroactive ADRs for v15 (SOTP), v16 (FX neutrality), and v17 (evidence locking)**: schema bumps shipped without ADRs; backfill is queued for Phase 3.8.
4. **Automated Spec Evolution**: use audit logs of "unmatched labels" to suggest updates to `MappingSpec.yaml`.
5. **UI Expansion**: surface the Rigor Ladder in `DebugPanel` and `CompanyWorkspace` to provide a "Rigor Roadmap" to the user.

## 5. Operational Guide for AI Agents
- **To debug a "Guarded" run**: Check `traceability.rigor.checkpoints` to find the first `achieved: false` gate.
- **To fix a mapping error**: Add the missing label to `CapitalineIndASDetailedMappingSpec.yaml` under the correct canonical key.
- **To verify a change**: Run `npm run validate` (typecheck, test, build).
