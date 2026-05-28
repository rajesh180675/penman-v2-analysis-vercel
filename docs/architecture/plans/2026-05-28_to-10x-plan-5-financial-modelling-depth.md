# Plan 5 — Financial-Modelling Depth (5 PRs, schema v14 → v15)

> **For Hermes:** Use `subagent-driven-development` skill. This plan turns the existing valuation engine from "academically correct" into "auditable to a CFA review board". Each PR ships one piece of analytical depth that's currently missing.

**Goal:** Close the five financial-modelling gaps that block 10/10 from a domain-expert reviewer:
1. Reverse DCF returns confidence intervals and sensitivity, not point estimates
2. Cumulative clean-surplus residual tracked across periods as a single auditable number
3. CAPM `ke` parameterized by year × sector (Damodaran India tables)
4. Sum-of-the-parts (SOTP) for conglomerates aggregating segment valuations
5. Ind-AS 116 lease treatment flag + period-over-period reconciliation

**Architecture:** Each gap becomes a sector-agnostic engine module under `src/engine/depth/` consumed by every pipeline strategy. Schema v15 adds `analyticalDepth` block to envelope.

**Tech Stack:** No new dependencies. Existing Damodaran data shipped as static JSON (`public/data/damodaran/india-erp-by-year.json`).

**Sequencing rule:** PR-5.1 → PR-5.2 → PR-5.3 (independent of each other after PR-5.1) → PR-5.4 → PR-5.5. PR-5.4 (SOTP) depends on PR-3.4 (NBFC strategy migrated, segment data routable per strategy).

---

## PR-5.1 — Reverse DCF with confidence intervals + sensitivity

**Branch:** `depth/reverse-dcf-intervals`
**Schema bump:** v14 → v14.5 (additive field; no envelope-shape break, but new `reverseDcf` block)
**Estimated diff:** +900 / -300, 3 new files

**Why:** A reverse DCF that returns "fair value = ₹847" without showing how that number changes when terminal growth shifts ±100bps is decoration. The output must be a 5×5 grid plus an asymmetric confidence interval derived from the input distributions.

**Domain spec:**

A reverse DCF takes the *current market price* and infers the *implied terminal growth rate* (or the *implied 5-year FCF growth rate*) under a fixed WACC. The output is:
- **Implied growth point estimate** (single number, e.g. 6.2% terminal)
- **Sensitivity grid:** implied growth at WACC × terminal-share-of-value matrix (5×5 = 25 cells)
- **Confidence interval (asymmetric):** P10/P25/P50/P75/P90 implied growth from Monte Carlo over WACC distribution × FCF margin distribution
- **Plausibility flag:** if implied growth > GDP-growth-cap (currently 6.5% nominal long-run for India), flag as "implausible"

**Target API:**

```ts
// src/engine/depth/reverseDcf.ts
export interface ReverseDcfInput {
  currentPrice: INRAbsolute;      // per share
  sharesOutstanding: AbsoluteShares;
  recastData: RecastPeriod[];
  config: CompanyConfig;
  wacc: PercentFraction;
  waccStdDev: PercentFraction;    // for Monte Carlo, default 100bps
  fcfMarginStdDev: PercentFraction; // for Monte Carlo, default 200bps
  monteCarloIterations?: number;  // default 5000
}

export interface ReverseDcfResult {
  impliedTerminalGrowthPoint: PercentFraction;
  sensitivityGrid: SensitivityCell[][];   // 5x5
  confidenceInterval: {
    p10: PercentFraction;
    p25: PercentFraction;
    p50: PercentFraction;
    p75: PercentFraction;
    p90: PercentFraction;
  };
  plausibility: "plausible" | "stretched" | "implausible";
  reasonsForFlag: string[];
  monteCarloSummary: {
    iterations: number;
    convergenceMaxIteration: number;
    seed: number;                  // deterministic — same inputs → same output
  };
}

export function computeReverseDcf(input: ReverseDcfInput): ReverseDcfResult { ... }
```

**Steps:**

1. Create `src/engine/depth/reverseDcf.ts` with:
   - `computeImpliedGrowthPoint()` — solve for `g` such that PV of growing perpetuity = `currentPrice * sharesOutstanding`.
   - `computeSensitivityGrid()` — 5×5 grid varying WACC and terminal share.
   - `computeMonteCarloInterval()` — 5,000 trials with explicit seed for determinism.
2. Determinism: seed via `xmur3` from `input.runId` (or fallback to `0xCAFE`). Same inputs → same output → reproducible audits.
3. Plausibility flagging:
   - `g > 0.065` (India nominal LRG cap): "implausible"
   - `g > 0.045` (5-year industry-conditional cap): "stretched"
   - else: "plausible"
