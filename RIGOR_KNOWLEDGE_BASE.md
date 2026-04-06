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

### Traceability Envelope (Schema `v8`)
- The `AnalysisTraceabilityEnvelope` is the shared confidence signal.
- It contains: `confidence` (status, tone, headline), `rigor` (current level, achieved levels), and `mappingCoverage`.

## 4. Current Gaps & Improvement Roadmap

### Identified Fragilities
- **Label Dependency**: The system is currently fragile because it relies on string labels.
- **Audit Gaps**: Some runs fail so early that no traceability envelope is generated, creating "black holes" in the audit log.

### Planned Improvements
1. **Metric IDs**: Transition from label-based mapping to **Metric ID-based mapping** (using Capitaline's numeric IDs).
2. **Pre-Flight Envelopes**: Generate a minimal `v8` envelope even for failed ingestions to ensure 100% audit coverage.
3. **Automated Spec Evolution**: Use audit logs of "unmatched labels" to automatically suggest updates to the `MappingSpec.yaml`.
4. **UI Expansion**: Surface the Rigor Ladder in the `DebugPanel` and `CompanyWorkspace` to provide a "Rigor Roadmap" to the user.

## 5. Operational Guide for AI Agents
- **To debug a "Guarded" run**: Check `traceability.rigor.checkpoints` to find the first `achieved: false` gate.
- **To fix a mapping error**: Add the missing label to `CapitalineIndASDetailedMappingSpec.yaml` under the correct canonical key.
- **To verify a change**: Run `npm run validate` (typecheck, test, build).
