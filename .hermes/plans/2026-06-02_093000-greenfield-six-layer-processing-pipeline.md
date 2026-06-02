# Plan: Greenfield 6-Layer Processing Pipeline for DMART/Accounting-Artifact Corrections

## Goal

Integrate the prior DMART distress-false-positive plan into a greenfield, reviewer-grade processing pipeline with six explicit layers:

1. L1 Ingestion & Normalisation
2. L2 Detection — 12 parallel pure detectors
3. L3 Classification & Triage
4. L4 Adjustment Pipeline
5. L5 Validation & Reconciliation
6. L6 Confidence Re-scoring

The pipeline must preserve the reliable DMART signals while eliminating misleading insolvency language:

- Preserve: overvaluation / margin-of-safety signal, reverse-DCF saturation, negative expansion FCF, and structural-break / dirty-surplus flags.
- Correct: DMART-like historical negative-equity / lease-accounting artifacts must not become `financial distress`, `avoid`, `negative net worth`, or equity-model blocking when latest CSE/CFO/market evidence is healthy.
- Make every adjustment reversible, field-level audited, validation-gated, and available as both as-reported and adjusted outputs.

## Current context / empirical validation

Validated in `C:/Users/rajesh/WindsurfAPI/penman-v2-analysis` on 2026-06-02 09:28 IST.

### Repository state

- Branch: `main...origin/main`.
- Existing plan being integrated:
  - `.hermes/plans/2026-06-02_092137-dmart-distress-lease-adjusted-valuation.md`
- Working tree has unrelated untracked files. Do not clean them up in this task.
- Release blocker remains:
  - `src/engine/__tests__/__tmp_dmart_crosscheck.spec.ts` is untracked but inside `src/engine/__tests__/`, so TypeScript sees it.
  - `npm run typecheck` currently fails only on that scratch test's bad property/type references.

Typecheck result revalidated:

```text
npm run typecheck
exit 2
src/engine/__tests__/__tmp_dmart_crosscheck.spec.ts(74,83): error TS2339: Property 'statement' does not exist ...
src/engine/__tests__/__tmp_dmart_crosscheck.spec.ts(79,126): error TS2339: Property 'PBT' does not exist on type 'CanonicalIncome'.
src/engine/__tests__/__tmp_dmart_crosscheck.spec.ts(80,92): error TS2339: Property 'TotalAssets' does not exist on type 'CanonicalBalanceSheet'.
src/engine/__tests__/__tmp_dmart_crosscheck.spec.ts(114,193): error TS7006: Parameter 's' implicitly has an 'any' type.
```

### Existing architecture found by inspection

- Current main pipeline: `src/engine/pipeline.ts`.
  - Sorts/excludes periods.
  - Routes financial institutions to `processBankData`.
  - Computes `RecastPeriod[]` through `computeRecastPeriod`, `computeRatios`, residual income, and quality.
  - Runs current anomaly detection after recast.
  - Attaches `SpecFlag[]` to periods.
  - Runs distress, loss-maker, IT-services, cyclicality, ratio sanity, and frequency warnings.
- Current anomaly pipeline: `src/engine/anomalyDetection/pipeline.ts`.
  - Has 6 detector families: dirty surplus, dividend discrepancy, metric step changes, component disappearance, reclassification, payout anomaly.
  - Output is `AnomalyBundle` and `SpecFlag[]`.
  - It does not have `AnomalySignal`, `p_artifact`, parallel detector isolation, triage dependency graph, or adjustment DAG.
- Current flags: `src/engine/types/quality.ts`.
  - `SpecFlag` has `spec_id`, `severity`, `label`, `message`, `affects_terminal`, `period`.
  - Severity is `INFO=1`, `WARNING=2`, `CRITICAL=3`.
  - There is no probability-weighted artifact score.
- Current recast shape: `src/engine/types/recast.ts`.
  - `CanonicalBalanceSheet` already exposes `OA_ROU`, but not lease liabilities / ex-lease financial debt / lease-adjusted equity.
  - `RecastPeriod` preserves `trace`, `spec_flags`, `recastDebug`, and structural `kw` fields.
- Current reconciliation / rigor layer:
  - `src/engine/reconciliationResiduals.ts` performs de-tautologized statement checks against raw evidence.
  - `src/engine/analysisTraceability.ts` builds the shared trust envelope and currently treats severe/critical distress as valuation-blocking.
  - `docs/analysis-rigor-ladder.md` states traceability schema is currently around v18 and consumed across reports.
- Current ratio validation support exists:
  - `src/engine/PenmanNissimEngine/ratiosResidual.ts` already computes Eq.16 residuals including `RNOA - PM * ATO`.
  - `src/engine/identityTests.ts` includes `A8` style RNOA decomposition assertions.

### Prior DMART facts to preserve

From `C:/Users/rajesh/AppData/Local/Temp/dmart_crosscheck.json` inspected in the prior plan:

- 14 parsed periods.
- Structural breaks without exclusions: `2016-03-31`, `2017-03-31`, `2020-03-31`.
- FY2025:
  - Revenue: ₹59,358.05 Cr.
  - Revenue growth: 16.87%.
  - Raw equity: ₹21,426.7 Cr.
  - Recast CSE: ₹21,427.75 Cr.
  - CFO: ₹2,462.97 Cr.
  - Capex: ₹3,423.04 Cr.
  - FCF_cash: `-₹960.07 Cr`.
  - NFO: `-₹53.02 Cr`, i.e. net cash, not debt stress.
