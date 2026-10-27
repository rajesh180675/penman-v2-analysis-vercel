# Native Forecast Generation — Design

**Date:** 2026-10-27 (IST)
**Status:** Built 2026-10-27 (see §9)
**Scope:** Plan §9.7 exit criterion 1. The run's forecast cases come from a forecast-generation stage of their own, not from the command center's scenario cards.
**Builds on:** `2026-07-20-legacy-to-native-migration.md` §9 (forecast cutover); #504–#509 (native cases, valued and published)

---

## 1. Where things stand

Since #509 the command center's scenario cards are valued on native forecast cases (`forecastState/engine.ts`, balanced statements). But those cases are still produced inside the command center, in this order:

1. `buildScenarioCards` (`valuationCommandCenter/builders.ts`) calls `derivePersistenceForecastScenario` four times (stress, base, bull, historical panic). Each call returns a `ForecastScenario`: per-year sales growth, after-tax core margin and asset turnover, plus held financing (`flev`, `nfo_level` or `owner_payout`), `nbc`, the minority's ratio and income share, `ke`, `kw` and terminal growth.
2. The card clamps terminal growth to the sector template's band, then turns the scenario into a native case through `buildIndustrialForecastFromLegacyScenario` (`forecastState/legacyScenarioBridge.ts`). This step maps the scenario's drivers onto `IndustrialForecastYearDrivers` and solves the financing in passes.
3. The run's forecast stage (`runForecast` → `buildScenarioForecastResults`) reads `commandCenter.scenarios[].scenario` back out and builds the same four cases again, with the run's window and assumption ids as labels.

So the forecast is decided inside the command center, and the run reads it back from the cards. Exit criterion 1 asks for the reverse: the run decides the forecast, and the valuation consumes it.

Measured 2026-10-27: building the four cases takes 6–7 ms in a run of 8–15 s. Building them twice costs nothing that matters. The point of this cutover is ownership and lineage, not speed.

## 2. What decides a forecast today

`derivePersistenceForecastScenario` (`forecastingEngine/scenarios.ts`) takes:

| Input | Computed in the command center as | Where it comes from |
|---|---|---|
| `periods` | `valuationData` | the run's valuation basis (`buildValuationBasis`) |
| `latest` | the last valuation period | same |
| `businessModel` | `buildBusinessModelProfile(valuationData)` | history only |
| `template` | `resolveValuationSectorTemplate(valuationData, config.sector_template, config.company_type)` | history + config |
| `horizon` | 5 | constant |
| `riskInputs.ke`, `kw` | `resolveCostOfCapitalFromConfig(...)` | config, macro and beta packs, live risk-free rate |
| `riskInputs.riskFreeRate` | the cost of capital's riskless rate | same |

All of these are already computed at the run level, or can be. The run's assumption-resolution stage resolves the same cost of capital (`resolveAssumptions`), and a parity spec asserts the two equal (Stage 9).

Two things are applied after derivation and before the case is built:

- **Terminal growth** is clamped to the template's floor and cap, or set by `config.g_terminal_override`.
- **kw** is solved per card (`computeConsistentValuation`) *after* the case is valued. The case's statements do not read kw (§4.3), so the seed kw it is built with matters only for the terminal-spread validation check.

## 3. Design

### 3.1 A forecast-generation stage

A new executor step, `generateForecastCases`, runs **before** the command center is built. It produces the four forecast cases and records them as the run's forecast artifacts. Today's order (`executeLegacyAnalysisRun`) is `selectWindow → runCommandCenter → recordMarketSnapshot → resolveRunAssumptions → runForecast → checkCaseValuations`. It becomes:

```
selectWindow
recordMarketSnapshot           (moves earlier: it records state.marketSnapshot, set at openRun)
resolveRunAssumptions          (moves earlier: it no longer needs the command center, §3.3)
generateForecastCases   (new)  → state.forecastResults: IndustrialForecastResult[]
runCommandCenter               ← consumes state.forecastResults
runForecast                    → calibration, ordering gate, governance (unchanged)
checkCaseValuations            (unchanged)
```

