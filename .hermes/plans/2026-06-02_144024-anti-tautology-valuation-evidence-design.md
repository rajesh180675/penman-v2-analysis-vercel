# Plan + Design Spec: Anti-Tautology Valuation Evidence Layer

> For Hermes implementers: this is a plan/design-spec only. Do not treat it as already implemented. Implement incrementally with TDD and keep the app deployable after each phase.

## Goal

Make Penman V2's valuation output defensible as independent economic judgment, not a circular accounting model that proves its own assumptions.

The next valuation improvement should move the app from:

> "The accounting model produced a value, therefore the valuation is justified."

To:

> "Every material valuation assumption has independent evidence, price-derived expectations are quarantined from intrinsic confidence, historical forecast skill is measured out-of-sample, and disagreements between accrual, cash, market, and sector-native lenses reduce confidence instead of being averaged away."

For DMART specifically, the desired narrative is:

- Reliable: extreme overvaluation / margin-of-safety warning remains strong.
- Reliable: reverse-DCF saturation means the market is pricing perfection.
- Reliable: negative FCF is expansion-capex burden, not bankruptcy risk.
- Reliable: structural breaks / dirty-surplus spikes around Ind AS transition and demerger remain visible.
- Fixed: no misleading "financial distress / avoid / negative net worth" verdict when current solvency evidence is healthy.
- Improved: the app explains what operating facts the current price requires: store growth, revenue/store, margin, reinvestment, and moat duration.

## Non-goals

- Do not add another valuation formula merely to increase model count.
- Do not let reverse DCF raise intrinsic-value confidence. Reverse DCF is a market-expectation diagnostic.
- Do not fabricate peer, sector, store-count, or management-guidance data. If data is unavailable, show `source_unavailable` and lower confidence.
- Do not add runtime web fetching for static calibration data unless explicitly approved. Prefer static JSON sidecars imported at build/test time.
- Do not weaken overvaluation or reverse-DCF saturation warnings while fixing distress false positives.
- Do not silently replace canonical accounting values such as CSE. Any adjusted value must be a disclosed adjusted lens.

## Current context / empirically validated assumptions

Validated by read-only inspection and commands on `2026-06-02_144024 IST` in workspace `C:/Users/rajesh/WindsurfAPI/penman-v2-analysis`.

### Repo state

- Current working directory: `/c/Users/rajesh/WindsurfAPI/penman-v2-analysis`.
- Latest commit: `abe8519e feat(accounting): add greenfield artifact triage pipeline (#249)`.
- `npm run typecheck` completed successfully:
  - Output: `> react-vite-tailwind@0.0.0 typecheck` then `> tsc --noEmit`.
- There are unrelated untracked files in the workspace, including prior `.hermes/plans/*.md` and several security / Frida scratch files. Do not clean them up as part of this valuation work.

### Verified architecture/doc facts

- `CLAUDE.md` confirms the repo is Vite 7 + React 19 + TypeScript 5.9, with validation commands:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `npm run validate`
- `docs/financial-model-rigor-plan.md` defines the trust target: every material number must be traceable, structurally reconciled, economically classified, and blocked/downgraded when weak.
- `docs/analysis-rigor-ladder.md` currently defines five levels:
  - `syntactically-valid`
  - `structurally-reconciled`
  - `economically-plausible`
  - `valuation-eligible`
  - `production-ready`
- Current traceability schema is `2026-06-traceability-v18` in `src/engine/policyVersions.ts`.
- `src/lib/envelopeMigrations.ts` already supports additive schema migrations through v18.
- `docs/COMPREHENSIVE-VALUATION-DESIGN.md` already calls for valuation synthesis, confidence weighting, market data, sensitivity, and backtesting. This plan narrows that broad vision into the next anti-tautology implementation spine.

### Verified current engine facts

- `src/engine/valuationCommandCenter/types.ts` already has:
  - `ValuationScenarioCard.assumptions`
  - `ReverseDcfDiagnostics`
  - `ValuationBacktestSummary`
  - `cashFlowDcf`
  - `valuationTriangulation`
- `src/engine/valuationCommandCenter/core.ts` already wires:
  - scenario cards
  - reverse DCF expectation
  - EV/EBITDA cross-check
  - India quality signals
  - earnings quality
  - EPV
  - working-capital gate
  - clean-surplus check
  - Damodaran CAPM
  - reverse-DCF Monte Carlo
  - independent cash-statement FCFF DCF
  - lightweight valuation triangulation evidence
- `src/engine/valuationCommandCenter/backtest.ts` is currently a price/signal replay backtest. It answers: "what state did the command center assign historically, and what happened to price later?"
  - It does not yet answer: "can the forecast engine predict future revenue, margin, RNOA, CFO, capex, FCF, or equity growth out-of-sample?"
- `src/engine/cashFlowDcf.ts` already exists as an independent cash lens and explicitly avoids NOA/OI accrual recast inputs.
- `src/engine/valuationTriangulation.ts` currently creates three per-share evidence methods:
  - `accrual-riv`
  - `cash-fcff-dcf`
  - `relative-ev-ebitda`
  It intentionally does not blend them into a headline median.
- `src/engine/reconciliationResiduals.ts` already has a `valuation-triangulation` residual gate with warning threshold `15%` and critical threshold `30%`.
- `src/engine/reverseDCF.ts` already surfaces solver saturation as "bounded values, not forecasts" and warns that the market is paying a premium the model cannot price.
- `src/engine/greenfieldPipeline/*` exists after PR #249 and is the right architectural seam for accounting-artifact vs true-distress separation.