- Therefore current DMART solvency is not distress. Any negative-equity signal must be historical/pre-break/accounting-artifact unless fresh data proves otherwise.

## Design stance

This is a greenfield pipeline design, but it should be integrated incrementally as a sidecar first, not as a big-bang replacement of `src/engine/pipeline.ts`.

Reasons:

- Current UI, tests, and persisted traceability envelopes depend on `RecastPeriod`, `SpecFlag`, `AnalysisTraceabilityEnvelope`, and `PipelineResult` shapes.
- A sidecar lets the executor prove the six-layer contract with focused tests before switching valuation/report surfaces.
- No new dependency is justified. All layers can be implemented in TypeScript with existing engine types.

Implementation folder:

```text
src/engine/greenfieldPipeline/
  types.ts
  l1Normalize.ts
  detectors/
  triage.ts
  adjusters/
  validateAdjustments.ts
  confidence.ts
  runGreenfieldPipeline.ts
  adapters.ts
```

The greenfield result should be bridged into the current pipeline through additive fields first:

```ts
interface PipelineResult {
  // existing fields remain
  greenfield?: GreenfieldPipelineResult | undefined;
}
```

Only after tests pass should selected outputs replace current distress / structural-break / confidence behaviors.

## Core data contracts

### Money/unit policy

The user-specified greenfield normalized layer should standardize Cr to absolute rupees (`₹`) before detection.

However, current engine math uses INR-crore amounts and crore-shares in many places. To avoid unit regressions:

- L1 normalized schema stores explicit absolute INR values.
- A compatibility adapter converts normalized values back to existing `INRCrore` / crore-based `RecastPeriod` until full unit migration is complete.
- Tests must assert both directions:
  - `3423.04 Cr -> 34,230,400,000 INR`.
  - `34,230,400,000 INR -> 3423.04 Cr` for legacy valuation adapters.
- Share counts must also be explicit:
  - normalized canonical count: absolute shares.
  - legacy adapter: crore-shares, matching current project convention.

### `NormalizedPeriod`

New file: `src/engine/greenfieldPipeline/types.ts`

```ts
type AccountingStandard = "ind-as" | "ifrs" | "gaap" | "revised-sch-vi" | "unknown";
type SeverityLevel = "INFO" | "WARNING" | "BLOCKING" | "CRITICAL";

type MoneyINR = number;
type PercentFraction = number;

interface NormalizedPeriod {
  companyId: string;
  periodEnd: string;
  periodStart?: string | null;
  isPartialPeriod: boolean;
  periodLengthDays: number | null;

  accountingStandard: AccountingStandard;
  standardAdoptions: {
    indAS109: boolean;
    indAS115: boolean;
    indAS116: boolean;
    adoptionDateEvidence: Record<string, string | null>;
  };

  industry: {
    companyType: CompanyType | "auto";
    inferredIndustry: string | null;
    confidence: "explicit" | "inferred" | "unknown";
  };

  values: {
    // canonical fields in absolute INR, not Cr
    revenue: MoneyINR | null;
    cse: MoneyINR | null;
    totalAssets: MoneyINR | null;
    cfo: MoneyINR | null;
    capex: MoneyINR | null;
    fcfCash: MoneyINR | null;
    leaseLiabilities: MoneyINR | null;
    rightOfUseAssets: MoneyINR | null;
    financialDebtExLease: MoneyINR | null;
    dividendsPaid: MoneyINR | null;
    equityIssued: MoneyINR | null;
    buybacks: MoneyINR | null;
    netIncome: MoneyINR | null;
  };

  derived: {
    rnoa: PercentFraction | null;
    flev: number | null;
    pm: PercentFraction | null;
    ato: number | null;
    dirtySurplusSeed: MoneyINR | null; // Δequity − (NI − div + iss − buyback)
  };

  lineage: NormalizedFieldLineage[];
  asReportedRecast?: RecastPeriod | undefined; // compatibility bridge
}
```

### `AnomalySignal`

```ts
interface AnomalySignal {
  detectorId: DetectorId;
  period: string;
  severity: SeverityLevel;
  p_artifact: number; // 0..1. High = likely accounting mechanics; low = real/economic signal.
  label: string;
  message: string;
  affectedFields: string[];
  evidence: Record<string, number | string | boolean | null>;
  suggestedAdjusters: AdjusterId[];
  suppresses?: Array<{ detectorId: DetectorId; period: string; reason: string }>;
  blocksValuation?: boolean;
  blocksAdjustment?: boolean;
}
```

Rules:

- Detectors are pure functions.
- Detectors never mutate periods.
- Detectors never suppress each other directly; they only emit `suppresses` candidates that L3 resolves.
- Every signal must carry `p_artifact`.
- Existing `SpecFlag` gets an adapter from `AnomalySignal`, but `AnomalySignal` becomes the richer internal contract.

### `AdjustmentAuditEntry`

```ts
interface AdjustmentAuditEntry {
  adjusterId: AdjusterId;
  field: string;
  period: string;
  before: number | string | boolean | null;
  after: number | string | boolean | null;
  delta: number | null;
  reason: string;
  driven_by: Array<{ detectorId: DetectorId; signalId: string }>;
  validationStatus: "pending" | "accepted" | "rejected";
  rejectedBy?: string[];
}
```

### `GreenfieldPipelineResult`