The windowed valuation basis (`windowValuationBasis`, now computed inside `runCommandCenter`) moves into `selectWindow` or a step of its own, because both the forecast and the command center need it.

`generateForecastCases` calls one function in `forecastState`:

```ts
export function generateIndustrialForecastCases(input: {
  readonly periods: readonly RecastPeriod[];   // the valuation basis
  readonly config: EngineConfig;
  readonly template: ValuationSectorTemplateDefinition;
  readonly businessModel: BusinessModelProfile;
  readonly costOfCapital: { readonly ke: number; readonly kw: number; readonly riskFreeRate: number };
  readonly horizon: number;
  readonly labels: { readonly analysisWindowId: string; readonly assumptionIds: readonly string[]; readonly evidenceRefs: readonly string[] };
}): IndustrialForecastResult[]
```

Inside, for each scenario key, it calls `derivePersistenceForecastScenario` and applies the terminal-growth clamp (moved out of `makeScenario`, so it exists once). It then builds the case through the existing bridge, which stays the mapping from scenario drivers to year drivers. The function returns the cases; each computed case carries the `ForecastScenario` it was built from (§3.2).

This stage is the only caller of `derivePersistenceForecastScenario` on the run path. The classic shell's ForecastReport, DriverGrid and `anchoredValuationPeriods` keep calling it directly. They are UI and helper paths outside the run, and they move with the command center's own decomposition (§7), not here.

### 3.2 Cases carry their scenario

The command center still needs each scenario's `ForecastScenario`, because:

- break-even, PVRE and the forecast tab re-value through the closed form (`buildScenario`), which takes one;
- the card displays its drivers (`assumptions.salesGrowthYear1` and so on) and its forecast policy;
- frozen snapshots record the stress, bull and panic paths through `buildScenario(card.scenario)` (`scripts/accountability/appSnapshot.ts`).

So the stage hands the command center `{ result: IndustrialForecastResult; scenario: ForecastScenario }` pairs. The scenario is the *input* the case was generated from, recorded beside it. It is not read back out of the case. `IndustrialForecastCase` itself does not change, so content hashes of computed cases do not move from this.

### 3.3 The command center consumes the cases

`buildValuationCommandCenter` gains an optional `forecastCases` parameter. When it is given, `buildScenarioCards` uses each pair instead of deriving and building its own: the case for the valuation, and the scenario for the card's display and for the closed-form consumers. When it is absent (classic shell, Dashboard, `useAuditAnalysis`), the command center generates the cases itself by calling the same `generateIndustrialForecastCases`. So there is one derivation path, not two.

The run's assumption-resolution stage currently reads the base card (`buildRunAssumptionCandidates`: terminal growth, year-1 sales growth, margin and turnover). It moves to read the base forecast case's scenario instead, which lets it run before the command center. Its values do not change: they are the same drivers, read from the same derivation one step earlier.

### 3.4 What the forecast stage stops doing

`runForecast` stops calling `buildScenarioForecastResults` (`forecastState/scenarioGates.ts`), which built cases from `commandCenter.scenarios`. It takes `state.forecastResults` as already generated. Calibration, the validation and ordering gate, and governance stay as they are.

`buildScenarioForecastResults` is deleted. Its only other caller is the audit harness, which runs the app's own loader (`loadCompanyRun`) since #431, so it inherits the stage.

## 4. What does not change, and why

### 4.1 Values

The cases are built from the same derivation, with the same inputs, through the same bridge. The cards value the same cases they value today. The expected result is **exact parity**: no value, status or rung moves.

What can move are labels:
- Today the cards build their cases with `analysisWindowId: "valuation-command-center"` and empty assumption and evidence ids; the run's recorded cases carry the real ones. After this change there is one set of cases, with the real labels.
- The command center's materialization does not contain the cases (only `valuation`, `scenario`, `forecastSource`), so its digest should not move. If it does, a field is leaking and must be found.
- The recorded `forecastResults` should be byte-identical: they are built the same way they are today, only earlier.

### 4.2 The single exception: kw on the recorded case

The run's recorded cases are built today from `card.scenario`, which carries the **solved** kw (`scenarioAtKw`). The cards build theirs at the **structural seed** kw. Generating the cases before the command center means the recorded case carries the seed.