### Verified test surface

Relevant existing tests include:

- `src/engine/__tests__/analysisTraceability.spec.ts`
  - already verifies material independent valuation divergence blocks above valuation eligibility.
- `src/engine/__tests__/cashFlowDcf.spec.ts`
- `src/engine/__tests__/valuationCommandCenter.spec.ts`
- `src/engine/__tests__/valuationTraceabilitySummary.spec.ts`
- `src/components/__tests__/ValuationReport.spec.tsx`
- `src/engine/valuation/__tests__/*.spec.ts`
- `src/engine/__tests__/greenfieldPipeline.triageAdjustValidateConfidence.spec.ts`

### Skill/reference facts incorporated

- Company-type adaptive valuation skill says explicit user-selected `company_type` is primary routing; auto-detection is fallback only.
- Poly-paradigm rigor pattern says Penman-Nissim variants are not independent confirmation; at least one cash-statement lens and one market/relative lens are needed before triangulation is meaningful.
- Indian retail lease caveat says DMART-like cases must preserve overvaluation / reverse-DCF saturation / expansion-capex warnings while avoiding false current-distress language.
- Greenfield artifact pattern says detectors should emit structured evidence and not mutate valuation state directly.

## Problem statement

The app is already moving away from tautology at the reconciliation level, but valuation can still look circular in three ways:

1. **Assumption circularity**
   - A scenario can derive growth, margins, reinvestment, and terminal persistence from the same accounting series being valued.
   - The UI then presents the resulting value as if the assumptions were independently supported.

2. **Model-count illusion**
   - Multiple Penman-derived outputs can look like triangulation even when they are algebraic rearrangements of the same accrual spine.
   - Existing `valuationTriangulation` is a good start, but the evidence is still lightweight: mostly per-share values, not assumption provenance.

3. **Market-implied expectation contamination**
   - Reverse DCF correctly asks what the market must believe.
   - But market-implied assumptions must never be allowed to validate intrinsic assumptions or raise confidence. They are diagnostics, not evidence of fair value.

## Design principles

1. **Evidence before confidence**
   - Every material valuation assumption gets an evidence ledger row.
   - Confidence can rise only from non-price evidence: reported history, clean holdout forecast performance, peer/sector calibration, or explicit source documents.

2. **Price-derived quarantine**
   - Price-derived assumptions can explain market expectations.
   - They cannot improve intrinsic valuation confidence, forecast confidence, or production-ready status.

3. **Out-of-sample discipline**
   - If the forecast engine cannot predict known historical outcomes, the future valuation range must widen and confidence must fall.

4. **Paradigm independence**
   - Accrual, cash, market/relative, and sector-native lenses must carry `independenceGroup` metadata.
   - Methods in the same independence group do not count as independent corroboration.

5. **Sector-native economics where available**
   - For retail/consumer names like DMART, RNOA/PM/ATO should be complemented by operational drivers: stores, revenue/store, same-store sales growth, capex/store, lease burden/store, and store-level ROIC.

6. **Fail closed, but degrade gracefully**
   - Missing peer/store/forecast evidence should not crash valuation.
   - It should produce an honest skip / warning and cap confidence.

7. **Static data stays static**
   - Peer calibration and sector priors should be versioned JSON under `src/engine/valuation/data/` or company sidecars, not fetched live at runtime.

## Proposed architecture

### New high-level flow

```text
Recast periods + traceability + market data + sector template
        |
        v
Valuation Command Center scenarios / reverse DCF / cash DCF / EV-EBITDA
        |
        +--> Assumption Evidence Ledger
        |      - What assumption?
        |      - What source supports it?
        |      - Is it price-derived?
        |      - What is the defensible range?
        |
        +--> Forecast Holdout Validator
        |      - Train/calibrate on early periods
        |      - Forecast later known periods
        |      - Measure errors on revenue, margin, RNOA, CFO, capex, FCF, CSE
        |
        +--> Market-Implied Expectation Ledger
        |      - Reverse DCF outputs
        |      - Saturation flags
        |      - Required operational facts
        |      - Explicitly excluded from intrinsic confidence
        |
        +--> Peer / Sector Calibration
        |      - Static peer percentile checks
        |      - Sector bounds for terminal margin, growth, ROIC, multiples
        |
        +--> Sector-Native Driver Checks
               - Retail unit economics if data exists
               - `source_unavailable` if not
        |
        v
Evidence-weighted valuation synthesis + anti-tautology traceability gate
        |
        v
Valuation UI / Run Inspector / audit snapshot / workbook export
```

### Core new modules

Create a small folder rather than scattering logic:

```text
src/engine/valuationEvidence/
  index.ts
  types.ts
  assumptionLedger.ts
  forecastHoldout.ts
  marketImpliedLedger.ts
  peerCalibration.ts
  evidenceWeightedSynthesis.ts
  defensibilityChecklist.ts
  __tests__/
    assumptionLedger.spec.ts
    forecastHoldout.spec.ts
    marketImpliedLedger.spec.ts
    evidenceWeightedSynthesis.spec.ts
    defensibilityChecklist.spec.ts
```

Optional sector-native layer:

```text
src/engine/sectorDrivers/
  retailUnitEconomics.ts
  types.ts
  __tests__/
    retailUnitEconomics.spec.ts
```

Static data / sidecars:

```text
src/engine/valuation/data/peer-calibration/india-retail-2026-01.json
src/engine/valuation/data/sector-priors/india-retail-2026-01.json
public/data/companies/<company>/operational-drivers.json  # only if real sourced data exists
```

No runtime dependency is required for Phase 1-4.

## Data model design

### Assumption evidence ledger

```ts
export type ValuationAssumptionKey =
  | "revenue_growth"
  | "core_margin"
  | "asset_turnover"
  | "rnoa"
  | "reinvestment_rate"
  | "capex_intensity"
  | "working_capital_drag"
  | "fade_rate"
  | "terminal_growth"
  | "ke"
  | "kw"
  | "model_weight"
  | "store_count_growth"
  | "revenue_per_store"
  | "same_store_sales_growth"
  | "capex_per_store"
  | "lease_burden_per_store";

export type EvidenceSourceType =
  | "reported-history"
  | "clean-window-history"
  | "forecast-holdout"
  | "peer-percentile"
  | "sector-prior"
  | "macro-source"
  | "management-guidance"
  | "operational-driver-sidecar"
  | "user-override"
  | "price-derived"
  | "source-unavailable";

export interface ValuationAssumptionEvidence {
  key: ValuationAssumptionKey;
  label: string;
  value: number | null;
  unit: "fraction" | "inr-crore" | "inr-per-share" | "years" | "ratio" | "count";
  scenarioKey?: "stress" | "base" | "bull" | "historical-panic" | undefined;
  sourceType: EvidenceSourceType;
  sourceLabel: string;
  sourceRef?: string | null | undefined;
  sourcePeriodWindow?: { from: string; to: string; periods: number } | null | undefined;
  independenceGroup:
    | "accrual-history"
    | "cash-statement"
    | "market-price"
    | "peer-market"
    | "sector-static"
    | "operational-driver"
    | "user-input";
  priceDerived: boolean;
  eligibleForIntrinsicConfidence: boolean;
  confidence: "high" | "medium" | "low" | "unavailable";
  defensibleRange: { low: number | null; high: number | null; basis: string };
  warnings: string[];
}

export interface ValuationEvidenceLedger {
  schemaVersion: "2026-06-valuation-evidence-v1";
  periodEnd: string | null;
  companyId?: string | null | undefined;
  rows: ValuationAssumptionEvidence[];
  summary: {
    total: number;
    unsupportedCount: number;
    priceDerivedCount: number;
    confidenceEligibleCount: number;
    highConfidenceCount: number;
    sourceUnavailableCount: number;
  };
}
```

### Forecast holdout validation

```ts
export interface ForecastHoldoutMetricError {
  metric:
    | "sales"
    | "core_margin"
    | "rnoa"
    | "cfo"
    | "capex"
    | "fcf_cash"
    | "cse"
    | "noa";
  actual: number | null;
  predicted: number | null;
  absoluteError: number | null;
  percentageError: number | null;
  status: "confirmed" | "degraded" | "failed" | "unavailable";
}

export interface ForecastHoldoutFold {
  trainWindow: { from: string; to: string; periods: number };
  testPeriod: string;
  metrics: ForecastHoldoutMetricError[];
}

export interface ForecastHoldoutSummary {
  available: boolean;
  reason?: string | undefined;
  folds: ForecastHoldoutFold[];
  aggregate: {
    metricMape: Partial<Record<ForecastHoldoutMetricError["metric"], number>>;
    weightedMape: number | null;
    status: "confirmed" | "degraded" | "failed" | "unavailable";
    confidencePenaltyPct: number;
    valuationRangeWideningPct: number;
  };
}
```

Important distinction:

- Existing `ValuationBacktestSummary` is price/signal replay.
- New `ForecastHoldoutSummary` is business-driver forecast accuracy.

Both are useful, but only the second fights valuation tautology.

### Market-implied expectation ledger

```ts
export interface MarketImpliedExpectationLedger {
  marketPrice: number | null;
  asOf: string | null;
  rows: Array<{
    key: "implied_growth" | "implied_rnoa" | "implied_fade" | "implied_cap" | "implied_terminal_roic";
    value: number | null;
    cap?: number | null | undefined;
    saturated: boolean;
    comparisonAnchor: number | null;
    gap: number | null;
    interpretation: "reasonable" | "optimistic" | "priced_for_perfection" | "model_saturated" | "unavailable";
  }>;
  intrinsicConfidenceEffect: "none";
  warning: string;
}
```

Contract:

- `intrinsicConfidenceEffect` must always be `"none"`.
- If any row is saturated, UI copy must say: "market expects more than the model can rationalize".

### Evidence-weighted synthesis

```ts
export interface EvidenceWeightedModelContribution {
  modelKey: string;
  label: string;
  independenceGroup: string;
  perShare: number | null;
  baseReliability: number;
  evidenceCoveragePenalty: number;
  forecastSkillPenalty: number;
  priceDerivedPenalty: number;
  finalWeight: number;
  includedInIntrinsicRange: boolean;
  reason: string;
}

export interface EvidenceWeightedValuationSynthesis {
  contributions: EvidenceWeightedModelContribution[];
  intrinsicRange: {
    lowPerShare: number | null;
    midPerShare: number | null;
    highPerShare: number | null;
    rangeWideningPct: number;
  };
  marketExpectationRange: {
    pricePerShare: number | null;
    requiredGrowth: number | null;
    requiredRnoa: number | null;
    saturated: boolean;
  };
  defensibility: {
    status: "confirmed" | "guarded" | "blocked";
    checklist: DefensibilityChecklistItem[];
    summary: string;
  };
}
```