```ts
interface GreenfieldPipelineResult {
  asReported: NormalizedPeriod[];
  adjusted: NormalizedPeriod[];
  signals: AnomalySignal[];
  triage: TriageResult;
  auditTrail: AdjustmentAuditEntry[];
  validation: AdjustmentValidationReport;
  confidence: {
    asReported: ConfidenceScore;
    adjusted: ConfidenceScore;
  };
}
```

## L1 — Ingestion & Normalisation

### Responsibilities

L1 standardizes raw financial data before any detector runs.

Inputs:

- `RawPeriodData[]` from Capitaline / Screener / JSON / XBRL / manual loaders.
- Current `EngineConfig`.
- Optional parser diagnostics.
- Existing recast output if already computed by legacy path.

Outputs:

- `NormalizedPeriod[]` with absolute INR values, period metadata, accounting-standard tags, industry enrichment, and precomputed ratios.

### Required operations

1. Unit normalization:
   - Convert Cr to absolute INR at normalized-layer boundary.
   - Preserve original unit in lineage.
   - Add tests for INR/crore conversion and share-count conversion.
2. Standard tagging:
   - Tag periods as Ind AS / IFRS / GAAP / Revised Schedule VI / Unknown.
   - Use existing `computeAccountingStandardCoverage` logic in `analysisTraceability.ts` as reference, but implement L1 as a standalone pure helper.
3. Adoption-date flagging:
   - Ind AS 116 default adoption date: `2019-04-01`.
   - Also flag Ind AS 115 and 109 adoption windows where evidence exists.
   - Default dates are metadata, not proof; signal confidence should degrade if source evidence is absent.
4. Period alignment:
   - Sort periods.
   - Detect partial periods using date gaps / period length.
   - Preserve partial-period flag so detectors can downgrade or skip growth/step-change assumptions.
5. Derived ratio pre-computation:
   - RNOA.
   - FLEV.
   - PM.
   - ATO.
   - Dirty surplus seed: `Δequity − (NI − div + iss − buyback)`.
6. Industry enrichment:
   - Prefer explicit `config.company_type` dropdown.
   - Use existing scope/industry detectors only as fallback.
   - This respects the user's preference for explicit declaration over auto-detection.

### Files

- `src/engine/greenfieldPipeline/l1Normalize.ts`
- `src/engine/greenfieldPipeline/types.ts`
- `src/engine/greenfieldPipeline/adapters.ts`
- Optional helper reuse from:
  - `src/engine/analysisTraceability.ts`
  - `src/engine/scopePolicy.ts`
  - `src/engine/PenmanNissimEngine/recast.ts`

### L1 tests

- `src/engine/__tests__/greenfieldPipeline.l1Normalize.spec.ts`
  - Unit conversion Cr -> INR and INR -> legacy Cr adapter.
  - Period sorting and partial-period flagging.
  - Ind AS 116 default adoption after `2019-04-01`.
  - Dirty surplus seed includes dividends, equity issuance, and buybacks.
  - Explicit `company_type` overrides fallback inference.

## L2 — Detection: 12 parallel pure detectors

### Rules

- All 12 detectors fire independently.
- No detector can read another detector's output.
- No detector mutates periods.
- Each detector returns `AnomalySignal[]` or `null`.
- Each signal carries `p_artifact` and severity.
- Detectors can propose suppressions, but L3 applies them.

### Detector catalogue

| ID | Detector | Purpose | Typical p_artifact | Suggested adjuster |
| --- | --- | --- | --- | --- |
| D1 | StandardAdoptionDetector | Flags Ind AS 116/115/109 adoption windows and accounting-regime transitions. | 0.80-0.95 when date/evidence matches | A1, A3 |
| D2 | DirtySurplusDetector | Flags dirty surplus seed / clean-surplus residual spikes. | 0.40-0.90 depending evidence | A2, A3, A4 |
| D3 | LeaseAccountingDetector | Identifies lease-liability / ROU-asset distortions, especially retail post-Ind AS 116. | 0.75-0.95 with explicit lease lines | A1 |
| D4 | FxOciTranslationDetector | Detects OCI/FX translation that explains dirty surplus in same period. Can suppress D2 for same period. | 0.80-0.95 | A2 |
| D5 | NegativeEquitySolvencyDetector | Separates current negative-equity distress from historical/pre-break accounting artifacts. | Low for current CFO-negative stress; high for historical/pre-break/lease cases | A1, A3 |
| D6 | StructuralBreakDemergerDetector | Flags demerger/scheme/reclassification windows; supports post-break truncation. | 0.65-0.95 | A3 |
| D7 | BuybackCapitalReturnDetector | Detects buybacks/capital returns that distort CSE and clean surplus. | 0.70-0.95 with buyback line evidence | A4, A2 |
| D8 | ComponentReclassificationDetector | Replaces/extends current S-5.4/S-5.5 OA/FA/FO/OL movement checks. | 0.55-0.90 | A2, A3 |
| D9 | MetricStepChangeDetector | PM/RNOA/ROCE/FLEV/ATO step changes and reasonability outliers. | 0.30-0.85 | A3 or warning only |
| D10 | ExpansionCapexFcfDetector | Detects negative FCF caused by growth capex vs operating cash weakness. | High artifact/accounting? No: this is usually real business signal, p_artifact low-to-medium. | none; FCF never adjusted |
| D11 | FreshnessFrequencyDetector | Flags stale financials, mixed frequency, partial periods. | 0.70 for data-timing artifact | none; confidence cap |
| D12 | MarketExpectationSaturationDetector | Captures overvaluation/MoS and reverse-DCF solver saturation as real valuation signals. | 0.00-0.20 | none; never adjusted away |