kw reaches only the case's terminal block (`terminal.kw`, the kw spread checks, `TerminalEconomicsDiagnostic.kwSpread`); no projected statement reads it. So the recorded cases' terminal diagnostics will move, and their content hashes with them. No value moves, because the valuation runs at the card's solved kw either way.

Recording the seed is the more honest record: it is the kw the forecast was generated under. The solved kw is a valuation output and belongs on the card, where it already is (`kwConsistency`). The PR should say this and show the field-level diff.

### 4.3 Scenario ordering

`validateIndustrialScenarioOrdering` reads computed cases' projected states, not kw, so the ordering gate's verdict does not move.

## 5. Proof

1. **Parity harness, exact.** `npm run parity -- --compare=<main> --dump --baseline-dump` against a fresh main recording. Expected: every company's status, basis, code, diagnostics and artifact count unchanged. The command center digest unchanged. `forecastResults` moves only at `terminal.kw` and the fields derived from it (§4.2). Anything else is a bug.
2. **Unit:** `generateIndustrialForecastCases` returns four cases equal (deep) to what `buildScenarioCards` built before, for a library company (TCS), at the seed kw.
3. **Mutation:** the stage's terminal-growth clamp removed; the command center deriving its own cases although given them; assumption resolution reading a scenario other than the base. Each must be killed by a spec.
4. **Census:** `computeValuationCallSites.spec.ts` should not change (no `computeValuation` call moves).
5. **Audit:** `npm run audit:all`, every outcome unchanged.

## 6. Risks

- **Executor ordering.** Recording the market snapshot and resolving assumptions move ahead of the command center. Both read state set before it (`state.marketSnapshot` at `openRun`, the window at `selectWindow`), so their outputs should not move. The artifact *order* was expected to change, which would move the run's reproducibility hash even with identical artifacts. It did not (§9): the only artifact recorded in the moved stages, the market snapshot, comes before the first forecast-dependent artifact either way. The Stage 9 cost-of-capital equality (`assumptionResolution.spec.ts`, `legacyExecutor.spec.ts`) must still pass unchanged.
- **Two cost-of-capital routes.** The stage takes ke and kw from the run's assumption resolution (`analysisCase/assumptionResolution.ts`); the command center computes its own (`valuationCommandCenter/core.ts`). Both call `resolveCostOfCapitalFromConfig` with the same inputs, and the Stage 9 spec asserts them equal. The stage must use the same packs and as-of date, and the equality must cover the new site.
- **Classic shell.** It builds its own command center without a run. It keeps working through the generate-it-yourself fallback (§3.3), and must be checked by loading a company in `?ui=classic`.

## 7. Out of scope

- Replacing `ForecastScenario` with native drivers (§9.3). The scenario stays the derivation's output; this change moves who calls the derivation, not what it returns.
- Calibration as an artifact stage (§9.7 criterion 7) and non-mutating composition (§10.4). Neither runs for any library company, so neither can be proved by the parity harness; each needs fixtures first.
- `ContentRef<"forecast-case">` inputs to model execution (§9.7 criterion 5). The cards still reach the case in memory.

## 8. Slicing

One PR. The derivation, the stage, the command center parameter and the assumption-resolution move are coupled: splitting them leaves two derivation paths alive at once. The PR is proved by §5 and lands only with exact parity apart from §4.2.

## 9. Outcome

Built as one PR, as §8 planned. Two things differ from the design:

- **The seam is two functions, not one.** `planForecastScenarios` runs inside assumption resolution, because the base scenario sources the assumptions the cases are then labelled with; `buildPlannedForecastCases` runs after. Both are executor dependencies, so the executor spec stubs them.
- **The artifact order did not change**, so parity compared positions directly.

Parity against main (2534a167): every materialized field but `forecastResults` is byte-identical across all 33 runs. On the recorded cases only `terminal.kwSpread` moves, on 72 of 84 (§4.2). The smallest spread after is 3.4 points (NTPC bull), against the 0.5-point minimum. Five mutants were killed, including a backtest that leaks the latest anchor's cases into earlier anchors.
