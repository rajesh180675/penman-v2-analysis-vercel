# Plan 2 — Decompose God Modules (3 PRs, no schema bump)

> **For Hermes:** Use `subagent-driven-development` skill. Each PR is a pure refactor with behavior-preserving guarantee enforced by the existing test suite.

**Goal:** Make every file in the codebase reviewable in one sitting (≤500 lines) by splitting the 5 god modules along seam lines that already exist conceptually.

**Architecture:** Each god file gets:
1. A *facade* (the file at the original path) that re-exports the public API. Keeps callsites untouched.
2. Domain modules co-located in a sibling folder.
3. Pure logic moved out of components into colocated `*.hooks.ts`.

The test suite is the contract. Zero behavior change is the acceptance bar.

**Tech Stack:** No new dependencies. React 19, TypeScript 5.9, Vitest 4.

**Sequencing rule:** PR-2.1 (App.tsx) first because every other surface depends on App's shape. PR-2.2 (v3Analytics) and PR-2.3 (god-components) can land in either order after that.

---

## PR-2.1 — Decompose `src/App.tsx` (1,208 → ≤400 lines)

**Branch:** `arch/decompose-app-shell`
**Estimated diff:** +1,500 / -1,200, 7 new files

**Why:** `App.tsx` is a 1,208-line orchestrator with 28 engine imports and ~15 `useState` calls managing what should be a state machine. Adding a new ingestion source today means reading the entire file. The orchestration and the rendering live tangled.

**Target layout:**

```
src/App.tsx                          ← thin entry, ≤120 lines
src/app/
  AppShell.tsx                       ← routing + tabs, ≤300 lines
  state/
    auditRunMachine.ts               ← finite-state machine (idle/loading/error/ready/blocked)
    useAuditRun.ts                   ← hook wrapping the machine
    useDataIngestion.ts              ← adapter selection (Capitaline/Screener/JSON/XBRL/Manual)
    useTraceabilityEnvelope.ts       ← memoised envelope build
  context/
    AuditRunContext.tsx              ← React context provider
  __tests__/
    auditRunMachine.spec.ts
    useDataIngestion.spec.ts
```

**State machine sketch (`auditRunMachine.ts`):**

```ts
import type { RawPeriodData, RecastPeriod, AnalysisTraceabilityEnvelope } from "../../engine/types";
import type { ValuationResult } from "../../engine/types/valuation";

export type AuditRunState =
  | { status: "idle" }
  | { status: "ingesting"; source: IngestionSource; progress: number }
  | { status: "ingested"; rawData: RawPeriodData[] }
  | { status: "recasting"; rawData: RawPeriodData[] }
  | { status: "recast-complete"; rawData: RawPeriodData[]; recastData: RecastPeriod[] }
  | { status: "valuing"; rawData: RawPeriodData[]; recastData: RecastPeriod[] }
  | { status: "ready"; rawData: RawPeriodData[]; recastData: RecastPeriod[]; valuation: ValuationResult; envelope: AnalysisTraceabilityEnvelope }
  | { status: "blocked"; rawData: RawPeriodData[]; envelope: AnalysisTraceabilityEnvelope; reason: BlockReason }
  | { status: "error"; error: Error; phase: "ingest" | "recast" | "value" };

export type AuditRunEvent =
  | { type: "ingest"; source: IngestionSource; payload: unknown }
  | { type: "ingest-progress"; progress: number }
  | { type: "ingest-success"; rawData: RawPeriodData[] }
  | { type: "ingest-failure"; error: Error }
  | { type: "recast" }
  | { type: "recast-success"; recastData: RecastPeriod[] }
  | { type: "value" }
  | { type: "value-success"; valuation: ValuationResult; envelope: AnalysisTraceabilityEnvelope }
  | { type: "blocked"; envelope: AnalysisTraceabilityEnvelope; reason: BlockReason }
  | { type: "reset" };

export function auditRunReducer(state: AuditRunState, event: AuditRunEvent): AuditRunState {
  // exhaustive switch — every state × event combo is explicitly handled or rejected
}
```

**Steps:**

1. Read `App.tsx` start to end. Identify the 5 distinct concerns:
   - Tab routing
   - Ingestion adapter selection
   - Audit run state machine
   - Envelope build memoisation
   - Cross-tab confidence broadcast