### Important detector semantics

#### D2 DirtySurplusDetector

- Calculates from L1 seed:
  - `Δequity − (NI − div + iss − buyback)`.
- Emits high severity when residual breaches threshold.
- Does not decide whether it is real or artifact.
- `p_artifact` rises when:
  - period aligns with Ind AS adoption window;
  - D4 evidence would explain OCI/FX translation;
  - D6 structural break evidence exists;
  - D7 buyback/capital return evidence exists.
- D2 itself does not consume D4/D6/D7; L3 triage performs that resolution.

#### D4 FxOciTranslationDetector

- Emits evidence when OCI / FX translation reserve movement explains most of dirty surplus.
- It proposes:

```ts
suppresses: [{ detectorId: "D2", period, reason: "OCI/FX translation explains dirty surplus residual" }]
```

- L3 can then suppress or downgrade D2 for that same period.

#### D5 NegativeEquitySolvencyDetector

- Must split:
  - `currentSolvencySignal`: latest adjusted/reported equity is invalid today.
  - `historicalAccountingSignal`: prior periods had zero/negative equity but latest has recovered.
- DMART expected classification:
  - latest CSE positive;
  - CFO positive;
  - NFO net cash;
  - historical break windows present;
  - result: `WARNING`, high `p_artifact`, no valuation block.
- Real distressed expected classification:
  - latest CSE <= 0 and CFO <= 0 / high financial debt / no lease-adjusted rescue;
  - result: `BLOCKING` or `CRITICAL`, low `p_artifact`, valuation block.

#### D10 ExpansionCapexFcfDetector

- FCF is never adjusted.
- For DMART, negative FCF should be a business-model signal:
  - CFO positive;
  - capex > CFO;
  - revenue/store growth likely high;
  - message: expansion capex burden, not distress.
- `p_artifact` should be low unless source timing/partial-period evidence says otherwise.

#### D12 MarketExpectationSaturationDetector

- Converts existing reverse-DCF saturation and MoS/overvaluation outputs into `AnomalySignal` form.
- This is a real valuation signal, not an accounting artifact.
- It must never be suppressed by lease, dirty surplus, or post-break adjustments.
- For DMART:
  - overvaluation remains strong;
  - reverse-DCF cap saturation remains visible;
  - confidence may be capped by stale data, but the signal is not removed.

### L2 files

```text
src/engine/greenfieldPipeline/detectors/index.ts
src/engine/greenfieldPipeline/detectors/standardAdoption.ts
src/engine/greenfieldPipeline/detectors/dirtySurplus.ts
src/engine/greenfieldPipeline/detectors/leaseAccounting.ts
src/engine/greenfieldPipeline/detectors/fxOciTranslation.ts
src/engine/greenfieldPipeline/detectors/negativeEquitySolvency.ts
src/engine/greenfieldPipeline/detectors/structuralBreakDemerger.ts
src/engine/greenfieldPipeline/detectors/buybackCapitalReturn.ts
src/engine/greenfieldPipeline/detectors/componentReclassification.ts
src/engine/greenfieldPipeline/detectors/metricStepChange.ts
src/engine/greenfieldPipeline/detectors/expansionCapexFcf.ts
src/engine/greenfieldPipeline/detectors/freshnessFrequency.ts
src/engine/greenfieldPipeline/detectors/marketExpectationSaturation.ts
```

### L2 tests

- One focused spec per detector or grouped by detector family:
  - `src/engine/__tests__/greenfieldPipeline.detectors.spec.ts`
- Explicit tests:
  - D4 proposes suppression for D2 same period.
  - D5 does not block DMART-shaped latest-positive equity.
  - D10 emits negative-FCF expansion signal and does not propose any adjuster.
  - D12 remains low `p_artifact` and unsuppressible.

## L3 — Classification & Triage

### Responsibilities

L3 resolves conflicts and orders downstream adjusters.

Inputs:

- `NormalizedPeriod[]`
- all L2 `AnomalySignal[]`
- user preferences from config:
  - structural-break window policy;
  - manual exclusions;
  - keep-all override;
  - lease adjustment preference if added.

Outputs:

- `TriageResult`:
  - active signals;
  - suppressed/deduped signals;
  - aggregate severity = max severity of active signals;
  - adjuster DAG;
  - user override effects;
  - rationale log.

### Deduplication and suppression

Rules:

- Suppression is period-specific and reason-specific.
- Suppressed signals are retained in audit output but are not allowed to block or penalize twice.
- Example required by the user:
  - D4 can suppress D2 for same period when FX/OCI translation fully explains dirty surplus.
- Additional expected rules:
  - D3 lease-accounting signal can downgrade D5 negative-equity signal only when lease-neutral equity and CFO evidence are healthy.
  - D6 structural-break signal can convert historical D5 negative equity from current distress to historical accounting warning.
  - D7 buyback signal can downgrade D2 clean-surplus residual if buyback/capital return fully reconciles CSE movement.

### Dependency graph resolution

Adjuster DAG:

```text
A1 LeaseAdjuster
  -> A2 DirtySurplusAdjuster
  -> A3 PreBreakTruncator
  -> A4 BuybackAdjuster
```

Hard ordering requirements:

- LeaseAdjuster always runs before BuybackAdjuster.
- DirtySurplusAdjuster must see lease-adjusted fields if lease adjustments exist.
- PreBreakTruncator runs after accounting-field adjustments so its cut decision can use artifact-resolved signals.
- BuybackAdjuster runs after lease adjustments and after dirty-surplus classification, because buyback changes equity/distribution interpretation.

