# Command Center Decomposition — Staging Design

**Date:** 2026-10-30 (IST)
**Status:** Design. Nothing built.
**Scope:** How to carry out `2026-07-20-legacy-to-native-migration.md` §7 (split `buildValuationCommandCenter` into native stages) in safe, parity-proved steps.
**Builds on:** §7.1–7.7 of the migration plan; #513 (forecast generated before the command center), #527 (forecast gates as a stage), #528 (cards value the recorded cases).

---

## 1. What the command center is today

`buildValuationCommandCenter` (`valuationCommandCenter.ts`) is `buildCoreCommandCenter` (`valuationCommandCenter/core.ts`, 760 lines) plus a backtest (`backtest.ts`). The whole module is 2,505 lines across 8 files. `buildCoreCommandCenter` runs one sequence and returns about 40 fields at once.

| Group | Computed by | Lines (core.ts) |
|---|---|---|
| Share basis, readiness anchor, anchor slice | `resolveShareBasis`, `resolveValuationReadiness` | 139–145 |
| Price basis: share-count change, carved-stake price, price date | inline | 153–171, 240–241 |
| Market context: freshness, history, percentile | `normalizeHistoricalSeries`, `summarizeHistoricalPrices` | 178–183 |
| Sector template, business model, quality, persistence penalty | `resolveValuationSectorTemplate`, `buildBusinessModelProfile`, `computeQualityScore` | 184–210 |
| Cash-flow diagnostics (owner earnings, maintenance capex) | `computeCashFlowDiagnostics` | 187 |
| Cost of capital | `resolveCostOfCapitalFromConfig` | 211–236 |
| Scenario cards (4) | `buildScenarioCards` on the run's forecast cases | 242–263 |
| Reverse DCF | `buildReverseDcfExpectation` | 319 |
| SOTP, conglomerate | `buildSotpAssessment` | 336–338 |
| EV/EBITDA cross-check | `computeEvEbitdaCrossCheck` | 341–346 |
| India quality, earnings quality (Dechow-Dichev, REM) | `computeIndiaQualitySignals`, `buildDechowDichevAndRem`, `buildEarningsQualityCard` | 347–359 |
| Opportunity score, conviction, signal state, checklist, kill switches | inline + `buildChecklist` | 360–608 |
| Class-A models | `buildClassAModels` | 609 |
| Cash-flow DCF | `computeCashFlowDcf` | 613 |
| Triangulation, evidence ledger, holdout, market-implied ledger | `buildValuationTriangulationEvidence`, `buildAssumptionEvidenceLedger`, `evaluateForecastHoldout`, `buildMarketImpliedExpectationLedger` | 622–640 |
| EPV | `computeEPV` | 651–655 |
| Evidence-weighted synthesis | `buildEvidenceWeightedSynthesis` | 656–665 |

Since #513 and #528 the forecast is no longer decided here: the run generates the cases, records them, and the cards value the recorded cases. The cost of capital is resolved twice, once by the run's assumption-resolution stage and once here, and a parity spec asserts the two agree (Stage 9).

## 2. Who reads it

Three kinds of reader, measured 2026-10-30.

**The run** (`analysisRun/legacyExecutor.ts`) reads five fields: `costOfCapital` (5 reads), `evidenceWeightedSynthesis` (3), `scenarios` (1), `earningsQuality` (1), and the whole object through `adaptLegacyCommandCenterModelResults` (`modelCatalog/legacyAdapters.ts`). That adapter reads `scenarios`, `cashFlowDcf`, `reverseDcf`, `evEbitda`, `epv`, `sotp`, `shareBasis` and `evidenceWeightedSynthesis`, and wraps each as a catalog model result.

**The UI**, through the run's materialized `commandCenter`. Across `src/components`, `src/next`, `src/app` and `src/lib`, 27 files read about 30 of its fields. The heaviest are `signal` (56 reads), `marketContext` (39), `opportunity` (37), `marketPrice` (25), `backtest` (23), `businessModel` (20) and `epv` (18).

**Three UI rebuilds.** `DashboardView.tsx:144`, `ValuationReport.tsx:222` and `useAuditAnalysis.ts:170` call `buildValuationCommandCenter` themselves when no run is present (`runCommandCenter ?? buildValuationCommandCenter(...)`).

