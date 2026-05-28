# Plan 5b — Modelling Depth Advanced (5 PRs, schema v15 → v16)

> **For Hermes:** Use `subagent-driven-development` skill. This plan extends Plan 5 with the institutional-grade valuation lenses that distinguish a CFA-defensible engine from a textbook one. Domain research is the bottleneck — each PR has a "research artifact" in `docs/research/` before the code lands.

**Goal:** Close the five remaining modelling gaps a senior buy-side reviewer would flag:
1. Real-options valuation for R&D pipelines and optionality (pharma, tech)
2. Credit-spread-aware WACC using sovereign + corporate yield curves
3. Working-capital sustainability surfaced as a first-class envelope check
4. ESG-adjusted cost of equity with explicit citation
5. FX hedging analysis for export-heavy Indian companies

**Architecture:** New modules under `src/engine/depth/advanced/` consumed by every pipeline strategy. Schema v16 adds `analyticalDepth.advanced` block.

**Tech Stack:** No new runtime deps. `mathjs` candidate for option-pricing math (Black-Scholes); evaluate vs hand-rolled.

**Sequencing rule:** Plan 5 must complete first (analyticalDepth shape exists). Within Plan 5b: PR-5b.1 → PR-5b.2 → others independent.

---

## PR-5b.1 — Real-options valuation (Black-Scholes for R&D pipelines)

**Branch:** `depth/real-options-bsm`
**Schema bump:** v15 → v15.5 (additive)
**Estimated diff:** +900 / -100, 3 new files

**Why:** A pharma company with a Phase-2 oncology trial has option value the DCF can't capture. Traditional valuation either ignores it (understates) or counts it as committed cashflow (overstates). Real-options framing: each pipeline asset is a call option on the underlying NPV, exercised on regulatory approval.

**Domain spec:**

For each pipeline asset (or strategic optionality):
- Underlying value `S` = expected NPV if commercialized (per-asset DCF)
- Strike `K` = remaining R&D + launch cost
- Time to expiry `T` = expected years until launch decision
- Volatility `σ` = volatility of comparable launched products (sector-conditional)
- Risk-free `r` = sourced from Damodaran (Plan 5 PR-5.3)

Black-Scholes call value = real option value. Sum across pipeline assets, add to base DCF.

**Target API:**

```ts
// src/engine/depth/advanced/realOptions.ts
export interface PipelineAsset {
  assetId: string;
  description: string;
  expectedNpvIfCommercialized: INRCrore;
  remainingDevelopmentCost: INRCrore;
  yearsToDecision: number;
  comparableVolatility: PercentFraction; // sector benchmark
  probabilityOfSuccess: PercentFraction; // regulatory POS, sector-conditional
}

export interface RealOptionResult {
  asset: PipelineAsset;
  d1: number; d2: number;
  bsmCallValue: INRCrore;
  riskAdjustedValue: INRCrore;  // bsmCallValue × probabilityOfSuccess
  diagnostics: { rfr: PercentFraction; volSource: string; posSource: string };
}

export function valuePipelineAsset(asset: PipelineAsset, ctx: RealOptionContext): RealOptionResult;
export function valuePipelineAggregate(assets: PipelineAsset[], ctx: RealOptionContext): {
  perAsset: RealOptionResult[];
  totalRiskAdjusted: INRCrore;
};
```

**Steps:**

1. Research artifact: `docs/research/real-options-india.md` — citation-grade summary of Damodaran's real-options framework + Indian pharma POS tables (Phase-1: 0.10, Phase-2: 0.30, Phase-3: 0.60, NDA: 0.85).
2. Implement Black-Scholes in `realOptions.ts` (no `mathjs` — pure functions, deterministic).
3. Add pipeline-asset config to `CompanyConfig`: `pipelineAssets?: PipelineAsset[]`.
4. Surface in valuation: total enterprise value = base DCF + risk-adjusted real-option sum.
5. Add Sun Pharma to golden expectations (R&D-heavy, has pipeline).
6. Tests: 12 cases — BSM correctness vs hand-computed reference, edge cases (T=0, σ=0), POS application, aggregation, no-pipeline pass-through.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/advanced/__tests__/realOptions.spec.ts   # 12 green
# Reference: Damodaran textbook example reproduced ± 0.5%
```

---

## PR-5b.2 — Credit-spread-aware WACC

**Branch:** `depth/credit-spread-wacc`
**Schema bump:** none (additive in capm result)
**Estimated diff:** +600 / -150

**Why:** Plan 5 PR-5.3 ships sector-aware CAPM `ke`. WACC blends `ke` with `kd` (cost of debt). Today `kd` is likely book-yield. For credit-stressed names (any company with credit rating ≤ BBB), book-yield understates true cost of debt. Use sovereign curve + credit spread.

**Domain spec:**

```
kd_market = rfr_tenor_matched + credit_spread_for_rating
WACC = (E/V) × ke + (D/V) × kd_market × (1 - tax_rate)
```

Where `credit_spread_for_rating` comes from a published India corporate-bond spread matrix (CRISIL / ICRA / Moody's India tables).

**Target additions:**

```ts
// extend src/engine/depth/capm.ts
export interface CreditAwareWaccInput {
  ke: PercentFraction;          // from CAPM
  effectiveDebt: INRCrore;
  effectiveEquity: INRCrore;
  taxRate: PercentFraction;
  creditRating?: "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "CCC" | "unrated";
  averageDebtTenorYears?: number; // default 5
  fiscalYear: number;
}