Implementation:

- Add `src/engine/greenfieldPipeline/triage.ts`.
- Implement a small no-dependency topological sort.
- If dependencies conflict or cycle, fail closed:
  - no adjustments applied;
  - return as-reported result;
  - emit `CRITICAL` triage warning.

### User override handling

Config additions in `src/engine/types/config.ts`:

```ts
type StructuralBreakWindowPolicy = "auto-post-break" | "manual" | "keep-all";
type AdjustmentMode = "as-reported-only" | "adjusted-with-audit";

interface EngineConfig {
  structural_break_window_policy?: StructuralBreakWindowPolicy;
  greenfield_adjustment_mode?: AdjustmentMode;
}
```

Defaults:

- `structural_break_window_policy`: `"auto-post-break"`.
- `greenfield_adjustment_mode`: `"adjusted-with-audit"` when feature flag is on; otherwise existing behavior.

Do not overload `excluded_periods: []` as acknowledgement. An explicit policy is required.

## L4 — Adjustment Pipeline

### Global adjustment rules

- Adjusters execute in topological order.
- Each adjuster receives output of prior adjuster.
- As-reported periods are never mutated.
- Adjusted output is a separate object graph.
- Every field change logs:

```ts
{ field, period, before, after, delta, reason, driven_by }
```

- Adjustments are reversible by replaying audit entries backward or by returning to `asReported`.
- FCF is never adjusted.
- Adjusters can propose changes; L5 validation can reject individual field changes.

### A1 LeaseAdjuster

Purpose:

- Separate financial debt from lease liabilities.
- Compute lease-neutral/lease-adjusted equity lens without rewriting reported CSE.
- Prevent Ind AS 116 mechanics from becoming bankruptcy language.

Inputs:

- D1, D3, D5 signals.
- `OA_ROU` / ROU assets.
- explicit lease liabilities when available.
- CFO, NFO, financial debt ex-lease.

Outputs / fields:

- `leaseLiabilities`.
- `financialDebtExLease`.
- `nfoExLease`.
- `leaseNeutralEquity = CSE + leaseLiabilities - ROU assets` when explicit enough.
- `leaseAdjustmentConfidence = explicit | partial | none`.

Rules:

- Never overwrite `cse`.
- If lease lines are absent or embedded, mark confidence `partial` or `none`; do not guess large adjustments.
- If latest reported CSE is negative but lease-neutral equity positive, CFO positive, and ex-lease debt manageable, downgrade current distress to lease-accounting caveat.

### A2 DirtySurplusAdjuster

Purpose:

- Resolve clean-surplus artifacts from OCI/FX, Ind AS transition, demerger/scheme, and capital transactions.
- Preserve dirty-surplus signals as audit evidence.

Rules:

- Can adjust derived clean-surplus anchors / terminal anchor eligibility.
- Must not adjust FCF.
- Must not delete the D2 signal; it can mark it resolved/artifact in triage and confidence.
- If D2 has low `p_artifact`, no adjustment; keep as real warning/block.

### A3 PreBreakTruncator

Purpose:

- Default valuation/time-series models to post-break periods when structural breaks contaminate history.

Rules:

- Do not remove periods from raw/as-reported statements.
- Add `analysisWindow` metadata:

```ts
{
  mode: "auto-post-break" | "manual" | "keep-all";
  excludedPeriods: string[];
  includedPeriods: string[];
  reason: string;
  minHistorySatisfied: boolean;
}
```

- If post-break window leaves fewer than 10 periods:
  - allow adjusted run but cap confidence / rigor appropriately;
  - show UI warning.
- DMART expected:
  - breaks at 2016/2017/2020;
  - auto-post-break excludes 2012-2015 if the earliest break policy is used and leaves 10 periods;
  - UI says valuation is using post-break window, not all historical periods.

### A4 BuybackAdjuster

Purpose:

- Normalize CSE movement and distribution interpretation around buybacks/capital returns.

Rules:

- Runs after LeaseAdjuster.
- Uses D7 and D2 signals.
- Adjusts clean-surplus/distribution interpretation, not FCF.
- Must preserve capital-return signal as a real corporate-action event.

## L5 — Validation & Reconciliation

### Responsibilities

Validate proposed adjusted values before they affect outputs.

### Required checks

1. Balance sheet identity:
   - `Assets = Equity + Liabilities` or equivalent normalized identity.
   - tolerance: ±0.5%.
2. RNOA decomposition:
   - `RNOA ≈ PM × ATO`.
   - tolerance: ±0.2 percentage points.
   - Compatibility note: current engine Eq.16 also separates OtherItems/NOA. In greenfield validation, use this as:
     - core closure: `CoreRNOA ≈ CorePM × ATO`; and/or
     - reported closure: `RNOA ≈ PM × ATO + OtherItemsRatio` when OtherItemsRatio is material.
3. Reasonableness bounds:
   - RNOA between -50% and +150%.
   - Violations raise `WARNING` but do not block the adjustment by themselves.
4. As-reported vs adjusted diff table per period:
   - every adjusted field;
   - before/after/delta;
   - signal/adjuster responsible;
   - validation status.
5. FCF protection:
   - FCF is never adjusted.
   - Any identity involving FCF compares against unadjusted FCF.
   - If an adjuster attempts to change `fcfCash`, L5 rejects it automatically.