Rules:

- Reverse DCF contribution weight for intrinsic range = `0`.
- Multiple Penman variants share one accrual independence group.
- Cash-flow DCF can count separately only if it uses cash-statement primitives and has positive normalized FCF.
- EV/EBITDA or peer market lens can challenge assumptions but should not dominate intrinsic range unless peer data quality is high.
- Missing sector-driver data should cap confidence, not invent values.

### Traceability schema extension

Add optional v19 field to `AnalysisTraceabilityEnvelope`:

```ts
antiTautology?: {
  evidenceLedgerRef: {
    hasLedger: boolean;
    assumptionCount: number;
    unsupportedCount: number;
    priceDerivedCount: number;
    checksum: string | null;
  };
  forecastHoldout: {
    available: boolean;
    status: "confirmed" | "degraded" | "failed" | "unavailable";
    weightedMape: number | null;
    valuationRangeWideningPct: number;
  };
  priceDerivedIsolation: {
    reverseDcfExcludedFromIntrinsicConfidence: boolean;
    priceDerivedAssumptionsUsedForIntrinsic: number;
  };
  paradigmIndependence: {
    independentLensCount: number;
    criticalDivergence: boolean;
  };
  sectorDriverCoverage: {
    status: "confirmed" | "partial" | "unavailable";
    driverCount: number;
    sourceUnavailableCount: number;
  };
};
```

Migration from v18 to v19 should add `antiTautology: null` for legacy envelopes. Do not destructively transform old envelopes.

## Step-by-step implementation plan

### Phase 0 — ADR and schema contract, no runtime behavior change

Objective: lock the design before code changes alter valuation confidence.

Files likely to change:

- Create: `docs/adr/010-anti-tautology-valuation-evidence.md`
- Modify: `docs/analysis-rigor-ladder.md`
- Modify: `docs/COMPREHENSIVE-VALUATION-DESIGN.md`

Tasks:

1. Write ADR-010 with these decisions:
   - price-derived expectations cannot improve intrinsic confidence;
   - every material valuation assumption needs an evidence row;
   - forecast holdout is separate from price/signal replay;
   - model independence is based on `independenceGroup`, not model count;
   - static peer/sector priors are versioned data files, not runtime fetches.
2. Update the rigor ladder follow-on section to name the new checkpoint:
   - `valuation-assumption-evidence`
   - `forecast-holdout-skill`
   - `price-derived-isolation`
3. Do not change UI or valuation calculations in this phase.

Tests / validation:

- No code tests required beyond `npm run typecheck` if only docs change.
- Ship gate: docs compile trivially; no app behavior changes.

### Phase 1 — Add valuation evidence ledger sidecar

Objective: produce a structured ledger from existing scenario assumptions without changing valuation outputs.

Files likely to change:

- Create: `src/engine/valuationEvidence/types.ts`
- Create: `src/engine/valuationEvidence/assumptionLedger.ts`
- Create: `src/engine/valuationEvidence/index.ts`
- Create: `src/engine/valuationEvidence/__tests__/assumptionLedger.spec.ts`
- Modify: `src/engine/valuationCommandCenter/types.ts`
- Modify: `src/engine/valuationCommandCenter/core.ts`

Implementation details:

1. Add `ValuationEvidenceLedger` and row types.
2. Build ledger rows from `ValuationScenarioCard.assumptions`:
   - `ke` -> source `user-override` or config-derived, confidence medium unless CAPM cross-check agrees.
   - `kw` -> source `reported-history` / `structural` via existing S-9.4C seam, confidence high when structural kw exists.
   - `g` / terminal growth -> source from `forecastPolicy.terminalAnchorSource` when available.
   - `salesGrowthYear1`, `corePmYear1`, `reinvestmentRateYear1`, `incrementalRoicYear1` -> source from historical clean-window evidence when available, otherwise sector template.
3. Mark all reverse-DCF implied values as `priceDerived: true` and `eligibleForIntrinsicConfidence: false`.
4. Add optional `evidenceLedger: ValuationEvidenceLedger` to `ValuationCommandCenterOutput`.
5. Keep existing scenario cards unchanged so current UI/tests do not break.

Acceptance tests:

- Ledger has rows for base scenario growth, margin, reinvestment, ke, kw, terminal growth.
- Any price-derived row has `eligibleForIntrinsicConfidence === false`.
- Unsupported assumptions increment `unsupportedCount`.
- No ledger row is emitted with non-finite numeric value.

Commands:

```bash
npm test -- src/engine/valuationEvidence/__tests__/assumptionLedger.spec.ts
npm run typecheck
```

Ship gate after Phase 1:

- App behavior unchanged except optional data is now available for inspection.
- Safe to deploy because no confidence gate has changed yet.

### Phase 2 — Build forecast holdout validator

Objective: test whether the forecast engine can predict known historical business outcomes.

Files likely to change:

- Create: `src/engine/valuationEvidence/forecastHoldout.ts`
- Create: `src/engine/valuationEvidence/__tests__/forecastHoldout.spec.ts`
- Modify: `src/engine/valuationCommandCenter/types.ts`
- Modify: `src/engine/valuationCommandCenter/core.ts`

Implementation details:

1. Do not reuse `valuationCommandCenter/backtest.ts` as-is. That module is price/signal replay.
2. Add rolling holdout folds over recast periods:
   - minimum total periods: 6;
   - minimum train periods: 4;
   - test one period ahead by default;
   - optional two/three-period horizon later, but not in first PR.
