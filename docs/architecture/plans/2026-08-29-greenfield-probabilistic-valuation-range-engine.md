# Greenfield: Probabilistic Valuation Range Engine (PVRE)

**Date:** 2026-08-29
**Status:** All four milestones shipped. A (engine), B (multi-model + disagreement gate), C (calibration + persistence), D (UI section + browser-local vintage store).
**Author:** Hermes deep-dive (codebase grounded)

---

## 1. Why this, and why now

Deep-dive findings (grounded in repo, not aspiration):

| Finding | Evidence |
|---|---|
| Scorecard 7.6/10, **0/33 production-ready**, all 33 POLICY_WARNING | docs/valuation-maturity-scorecard.md |
| 53 reconciliation blockers, 33 model-applicability blockers dominate | same doc, blocker counts |
| Poly-paradigm plan exists; Phases 1/4 shipped, 2/3/5 pending | docs/poly-paradigm-valuation-plan.md |
| 14-stage native architecture planned (ADR-009-016); 0/14 fully native, executor is a 1643-line god function | docs/architecture/2026-08-current-state-gap-assessment.md |
| Monte Carlo exists (monteCarloWorker) but scenario analysis exists too (forecastingEngine/scenarios.ts) — outputs are point estimates + ranges, NOT calibrated probability distributions | src/engine/monteCarloWorker.ts, forecastingEngine/scenarios.ts |
| assumptionLedger.ts + evidenceWeightedSynthesis.ts exist — assumptions are tracked, synthesis is weighted — but no FORECAST-VS-ACTUAL backtesting loop, no calibration curve, no Brier-style scoring of historical runs | src/engine/valuationEvidence/assumptionLedger.ts, evidenceWeightedSynthesis.ts |

**The honest gap:** the tool quantifies *data* rigor (parser fidelity, reconciliation) and *model* rigor (independence, applicability) but has no **decision rigor** layer:
1. Every output is effectively a point estimate or scenario range with no stated probability, so a reviewer cannot answer "how confident are we, numerically?"
2. There is no backtesting loop that would tell us if 70% confidence intervals actually contain realized outcomes ~70% of the time.
3. Assumptions are sourced/ledgered per-run but never scored for *accuracy after the fact*.

A greenfield module that owns only the probabilistic layer avoids duplicating the in-flight native-executor migration and the roadmap's sector-native models while filling the specific hole the maturity scorecard cannot measure today.

## 2. Scope: what PVRE is (and is not)

**In scope (new module `src/engine/pvre/`)**
1. **Probabilistic forecast distributions.** Replace point/scenario forecasts with explicit probability distributions over the drivers (sales growth, margin, ATO, ke, g_terminal). Inputs: SourcedAssumptionSet + history + sector template priors. Output: marginal + joint samples.
2. **Correlated Monte Carlo valuation.** Run every applicable valuation model on the SAME sampled assumption vectors (one draw → all models), producing a distribution per model and a cross-model distribution of disagreement. Reuse existing valuation models as pure functions; PVRE owns the sampling, not the formulas.
3. **Calibration & backtesting ledger.** Every analysis run persists its assumption distributions + final value distribution (in the existing artifact/store layer). When a later run for the same company lands, score the earlier forecast against realized data (Brier/log score + coverage of prediction intervals) and persist a per-company and global calibration curve.
4. **Disagreement-as-signal gate.** Cross-model value dispersion (already surfaced qualitatively) becomes a first-class rigor signal: high unexplained dispersion blocks "production-ready" promotion unless the anti-tautology/independence ledger shows the disagreement is expected (e.g., distress, conglomerate).
5. **Assumption accuracy ledger.** Extend assumptionLedger: after N months, score each sourced assumption (ke, g, fade) against realized peers/market; surface "optimism bias" per assumption type in reviewer pack.
6. **Reviewer probabilistic bundle.** A single downloadable artifact: value distribution plot, calibration curve, coverage table, and the top-5 assumption sensitivities (partial rank correlation). Consumed by report/export, not a new UI tab initially.