### Rejection behavior

- Failed identity checks reject the specific field adjustment, not the entire period.
- Rejected field falls back to as-reported value.
- Audit entry remains with `validationStatus: "rejected"` and `rejectedBy` reasons.
- If rejection creates dependency issues for later adjustments, later dependent adjustments are also rejected with dependency reasons.

### Files

- `src/engine/greenfieldPipeline/validateAdjustments.ts`
- Possible adapter into existing:
  - `src/engine/reconciliationResiduals.ts`
  - `src/engine/types/reconciliation.ts`

### Tests

- Lease adjustment accepted when identity remains within ±0.5%.
- Dirty-surplus derived anchor adjustment accepted but FCF unchanged.
- Attempted FCF adjustment rejected.
- RNOA out of bounds warns but does not block if identity passes.
- Field-level rejection falls back only that field.

## L6 — Confidence Re-scoring

### Requirements

Score as-reported and adjusted financials separately.

Output:

```ts
interface ConfidenceScore {
  level: "low" | "medium" | "high" | "blocked";
  score: number;
  penalties: Array<{ reason: string; points: number; signalId?: string }>;
  bonuses: Array<{ reason: string; points: number; signalId?: string }>;
  caps: Array<{ reason: string; cap: number }>;
}
```

### Formula

Base score: 60.

Penalties:

- Real low-`p_artifact` signals subtract 5-25 points based on severity.
- Unresolved `BLOCKING` / `CRITICAL` real signals keep confidence low or blocked.
- Failed/rejected adjustments subtract points if they affect valuation-critical fields.

Bonuses:

- Resolved `BLOCKING` accounting-artifact signals add 10-15 points.
- Examples:
  - lease-accounting caveat resolves a false current-distress block;
  - D4 fully explains D2 dirty surplus;
  - post-break truncation isolates contaminated pre-break periods.

Stale-data caps:

- >12 months since latest period end: max score 55.
- >18 months since latest period end: max score 40.

Important interpretation:

- Stale data caps confidence but should not by itself block valuation.
- Overvaluation / market-expectation saturation is a real signal; it should penalize investment attractiveness, not data integrity. Present it in valuation narrative separately from data-confidence scoring.

### DMART expected confidence behavior

As-reported:

- Historical dirty surplus / negative-equity artifacts visible.
- Stale data cap applies if latest period is >12 months old.
- Confidence likely capped around 55 even if adjustments resolve false blockers.

Adjusted:

- Lease/pre-break/dirty-surplus artifacts resolved or isolated.
- No financial distress block when latest CSE/CFO/NFO are healthy.
- Confidence still capped by staleness and structural-reconciliation residuals if present.
- Overvaluation remains visible, not adjusted away.

## Integration with current DMART plan

The prior plan phases map into the six-layer architecture as follows:

| Prior plan item | New layer mapping |
| --- | --- |
| Split current solvency from historical accounting artifacts | D5 + L3 triage + L6 confidence |
| Expose lease / ex-lease debt fields | L1 normalized fields + A1 LeaseAdjuster |
| Default post-break analysis window | D6 + A3 PreBreakTruncator + L3 user override |
| Staleness warning only | D11 + L6 confidence cap |
| Preserve overvaluation / reverse-DCF saturation | D12 as real signal, no adjuster |
| Negative FCF framed as expansion capex | D10 as real business signal, no adjuster, FCF never adjusted |
| UI copy and trust envelope consistency | adapters + traceability/schema update + surfaces |

## Step-by-step implementation plan

### Phase 0 — Remove release blocker and keep repo safe

1. Resolve untracked scratch test in `src/engine/__tests__/__tmp_dmart_crosscheck.spec.ts`:
   - Preferred: convert to a proper typed regression fixture outside scratch naming.
   - Alternative: move outside `src/` if it is only diagnostic.
2. Do not delete unrelated untracked files.
3. Re-run:
   - `npm run typecheck`

Ship gate: typecheck no longer fails on scratch test.

### Phase 1 — Add greenfield types and L1 normalizer

1. Create `src/engine/greenfieldPipeline/types.ts`.
2. Create `src/engine/greenfieldPipeline/adapters.ts`.
3. Create `src/engine/greenfieldPipeline/l1Normalize.ts`.
4. Add L1 tests.
5. Do not connect to UI yet.

Ship gate:

- `npm test -- src/engine/__tests__/greenfieldPipeline.l1Normalize.spec.ts`
- `npm run typecheck`

### Phase 2 — Implement 12 pure detectors

1. Implement detector modules under `src/engine/greenfieldPipeline/detectors/`.
2. Add detector registry that runs all detectors over L1 output.
3. Ensure registry never passes detector output into another detector.
4. Add adapter to convert selected `AnomalySignal`s to existing `SpecFlag`s for old surfaces.

Ship gate:

- D2/D4 suppression proposal tests pass.
- D5 DMART-shaped recovered-positive-equity test passes.
- D10 negative FCF test passes.
- D12 market saturation test passes.

### Phase 3 — Implement L3 triage and adjuster DAG

1. Create `triage.ts`.
2. Implement:
   - deduplication;
   - suppression resolution;
   - aggregate severity max;
   - user override policy;
   - topological sort.
3. Add config fields in `src/engine/types/config.ts`.
4. Add tests for:
   - D4 suppressing D2 same period;
   - D3 downgrading D5 only when lease-neutral/CFO evidence is strong;
   - keep-all/manual/auto post-break policies.

Ship gate:

- `greenfieldPipeline.triage.spec.ts` passes.

### Phase 4 — Implement L4 adjusters

1. Implement A1 LeaseAdjuster.
2. Implement A2 DirtySurplusAdjuster.
3. Implement A3 PreBreakTruncator.
4. Implement A4 BuybackAdjuster.
5. Add full audit trail entries for every field-level change.
6. Ensure as-reported period objects are deep-frozen or cloned so tests catch mutation.

Ship gate:

- Adjuster order test proves A1 before A4.
- Audit trail test proves field/before/after/delta/reason/driven_by exists.
- Reversibility test proves as-reported can be recovered.

### Phase 5 — Implement L5 validation and rejection

1. Add `validateAdjustments.ts`.
2. Run validation after every adjuster or after all adjusters with field-level dependency tracking.
3. Reject field-level changes that fail identity checks.
4. Ensure FCF changes are impossible or auto-rejected.
5. Produce as-reported vs adjusted diff table.

Ship gate:

- `greenfieldPipeline.validation.spec.ts` passes.
- FCF attempted adjustment is rejected.

### Phase 6 — Implement L6 confidence scoring

1. Add `confidence.ts`.
2. Score as-reported and adjusted outputs separately.
3. Implement base score 60.
4. Implement real-signal penalties, resolved-artifact bonuses, and stale caps.
5. Add DMART-shaped confidence test.

Ship gate:

- `greenfieldPipeline.confidence.spec.ts` passes.
- FY2025 as of 2026-06-02 caps at max 55.
- >18 months caps at max 40.

### Phase 7 — Wire sidecar into `processCompanyDataFull`

1. Add optional greenfield run after legacy recast completes:
   - input: raw data, legacy recast, config, market/valuation evidence when available.
2. Add `greenfield?: GreenfieldPipelineResult` to `PipelineResult`.
3. Keep existing outputs unchanged until greenfield tests are stable.
4. Add a feature flag if needed, but prefer always computing if cheap and pure.

Ship gate:

- Existing focused tests still pass:
  - `npm test -- src/engine/__tests__/distressDetector.spec.ts src/engine/__tests__/distressRigorGate.spec.ts src/engine/__tests__/negativeEquityValuation.spec.ts`
- Full engine typecheck passes.

### Phase 8 — Replace misleading distress/trust behavior with greenfield outputs

1. Update `src/engine/distressDetector.ts` or wrap it with greenfield D5 result.
2. Update `src/engine/analysisTraceability.ts`:
   - valuation eligibility blocks on unresolved real current-distress signal;
   - does not block on resolved/high-`p_artifact` historical artifact.
3. If traceability envelope shape changes:
   - bump `src/engine/policyVersions.ts`.
   - update `src/lib/envelopeMigrations.ts`.
4. Update `src/components/valuation/DistressBanner.tsx` copy using greenfield triage:
   - current distress: strong warning;
   - historical artifact: caveat, not bankruptcy;
   - lease accounting: Ind AS 116 caveat;
   - expansion FCF: reinvestment burden.

Ship gate:

- DMART-like fixture does not show financial distress / negative net worth.
- Vodafone-like latest-negative-equity fixture still blocks.

### Phase 9 — UI integration and report consistency

1. Surface greenfield result consistently in:
   - `AnalysisBanners`.
   - Valuation tab.
   - Forecast tab if it uses caveats.
   - Statements tab diff table.
   - Academic Report.
   - Comparison and V3 Analytics if they show confidence.
2. Add an "As reported / Adjusted" toggle where appropriate.
3. Preserve all existing tabs and `data-testid` / DOM contracts unless tests are explicitly updated.
4. Light-mode styling: pair dark-only colors with light-mode equivalents.

Ship gate:

- UI pass navigates all tabs before further fixes.
- DMART copy says: expensive/perfection-priced, expansion FCF negative, structural-break caveated, not distressed.

### Phase 10 — Final validation

Run:

```text
npm run typecheck
npm test -- src/engine/__tests__/greenfieldPipeline.l1Normalize.spec.ts
npm test -- src/engine/__tests__/greenfieldPipeline.detectors.spec.ts
npm test -- src/engine/__tests__/greenfieldPipeline.triage.spec.ts
npm test -- src/engine/__tests__/greenfieldPipeline.adjusters.spec.ts
npm test -- src/engine/__tests__/greenfieldPipeline.validation.spec.ts
npm test -- src/engine/__tests__/greenfieldPipeline.confidence.spec.ts
npm test -- src/engine/__tests__/distressDetector.spec.ts src/engine/__tests__/distressRigorGate.spec.ts src/engine/__tests__/negativeEquityValuation.spec.ts
npm run validate
```

## Files likely to change

New greenfield files:

```text
src/engine/greenfieldPipeline/types.ts
src/engine/greenfieldPipeline/adapters.ts
src/engine/greenfieldPipeline/l1Normalize.ts
src/engine/greenfieldPipeline/runGreenfieldPipeline.ts
src/engine/greenfieldPipeline/triage.ts
src/engine/greenfieldPipeline/validateAdjustments.ts
src/engine/greenfieldPipeline/confidence.ts
src/engine/greenfieldPipeline/detectors/*.ts
src/engine/greenfieldPipeline/adjusters/*.ts
```

Existing engine files:

```text
src/engine/pipeline.ts
src/engine/types/config.ts
src/engine/types/recast.ts
src/engine/types/quality.ts               // adapter only if SpecFlag gains optional metadata
src/engine/distressDetector.ts
src/engine/analysisTraceability.ts
src/engine/policyVersions.ts              // if envelope shape changes
src/lib/envelopeMigrations.ts             // if envelope shape changes
src/engine/PenmanNissimEngine/recast.ts   // expose lease fields into legacy bridge
```

UI/report files:

```text
src/app/useAuditAnalysis.ts
src/app/AppShell.tsx
src/app/components/AnalysisBanners.tsx
src/components/valuation/DistressBanner.tsx
src/components/ValuationReport.tsx
src/components/AcademicReport.tsx
src/components/RecastStatements.tsx        // if adding as-reported vs adjusted diff table
```

Tests:

```text
src/engine/__tests__/greenfieldPipeline.l1Normalize.spec.ts
src/engine/__tests__/greenfieldPipeline.detectors.spec.ts
src/engine/__tests__/greenfieldPipeline.triage.spec.ts
src/engine/__tests__/greenfieldPipeline.adjusters.spec.ts
src/engine/__tests__/greenfieldPipeline.validation.spec.ts
src/engine/__tests__/greenfieldPipeline.confidence.spec.ts
src/engine/__tests__/dmartDistressPolicy.spec.ts
src/engine/__tests__/distressDetector.spec.ts
src/engine/__tests__/distressRigorGate.spec.ts
src/engine/__tests__/negativeEquityValuation.spec.ts
```

## Risks / tradeoffs / open questions

### Risks

- Unit migration risk: Cr -> INR can break valuations if legacy crore adapters are wrong.
  - Mitigation: branded conversion tests and compatibility adapters.
- Greenfield sidecar can drift from legacy pipeline if both compute similar metrics differently.
  - Mitigation: adapter tests comparing normalized values back to `RecastPeriod`.
- Adjustment pipeline can look like it is "massaging" results.
  - Mitigation: as-reported always preserved; adjusted output always audit-trailed and reversible.
- Confidence score can be misunderstood as valuation attractiveness.
  - Mitigation: separate data confidence from market overvaluation warnings.
- Auto post-break truncation can hide useful history.
  - Mitigation: explicit `analysisWindow`, UI disclosure, keep-all/manual override.

### Tradeoffs

- Sidecar-first is slower than direct replacement but much safer.
- Absolute INR normalized data is cleaner, but legacy crore math requires adapters during transition.
- Field-level rejection is more complex than rejecting an entire adjusted run, but it gives better reviewer auditability.

### Open questions for executor verification

- Are lease liabilities consistently present in Capitaline labels, or embedded in other financial liabilities? If embedded, A1 must mark `partial` and avoid aggressive adjustment.
- Does the current DMART UI path already sets exclusions manually? Verify in browser after implementation.
- Should D12 market saturation affect L6 confidence score or live in a separate valuation-risk score? Plan recommendation: separate it from data confidence, but still expose it as a real low-`p_artifact` signal.
- Should traceability envelope persist the whole greenfield result, or only a compact reference? Recommendation: persist a compact summary and put full audit diff in audit snapshot sidecar to avoid envelope bloat.

## Iteration Log

| Iteration | Assumptions tested | Finding | Plan change |
| --- | --- | --- | --- |
| 1 | Assumed the existing anomaly layer could directly become L2. | Current `anomalyDetection` has 6 detector families and `SpecFlag`, but no `AnomalySignal`, `p_artifact`, pure 12-detector registry, or adjuster DAG. | Added greenfield `AnomalySignal` sidecar with adapter to existing `SpecFlag`. |
| 2 | Assumed all adjustments could be patched into `processCompanyDataFull` directly. | `pipeline.ts` is already a broad orchestration layer used by many reports and financial-institution routing. | Plan uses sidecar-first integration with additive `greenfield?: GreenfieldPipelineResult`. |
| 3 | Tested typecheck before planning implementation. | Typecheck is blocked by untracked scratch DMART test, not by main code. | Phase 0 requires converting/moving scratch test before release validation. |
| 4 | Checked RNOA validation assumption. | Current engine already has Eq.16 residuals and notes RNOA decomposition may include OtherItemsRatio. | L5 uses `RNOA ≈ PM × ATO` with a compatibility note for CoreRNOA / OtherItemsRatio. |
| 5 | Stress-tested user's Cr -> ₹ normalization against current app convention. | Current project uses INR-crore values and crore-shares internally. | L1 normalizes to absolute INR but keeps a tested legacy crore adapter until full unit migration. |
| 6 | Reconciled prior DMART plan with user's six-layer design. | Prior plan phases map cleanly into D5/A1/A3/D11/D12/D10. | Added explicit mapping table and DMART expected outcomes per layer. |

## Ship gates

- Gate A: Typecheck blocker from scratch DMART test resolved.
- Gate B: L1 normalized units/periods/standard tags tested.
- Gate C: 12 detectors emit independent `AnomalySignal`s with `p_artifact`.
- Gate D: L3 suppressions and adjuster DAG tested, including D4 suppressing D2 and A1 before A4.
- Gate E: L4 audit trail and reversibility tested.
- Gate F: L5 identity validation rejects field-level failures and never adjusts FCF.
- Gate G: L6 scores as-reported and adjusted separately with stale caps.
- Gate H: DMART no longer shows distress/negative-net-worth while preserving overvaluation, reverse-DCF saturation, negative expansion FCF, and structural-break caveats.
- Final Gate: `npm run validate` passes and UI review across all tabs confirms the story is consistent.