4. Surface in `AnalysisTraceabilityEnvelope.analyticalDepth.reverseDcf`.
5. Add to ValuationReport.tsx: a 5×5 sensitivity heatmap + the P10/P50/P90 interval.
6. Tests: 12 cases — point estimate vs Excel reference, sensitivity grid bounds, plausibility flags, Monte Carlo determinism, edge cases (zero FCF, negative FCF).

**Acceptance test:**

```bash
npx vitest run src/engine/depth/__tests__/reverseDcf.spec.ts   # 12 cases green
# Cross-reference: hand-computed Excel for ITC FY25 → expected implied g = 4.8% ± 0.1%
```

---

## PR-5.2 — Cumulative clean-surplus residual

**Branch:** `depth/clean-surplus-residual`
**Schema bump:** none (additive in `analyticalDepth`)
**Estimated diff:** +500 / -100, 1 new file

**Why:** Penman's clean-surplus identity says: `Δbook value = comprehensive income - dividends paid + capital transactions`. Dirty-surplus events (FX translation, hedging reserves, OCI items) violate this. The existing `fcfeDirtySurplus.ts` detects events but doesn't accumulate the residual into a single auditable number.

**Domain spec:**

Track per-period:
```
residual_t = (BookValue_t - BookValue_{t-1}) - (CompIncome_t - Dividends_t + CapitalTransactions_t)
```
Cumulative:
```
cumulativeResidual = Σ residual_t over the rigor window
cleanSurplusResidualPctOfBook = cumulativeResidual / BookValue_latest
```

Reviewer-facing rule:
- `|pct| ≤ 0.005` (50 bps): clean
- `|pct| ≤ 0.02` (200 bps): tolerable, flag with reason
- `|pct| > 0.02`: violates clean-surplus, fail-closed at `economically-plausible`

**Target API:**

```ts
// src/engine/depth/cleanSurplus.ts
export interface CleanSurplusReport {
  status: "clean" | "tolerable" | "violation";
  perPeriodResiduals: { period: string; residual: INRCrore; residualPctOfBook: PercentFraction }[];
  cumulativeResidual: INRCrore;
  cleanSurplusResidualPctOfBook: PercentFraction;
  rigorImpact: "none" | "diagnostic" | "blocks-economically-plausible";
  topContributingPeriods: { period: string; residual: INRCrore; suspectedCause: string }[];
}

export function computeCleanSurplus(recastData: RecastPeriod[]): CleanSurplusReport { ... }
```

**Steps:**

1. Create `src/engine/depth/cleanSurplus.ts`.
2. Wire into `analysisTraceability.ts`: when `cleanSurplusResidualPctOfBook > 0.02`, gate `economically-plausible` ladder level (analogous to existing economic-sanity block).
3. Surface in `AcademicReport.tsx` and `V3AnalyticsPanel.tsx`: the per-period residual walk + cumulative number with a tolerance gauge.
4. Add `VITE_RIGOR_CLEAN_SURPLUS_BLOCK` feature flag (default ON).
5. Update README feature-flag table.
6. Tests: 10 cases — clean run, tolerable run, violation run, single-period contribution, multi-period accumulation, FX translation case, OCI hedging reserves case.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/__tests__/cleanSurplus.spec.ts   # 10 cases green
# Golden: ITC clean (≤50bps), Reliance demerger period violation expected
```

---

## PR-5.3 — CAPM `ke` parameterized by year × sector (Damodaran)

**Branch:** `depth/capm-india-by-sector`
**Schema bump:** none
**Estimated diff:** +600 / -200, 2 new files, 1 data file

**Why:** Today `ke` is a single per-run number (likely 12-13% baseline). Damodaran publishes annual India ERP and per-sector betas. Using a year × sector lookup turns `ke` from "guessed" into "sourced", a defensibility win.

**Data sources:**
- `public/data/damodaran/india-erp.json` — annual equity risk premium time series, 2015-present
- `public/data/damodaran/india-rfr.json` — annual 10-year India sovereign yield (risk-free)
- `public/data/damodaran/sector-betas-india.json` — unlevered β by sector × year

**Target API:**

```ts
// src/engine/depth/capm.ts
export interface CapmInput {
  fiscalYear: number;             // e.g. 2025
  sectorCode: string;              // e.g. "FMCG", "BANKS", "IT_SERVICES"
  leverageRatio: PercentFraction;  // D/E for the company
  taxRate: PercentFraction;        // effective tax rate
}