2. Extract the state machine first. Write `auditRunMachine.ts` + 8 unit tests covering every state transition.
3. Wrap the reducer in `useAuditRun.ts`. Verify with React Testing Library.
4. Extract `useDataIngestion.ts`. The current code has a switch over `dataSource`; lift it.
5. Extract `useTraceabilityEnvelope.ts` — memoise envelope build keyed on `(rawData, recastData, valuation, runId)`.
6. Build `AppShell.tsx` consuming the three hooks via `AuditRunContext`.
7. Replace `App.tsx` with a thin shell that mounts `<AppShell />` inside `<AuditRunProvider>`.
8. Run full suite. Zero behavior change expected.

**Acceptance test:**

```bash
wc -l src/App.tsx                 # ≤ 120
wc -l src/app/AppShell.tsx         # ≤ 300
find src/app/state -name "*.ts" | xargs wc -l | tail -1   # all under 250
npm test 2>&1 | tail -5           # 1132+ passing
npm run build 2>&1 | tail -5      # bundle size unchanged ± 5%
```

**Test seam:**

`src/app/state/__tests__/auditRunMachine.spec.ts` — 18 cases covering every state-transition in the machine. The machine is deterministic and pure, so 18 unit tests prove correctness.

---

## PR-2.2 — Decompose `src/engine/v3Analytics.ts` (2,059 → 4 modules)

**Branch:** `arch/decompose-v3-analytics`
**Estimated diff:** +2,200 / -2,059, 5 new files

**Why:** `v3Analytics.ts` is the largest file in the engine. It mixes:
- Dirty-surplus reconciliation
- Terminal-anchor selection (overlapping with PR-B economic-sanity gates)
- Sensitivity matrix generation
- Confidence interpretation / narrative

These four are independently testable; they're tangled today only because the file grew.

**Target layout:**

```
src/engine/v3/
  index.ts                              ← re-exports old API surface; original path forwards here
  dirtySurplus.ts                       ← clean-surplus reconciliation, comprehensive income walk
  terminalAnchor.ts                     ← terminal-period selection (delegates to economicSanityGates where overlap)
  sensitivity.ts                        ← Monte Carlo / grid sensitivity, returns a SensitivityMatrix
  confidenceNarrative.ts                ← human-readable interpretation of envelope status
  __tests__/
    dirtySurplus.spec.ts                ← already exists at v3Analytics.spec.ts; split & redistribute
    terminalAnchor.spec.ts
    sensitivity.spec.ts
    confidenceNarrative.spec.ts
```

**Steps:**

1. Read `v3Analytics.ts`. Mark each function with a `// @v3-section: <name>` tag.
2. Extract each section to its own file. Preserve function signatures so callsites work after barrel re-export.
3. The old file becomes:
   ```ts
   export * from "./v3/index";
   ```
4. Split the existing test file along the same seams. Each new spec file ≤200 lines.
5. Run the full suite. Zero behavior change expected.

**Anti-pattern to avoid:** Don't introduce a class hierarchy. Functions are correct here; the v3 modules are stateless transformations.

**Acceptance test:**

```bash
wc -l src/engine/v3/*.ts             # all ≤ 500
wc -l src/engine/v3Analytics.ts      # ≤ 5  (just the barrel export)
npm test 2>&1 | tail -5              # full suite green
```

---

## PR-2.3 — Decompose 5 god-component files

**Branch:** `arch/decompose-god-components`
**Estimated diff:** +3,000 / -2,800, 15 new files

**Why:** These five files combined: `ValuationReport.tsx (1,789)`, `FinancialInstitutionReport.tsx (1,715)`, `AcademicReport.tsx (1,690)`, `V3AnalyticsPanel.tsx (1,476)`, `DebugPanel.tsx (1,504)` — total ~7,800 lines. They mix expensive computation (memoised tables, sensitivity grids, audit row enrichment) with rendering. They each have ~20 useEffect/useMemo calls.

**Target pattern (per component):**

```
src/components/<area>/
  <Component>.tsx                       ← rendering only, ≤500 lines
  <Component>.hooks.ts                  ← derivations, ≤400 lines
  <Component>.formatters.ts             ← number/percent/currency formatters
  __tests__/
    <Component>.spec.tsx                ← component renders correctly given hook output
    <Component>.hooks.spec.ts           ← pure derivation tests
```