3. For each fold:
   - calibrate forecast assumptions only from train periods;
   - predict the next known period's sales, core margin, RNOA, CFO, capex, FCF_cash, CSE, NOA;
   - compare predicted vs actual.
4. Aggregate into `weightedMape` and status:
   - `confirmed`: enough folds and weighted MAPE below threshold;
   - `degraded`: enough folds but moderate errors;
   - `failed`: enough folds and large errors;
   - `unavailable`: not enough periods or missing required metrics.
5. Use thresholds as policy constants, not magic UI literals. Initial suggested policy:
   - warning/degraded: weighted MAPE >= 15%;
   - failed: weighted MAPE >= 30%;
   - capex/FCF can use wider thresholds because expansion cycles are noisier.
6. Output `valuationRangeWideningPct` from forecast skill:
   - confirmed: 0-5%;
   - degraded: 10-20%;
   - failed: 25-40%;
   - unavailable: 15% cap/penalty unless data depth itself is too thin.

Acceptance tests:

- A smooth synthetic series produces `confirmed` and low/no range widening.
- A noisy series with wrong capex/FCF predictions produces `degraded` or `failed`.
- A 4-period series returns `unavailable` with a clear reason, not fake confidence.
- Errors are computed against actual known historical outcomes, not against the forecast's own assumptions.

Commands:

```bash
npm test -- src/engine/valuationEvidence/__tests__/forecastHoldout.spec.ts
npm run typecheck
```

Ship gate after Phase 2:

- Holdout result is computed and exposed but does not yet block valuation eligibility.
- Safe to deploy as diagnostic-only.

### Phase 3 — Market-implied expectation quarantine

Objective: make the reverse-DCF output explicitly diagnostic-only.

Files likely to change:

- Create: `src/engine/valuationEvidence/marketImpliedLedger.ts`
- Create: `src/engine/valuationEvidence/__tests__/marketImpliedLedger.spec.ts`
- Modify: `src/engine/reverseDCF.ts` only if existing diagnostics need a missing saturation field surfaced through command center.
- Modify: `src/engine/valuationCommandCenter/helpers.ts`
- Modify: `src/engine/valuationCommandCenter/types.ts`
- Modify: `src/engine/valuationCommandCenter/core.ts`

Implementation details:

1. Convert current `ReverseDcfDiagnostics` into a `MarketImpliedExpectationLedger` sidecar.
2. Preserve current reverse-DCF output and UI behavior for backward compatibility.
3. Add explicit invariant:
   - `intrinsicConfidenceEffect: "none"`.
4. If saturation occurs:
   - narrative: "Current price implies expectations beyond model caps; these are bounded diagnostics, not forecasts."
5. Ensure opportunity scoring cannot interpret optimistic price-derived assumptions as support for intrinsic value.
   - Price pessimism may identify opportunity, but only if independent intrinsic/stress cases already support it.
   - Price optimism/saturation should reduce defensibility or stay as warning.

Acceptance tests:

- Saturated reverse DCF produces `model_saturated` rows.
- Market-implied rows are always `priceDerived: true` in the assumption ledger.
- Reverse DCF cannot increase `highConfidenceCount` in the evidence ledger.
- Intrinsic confidence remains unchanged or lower when only market-implied assumptions are available.

Commands:

```bash
npm test -- src/engine/valuationEvidence/__tests__/marketImpliedLedger.spec.ts
npm test -- src/engine/__tests__/valuationCommandCenter.spec.ts
npm run typecheck
```

Ship gate after Phase 3:

- DMART-like saturated reverse-DCF story becomes cleaner: "market prices perfection" without converting it into a fair-value proof.

### Phase 4 — Evidence-weighted valuation synthesis

Objective: produce a range that weights models by independent evidence quality rather than model count.

Files likely to change:

- Create: `src/engine/valuationEvidence/evidenceWeightedSynthesis.ts`
- Create: `src/engine/valuationEvidence/__tests__/evidenceWeightedSynthesis.spec.ts`
- Modify: `src/engine/valuationTriangulation.ts`
- Modify: `src/engine/reconciliationResiduals.ts`
- Modify: `src/engine/valuationCommandCenter/types.ts`
- Modify: `src/engine/valuationCommandCenter/core.ts`

Implementation details:

1. Extend `ValuationTriangulationMethod` with optional metadata:
   - `independenceGroup`
   - `sourceType`
   - `eligibleForIntrinsicRange`
   - `reason`
2. Keep current `perShare` fields for compatibility.
3. Add `EvidenceWeightedModelContribution` for:
   - accrual RIV/ReOI group;
   - cash-statement FCFF DCF;
   - relative EV/EBITDA;
   - SOTP if applicable;
   - sector-native driver model if available later;
   - reverse DCF as `includedInIntrinsicRange: false`.
4. Calculate range using included models only.
5. Apply penalties from:
   - missing assumption support;
   - forecast holdout failure;
   - same-independence-group duplication;
   - critical triangulation divergence;
   - stale or unavailable market inputs.
6. Do not replace existing scenario cards immediately. Add a new `evidenceWeightedSynthesis` field first.

Acceptance tests:

- Multiple Penman variants do not count as multiple independent models.
- Reverse DCF receives zero intrinsic weight.
- Cash DCF and accrual lens disagreement above critical threshold marks defensibility guarded/blocked.
- A high-error forecast holdout widens the intrinsic range.
- If only one intrinsic lens exists, the range is available but confidence is capped.

