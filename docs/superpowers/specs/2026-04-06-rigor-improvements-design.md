# Design: Rigor Improvements - Trust Envelope Expansion & Registry Scoping
Date: 2026-04-06
Status: Approved (Autonomous)

## 1. Objective
Enhance the "defensibility" of the valuation process by surfacing the Shared Trust Envelope in critical diagnostic surfaces and introducing workspace isolation for the Comparison Registry.

## 2. Scope of Changes

### 2.1 Traceability Envelope Expansion
Currently, the `AnalysisTraceabilityEnvelope` is passed to reports but missing from the orchestration and diagnostic shells.

**Target Surfaces:**
- **`DebugPanel.tsx`**: 
  - **Goal**: Move from "error listing" to "rigor roadmap".
  - **Implementation**: Add a `RigorLadder` component that consumes `traceability.rigor`. It will render the 5 sequential gates (`syntactically-valid` $\rightarrow$ `production-ready`), highlighting the current level and providing the `detail` text for the first uncleared gate.
- **`CompanyWorkspace.tsx`**:
  - **Goal**: Provide immediate confidence context for the active company.
  - **Implementation**: Add a `ConfidenceBadge` in the header that consumes `traceability.confidence` (status, headline, and tone).

### 2.2 Comparison Registry Scoping
Currently, the registry is a single shared snapshot per research API.

**Proposed Change: Workspace Partitioning**
- **Mechanism**: Introduce a `workspaceId` (string) to the registry state.
- **Persistence Layer**:
  - `src/lib/companyRegistryStore.ts`: Update local storage keys to include the `workspaceId` (e.g., `penman_registry_{workspaceId}`).
  - `api/research/index.js`: Update the blob-backed storage to partition snapshots by `workspaceId`.
- **Orchestration**:
  - `src/App.tsx`: Allow the `workspaceId` to be derived from the URL or a default value. Pass this ID to all registry sync/fetch calls.

## 3. Technical Details

### 3.1 Data Flow Changes
- `src/App.tsx` $\rightarrow$ `DebugPanel`: Pass `traceability` prop.
- `src/App.tsx` $\rightarrow$ `CompanyWorkspace`: Pass `traceability` prop.
- `src/App.tsx` $\rightarrow$ `companyRegistryStore` / `sharedResearchApi`: Pass `workspaceId`.

### 3.2 Component Design
- **`RigorLadder` (New)**: A vertical stepper component.
  - Green check for `achieved: true`.
  - Amber/Red for the first `achieved: false` with the associated `detail` text.
  - Grayed out for subsequent levels.
- **`ConfidenceBadge` (New)**: A compact pill component using `traceability.confidence.tone` for coloring.

## 4. Verification Plan
- **Type Safety**: `npm run typecheck`.
- **Functional Tests**: `npm test` to ensure registry merge logic still works with `workspaceId`.
- **Build**: `npm run build`.
- **Manual Validation**:
  - Verify that the `DebugPanel` correctly reflects the rigor level of the current run.
  - Verify that switching `workspaceId` (via URL/config) loads a different set of peers.