export interface WaccResult {
  wacc: PercentFraction;
  kd: { market: PercentFraction; book: PercentFraction; spreadBps: BasisPoints };
  weights: { equity: PercentFraction; debt: PercentFraction };
  citations: { rfrSource: string; spreadSource: string };
}

export function computeWacc(input: CreditAwareWaccInput): WaccResult;
```

**Steps:**

1. Curate `public/data/damodaran/india-credit-spreads.json` with rating × tenor × year spread matrix.
2. Implement `computeWacc`.
3. Replace existing WACC derivation throughout valuation.
4. Update workbook Cover sheet to show `kd_market`, `kd_book`, `spreadBps`, citations.
5. Tests: 10 cases — every rating bucket, unrated fallback, tenor interpolation, weight correctness.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/advanced/__tests__/wacc.spec.ts   # 10 green
# Reference: Tata Motors FY25 with BBB+ rating → kd_market ≈ rfr + 250bps
```

---

## PR-5b.3 — Working-capital sustainability gate

**Branch:** `depth/working-capital-sustainability`
**Schema bump:** v16 (adds workingCapitalSustainability to envelope)
**Estimated diff:** +700 / -100

**Why:** RNOA can be flattered by stretched payables and starved inventory. A run that looks "valuation-eligible" while WC days have deteriorated 50% in 3 years is misleading. Today there's no first-class check for this.

**Domain spec:**

Per period, compute:
```
DSO = receivables / (revenue / 365)
DIO = inventory / (cogs / 365)
DPO = payables / (cogs / 365)
CCC = DSO + DIO − DPO  (cash conversion cycle, days)
```

Trend test: regress CCC on time. If slope > 10 days/year and current CCC > sector P75: flag.

Status:
- `stable`: CCC trend within ±5 days/year
- `deteriorating`: positive trend > 10 days/year
- `unsustainable`: CCC > sector P95 OR DPO > 180 days

**Target API:**

```ts
// src/engine/depth/advanced/workingCapital.ts
export interface WorkingCapitalReport {
  status: "stable" | "deteriorating" | "unsustainable";
  perPeriod: { period: string; dso: number; dio: number; dpo: number; ccc: number }[];
  trend: { cccSlopeDaysPerYear: number; r2: number };
  sectorBenchmark: { sectorCode: string; cccP50: number; cccP75: number; cccP95: number };
  rigorImpact: "none" | "diagnostic" | "blocks-economically-plausible";
  flaggedPeriods: { period: string; reason: string }[];
}
```

**Steps:**

1. Curate `public/data/sector-benchmarks/working-capital-india.json` — CCC percentiles by sector × year (CMIE / Capitaline aggregates).
2. Implement `computeWorkingCapital`.
3. Wire into rigor ladder: `unsustainable` blocks `economically-plausible` when flag enabled.
4. Add `VITE_RIGOR_WORKING_CAPITAL_BLOCK` feature flag.
5. Tests: 10 cases — stable run, deteriorating trend, unsustainable spike, sector-relative gate, sector-missing fallback.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/advanced/__tests__/workingCapital.spec.ts   # 10 green
```

---

## PR-5b.4 — ESG-adjusted cost of equity

**Branch:** `depth/esg-adjusted-ke`
**Schema bump:** none
**Estimated diff:** +500 / -50

**Why:** Audit committees and ESG mandates increasingly require disclosure of how environmental/social/governance factors flow into discount rate. Today `ke` is sector-only. Add an explicit ESG premium.

**Domain spec:**

```
ke_esg = ke_capm + esg_premium
esg_premium = lookup(esgScore, sectorCode) where:
  - esgScore ≥ 75 (top quartile): -25 bps  (rewarded)
  - esgScore in [50, 75):           0 bps
  - esgScore in [25, 50):         +25 bps
  - esgScore < 25:                +75 bps
```

ESG scores sourced from MSCI India ESG / Sustainalytics. Score absent → premium = 0, surface as "unscored" diagnostic (does not block rigor).

**Target API:**

```ts
// extend src/engine/depth/capm.ts
export interface EsgAdjustment {
  baselineKe: PercentFraction;
  esgPremiumBps: BasisPoints;
  adjustedKe: PercentFraction;
  esgScore: number | null;
  esgScoreSource: string | null;
  bucket: "leader" | "average" | "laggard" | "severe-laggard" | "unscored";
}
export function applyEsgAdjustment(ke: PercentFraction, companyId: string, fiscalYear: number): EsgAdjustment;
```

**Steps:**

1. Curate `public/data/esg/india-msci-scores.json` with companyId × year × score (ship the 30 known golden-suite companies + extensions).
2. Implement `applyEsgAdjustment`.
3. Wire into valuation pipeline AFTER CAPM derivation.
4. Workbook Cover sheet adds `esgScore`, `esgPremiumBps`, `esgSource`.
5. Tests: 8 cases — every bucket, unscored fallback, leader reward correctness.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/advanced/__tests__/esg.spec.ts   # 8 green
# Reference: Infosys score ≈ 80 → premium = -25 bps applied
```