Commands:

```bash
npm test -- src/engine/valuationEvidence/__tests__/evidenceWeightedSynthesis.spec.ts
npm test -- src/engine/__tests__/analysisTraceability.spec.ts
npm run typecheck
```

Ship gate after Phase 4:

- Command center can show an evidence-weighted range while preserving old range as fallback.
- Rigor gate begins using stronger evidence but must remain additive and explainable.

### Phase 5 — Traceability v19 anti-tautology gate

Objective: wire the new evidence into the shared trust envelope.

Files likely to change:

- Modify: `src/engine/policyVersions.ts`
- Modify: `src/lib/envelopeMigrations.ts`
- Modify: `src/engine/analysisTraceability.ts`
- Modify: `src/engine/types/traceability.ts` or wherever `AnalysisTraceabilityEnvelope` is defined.
- Modify: `src/lib/auditSnapshot.ts`
- Modify: `src/engine/excelExport.ts` if workbook exports traceability.
- Create/modify tests around migrations and traceability summaries.

Implementation details:

1. Bump `TRACEABILITY_SCHEMA_VERSION` from `2026-06-traceability-v18` to `2026-06-traceability-v19`.
2. Add migration:
   - v18 -> v19 with `antiTautology: null`.
3. Add `antiTautology` summary into `buildAnalysisTraceability`.
4. Rigor behavior:
   - `valuation-eligible` requires price-derived assumptions not used as intrinsic evidence.
   - `production-ready` requires enough evidence or a clear `guarded` cap.
   - forecast holdout `failed` should cap at `economically-plausible` or `valuation-eligible` depending on severity; do not immediately overblock in first release without tests.
   - critical cross-paradigm divergence remains fail-closed as it does today.
5. Preserve monotonic ladder behavior: production-ready cannot bypass failed lower checks.

Acceptance tests:

- Legacy v18 envelope migrates to v19 with `antiTautology: null` and `synthetic-clean` stamp if migration applied.
- Price-derived assumption misuse blocks `valuation-eligible`.
- Forecast holdout failure downgrades confidence and/or widens range.
- Existing parser/reconciliation/concept-identity blockers still win.

Commands:

```bash
npm test -- src/lib/__tests__/envelopeMigrations.spec.ts
npm test -- src/engine/__tests__/analysisTraceability.spec.ts
npm test -- src/engine/__tests__/valuationTraceabilitySummary.spec.ts
npm run typecheck
```

Ship gate after Phase 5:

- Anti-tautology evidence is part of the same shared trust envelope consumed across surfaces.
- Safe to deploy if all existing trust envelope tests are green.

### Phase 6 — UI: defensibility panel in Valuation Report / Command Center

Objective: make the anti-tautology evidence visible and understandable.

Files likely to change:

- Modify: `src/components/ValuationReport.tsx`
- Modify: `src/components/valuation/ValuationCommandCenterHero.tsx`
- Create: `src/components/valuation/ValuationEvidenceLedgerPanel.tsx`
- Create: `src/components/valuation/ForecastHoldoutPanel.tsx`
- Create: `src/components/valuation/MarketImpliedExpectationsPanel.tsx`
- Modify/create component tests under `src/components/__tests__/`.

UI sections:

1. **Defensibility Checklist**
   - Assumptions independently sourced: yes/no.
   - Forecast holdout skill: confirmed/degraded/failed/unavailable.
   - Terminal assumptions inside historical/peer bounds: yes/no.
   - Price-derived inputs excluded from intrinsic confidence: yes/no.
   - Independent lens count: N.
   - Sector driver model available: yes/no.
   - Valuation range widened for weak evidence: yes/no.

2. **Assumption Evidence Ledger**
   - Row table with assumption, value, source, confidence, price-derived flag, defensible range.

3. **Market-Implied Expectations**
   - Current price requires X growth / Y RNOA / Z fade.
   - Saturation banner if relevant.
   - Explicit copy: "This explains market expectations; it does not validate intrinsic value."

4. **Forecast Skill**
   - Holdout error table.
   - Range-widening effect.

Styling:

- Follow user preference for good light-mode contrast.
- If using teal/dark advanced-panel theme, pair dark text colors with light equivalents, e.g. `text-slate-800 dark:text-slate-200`.

Acceptance tests:

- Panel renders even when evidence ledger is unavailable.
- Price-derived reverse DCF is labeled diagnostic-only.
- Forecast holdout unavailable displays reason, not blank cells.
- Existing ValuationReport DOM/test contracts are preserved unless explicitly updated.

Commands:

```bash
npm test -- src/components/__tests__/ValuationReport.spec.tsx
npm run typecheck
```

Ship gate after Phase 6:

- Users can see why valuation is defensible or guarded without opening dev tools.

### Phase 7 — Retail / DMART sector-native operational driver layer

Objective: give DMART-like retail valuations a non-tautological operating reality check.

Files likely to change:

- Create: `src/engine/sectorDrivers/types.ts`
- Create: `src/engine/sectorDrivers/retailUnitEconomics.ts`
- Create: `src/engine/sectorDrivers/__tests__/retailUnitEconomics.spec.ts`
- Modify: `src/engine/valuationSectorTemplates.ts`
- Modify: `src/engine/valuationCommandCenter/core.ts`
- Optional real-data sidecar: `public/data/companies/DMART/operational-drivers.json` only if sourced data exists and user approves/source is explicit.

Driver model fields:

- store count
- new stores opened
- revenue per store
- same-store sales growth
- store ramp period
- gross margin
- operating cost per store
- capex per store
- lease liability per store
- inventory turns / working capital cycle
- store-level ROIC

Implementation details:

1. Detect retail/consumer template from explicit `company_type` / sector template.
2. If operational driver sidecar exists:
   - compute unit-economics reality check;
   - compare market-implied growth against required store runway;
   - emit evidence rows with `sourceType: "operational-driver-sidecar"`.
3. If sidecar is absent:
   - emit `source_unavailable` rows;
   - cap confidence for retail unit-economics claims;
   - do not fabricate store counts or capex/store.
4. For DMART copy:
   - "At current price, the market requires X-store / Y revenue-store / Z margin path" only when data exists.
   - Otherwise: "Retail driver model unavailable because store-level sidecar is missing. Intrinsic confidence remains based on accounting/cash/peer evidence only."

Acceptance tests:

- With complete driver sidecar, the retail model computes store-level metrics and evidence rows.
- With missing sidecar, no fake values are emitted and confidence is capped.
- DMART-like expansion capex negative FCF is labeled reinvestment burden, not distress.

Commands:

```bash
npm test -- src/engine/sectorDrivers/__tests__/retailUnitEconomics.spec.ts
npm run typecheck
```

Ship gate after Phase 7:

- DMART has a path to operationally grounded valuation when real store data is available.

### Phase 8 — Static peer / sector calibration

Objective: let external market/sector evidence challenge assumptions without becoming a lazy multiple average.

Files likely to change:

- Create: `src/engine/valuationEvidence/peerCalibration.ts`
- Create: `src/engine/valuationEvidence/__tests__/peerCalibration.spec.ts`
- Create: `src/engine/valuation/data/peer-calibration/india-retail-2026-01.json`
- Create: `src/engine/valuation/data/sector-priors/india-retail-2026-01.json`
- Modify: `src/engine/valuationCommandCenter/core.ts`

Implementation details:

1. Static peer file schema:
   - version
   - sector template
   - peer names/tickers
   - period/date
   - metric percentiles for growth, margin, ROIC/RNOA, EV/Sales, EV/EBITDA, P/E, P/B
   - source notes
2. Calibration checks:
   - forecast revenue growth vs peer percentiles;
   - terminal margin vs mature peer margin;
   - assumed RNOA/ROIC vs peer distribution;
   - market-implied multiple vs peer extremes;
   - reinvestment and capex intensity vs sector ranges.
3. Peer data should challenge assumptions, not auto-set them.
4. If peer file is stale or missing, emit `source_unavailable` / stale warning.

Acceptance tests:

- Assumption above 90th percentile is flagged as aggressive.
- Peer data can downgrade confidence but cannot by itself validate a stretched intrinsic value.
- Missing peer data does not crash valuation.

Commands:

```bash
npm test -- src/engine/valuationEvidence/__tests__/peerCalibration.spec.ts
npm run typecheck
```

Ship gate after Phase 8:

- Terminal assumptions and market-implied expectations are externally benchmarked.

## Files likely to change summary

Core engine:

- `src/engine/valuationCommandCenter/core.ts`
- `src/engine/valuationCommandCenter/types.ts`
- `src/engine/valuationCommandCenter/helpers.ts`
- `src/engine/valuationTriangulation.ts`
- `src/engine/reconciliationResiduals.ts`
- `src/engine/analysisTraceability.ts`
- `src/engine/policyVersions.ts`
- `src/lib/envelopeMigrations.ts`
- `src/lib/auditSnapshot.ts`
- `src/engine/excelExport.ts`

New engine folders:

- `src/engine/valuationEvidence/*`
- `src/engine/sectorDrivers/*`

UI:

- `src/components/ValuationReport.tsx`
- `src/components/valuation/ValuationCommandCenterHero.tsx`
- `src/components/valuation/ValuationEvidenceLedgerPanel.tsx`
- `src/components/valuation/ForecastHoldoutPanel.tsx`
- `src/components/valuation/MarketImpliedExpectationsPanel.tsx`

Docs:

- `docs/adr/010-anti-tautology-valuation-evidence.md`
- `docs/analysis-rigor-ladder.md`
- `docs/COMPREHENSIVE-VALUATION-DESIGN.md`

Data, only if sourced:

- `src/engine/valuation/data/peer-calibration/*.json`
- `src/engine/valuation/data/sector-priors/*.json`
- `public/data/companies/<company>/operational-drivers.json`

## Validation plan

Run focused tests as each phase lands, then full validation at the end.

Focused commands:

```bash
npm test -- src/engine/valuationEvidence/__tests__/assumptionLedger.spec.ts
npm test -- src/engine/valuationEvidence/__tests__/forecastHoldout.spec.ts
npm test -- src/engine/valuationEvidence/__tests__/marketImpliedLedger.spec.ts
npm test -- src/engine/valuationEvidence/__tests__/evidenceWeightedSynthesis.spec.ts
npm test -- src/engine/valuationEvidence/__tests__/peerCalibration.spec.ts
npm test -- src/engine/sectorDrivers/__tests__/retailUnitEconomics.spec.ts
npm test -- src/engine/__tests__/analysisTraceability.spec.ts
npm test -- src/engine/__tests__/valuationCommandCenter.spec.ts
npm test -- src/components/__tests__/ValuationReport.spec.tsx
npm run typecheck
```

Final release gate:

```bash
npm run validate
```

Expected final proof points:

- TypeScript compiles with no unused imports / Set iteration / DOMPurify config mistakes.
- Existing valuation report tests still pass.
- Traceability migration tests pass for v18 -> v19.
- A fixture with reverse-DCF saturation proves price-derived assumptions cannot raise intrinsic confidence.
- A noisy forecast-holdout fixture widens valuation range.
- A DMART-shaped fixture keeps overvaluation / saturation / negative expansion FCF warnings but avoids current-distress wording when solvency evidence is healthy.

## Risks, tradeoffs, and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Big-bang schema/UI change breaks app | Valuation command center is already broad | Ship ledger diagnostic first, then holdout, then gates, then UI |
| Forecast holdout over-penalizes expansion companies | Retail capex cycles make FCF noisy | Metric-specific thresholds; separate revenue/margin/RNOA skill from capex/FCF skill |
| Peer data becomes stale or fabricated | User explicitly does not want fake economic data | Static versioned source files only; `source_unavailable` when missing |
| Reverse DCF opportunity scoring currently uses market-implied pessimism | Useful for finding cheap stocks, but can blur intrinsic support | Keep as opportunity diagnostic; never count as intrinsic evidence |
| Too many fields bloat traceability envelope | Existing architecture uses sidecars for lineage | Put detailed ledger in command center/audit snapshot sidecar; envelope stores summary/ref |
| UI becomes too complex | Users need clarity, not another table dump | Add a compact defensibility checklist first, collapsible ledger second |
| Model disagreement blocks too aggressively | Divergence can be legitimate in transition years | Attach reason codes and keep guarded outputs informative; fail closed only above thresholds |
| Store-level data may not exist | DMART operational driver model needs real data | Sidecar optional; absence is explicit and lowers confidence |

## Open questions

1. Should forecast holdout failure cap at `economically-plausible` immediately, or first only widen range and cap `production-ready`?
   - Recommendation: first release caps `production-ready`, not all valuation eligibility, unless the error is critical and unexplained.
2. What exact peer universe should be used for DMART retail calibration?
   - Do not guess. Use a sourced static file or leave unavailable.
3. Should operational driver sidecars live under `public/data/companies/<id>/` or `src/engine/valuation/data/company-drivers/`?
   - Recommendation: company-specific sourced data under `public/data/companies/<id>/` if user wants data changes decoupled from code.
4. Should evidence-weighted range replace existing `range` immediately?
   - Recommendation: expose as `evidenceWeightedSynthesis` first; replace headline only after UI/test review.
5. Should v19 anti-tautology gate be a hard blocker for `valuation-eligible`?
   - Recommendation: hard-block only price-derived contamination and critical lens divergence; degrade/widen for missing/weak holdout evidence.

## Iteration Log

| Iteration | Assumptions tested | Gaps found | Plan change |
|---|---|---|---|
| v1 | Assumed current command center had no backtesting or independent lens support. Verified files show `valuationCommandCenter/backtest.ts`, `cashFlowDcf.ts`, and lightweight `valuationTriangulation.ts` already exist. | Existing backtest is price/signal replay, not forecast-skill holdout. Existing triangulation is per-share only, not assumption provenance. | Reframed plan to build on existing backtest/triangulation instead of replacing them. Added separate `ForecastHoldoutSummary`. |
| v2 | Assumed reverse DCF saturation already exists. Verified `reverseDCF.ts` has saturation flags/narrative and command center has `ReverseDcfDiagnostics`. | The missing part is not solver behavior; it is quarantine from intrinsic confidence and UI copy. | Added `MarketImpliedExpectationLedger` with invariant `intrinsicConfidenceEffect: "none"`. |
| v3 | Assumed traceability schema can be bumped safely. Verified `policyVersions.ts` v18 and `envelopeMigrations.ts` migration chain. | Detailed evidence ledger could bloat persisted envelopes. | Added v19 envelope summary/ref only; detailed ledger remains sidecar/command-center payload. |
| v4 | Assumed DMART fix should be part of valuation evidence plan. Verified greenfield pipeline and Indian retail lease caveat are relevant. | Distress false-positive fix and anti-tautology valuation are related but separable. | Kept DMART as acceptance/narrative target; did not merge all distress implementation details into this plan. |
| v5 | Stress-tested runtime/static data risk. | Peer/store data cannot be guessed or fetched casually. | Added static sidecar/source-unavailable rule and non-goal against fabricated data. |
| v6 | Stress-tested big-bang risk and test contracts. | A single PR touching schema, command center, UI, peer data, and sector drivers would be risky. | Split into eight deployable phases with ship gates after each. |

## Final acceptance criteria

The feature is successful when a skeptical reviewer can open a valuation run and answer these questions without trusting circular model prose:

1. What assumptions drive the value?
2. What independent evidence supports each assumption?
3. Which assumptions are price-derived and therefore excluded from intrinsic confidence?
4. Did the forecast method demonstrate any out-of-sample skill on known historical periods?
5. Do accrual, cash, market/relative, and sector-native lenses agree or diverge?
6. If they diverge, did the app downgrade confidence instead of averaging away the conflict?
7. For DMART, does the app say the true story: great business, heavy expansion, market prices perfection, not current financial distress?

## Recommended next implementation PR

Start with Phase 1:

> `feat(valuation): add assumption evidence ledger`

Why first:

- It directly addresses tautology.
- It is diagnostic-only and low-risk.
- It creates the data contract needed for holdout, traceability, UI, and peer calibration.
- It can be tested without changing existing valuation outputs.