export interface CapmResult {
  ke: PercentFraction;
  inputs: {
    rfr: PercentFraction;          // sourced from india-rfr.json
    erp: PercentFraction;          // sourced from india-erp.json
    unleveredBeta: number;          // sourced from sector-betas-india.json
    leveredBeta: number;             // computed: unleveredBeta × (1 + (1 - taxRate) × leverageRatio)
  };
  citations: {
    rfrSource: string;             // e.g. "Damodaran India RFR Jan 2025"
    erpSource: string;
    betaSource: string;
  };
}

export function computeCapmKe(input: CapmInput): CapmResult { ... }
```

**Steps:**

1. Curate Damodaran India data into the 3 JSON files. Each entry cites the source URL + retrieval date.
2. Create `src/engine/depth/capm.ts`.
3. Add `sectorCode` to `CompanyConfig` (registry update for golden 5).
4. Wire into valuation: replace the existing single-number `ke` with `computeCapmKe(...)`.
5. Surface citations in workbook (Cover sheet adds rfrSource, erpSource, betaSource rows; bumped in `docs/workbook-regression-contract.md`).
6. **Important:** add a fallback for years/sectors not in the data: use the closest year + base sector with a warning surfaced in the envelope.
7. Tests: 10 cases — every sector × year coverage, fallback warning, leverage adjustment correctness, citation completeness.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/__tests__/capm.spec.ts   # 10 cases green
# Golden: ITC FY25 ke ≈ 13.2% (Damodaran FMCG beta 0.55, leverage 0.05, ERP 8.12%, rfr 6.95%)
```

---

## PR-5.4 — Sum-of-the-parts for conglomerates

**Branch:** `depth/sotp-conglomerate`
**Schema bump:** v14 → v15 (adds `sotp` block to envelope)
**Estimated diff:** +1,200 / -150, 4 new files

**Why:** A conglomerate like Reliance Industries cannot be valued as a single entity. SOTP requires per-segment valuation with sector-appropriate multiples, then aggregation with a conglomerate discount. Today the segment data exists but isn't aggregated.

**Domain spec:**

For each segment:
- Identify its sector (consumer / energy / digital / financial / etc.)
- Run a sector-appropriate valuation lens (P/E for FMCG, EV/EBITDA for energy, EV/sales for digital, P/B for financial)
- Apply per-sector multiples sourced from peer comps (top 5 listed peers per sector)
- Sum, then apply conglomerate discount (15-25% per Damodaran India research)

**Target API:**

```ts
// src/engine/depth/sotp.ts
export interface SotpSegment {
  segmentName: string;
  sectorCode: string;
  revenue: INRCrore;
  ebitda: INRCrore;
  ebit: INRCrore;
  capitalEmployed: INRCrore;
  appliedLens: "PE" | "EV_EBITDA" | "EV_SALES" | "PB";
  appliedMultiple: number;
  peerSet: string[];                // peer ticker list for the multiple
  segmentValuation: INRCrore;
}

export interface SotpResult {
  segments: SotpSegment[];
  segmentSum: INRCrore;
  conglomerateDiscount: PercentFraction;
  postDiscountValue: INRCrore;
  netDebt: INRCrore;
  equityValue: INRCrore;
  equityValuePerShare: INRAbsolute;
  reconcilesWithMarket: { marketCap: INRCrore; impliedDiscount: PercentFraction };
}

export function computeSotp(input: SotpInput): SotpResult { ... }
```

**Steps:**