---

## PR-5b.5 — FX hedging analysis for export-heavy companies

**Branch:** `depth/fx-hedging`
**Schema bump:** v16 (final shape, completes Plan 5b)
**Estimated diff:** +800 / -100

**Why:** IT services, pharma exporters, textile exporters have substantial USD/EUR/GBP revenue. Reported INR earnings are jointly determined by underlying business performance and FX moves. Without separating these, RNOA is uninterpretable across periods.

**Domain spec:**

Per period:
- Identify foreign-currency revenue share (from segment/geography splits or notes)
- Compute FX-neutral revenue: revenue at constant rate (use period-1 rate as base)
- FX impact = reported revenue − FX-neutral revenue
- Hedging coverage ratio (if disclosed): notional hedges / FX exposure

Status:
- `not-applicable`: foreign revenue < 10%
- `disclosed`: foreign revenue ≥ 10% AND hedge disclosure present
- `undisclosed-exposed`: foreign revenue ≥ 10% AND no hedge disclosure (diagnostic)
- `materially-distorted`: foreign revenue ≥ 30% AND |FX impact / EBITDA| > 0.15

**Target API:**

```ts
// src/engine/depth/advanced/fxHedging.ts
export interface FxHedgingReport {
  status: "not-applicable" | "disclosed" | "undisclosed-exposed" | "materially-distorted";
  perPeriod: {
    period: string;
    foreignRevenueShare: PercentFraction;
    reportedRevenueINRCrore: INRCrore;
    fxNeutralRevenueINRCrore: INRCrore;
    fxImpactINRCrore: INRCrore;
    hedgingCoverage: PercentFraction | null;
  }[];
  rigorImpact: "none" | "diagnostic";
}
```

**Steps:**

1. Implement `computeFxHedging` reading from segment data (Capitaline geographic segment exports).
2. Curate `public/data/fx-rates/inr-historical.json` — quarterly USD/INR, EUR/INR, GBP/INR rates from RBI (10-year history).
3. Surface in StatementsReport as side-by-side reported vs FX-neutral revenue.
4. Add Infosys + Sun Pharma to golden expectations (FX-exposed).
5. Tests: 10 cases — domestic-only pass-through, exposed-disclosed, exposed-undisclosed, distortion threshold, FX-neutralization correctness.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/advanced/__tests__/fxHedging.spec.ts   # 10 green
# Reference: Infosys FY25 foreign rev ≈ 95%, FX-neutral revenue ± 2% of reported
```

---

## Cross-cutting acceptance for Plan 5b

```bash
# ─── Schema v16 ─────────────────────────────
grep TRACEABILITY_SCHEMA_VERSION src/engine/policyVersions.ts   # = "2026-06-traceability-v16"

# ─── advanced block populated ───────────────
grep -rn "analyticalDepth\.advanced\." src/   # ≥ 5 hits

# ─── Reference data shipped ────────────────
ls public/data/damodaran/india-credit-spreads.json
ls public/data/sector-benchmarks/working-capital-india.json
ls public/data/esg/india-msci-scores.json
ls public/data/fx-rates/inr-historical.json

# ─── Research artifacts ─────────────────────
ls docs/research/real-options-india.md
ls docs/research/credit-spreads-india.md
ls docs/research/working-capital-benchmarks.md
ls docs/research/esg-india-methodology.md
ls docs/research/fx-hedging-disclosure-norms.md

# ─── Suite green ───────────────────────────
npm run validate
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Real-options inputs (volatility, POS) are highly judgmental | high | Each `PipelineAsset` carries explicit source citation; run shows sensitivity to vol ±20% |
| ESG scores have multiple vendors with disagreement | high | Pick one source (MSCI), cite explicitly. Add comment in ADR-007 listing alternatives |
| Working-capital benchmark data is stale | medium | Annual refresh; year-of-data shown in workbook |
| Credit spread matrix doesn't cover unrated names | high | Explicit "unrated" bucket with conservative spread (BB+ proxy); diagnostic flag |
| FX-neutral revenue requires segment data not always present | medium | Status `not-applicable` when segment absent or foreign rev < 10% |

## Definition of done

10/10 means a buy-side analyst opens the envelope and sees:
1. Pipeline-heavy companies have a real-options enterprise-value contribution with per-asset breakdown
2. WACC carries a sourced credit spread, not a book-yield approximation
3. Working-capital sustainability is a first-class rigor gate, sector-benchmarked
4. ESG-adjusted `ke` cites score + bucket + bp adjustment
5. FX-exposed companies show reported vs FX-neutral revenue with hedge disclosure status