So the object is not only the models' container. It is the UI's read model for the whole valuation page. Most of its fields (signal, opportunity, checklist, market context, business model) are presentation and decision logic, not models.

## 3. Why not split it the way §7.2 draws it

§7.2 splits the command center into four stages (assumption resolution, forecast, model execution, synthesis), each taking and returning only `ContentRef`s, with no `ValuationCommandCenterOutput` left. Three facts make that a poor first move:

1. **The UI reads the object.** Removing it means rewriting 27 files to read stage artifacts. That is §7's last step, not its first, and it has no parity harness: parity covers the run's materialization, not what a component renders.
2. **The signal and opportunity logic (about 250 lines) reads nearly everything else.** It reads the cards, reverse DCF, quality, persistence, market freshness, history and share basis together, so it can't move until the rest has a stable shape.
3. **Two of §7.2's four stages are already native.** Assumption resolution has run as its own stage since Stage 9, and the forecast since #513, #527 and #528. Their remaining duplication is the command center re-resolving the cost of capital, which the parity spec already guards.

## 4. Staging

Each step is one PR. Each leaves `ValuationCommandCenterOutput` field for field identical, so `npm run parity` proves it on all 33 runs, and the UI is untouched until the last step.

**Step 1: the command center takes the run's cost of capital.** *Done 2026-10-30.* Parity holds on all 33 runs. The backtest passes `costOfCapital: null`, so each earlier anchor resolves its own; library runs carry no price history, so the backtest never runs there, and a unit test with a synthetic history covers that path instead. `buildCoreCommandCenter` accepts the resolved cost of capital (as it already accepts `forecastCases`) and uses it instead of calling `resolveCostOfCapitalFromConfig` again. The UI rebuilds pass nothing and keep resolving their own. This removes the duplication the Stage 9 parity spec exists to police.

**Step 2: the models run as their own stage.** A `runValuationModels` stage function takes the anchor slice, share basis, price basis, cost of capital and the recorded cases, and returns the model results:
- the scenario cards
- reverse DCF
- SOTP
- EV/EBITDA
- Class-A models
- cash-flow DCF
- EPV

`buildCoreCommandCenter` calls it and copies the results into its output. The run's `adaptLegacyCommandCenterModelResults` then reads the stage's output rather than the command center. Synthesis and the signal logic stay inside.

**Step 3: synthesis runs as its own stage.** `buildEvidenceWeightedSynthesis` already takes its inputs as arguments (core.ts:656). It moves out the same way, reading the model stage's output plus the evidence ledger and holdout. This also settles the advanced-model composition question in §7.4: the composition step mutates the synthesis today, and a stage boundary is where that becomes a new artifact.

**Step 4: the presentation layer as a read model.** What remains in `buildCoreCommandCenter` is the signal, opportunity, checklist, market context, business model and range. It becomes `buildValuationReadModel(stageOutputs)`, a pure function of the stages' outputs that returns today's `ValuationCommandCenterOutput` shape. The UI keeps reading the same object. The three UI rebuilds call the stages and then the read model.

**Step 5 (later, separate): UI reads stage artifacts.** Only after step 4. Tab by tab, as the UI projection plan (`2026-07-20-ui-projection-read-models.md`) describes. This step is out of the parity harness's reach and needs its own screenshot or rendered-output check.

## 5. Risks

- **The backtest re-runs the command center at earlier anchors** (`backtest.ts:59` passes `forecastCases: null`, so each anchor derives its own forecast). Steps 1–3 must keep that path working for a context with no run, as the UI rebuilds do. Each new stage parameter therefore defaults to today's in-place derivation when it is absent.
- **The UI rebuilds are not covered by parity.** Each step keeps their call shape unchanged until step 4, and the existing `DashboardView.commandCenter.spec.tsx` and `ValuationReport.spec.tsx` cover them.
- **Order of floating-point operations.** A stage that recomputes a sum in a different order moves leaves at around 1e-15. The parity harness reports any moved leaf, so each step must be byte-identical, or explain every leaf it moves.

## 6. Exit for this design

Steps 1–4 are done when `buildCoreCommandCenter` holds no model or synthesis computation, the run's model and synthesis artifacts come from stage functions, and parity is identical on all 33 runs at each step. §7.7's full exit (no `ValuationCommandCenterOutput` at all) waits for step 5.