**Explicitly out of scope (do NOT duplicate in-flight work):**
- No rewrite of the executor/pipeline — PVRE is a *sidecar* consuming existing PipelineResult/CommandCenter outputs, like the greenfield 6-layer sidecar already does.
- No new sector-native models (that's poly-paradigm Phase 2).
- No migration of UI off legacy projections (native migration owner).
- No new data ingestion (Capitaline/ar-sidecar owners).

## 3. Architecture

```
                        existing
  PipelineResult / BankResult / CommandCenterOutput
                        |
                        v
        PVRE input adapter (read-only mapping)
                        |
      +-----------------+------------------+
      |                                    |
  Assumption                        Driver history +
  priors builder                    sector priors
      |                                    |
      v                                    v
  Sampler (Monte Carlo / copula) -> Model runners (existing models as pure fns)
      |                                    |
      +-----------------+------------------+
                        v
        PVRE output artifact (immutable, hashed)
                        |
      +-----------------+------------------+
      |                 |                  |
  Calibration      Disagreement      Reviewer
  ledger           gate              bundle
      |                 |                  |
      v                 v                  v
  Scorecard        Rigor ladder     Export/Report
```

Key contracts (TypeScript, in `src/engine/pvre/types.ts`):
- `PvreInput` — resolved run facts + SourcedAssumptionSet + sector template + market snapshot.
- `DriverDistribution` — family (normal/student-t/triangular), params, source, correlation group.
- `ValuationDistribution` — quantiles, mean, prob-of-upside vs market price, per model + synthesized.
- `CalibrationRecord` / `CalibrationCurve` — predicted p vs empirical frequency bins.
- `DisagreementVerdict` — dispersion ratio, allowed?, reason codes.

Integration points (existing seams, no god-function edits):
- Input read: after `buildValuationCommandCenter` result exists (AppShell / worker boundary already exposes it).
- Persist: existing artifact/store layer used by AnalysisRun (content-addressed).
- Rigor hook: add `cross-lens-disagreement` blockers data the scorecard already counts, but now sourced from measured dispersion.
- UI: report/export first; optional Debug panel later.

## 4. Rigor-level impact

Targets the two live blockers and the scorecard wedge:
- `model-applicability: 33/33` → PVRE makes applicability explicit per model per draw and records skip-with-reason.
- `reconciliation: 53` → unchanged (owned by native migration); PVRE does not claim to fix it.
- `cross-lens-disagreement: 1` → becomes a measurable, gated signal.
- New family score candidate: "Probabilistic calibration" — measurable lift once backtesting has ≥N vintages.

Honest constraint: calibration needs multiple vintages over time; the first 3-6 months the calibration curve is sparse and must be labeled low-confidence rather than hidden.

## 5. Build plan (small, verifiable increments)

1. Milestone A — types + input adapter + deterministic sampler (seeded), one model wired. Tests: unit (seeded reproducibility), typecheck.
2. Milestone B — all applicable models looped; disagreement metric + gate signal; scorecard reads measured dispersion.
3. Milestone C — persistence of distributions; backtest scoring; calibration curve API.
4. Milestone D — reviewer bundle export; UI minimal surface in Report tab.
Each milestone: `npm run typecheck`, targeted vitest, golden tests untouched unless distributions change engine outputs (they should not — PVRE is additive).

## 6. Risks & principled limits

- Don't claim precision calibration early: report coverage honestly.
- Correlated drivers need a defensible copula choice; default Gaussian copula with sector priors, sensitivity-checked.
- Do not let "probability" mask structural data gaps: expected-skip outcomes remain expected-skip.
- Keep PVRE pure/functional to fit the repo's deterministic engine style.

## 7. Why not just finish the roadmap instead?

Roadmap owns correctness (native executor, sector models). PVRE owns *decision uncertainty* — orthogonal, complementary, and the only path to answering "how sure are we?" with a number that can be graded later. Both should proceed; PVRE is designed not to collide with the migration.