**Concrete plan per file:**

| File | Split into | Hook responsibilities |
|---|---|---|
| `ValuationReport.tsx` (1,789) | `ValuationReport.tsx` (≤500), `useValuationDerivations.ts`, `valuationFormatters.ts` | RE/CV2/CV3 derivations, lens-blend table, P/E vs P/B comparison |
| `FinancialInstitutionReport.tsx` (1,715) | `FinancialInstitutionReport.tsx` (≤500), `useBankDerivations.ts`, `bankFormatters.ts` | NIM/CRAR/GNPA tables, Tier-1 capital walk |
| `AcademicReport.tsx` (1,690) | `AcademicReport.tsx` (≤500), `useAcademicTables.ts`, `academicFormatters.ts` | LaTeX table generation, citations, methodology block |
| `V3AnalyticsPanel.tsx` (1,476) | `V3AnalyticsPanel.tsx` (≤500), `useV3Derivations.ts`, `v3Formatters.ts` | Dirty-surplus walk render, sensitivity grid |
| `DebugPanel.tsx` (1,504) | `DebugPanel.tsx` (≤500), `useDebugDerivations.ts`, `debugFormatters.ts` | Schema migration log, telemetry breakdown, raw envelope |

**Steps (per file, identical pattern):**

1. Identify every `useMemo` / `useCallback` block whose dependencies are the envelope/recastData. Move the body into a `<Component>.hooks.ts` function.
2. Identify every `Intl.NumberFormat`-style formatting helper. Move to `<Component>.formatters.ts`.
3. The component file becomes a JSX-only render layer. Its `useMemo`s call into the hook module.
4. Write a `<Component>.hooks.spec.ts` for every derivation. These are now plain function tests, no React renderer needed.
5. Run the existing component spec; it should pass without modification because the hook IS the implementation.

**Acceptance test (per file):**

```bash
wc -l src/components/<area>/<Component>.tsx     # ≤ 500
wc -l src/components/<area>/<Component>.hooks.ts # ≤ 400
npx vitest run src/components/<area>/__tests__/  # all green
```

**Cross-cutting acceptance for PR-2.3:**

```bash
# No file in src/components > 600 lines
find src/components -name "*.tsx" -exec wc -l {} \; | awk '{ if ($1 > 600) print }' | wc -l   # = 0

# Hook coverage
ls src/components/**/*.hooks.ts | wc -l   # ≥ 5

# Suite green
npm test
npm run build
```

---

## Cross-cutting acceptance for Plan 2

After all 3 PRs merge:

```bash
# ─── No god files ───────────────────────────
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -10
# Top 10 should all be ≤ 600. Original top file (v3Analytics 2,059) replaced.

# ─── App.tsx is thin ────────────────────────
wc -l src/App.tsx                  # ≤ 120

# ─── Hook layer extracted ──────────────────
find src -name "*.hooks.ts" | wc -l   # ≥ 8

# ─── Behavior preserved ────────────────────
npm run validate                   # full suite + build green

# ─── Bundle size budget ────────────────────
ls -la dist/assets/*.js | awk '{ sum += $5 } END { print sum }'   # ≤ within 5% of pre-Plan-2 size
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hook extraction subtly changes referential identity → re-render storms | medium | Use `useMemo` with explicit dependency arrays. Run React-DevTools profiler on the largest report; expect render count unchanged ± 1 |
| State machine reducer misses an edge case | medium | Exhaustive switch + `assertNever` helper at the default branch — TS forces every event to be handled |
| Tests pass but production behavior subtly changes | low | The existing 1132+ test suite IS the contract. If anything breaks, find it before merging |
| Bundle size regresses from import-graph changes | low | `npm run build` size budget gate in CI (PR-2.1 acceptance) |

## Definition of done

10/10 means:
1. No file in `src/` exceeds 600 lines.
2. App.tsx is a 120-line shell over a typed state machine.
3. v3Analytics is 4 testable modules, each ≤500 lines.
4. The 5 god-components have rendering separated from derivation; hooks are independently unit-tested.
5. Suite green, bundle size flat, no behavior change.