1. Create `src/engine/depth/sotp.ts`.
2. Define peer-set library: `public/data/peer-sets/<sector>.json` (5 peers each, top 8 sectors).
3. Wire SOTP into the conglomerate routing (an existing `conglomerateRouting.spec.ts` exists per file listing — extend).
4. Reliance Industries golden case (Plan v4 PR-F) MUST show SOTP output with at least 3 segments (refining, retail, digital).
5. Surface SOTP in ValuationReport.tsx with per-segment breakdown table.
6. Tests: 15 cases — single-segment passthrough, multi-segment aggregation, discount application, peer-set fallback, no-segments-data degradation.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/__tests__/sotp.spec.ts          # 15 cases
npx vitest run src/engine/__tests__/conglomerateRouting.spec.ts # extended cases
```

---

## PR-5.5 — Ind-AS 116 lease treatment + reconciliation

**Branch:** `depth/leases-indas-116`
**Schema bump:** v15 (envelope adds `leaseAccountingFlag`)
**Estimated diff:** +700 / -150, 2 new files

**Why:** Ind-AS 116 brought operating leases on-balance-sheet from FY20. For asset-heavy retailers (Avenue Supermarts, Future Retail, Trent), pre-FY20 numbers are not directly comparable to post-FY20 numbers without adjustment. RNOA changes by 200-400bps. Today the engine doesn't flag this.

**Domain spec:**

For each period:
- Detect right-of-use assets, lease liabilities (current + non-current), depreciation on RoU, finance cost on lease liability.
- Compute "as if pre-Ind-AS 116" RNOA: strip RoU from NOA, strip lease finance cost from NFE, restore operating lease expense to operating costs.
- Track period-over-period reconciliation: when transitioning FY19→FY20, the jump in NOA should equal RoU added; flag if it doesn't (data quality issue).
- Status:
  - All periods post-FY20 → `applied-uniformly`
  - All periods pre-FY20 → `not-applicable`
  - Mixed → `transitional`, with reconciliation check
  - Mixed without reconciliation → `inconsistent`, fails `economically-plausible`

**Target API:**

```ts
// src/engine/depth/leases.ts
export interface LeaseAccountingReport {
  status: "not-applicable" | "applied-uniformly" | "transitional" | "inconsistent";
  perPeriod: {
    period: string;
    rouAssets: INRCrore;
    leaseLiability: INRCrore;
    depreciationRou: INRCrore;
    financeCostLease: INRCrore;
    operatingLeaseExpense: INRCrore;  // pre-Ind-AS-116 equivalent
    rnoaPostStandard: PercentFraction;
    rnoaPreStandard: PercentFraction; // restated for comparability
  }[];
  transitionPeriod?: string;
  transitionReconciliationResidualPct?: PercentFraction;
  rigorImpact: "none" | "diagnostic" | "blocks-economically-plausible";
}

export function computeLeaseAccounting(recastData: RecastPeriod[]): LeaseAccountingReport { ... }
```

**Steps:**

1. Create `src/engine/depth/leases.ts`.
2. Bump schema to v15.
3. Surface in StatementsReport: side-by-side RNOA-pre and RNOA-post tables for asset-heavy companies.
4. Add Avenue Supermarts (DMart) golden expectations.json to test transitional treatment (FY19 pre-standard, FY20 onwards post-standard).
5. Add `VITE_RIGOR_LEASE_RECONCILIATION_BLOCK` feature flag.
6. Tests: 12 cases — pre-only, post-only, transition, transition reconciliation pass/fail, asset-light pass-through.

**Acceptance test:**

```bash
npx vitest run src/engine/depth/__tests__/leases.spec.ts        # 12 cases green
# Manual: DMart workbook shows transition-period reconciliation row
```

---

## Cross-cutting acceptance for Plan 5

```bash
# ─── Schema v15 landed ──────────────────────
grep TRACEABILITY_SCHEMA_VERSION src/engine/policyVersions.ts   # = "2026-06-traceability-v15"

# ─── analyticalDepth block populated ───────
grep -rn "analyticalDepth\\.reverseDcf\\|analyticalDepth\\.cleanSurplus\\|analyticalDepth\\.capm\\|analyticalDepth\\.sotp\\|analyticalDepth\\.leases" src/   # ≥ 5 hits

# ─── Citations are sourced ─────────────────
ls public/data/damodaran/                                       # 3 files present
ls public/data/peer-sets/                                       # ≥ 8 files

# ─── Suite green ───────────────────────────
npm run validate

# ─── Golden cases pass with depth ─────────
# - Reliance: SOTP shows ≥ 3 segments
# - DMart: transitional lease handling
# - ITC: clean-surplus pct < 50bps
# - HDFC Bank: CAPM ke uses BANKS sector
```

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Damodaran data is licensed | medium | Damodaran's tables are publicly published. Cite explicitly with retrieval-date URL. If licensing changes, swap to public RBI / SEBI data |
| Monte Carlo non-determinism breaks reproducibility | high | Seeded RNG (xmur3), seed surfaced in envelope. Same seed = same output, always |
| SOTP peer-set is judgmental | high | Peer-set comes from `public/data/peer-sets/<sector>.json` — versioned, citable. Reviewers can override |
| Lease detection misses non-standard balance-sheet labels | medium | Anchor detection to concept identity (Plan v4 PR-A); if "right-of-use assets" can't be identified, status = "data-quality-uncertain" |
| Multiple gates compound unintended fail-closed | high | Each gate is independently flag-controlled. Operational handoff doc updated with decision tree |

## Definition of done

10/10 means a CFA-level reviewer reads any envelope and sees:
1. Reverse DCF returns confidence interval and 5×5 sensitivity, not a point estimate
2. Clean-surplus residual is a single auditable number with a per-period walk
3. CAPM `ke` cites Damodaran year + sector with an explicit fallback for missing data
4. Conglomerates are SOTP-aggregated with peer-sourced multiples and conglomerate discount
5. Asset-heavy companies in the FY19→FY20 transition window flag inconsistent lease treatment
