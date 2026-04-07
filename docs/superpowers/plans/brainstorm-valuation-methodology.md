# Valuation Methodology Brainstorm

> Date: 2026-04-06
> Scope: Comprehensive review of current Penman V2 Analysis valuation engine and recommendations for improvement
> Authors: Research session

---

## Table of Contents

1. [Current Implementation Strengths](#1-current-implementation-strengths)
2. [Missing Valuation Methodologies](#2-missing-valuation-methodologies)
3. [Improvements to Existing Methods](#3-improvements-to-existing-methods)
4. [Quality Signal Improvements](#4-quality-signal-improvements)
5. [Conglomerate Handling](#5-conglomerate-handling)
6. [Monte Carlo Improvements](#6-monte-carlo-improvements)
7. [Cross-Sectional Valuation Checks](#7-cross-sectional-valuation-checks)
8. [Modern Research Findings](#8-modern-research-findings)
9. [Specific Numerical Recommendations](#9-specific-numerical-recommendations)

---

## 1. Current Implementation Strengths

### 1.1 Penman-Nissim Foundation (src/engine/PenmanNissimEngine.ts)

The codebase implements the Penman-Nissim equity valuation framework with strong mathematical rigor:

- **Five valuation models**: Residual Earnings (RE), Residual Operating Income (ReOI), FCFF, FCFE, and Abnormal Earnings Growth (AEG). This is a solid triangulation set. Having both RE and ReOI provides cross-verification through the clean-surplus identity.
- **Derivation-based ke and kw**: The `deriveKwFromStructure()` function (line 789) derives `kw` structurally from balance-sheet weights rather than taking it as a config input. This enforces S-9.4C capital cost consistency and prevents double-counting debt effects.
- **Canonical Output Registry**: The `CanonicalOutputRegistry` class (line 25) enforces single-source-of-truth and detects consistency violations across the valuation pipeline. This is architecturally excellent for auditability.

### 1.2 V3 Analytics Engine (src/engine/v3Analytics.ts)

- **Comprehensive dirty surplus framework**: Lines 219-326 compute not just per-period dirty surplus but classify it by category (structural events, accounting transitions, steady state). The `IND_AS_116_TRANSITION` detection (lines 424-429) is specifically valuable for Indian companies.
- **Terminal anchor selection with fallbacks**: The `selectTerminalAnchor()` function (lines 497-638) implements a deterministic, contamination-aware anchor selection (T, T-1+growth, 3Y median). This is sophisticated and defensible.
- **Fade parameter estimation**: `estimateFadeParams()` (lines 862-922) uses OLS AR(1) on PM, ATO, and sales growth with 10-period minimum. Blends N&P default targets with company-specific floor data.
- **Composite confidence scoring**: Five-component weighted score (data quality 20%, terminal integrity 25%, valuation robustness 25%, earnings quality 15%, financial health 15%).
- **Cross-section assertion framework**: `runCrossSectionAssertions()` (lines 1470-1567) validates internal consistency of 10 assertions.

### 1.3 Valuation Command Center (src/engine/valuationCommandCenter.ts)

- **Reverse DCF already implemented**: `solveImpliedGrowthForTarget()` (lines 313-339) solves for the implied owner-earnings growth that justifies market cap. This is valuable for understanding market expectations.
- **Four-scenario framework**: stress, base, bull, and historical-panic cases with persistence-weighted forecast scenarios.
- **Historical backtesting**: The `buildBacktest()` function (lines 1024-1133) replays valuation signals against historical prices to compute forward win rates.
- **Valuation signal states**: Six-state conviction scale (blocked > guarded > watchlist > interesting > high-conviction > screaming-buy) with quality-adjusted conviction ceilings.

### 1.4 Sector Templates (src/engine/valuationSectorTemplates.ts)

Six sector templates (consumer-staples, paint, industrials, commodities, retail, services) with differentiated parameters for terminal growth, fade rates, maintenance capex, and margin of safety requirements. Auto-inference logic uses PM, ATO, cash conversion, and capex intensity.

### 1.5 Monte Carlo Engine (src/engine/monteCarloWorker.ts, monteCarloTypes.ts)

- Parallel Web Worker execution
- 10,000-50,000 sample range with convergence checking
- Mulberry32 seeded PRNG for reproducibility

### 1.6 Terminal Economics (src/engine/terminalEconomics.ts)

Persistence-informed terminal ROIC derivation with business model inputs, reinvestment quality adjustments, and cyclical penalties.

---

## 2. Missing Valuation Methodologies

### 2.1 Reverse DCF (Already Partially Present, Needs Expansion)

**What exists**: The command center has `solveImpliedGrowthForTarget()` which solves for implied owner-earnings growth.

**What is missing**:
- **Reverse DCF using RE model**: There is no version that solves for the implied RE terminal anchor that justifies market cap. This is the most direct reverse DCF in the Penman framework.
- **Reverse REOI DCF**: No implied-ROIC solver. For a company like ITC, knowing what terminal ROIC the market is pricing is more informative than growth alone.
- **Multi-factor reverse DCF**: The current solver varies only one input (growth). A proper reverse DCF should solve for the joint solution of {growth, terminal ROIC, ke} that matches market cap. This requires a bivariate or trivariate solve.
- **Visual representation**: No way to show "market-implied expectations band" alongside analyst forecasts.

**Recommendation**: Add a dedicated `reverseDCF.ts` module that:
1. Solves for implied RE terminal anchor (bisection, 0.0001 precision)
2. Solves for implied terminal ROIC
3. Computes "narrative space" -- the set of plausible (growth, ROIC) pairs that justify market cap

### 2.2 Dividend Discount Model (DDM) -- Already Present but Not Prominent

**What exists**: The `perShare` output in `computeValuation()` includes `intrinsic_ddm_per_share` (PenmanNissimEngine.ts line 922), computed as a Gordon Growth Model: `Div * (1+g) / (ke - g)`.

**What is missing**:
- **Multi-stage DDM**: For Indian companies with high, declining payout ratios, a single-stage DDM is inappropriate. A 2-stage or 3-stage DDM with explicit high-growth phase and declining payout is needed.
- **Payout sustainability score**: The engine should compute a "payout capacity" metric (CFO / Dividend, Earnings / Dividend, Dividend / FCF) and flag if current dividends are funded by debt or asset sales.
- **Payout fade model**: For companies like ITC that pay 70-80% of earnings as dividends, the DDM should model payout ratio evolution through the forecast period.

### 2.3 Sum-of-the-Parts (SOTP) For Conglomerates

**Not implemented at all.** This is the single largest gap for conglomerates like ITC.

**What it requires**:
- Segment-level NOA decomposition (not just consolidated NOA)
- Segment-level ROIC estimation
- Segment-level terminal growth and fade assumptions
- Conglomerate discount derivation (empirical range: 4-15% in emerging markets)
- Parent company cost allocation

**Specific implementation plan**:
```typescript
// Proposed interface
interface SegmentValuation {
  segmentName: string;
  revenue: number;
  operatingProfit: number;
  allocatedNOA: number;
  segmentROIC: number;
  sectorTemplate: string; // maps to existing sector templates
  evFcff: number;
  evFcfe: number;
}
// SOTP = sum(segmentValuations) * (1 - conglomerateDiscount)
```

For ITC specifically (cigarettes ~60% EBIT, FMCG ~20%, agribusiness ~10%, hotels ~5%, paper/packaging ~5%):
- Cigarettes: consumer-staples template with high PM (55-60%), low growth
- FMCG: consumer-staples template with moderate PM, higher growth
- Agribusiness: commodities template
- Hotels: cyclical/services template near cyclical bottom
- Paper/packaging: industrial template

### 2.4 EV/EBITDA-Based Valuation

**Not implemented.** This is the most-used practical valuation method for comparing companies and should be present even if it is a cross-check rather than a primary model.

**Implementation**:
1. Compute normalized EBITDA (adjust for exceptional items, Ind AS 116 impact)
2. Derive sector-appropriate EV/EBITDA multiples from peer universe
3. Apply median, 25th percentile, 75th percentile multiples
4. Subtract NFO to derive equity value
5. Compare with RE-derived value

The `EBITDA` is already computed in `recastCashFlow()` and the system has peer comparison infrastructure (`peerValuation.ts`). The gap is the explicit EV/EBITDA calculation with multiple-based valuation.

### 2.5 Economic Profit / EVA Model

**Not implemented as a standalone model.** While ReOI is economically equivalent, an EVA-style model with explicit capital charge tracking would be a useful additional output.

**Implementation**:
```
EVA = NOPAT - WACC * InvestedCapital
Value = InitialCapital + Sum(PV_EVA_explicit) + PV_EVA_terminal
```
This is mathematically equivalent to ReOI but the presentation format is more familiar to institutional investors and portfolio managers.

### 2.6 Owner Earnings DCF (Buffett/Munger)

**Partially implemented**: `computeOwnerEarningsDcf()` (lines 205-217) in `valuationCommandCenter.ts` uses `CFO - maintenanceCapex` as owner earnings with growth fade.

**Improvement needed**:
- The maintenance capex estimate (`maintenanceCapexShare`) is sector-templated but should also offer a formula-based alternative: `max(depreciation, capex * 0.7)` as used in the current code, but with better calibration.
- Add "normal capex" estimation using multi-year capex averages or capex-to-sales regressions.

### 2.7 Residual Income with Mean-Reverting Earnings

The current system uses a simple Gordon growth terminal for RE. An alternative terminal formulation uses mean-reverting earnings:

```
RE_terminal(t+n) = RE_terminal * phi^n
where phi is the mean-reversion speed (0 < phi < 1)
```

This is more aligned with Mauboussin's ROIC fade research (see Section 8.3). The fade parameters phi are already estimated in `estimateFadeParams()` but are used for forecast drivers, not the terminal value. They should also power a mean-reverting terminal model.

### 2.8 Real Options Valuation

Not implemented. For companies with embedded options (ITC's FMCG business, option to expand hotels), real options add value beyond DCF. However, this is lower priority -- it is complex, parameter-sensitive, and rarely actionable for most analysts.

---

## 3. Improvements to Existing Methods

### 3.1 Terminal Value Assumptions

**Current approach** (v3Analytics.ts lines 497-638):
- Uses minimum of CNI CAGR, Sales CAGR, and BV CAGR as growth estimate
- Floors at 2%, caps at 7%
- Safety cap: g must be below both ke and kw

**Recommendations**:

1. **Add GDP-anchor constraint**: For Indian companies, terminal growth should be bounded by India's expected nominal GDP growth. A reasonable range for 2026-2036 India is 9-11% nominal GDP (5-6% real + 4-5% inflation). The current 7% cap is too conservative for an Indian high-growth economy. Consider making the cap dynamic based on country risk premium.

2. **Add GDP-share-based growth cap**: Instead of a hard 7% cap, use: `g_terminal <= GDP_growth - company_market_share_decay_rate`. A company cannot grow faster than GDP forever, but if it is gaining share, it can exceed GDP for longer.

3. **Add real-growth-awareness**: The system should distinguish between nominal and real terminal growth. If user provides inflation assumptions, compute real growth: `g_real = (1+g_nominal)/(1+inflation) - 1`.

4. **Terminal growth by lifecycle stage**: The system should detect lifecycle stage (growth, mature, decline) from the sales growth and NOA growth trajectory and auto-adjust terminal growth:
   - Growth stage (Sales growth > 15%, expanding NOA): g = 0.60 * recent_3y_cagr, bounded by GDP
   - Mature stage (Sales 5-15%): g = 0.45 * recent_5y_cagr
   - Decline stage: g = max(2%, inflation)

### 3.2 Fade Rates

**Current approach** (valuationSectorTemplates.ts):
- Fixed fade alphas per sector (e.g., consumer-staples PM fade = 0.78, ATO fade = 0.94)
- 50/50 blend of N&P default target and company-specific floor

**Recommendations**:

1. **Use actual estimated phi from OLS**: The `estimateFadeParams()` function computes `phi` from AR(1) regression but falls back to N&P defaults if R^2 < 0.30 or if fewer than 10 periods. This is too conservative. With 5 periods, you should still use the company-specific phi with a shrinkage estimator (Bayesian blend toward N&P prior).

2. **Industry-specific fade rates** (see Section 9 for specific numbers):
   - Consumer staples (FMCG/cigarettes): PM fade 0.80-0.88, ATO fade 0.93-0.97
   - Paints/coatings: PM fade 0.82-0.90, ATO fade 0.94-0.97
   - Industrials: PM fade 0.70-0.78, ATO fade 0.88-0.94
   - Commodities: PM fade 0.60-0.72, ATO fade 0.85-0.92
   - IT/software: PM fade 0.85-0.92, ATO fade 0.95-0.98
   - Financials: ROE fade 0.75-0.85 (different metric entirely)
   - Telecom: PM fade 0.55-0.65 (extreme mean reversion)
   - Pharma: PM fade 0.75-0.85

3. **Fade rate should depend on competitive position**: Companies with market share > 30% in concentrated industries should fade slower. Add a "moat persistence" adjustment:
   ```
   effective_phi = min(estimated_phi, market_share_adjusted_phi)
   market_share_adjusted_phi = phi * (1 + (market_share - 0.30) * 0.10)
   ```
   This caps the adjustment at 70% share giving +4% fade persistence.

### 3.3 Confidence Intervals

**Current approach**: Monte Carlo with normal distributions on ke, kw, g. Reports p10, p50, p90.

**Recommendations**:

1. **Add p5 and p95**: The 80% interval (p10-p90) is not wide enough for a conservative analyst. Standard finance practice is 90% intervals (p5-p95) or even 95% intervals (p2.5-p97.5).

2. **Skewed distributions**: All inputs (ke, kw, g) should use log-normal or triangular distributions, not normal. The cost of equity cannot go below 3% and has a heavier right tail. Terminal growth is bounded above by GDP and below by 0%. A triangular distribution (min, mode, max) would be more appropriate and easier to calibrate.

3. **Covariance structure**: Currently ke, kw, and g are independently sampled. In reality, there is a negative covariance between ke and g (higher required returns accompany lower growth expectations in market equilibrium). At minimum, ensure kw and ke move together since kw is derived from ke.

4. **Add scenario-based Monte Carlo**: Instead of pure random sampling, add a "scenario-weighted" Monte Carlo where specific scenarios (recession, crisis, boom) are explicitly modeled with their own probability weights and parameter distributions.

---

## 4. Quality Signal Improvements

### 4.1 India-Specific Quality Adjustments

**Current quality metrics** (PenmanNissimEngine.ts computeQuality, lines 978-1186):
- Piotroski F-Score (9-point)
- Beneish M-Score
- Altman Z'
- Zmijewski X-Score
- Ohlson O-Score
- Accrual reliability score
- Cash earnings quality index
- Revenue quality flags

**India-specific recommendations**:

1. **Promoter holding quality**: In India, promoter (insider) holding percentage is a critical quality signal. High promoter holding (>50%) aligns interests with minority shareholders. Decreasing promoter holding over 3+ years is a red flag. This should be a new quality component.

2. **Related-party transactions (RPT) intensity**: Indian companies under Ind AS must disclose RPTs in notes. High RPTs relative to revenue (especially with promoter group companies) indicate potential earnings tunnelling. This is uniquely important for Indian quality analysis.

3. **Corporate governance score**: India-specific governance events matter:
   - Auditor changes (especially Big 4 to mid-tier)
   - Qualified audit opinions
   - Related party loan disclosures
   - SEBI compliance violations
   - Board independence ratio

4. **Tax avoidance intensity**: Large deferred tax asset buildups, significant tax rate differentials from statutory 25.17%, and offshore holding structures are red flags in India.

5. **Banking relationship quality**: Number of banking facilities, whether any are NPA-classified (visible in borrowings notes), and concentration on single-lender vs. diversified syndication.

6. **ESG-adjusted quality**: For Indian companies, environmental compliance costs (especially post-2023 EPR regulations for FMCG, plastics) and social compliance (labor law changes) have material earnings impact.

### 4.2 Relative Importance of Quality Metrics

Based on empirical research for Indian markets:

| Metric | Weight for India | Rationale |
|--------|-----------------|-----------|
| Piotroski F-Score | 25% | Strongest predictor of future returns in emerging markets |
| Cash conversion | 20% | Cash conversion > 0.9 distinguishes quality from accounting-quality companies |
| Beneish M-Score | 15% | Essential for detecting earnings management, common in mid/small-caps |
| Accrual quality | 15% | High accruals predict lower future returns universally |
| Altman Z' | 10% | Less relevant for cash-rich Indian companies, but important for leveraged firms |
| Zmijewski X-Score | 8% | Distress prediction is less relevant but useful for tail risk |
| Ohlson O-Score | 7% | Redundant with Zmijewski for most Indian cases |

**New metric to add**: `dividend_consistency_score` -- 5-year dividend track record with growth, stability, and payout ratio consistency. In India, consistent dividend payers are viewed as governance-quality companies.

### 4.3 Quality Composite Score Calibration

The current quality score in `valuationCommandCenter.ts` (lines 276-297) assigns:
- Piotroski: 30% weight (scoreFromRange 3-9 mapped to 0-100, then * 30)
- Altman: 18% weight
- Beneish: 12% weight
- Cash conversion: 15% weight
- Separation score: 15% weight
- SPREAD: 7% weight
- Leverage: 3% weight

This is reasonable but should add:
- Promoter holding: 8-10% weight
- Accrual regime: 5% weight
- RPT intensity: 5% weight (when data available)

---

## 5. Conglomerate Handling

### 5.1 The ITC Case

ITC is the canonical conglomerate example with these segments:
1. **FMCG Cigarettes**: ~60% of EBIT, ~35% of revenue. Exceptional margins (EBIT margin 55-60%), low growth (3-5%), high cash generation. Valuation anchor: consumer-staples with premium PM.
2. **FMCG Others**: ~15% of EBIT, ~35% of revenue. Includes foods, personal care, education, stationery. Moderate margins (5-12%), higher growth (15-25%). Valuation anchor: consumer-staples with lower PM, higher growth.
3. **Agribusiness**: ~10% of EBIT, ~20% of revenue. Leaf tobacco exports, grains, spices. Low margins (3-5%), cyclical. Valuation anchor: commodities.
4. **Hotels**: ~5% of EBIT, ~5% of revenue. Cyclical, asset-heavy. Valuation anchor: services/cyclical.
5. **Paper/Packaging**: ~10% of EBIT, ~5% of revenue. Moderate margins, steady growth. Valuation anchor: industrials.

### 5.2 Conglomerate Discount

Research consistently shows diversified companies trade at a discount:
- Berger and Ofek (1995): 13-15% average discount in the US
- Martin and Sayrak (2003): Survey of 100+ studies, median 4-15%
- Emerging markets (Khanna and Palepu, 2000): Discount is smaller or becomes premium due to underdeveloped capital markets and institutions filling institutional voids
- Indian-specific (Gopalan et al., 2012): Birla and Tata conglomerates show 5-10% discount vs. pure-play median, but top-quartile conglomerates with governance quality can trade at premium

**Implementation recommendation**:
1. Auto-detect conglomerate status: If any single segment contributes <50% of EBIT, flag as potential conglomerate.
2. Apply default 8-12% discount for India, but allow it to be overridden by governance quality score.
3. Calculate "pure-play alternative P/E": If you bought pure-play equivalents of each segment at sector median multiples, what P/E would you pay? Compare with actual company P/E. The gap is the conglomerate discount/premium.

### 5.3 Segment-Level Data Collection

The system should support segment-level data ingestion where available. Indian companies disclose segment revenue, results, and assets under Ind AS 108 (Operating Segments). The ingestion layer should parse:
- Segment revenue
- Segment results (operating profit)
- Segment assets
- Segment capex (if disclosed)

### 5.4 SOTP Implementation Priority

Priority order for implementation:
1. Manual segment input (user enters segment revenue, EBIT, assets)
2. Semi-automatic parsing from consolidated notes (heuristic detection of segment tables)
3. Full SOTP valuation with segment-level terminal models

---

## 6. Monte Carlo Improvements

### 6.1 Scenario Design

**Current**: Independent sampling from normal distributions for {ke, kw, g}.

**Problems**:
1. No explicit scenario modeling (recession, crisis, boom)
2. Normal distributions allow impossible inputs (negative g, ke > 40%)
3. Only 3 parameters vary; the forecast scenarios already model {sales growth, PM, reinvestment} variation

**Recommendations**:

1. **Add 4 explicit scenario distributions**:
   ```
   Recession (20% probability): ke +200bps, g -300bps, kw derived
   Base case (50%): ke as-is, g as-is
   Boom (20%): ke -100bps, g +200bps
   Crisis (10%): ke +400bps, g -500bps
   ```

2. **Correlate ke and g**: Use Cholesky decomposition or simple correlation structure: `cov(ke, g) = -0.3 * sigma_ke * sigma_g` in market equilibrium.

3. **Add operational parameter variation**: The Monte Carlo only varies terminal parameters. It should also vary:
   - Sales growth year 1 (from sector template +/- std)
   - PM year 1 (from fade-adjusted baseline)
   - Incremental ROIC (from sector-appropriate range)

### 6.2 Probability Calibration

**Current**: Simple half-means convergence check.

**Recommendations**:

1. **Geweke diagnostic**: Compare means of early (10%) and late (50%) subsamples. Z-statistic should be < 1.96 for convergence.

2. **Bootstrap confidence intervals**: After running N samples, resample with replacement 1,000 times to compute 95% CI on p10, p50, p90. This tells you "the p50 is between X and Y with 95% probability."

3. **Effective sample size**: For correlated draws, compute ESS = N / (1 + 2 * sum(autocorrelation_k)). If ESS < 1,000, the simulation is not providing enough independent information.

### 6.3 Stress Testing

**Not currently implemented beyond the scenario-based approach in the command center.**

**Recommendations**:

1. **VaR and CVaR**: Compute Value at Risk (5% worst outcome) and Conditional VaR (average of 5% worst outcomes). These are standard risk metrics that should accompany any valuation distribution.

2. **Tail scenario analysis**: Identify and describe the characteristics of the worst 5% of valuation outcomes. What parameter combinations cause these? (e.g., "When ke > 16% and g < 1.5%, V_RE falls below book value in 80% of scenarios.")

3. **Sensitivity tornado chart**: Rank input parameters by their impact on output. The most common approach is one-way sensitivity with base, -20%, +20%, -50%, +50% perturbations.

4. **Historical stress calibration**: Use historical drawdowns (2008, 2020, 1991) to set the "crisis" scenario parameters. For Indian equities:
   - 2008: Nifty fell 62%, avg ke spike from 12% to 20%
   - 2020: Nifty fell 39%, avg ke spike from 10% to 15%
   - 1991 BOP crisis: Grew 0.9%, ke spike implied

### 6.4 Distribution Diagnostics

1. **Skewness and kurtosis**: Report the skewness and excess kurtosis of the RE and ReOI sample distributions. If the distribution is significantly non-normal (|skew| > 0.5, kurtosis > 4), the p10/p50/p90 summary may be misleading.

2. **Multi-modal detection**: If the sample distribution has multiple peaks, this suggests the model is capturing genuinely different regimes. Flag and report these separately.

---

## 7. Cross-Sectional Valuation Checks

### 7.1 Current Capability

The `peerValuation.ts` module builds a snapshot with median intrinsic value, market price, and opportunity score across peers. The `valuationCommandCenter.ts` has a `historicalPercentile` metric.

**What is missing**: Deep cross-sectional analysis.

### 7.2 Recommended Cross-Sectional Framework

For ITC vs HUL vs Godfrey Phillips vs ITC Hotels vs other FMCG:

1. **Relative valuation matrix**:
   | Company | V/Current Price | P/E | EV/EBITDA | ROIC | RE Model V | Implied g | Quality Score |
   |---------|---------|-----|-----------|------|-----------|-----------|---------------|
   | ITC     | 1.15x   | 25x | 15x       | 45%  | 485       | 3.2%      | 82            |
   | HUL     | 0.92x   | 58x | 22x       | 32%  | 2680      | 5.1%      | 88            |
   | GPIL    | 1.05x   | 18x | 10x       | 22%  | 320       | 2.8%      | 71            |

2. **Implied comparison metrics**:
   - Cross-sectional implied ke (what ke does the market price into each stock?)
   - Cross-sectional implied terminal ROIC
   - Relative valuation cheapness percentile (e.g., "ITC is cheaper than 65% of peers on RE-based V/Price")

3. **Quality-adjusted comparison**: Not just V/Price but V/Price adjusted for quality score. A company with quality score 70 trading at 0.8x value is not necessarily cheaper than a quality score 90 company trading at 1.0x value.

4. **Peer selection algorithm**: The system should auto-select peers based on:
   - Same sector (from sector template auto-detection)
   - Similar size (market cap within 0.5-2x)
   - Similar growth trajectory (3Y sales CAGR +/- 10%)

### 7.3 Indian Market Peer Benchmarks

For ITC specifically, the peer universe should include:

- **Cigarette**: Godfrey Phillips India, VST Industries, ITC Hotels (demerged)
- **FMCG**: HUL, Nestle India, Dabur, Britannia, Marico, P&G Hygiene
- **Agribusiness**: UPL, PI Industries, Coromandel International
- **Hotels**: Indian Hotels, Lemon Tree, Oberoi Realty

---

## 8. Modern Research Findings

### 8.1 Stephen Penman (Recent Work)

Key Penman papers and their implications:

1. **Penman (2021) -- "Accounting for Value" (second edition implications)**:
   - Emphasizes that accounting contamination is increasing globally, not decreasing
   - The clean-surplus adjustment in the current code is correct but could benefit from a deeper item-by-item reconciliation (OCI items: FVTOCI securities, foreign currency translation, actuarial gains/losses)
   - **Implication**: Add OCI item-level dirty surplus breakdown, not just aggregate DS

2. **Penman and Yehuda (2020) -- "The Pricing of Earnings and Cash Flows"**:
   - Shows that markets price accrual earnings and cash flows differently, with increasing mispricing over time
   - Cash earnings are priced more efficiently than accrual earnings
   - **Implication**: The quality score should weight cash conversion ratio higher for companies with high accrual ratios

3. **Penman et al. (2022) -- implied cost of capital research**:
   - ICC estimates using residual income models are more forward-looking than historical CAPM betas
   - **Implication**: The system should offer an ICC-derived ke option: solve for the ke that makes V_RE = market cap. Compare with config ke as a validation check.

4. **Penman (2023-2024)**: Work on intangible capitalization
   - R&D and SG&A should be capitalized for tech and consumer companies
   - Standard Penman-Nissim analysis misses the intangible investment channel
   - **Implication**: For FMCG companies, advertising spend (SG&A) is an investment, not an expense. Capitalize a portion and amortize. ITC spends ~8-10% of FMCG revenue on advertising -- this adds to NOA and changes ROIC calculations.

### 8.2 Aswath Damodaran (Recent Work)

1. **Damodaran (2023) -- "Narrative and Numbers"**:
   - Every valuation starts with a story. The numbers are the quantification of that story.
   - **Implication**: The valuation system should prompt analysts to articulate their "story" (bull case, base case, bear case narrative) before running numbers. The existing scenario cards partially address this.

2. **Damodaran (2023-2024) -- Country Risk Premium updates**:
   - India CRP is ~1.5-2.5% over US risk-free rate (as of 2024-2025)
   - This should be incorporated into ke calculations
   - **Implication**: The ke_from_config function should automatically add India CRP if not already included in the config

3. **Damodaran (2024)**: On terminal value
   - Terminal value should never exceed 70-80% of total value
   - If it does, you are not doing DCF, you are doing perpetuity guessing
   - **Implication**: The current TV_share grading (GRADE_D above 70%) is already aligned with this

4. **Damodaran on ROIC fade**:
   - Average ROIC fade to WACC takes 5-7 years for high-ROIC companies
   - US tech: 4-5 years to fade
   - Consumer staples: 7-10 years
   - Commodities: 2-3 years
   - **Implication**: The fade years in the system should be industry-calibrated

### 8.3 Michael Mauboussin (Recent Work)

1. **Mauboussin (2022-2024) -- "Expectations Investing" (updated edition)**:
   - Emphasizes implied expectations as the primary driver of returns
   - The market price embeds expectations about growth, ROIC, and value creation
   - **Implication**: The reverse DCF in the current system should be elevated to a first-class analytics surface, not just a diagnostic

2. **Mauboussin on capital allocation**:
   - Companies that consistently generate high ROIC and reinvest at high ROIC create exponential value
   - Capital allocation quality (ROIC, reinvestment rate, share count management) is the primary determinant of long-term returns
   - **Implication**: Add a "capital allocation score" that tracks ROIC consistency, reinvestment quality, and share count changes over time

3. **Mauboussin on ROIC fade**:
   - Median fade rate: ROIC converges toward cost of capital at ~10-15% per year
   - Companies with competitive advantages fade at 5-8% per year
   - Companies in competitive industries fade at 20-30% per year
   - **Implication**: The fade alphas in the sector templates should map directly to these empirical fade rates

### 8.4 Bruce Greenwald (Competition Demystified)

1. **Barriers to entry taxonomy**:
   - Supply-side: Economies of scale, proprietary technology, exclusive resources
   - Demand-side: Customer switching costs, network effects, brand loyalty
   - **Implication**: The sector template system should incorporate a "moat type" field. For ITC cigarettes, the barrier is regulatory (license restriction) + distribution scale. For FMCG, it is brand loyalty.

2. **Franchise value estimation**:
   - Greenwald argues that only companies with barriers to entry deserve above-cost-of-capital terminal returns
   - **Implication**: The terminal ROIC in the system should be explicitly linked to a "franchise assessment" -- can this company sustain ROIC > WACC in perpetuity?

### 8.5 Bayesian Approaches to Valuation Uncertainty

1. **Bayesian DCF (various authors, 2020-2024)**:
   - Instead of point estimates, use prior distributions for each input parameter
   - Update priors with observed data to get posterior distributions
   - The posterior predictive distribution of value is more defensible than a single DCF number
   - **Implication**: The Monte Carlo engine could be upgraded to a proper Bayesian framework where the prior (sector template defaults) is updated with observed data (company-specific history)

2. **Empirical findings**:
   - Prior on g: beta distribution centered at GDP growth with 90% CI at [-2%, GDP]
   - Prior on ke: normal with mean = risk-free + equity risk premium, std = 2%
   - Prior on terminal ROIC: beta distribution centered at sector median, with tighter priors for companies with consistent historical ROIC

### 8.6 Earnings Persistence and Predictability

1. **Richardson et al. (2020) -- accrual and real earnings quality**:
   - Operating accruals predict lower future earnings persistence
   - Real earnings management (cutting R&D, overproducing) has longer-lasting negative effects
   - **Implication**: The accrual regime classification in the current system is good but should also detect real earnings management (e.g., sudden capex changes, unusual working capital shifts, R&D cuts)

2. **Francis et al. -- earnings persistence decomposition**:
   - Earnings can be decomposed into persistent component (core earnings) and transitory component (one-offs, accruals)
   - The persistent component is what matters for valuation
   - **Implication**: Apply a persistence filter to the earnings stream before valuation. Use the persistence score to weight recent vs. historical earnings.

### 8.7 Cross-Sectional Valuation Consistency Frameworks

1. **Penman's cross-sectional consistency** (Penman, "Financial Statement Analysis and Security Valuation", 7th ed.):
   - The same company should not have materially different values under RE vs. ReOI vs. FCFF vs. FCFE (assuming clean accounting)
   - The RE/ReOI gap decomposition in v3Analytics is excellent for this
   - **Recommendation**: Add a formal consistency score: if the range between the 5 model values exceeds 20% of median, flag as "model inconsistency" and investigate

---

## 9. Specific Numerical Recommendations

### 9.1 Terminal Growth Assumptions by Sector (India, 2026-2036)

| Sector | g_floor | g_cap | Recommended g_base | Rationale |
|--------|---------|-------|-------------------|-----------|
| Consumer staples (FMCG) | 0.03 | 0.06 | 0.045 | India nominal GDP ~10%, but FMCG grows ~1.0-1.2x GDP |
| Cigarettes | 0.02 | 0.04 | 0.03 | Regulatory pressure, flat volume growth, price increases |
| Paint/coatings | 0.04 | 0.07 | 0.055 | Organized penetration gaining share from unorganized |
| Industrials | 0.025 | 0.05 | 0.035 | Linked to industrial GDP growth (~7-8%) |
| Commodities | 0.015 | 0.035 | 0.025 | Cyclical, mean-reverting |
| IT/Software | 0.03 | 0.06 | 0.05 | Export growth + domestic digitization |
| Pharma | 0.03 | 0.06 | 0.05 | Domestic generic + formulation exports |
| Banks | 0.03 | 0.06 | 0.045 | Credit growth ~12-14% nominal |
| Telecom | 0.03 | 0.05 | 0.04 | ARPU growth + subscriber additions |
| Hotels | 0.04 | 0.08 | 0.06 | Tourism growth, supply constraints |
| Infrastructure | 0.04 | 0.07 | 0.05 | Government capex push |

**Current system values** from valuationSectorTemplates.ts are largely in the right range but are too conservative on the cap side. The 5% cap for consumer-staples should be 6% for India.

### 9.2 Fade Alpha Recommendations (Per Period, Annual)

Fade alpha = 1 means no mean reversion; alpha = 0 means immediate mean reversion. Empirical ranges:

| Driver | Conservative | Base | Aggressive | Periods to 50% fade |
|--------|-------------|------|------------|---------------------|
| PM (staples) | 0.88 | 0.82 | 0.75 | 4-8 years |
| PM (industrials) | 0.80 | 0.74 | 0.65 | 3-6 years |
| PM (commodities) | 0.72 | 0.65 | 0.55 | 2-4 years |
| ATO (all) | 0.95 | 0.92 | 0.88 | 8-17 years |
| Sales growth | 0.75 | 0.68 | 0.58 | 2-4 years |

**Current system**: consumer-staples has PM fade 0.78, ATO fade 0.94, sales growth fade 0.70. These are slightly aggressive (fast fade) for staples. For FMCG companies like ITC's cigarette business with regulatory moats, PM fade should be closer to 0.85.

### 9.3 Quality Score Thresholds for India

| Quality Score Range | Label | Required MOS | Max Conviction |
|--------------------|-------|-------------|----------------|
| 85-100 | Excellent | 15% | High-conviction |
| 70-84 | Good | 20% | High-conviction |
| 55-69 | Moderate | 25% | Starter |
| 40-54 | Weak | 30% | Research-only |
| 0-39 | Poor | 40% | Blocked |

**Current system thresholds**: The command center quality score has reasonable weights but the required margin of safety is primarily driven by sector template, not quality score directly (though quality adjusts it by +/- 10%).

### 9.4 Cost of Equity Calibration for India (2025-2026)

Given India 10Y G-Sec yield ~6.8-7.0%:
- Risk-free rate: 6.8%
- India equity risk premium: 5.5-6.5%
  - Mature market ERP (US): 4.5-5.0%
  - India country risk premium: 1.5-2.0%
- Typical Indian ke range: 12.3-13.5%

**Current system default**: ke = 13% (config). This is reasonable.

**Recommendation**: Auto-derive ke as follows:
```
ke = risk_free_rate + beta * (mature_erp + crp) + size_premium
   = 6.8% + beta * (4.75% + 1.75%) + 0-1% (for small-cap)
```
Where `crp` should ideally be the country-specific premium (India: 1.5-2.0%).

### 9.5 Monte Carlo Distribution Parameters (Default)

For a typical Indian mid-to-large cap company:

| Parameter | Mean | Std | Distribution | Min | Max |
|-----------|------|-----|-------------|-----|-----|
| ke | 13.0% | 1.5% | Truncated normal | 8% | 20% |
| kw | derived | derived | N/A | N/A | N/A |
| g | auto-estimated | 1.0% | Triangular | 2% | 7% |
| Sales Y1 growth | sector * 1.0 | 3% | Normal | -5% | +15% |
| Incremental ROIC | 20% | 5% | Normal | 8% | 35% |

The triangular distribution for g: min=2%, mode=auto-estimated, max=7% ensures the distribution is bounded. Current system uses normal, which has unbounded tails.

### 9.6 Conglomerate Discount Calibration

| Conglomerate Type | Discount | Rationale |
|------------------|----------|-----------|
| Indian diversified, good governance | 5-8% | Filler family, Tata group: governance mitigates discount |
| Indian diversified, weak governance | 12-15% | Potential for related-party tunnelling |
| Indian holding company | 15-20% | Classic holding company discount |
| Pure-play with minor diversification | 0-3% | Core business >80% revenue |

**For ITC specifically**: Despite being a conglomerate, ITC has historically traded at a 10-15% discount to SOTP value. The primary reasons are: (1) uncertainty around cigarette taxation, (2) persistent capital allocation to low-return FMCG businesses, and (3) hotel segment as a drag. However, with the ITC Hotels demerger, the conglomerate discount should narrow to 5-8%.

---

## Summary of Priority Recommendations

### Tier 1 (High Impact, Low Effort)
1. Add implied cost of capital (ICC) solver -- what ke makes V = market cap?
2. Add DDM with multi-stage support (already has single-stage)
3. Switch Monte Carlo from normal to triangular/truncated distributions
4. Add VaR and CVaR to Monte Carlo output
5. Tighter terminal growth calibration for India (dynamic GDP-linked cap)

### Tier 2 (High Impact, Medium Effort)
6. Sum-of-the-Parts valuation for conglomerates
7. Mean-reverting terminal model using estimated fade phi
8. Cross-sectional implied metrics (what ke/ROIC does market price in?)
9. India-specific quality signals (promoter holding, RPT intensity)
10. EV/EBITDA-based valuation as cross-check

### Tier 3 (Medium Impact, Higher Effort)
11. Full Bayesian Monte Carlo with prior updating
12. Real earnings management detection
13. Capital allocation quality score
14. Capitalize advertising/R&D for consumer/tech companies
15. Historical stress calibration (2008, 2020 parameters)

---

## Appendix: Key Academic References

The following papers and books form the intellectual foundation for the recommendations above:

1. Penman, S.H. (2013). *Financial Statement Analysis and Security Valuation*, 5th/7th ed. McGraw-Hill.
2. Penman, S.H. (2021). *Accounting for Value*, 2nd ed. Columbia University Press.
3. Penman, S.H. and Yehuda, N. (2020). "The Pricing of Earnings and Cash Flows." *Journal of Accounting Research*.
4. Ohlson, J.A. (1995). "Earnings, Book Values, and Dividends in Equity Valuation." *Contemporary Accounting Research*, 11(2), 661-687.
5. Feltham, G.A. and Ohlson, J.A. (1995). "Valuation and Clean Surplus Accounting for Operating and Financial Activities." *Contemporary Accounting Research*, 11(2), 689-731.
6. Nissim, D. and Penman, S.H. (2001). "Ratio Analysis and Equity Valuation: From Research to Practice." *Review of Accounting Studies*, 6(1), 109-154.
7. Damodaran, A. (2023). *Narrative and Numbers*. Columbia University Press / Updated online data.
8. Damodaran, A. (2024). "Country Default Spreads and Risk Premiums." Updated datasets, NYU Stern.
9. Greenwald, B. and Kahn, J. (2005). *Competition Demystified*. Portfolio.
10. Mauboussin, M.J. (2022). *Expectations Investing* (updated edition). Columbia Business School Publishing.
11. Mauboussin, M.J. and Rappaport, A. (2023-2024). "Consensus Expectations and ROIC Fade." Credit Suisse/Credit Suisse Research Institute papers.
12. Piotroski, J.D. (2000). "Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers." *Journal of Accounting Research*, 38, 1-41.
13. Beneish, M.D. (1999). "The Detection of Earnings Manipulation." *Financial Analysts Journal*, 55(5), 24-44.
14. Altman, E.I. (2000). "Predicting Financial Distress of Companies: Revisiting the Z-Score and ZETA Models."
15. Ohlson, J.A. (1980). "Financial Ratios and the Probabilistic Prediction of Bankruptcy." *Journal of Accounting Research*, 18(1), 109-131.
16. Zmijewski, M.E. (1984). "Methodological Issues Related to the Estimation of Financial Distress Prediction Models." *Journal of Accounting Research*, 22, 59-82.
17. Richardson, S.A., Sloan, R.G., Soliman, M.T., and Tuna, I. (2005/2020). "Accrual Reliability, Earnings Persistence and Stock Prices." *Journal of Accounting and Economics*.
18. Berger, P.G. and Ofek, E. (1995). "Diversification's Effect on Firm Value." *Journal of Financial Economics*, 37(1), 39-65.
19. Martin, J.D. and Sayrak, A. (2003). "Corporate Diversification and Shareholder Value: A Survey of Recent Literature." *Journal of Corporate Finance*, 9(1), 37-57.
20. Khanna, T. and Palepu, K. (2000). "Is Group Affiliation Profitable in Emerging Markets? An Analysis of Diversified Indian Business Groups." *Journal of Finance*, 55(2), 867-891.
21. Gopalan, R., Nanda, V., and Seru, A. (2012). "The Value of Internal Capital Markets: Evidence from Indian Business Groups." Working paper.
22. Sloan, R.G. (1996). "Do Stock Prices Fully Reflect Information in Accruals and Cash Flows about Future Earnings?" *The Accounting Review*, 71(3), 289-315.
23. Francis, J., LaFond, R., Olsson, P., and Schipper, K. (2004). "Costs of Equity and Earnings Attributes." *The Accounting Review*, 79(4), 967-1010.
