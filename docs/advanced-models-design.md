# Advanced Financial Models — Design Specification

## Architecture: Layered Analytics Engine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 4: PORTFOLIO INTELLIGENCE                                             │
│  Cross-company benchmarking, conglomerate discount tracker                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  LAYER 3: MARKET-FACING MODELS                                               │
│  Reverse DCF, Merton credit model, Real options                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  LAYER 2: ADVANCED PENMAN-NISSIM                                             │
│  Fade rates, Feltham-Ohlson LID, Segment RNOA, Earnings persistence          │
├─────────────────────────────────────────────────────────────────────────────┤
│  LAYER 1: QUALITY & SIGNAL (existing + new)                                  │
│  Accrual quality, Beneish M-Score, Piotroski F-Score                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  DATA PIPELINE (existing)                                                    │
│  Capitaline parser → Recast → RNOA/FLEV/NBC → Segments                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## MODULE 1: FADE RATE ESTIMATION (ω)

### Academic Foundation
- Penman (2013) Ch. 14-15; Dechow, Hutton & Sloan (1999)
- Ohlson (1995) Linear Information Dynamics

### Core Model

Abnormal earnings follow AR(1) decay:
```
ReOI_{t+1} = ω × ReOI_t + ε_t
```

The fade rate ω determines terminal value:
```
CV_T = ReOI_T × ω / (1 + r_F - ω)
```

Full valuation with fade:
```
V_0 = NOA_0 + Σ_{t=1}^{T} [ReOI_t / (1+r_F)^t] + [ReOI_T × ω / ((1+r_F - ω) × (1+r_F)^T)] - NFO_0
```

### Estimation Method

**Company-specific ω from time series (OLS):**
```
ReOI_t = α + ω × ReOI_{t-1} + ε_t

Where:
  ReOI_t = OI_t - r_F × NOA_{t-1}
  r_F = risk-free + equity risk premium (cost of operations)
  OI_t = Operating Income after tax
  NOA_t = Net Operating Assets
```

**Inputs (all available in current pipeline):**
- OI: from recast P&L (operating income after tax)
- NOA: from recast BS (operating assets - operating liabilities)
- r_F: from URL params (rf + erp, already exists)

**Output Structure:**
```typescript
interface FadeRateEstimate {
  omega: number;               // 0 to 1
  omega_se: number;            // standard error
  r_squared: number;           // regression fit
  n_observations: number;      // years used
  confidence: "high" | "medium" | "low";
  terminalValue: number;       // CV_T using estimated ω
  impliedCompetitiveAdvantage: string; // interpretation
  // Decomposition
  omegaMargin: number;         // fade rate of OPM component
  omegaTurnover: number;       // fade rate of ATO component
}
```

**Empirical Benchmarks (Penman, US data):**
| Company Type | Typical ω | Interpretation |
|---|---|---|
| Commodity / Cyclical | 0.24 - 0.45 | Fast mean-reversion, no moat |
| Industrial average | 0.55 - 0.65 | Moderate persistence |
| Consumer brands / Pharma | 0.65 - 0.75 | Durable competitive advantage |
| Network effects / Monopoly | 0.75 - 0.90 | Near-permanent moat |

**Indian adjustment:** India's faster-growing economy may support slightly higher persistence
for companies riding secular GDP growth. Consider: `ω_adjusted = ω_raw + GDP_tailwind_factor`
where tailwind ≈ 0.02-0.05 for India vs developed markets.

### Segment-Level Fade Rates

Each segment gets its own ω estimated from its own ReOI series:
```
Segment_ReOI_{i,t} = Segment_EBIT_{i,t} × (1-tax) - r_F × Segment_NOA_{i,t-1}
Segment_NOA_i = Segment_Assets_i - Segment_Liabilities_i

Regression per segment:
  Segment_ReOI_{i,t} = α_i + ω_i × Segment_ReOI_{i,t-1} + ε
```

Terminal value becomes:
```
CV = Σ_i [Segment_ReOI_{i,T} × ω_i / (1 + r_F - ω_i)]
```

This is the key improvement: L&T's IT segment (ω≈0.70) should be valued differently
than Infrastructure (ω≈0.50).

---

## MODULE 2: REVERSE DCF / PRICE-IMPLIED EXPECTATIONS

### Academic Foundation
- Mauboussin & Rappaport (2001, 2021) "Expectations Investing"
- Core insight: don't predict → instead, read what the market already prices in

### Core Framework

Given market price P, solve for implied assumptions:
```
P × Shares + Debt - Cash = Σ_{t=1}^{T} [FCF_t / (1+WACC)^t] + CV_T / (1+WACC)^T
```

**FCF Model (Mauboussin):**
```
FCF_t = Revenue_{t-1} × (1+g) × OPM × (1-tax) - ΔRevenue_t × (IC_wc + IC_fc)
```

Where:
- g = revenue growth rate (THE variable we solve for)
- OPM = operating profit margin (from latest actuals or trend)
- IC_wc = incremental working capital per ₹ of revenue increase
- IC_fc = incremental fixed capital per ₹ of revenue increase

**Continuing Value:**
```
CV_T = NOPAT_{T+1} × (1 - g_cv/ROIC_cv) / (WACC - g_cv)
```

### What We Solve For (one at a time, holding others at base case):

1. **Implied Growth Rate:** What revenue CAGR justifies current price?
2. **Implied Competitive Advantage Period (CAP):** How many years of above-WACC returns are priced in?
3. **Implied Margin:** What steady-state OPM does the market assume?
4. **Implied Fade Rate:** What ω reconciles our model to market price?

### Output Structure:
```typescript
interface ReverseValuation {
  // Implied from market price
  impliedGrowthRate: number;     // revenue CAGR priced in
  impliedCAP: number;            // competitive advantage period (years)
  impliedMargin: number;         // steady-state OPM
  impliedFadeRate: number;       // ω that reconciles to market
  impliedROIC: number;           // ROIC embedded in terminal value

  // Comparison vs reality
  historicalGrowth5Y: number;    // actual 5Y revenue CAGR
  historicalMargin: number;      // trailing 3Y average OPM
  historicalROIC: number;        // trailing ROIC
  
  // Verdict
  expectationsGap: {
    growth: "above" | "below" | "inline";   // implied vs historical
    margin: "above" | "below" | "inline";
    sustainability: "optimistic" | "pessimistic" | "realistic";
  };
  
  // Sensitivity
  sensitivityTable: Array<{
    growth: number;
    margin: number;
    impliedValue: number;
  }>;
}
```

### Implementation Algorithm:

```
1. Compute base-case FCF trajectory from trailing financials
2. Binary search on growth rate g such that:
     Enterprise_Value(g) = Market_Cap + Net_Debt
3. Compare implied g to:
   - Historical CAGR (is market extrapolating past?)
   - Industry growth (is market giving premium vs peers?)
   - GDP + pricing power (is it physically achievable?)
4. Output: "Market expects 18% growth for 7 years. Historical was 12%.
           For this price to be fair, growth must accelerate 50%."
```

---

## MODULE 3: SEGMENT RNOA DECOMPOSITION

### Academic Foundation
- Penman (2013) Ch. 12; Nissim & Penman (2001)

### Core Formula
```
Segment_RNOA_i = Segment_OPM_i × Segment_ATO_i

Where:
  Segment_OPM_i = Segment_Result_i / Segment_Revenue_i
  Segment_ATO_i = Segment_Revenue_i / Segment_Net_Assets_i
  Segment_Net_Assets_i = Segment_Assets_i - Segment_Liabilities_i
  Segment_RNOA_i = Segment_Result_i / Segment_Net_Assets_i
```

### Firm-Level Attribution:
```
RNOA_firm = Σ_i [w_i × Segment_RNOA_i]
Where w_i = Segment_Net_Assets_i / Total_NOA (capital-weighted)

Revenue contribution: rev_share_i = Segment_Revenue_i / Total_Revenue
Profit contribution: profit_share_i = Segment_Result_i / Total_Result
Capital consumption: capital_share_i = Segment_Net_Assets_i / Total_NOA
```

### Segment Residual Operating Income:
```
Segment_ReOI_i = Segment_Result_i × (1-tax) - r_F × Segment_NOA_{i,prev}
```

### Competitive Position Matrix (per segment):

```
                    High ATO (>1.5x)         Low ATO (<1.5x)
                 ┌───────────────────────┬────────────────────────┐
High OPM (>15%) │  STARS                 │  MARGIN FORTRESS       │
                │  (rare: brand+scale)   │  (IP, moat, pricing)   │
                │  e.g., TCS             │  e.g., L&T Financial   │
                ├───────────────────────┼────────────────────────┤
Low OPM (<15%)  │  VOLUME PLAYS          │  DOGS                  │
                │  (scale advantage)     │  (capital destruction)  │
                │  e.g., L&T Infra       │  e.g., Hydrocarbon     │
                └───────────────────────┴────────────────────────┘
```

### Output Structure:
```typescript
interface SegmentRNOADecomposition {
  segments: Array<{
    name: string;
    revenue: number;
    result: number;
    netAssets: number;
    opm: number;          // operating profit margin
    ato: number;          // asset turnover
    rnoa: number;         // return on net operating assets
    reoi: number;         // residual operating income
    fadeRate: number;     // segment-specific ω
    quadrant: "star" | "margin_fortress" | "volume_play" | "dog";
    trend: "improving" | "stable" | "deteriorating";  // 3Y direction
  }>;
  
  firmLevel: {
    rnoa: number;
    weightedOPM: number;
    weightedATO: number;
    capitalMisallocation: number;  // how much RNOA lost by over-allocating to dogs
  };
  
  // What-if: if capital were reallocated from dogs to stars
  optimalAllocation: {
    potentialRNOA: number;
    rnoaGain: number;
    narrative: string;
  };
}
```

---

## MODULE 4: ACCRUAL QUALITY (Sloan 1996)

### Formula:
```
Accrual_Ratio = (Net_Income - CFO) / Average_Total_Assets

Where:
  Average_Total_Assets = (Total_Assets_t + Total_Assets_{t-1}) / 2
```

### Alternative (Richardson et al. 2005, NOA-based):
```
Accrual_Ratio_NOA = (NOA_t - NOA_{t-1}) / ((NOA_t + NOA_{t-1}) / 2)
```

### Earnings Persistence Decomposition:
```
Earnings_{t+1} = α + β_cf × CashFlow_t + β_acc × Accruals_t + ε

Empirical (Sloan 1996):
  β_cf ≈ 0.855 (cash flow component highly persistent)
  β_acc ≈ 0.765 (accrual component less persistent)
```

### Signal:
| Accrual Ratio | Interpretation |
|---|---|
| < -5% | Very high cash quality (conservative accounting) |
| -5% to +5% | Normal |
| +5% to +10% | Elevated accruals — earnings may not persist |
| > +10% | Red flag — high chance of future earnings decline |

### Output:
```typescript
interface AccrualQuality {
  accrualRatio: number;
  accrualRatioNOA: number;
  cashFlowComponent: number;
  accrualComponent: number;
  earningsQuality: "high" | "moderate" | "low" | "red_flag";
  persistenceForecast: number;  // weighted: β_cf×CF + β_acc×Acc
  narrative: string;
}
```

---

## MODULE 5: BENEISH M-SCORE

### Formula:
```
M = -4.84 + 0.920×DSRI + 0.528×GMI + 0.404×AQI + 0.892×SGI 
    + 0.115×DEPI - 0.172×SGAI + 4.679×TATA - 0.327×LVGI
```

### Variables:
```
DSRI = (Receivables_t/Sales_t) / (Receivables_{t-1}/Sales_{t-1})
GMI  = GrossMargin_{t-1} / GrossMargin_t
AQI  = [1 - (CA_t + PPE_t + Investments_t)/TA_t] / [1 - (CA_{t-1} + PPE_{t-1} + Investments_{t-1})/TA_{t-1}]
SGI  = Sales_t / Sales_{t-1}
DEPI = [Dep_{t-1}/(PPE_{t-1}+Dep_{t-1})] / [Dep_t/(PPE_t+Dep_t)]
SGAI = (SGA_t/Sales_t) / (SGA_{t-1}/Sales_{t-1})
LVGI = [(CL_t+LTD_t)/TA_t] / [(CL_{t-1}+LTD_{t-1})/TA_{t-1}]
TATA = (Net_Income_t - CFO_t) / Total_Assets_t
```

### Threshold: M > -1.78 → likely manipulator

### Output:
```typescript
interface BeneishMScore {
  mScore: number;
  isManipulator: boolean;  // M > -1.78
  variables: {
    dsri: number; gmi: number; aqi: number; sgi: number;
    depi: number; sgai: number; tata: number; lvgi: number;
  };
  dominantRiskFactor: string;  // which variable contributes most
  confidence: "high" | "medium" | "low";  // based on data completeness
}
```

---

## MODULE 6: MERTON CREDIT MODEL (Distance to Default)

### Core Equations:
```
Equity = V × N(d1) - D × e^(-rT) × N(d2)

d1 = [ln(V/D) + (r + σ_V²/2) × T] / (σ_V × √T)
d2 = d1 - σ_V × √T

Distance_to_Default = [ln(V/D) + (μ - σ_V²/2) × T] / (σ_V × √T)
Probability_of_Default = N(-DD)
```

### Solving for V and σ_V (iterative):
```
Given: E (market cap), σ_E (equity volatility from price), D (book debt), r, T=1

System:
  E = V×N(d1) - D×e^(-rT)×N(d2)           ... (1)
  σ_E × E = N(d1) × σ_V × V               ... (2) [Ito's Lemma]

Algorithm:
  1. Initial: V₀ = E + D, σ_V₀ = σ_E × E / (E+D)
  2. Compute d1, d2 from V₀, σ_V₀
  3. From (1): V_new = (E + D×e^(-rT)×N(d2)) / N(d1)
  4. From (2): σ_V_new = σ_E × E / (N(d1) × V_new)
  5. Repeat until |V_new - V_old| < tolerance
```

### Default Point (KMV):
```
Default_Point = Short_Term_Debt + 0.5 × Long_Term_Debt
```

### Output:
```typescript
interface MertonCreditModel {
  assetValue: number;          // V (implied market value of assets)
  assetVolatility: number;     // σ_V
  distanceToDefault: number;   // DD (in std devs)
  probabilityOfDefault: number; // PD = N(-DD)
  defaultPoint: number;        // D* = STD + 0.5×LTD
  creditRating: string;        // implied rating from DD mapping
  equityAsOptionValue: number; // option time value component
  debtCapacity: number;        // max additional debt before DD < 2
}
```

### DD to Rating Mapping (Moody's empirical):
| DD Range | Implied Rating | Typical PD |
|---|---|---|
| > 4.0 | AAA/AA | < 0.1% |
| 3.0 - 4.0 | A | 0.1% - 0.5% |
| 2.0 - 3.0 | BBB | 0.5% - 2% |
| 1.0 - 2.0 | BB | 2% - 8% |
| 0.5 - 1.0 | B | 8% - 20% |
| < 0.5 | CCC/D | > 20% |

---

## MODULE 7: CONGLOMERATE DISCOUNT (Berger-Ofek 1995)

### Core Formula:
```
Excess_Value = ln(Actual_EV / Imputed_EV)

Imputed_EV = Σ_i [Segment_Revenue_i × Median(EV/Revenue) for pure-play peers in segment i's industry]
         OR: Σ_i [Segment_EBIT_i × Median(EV/EBIT) for pure-play peers]
         OR: Σ_i [Segment_Assets_i × Median(EV/Assets) for pure-play peers]
```

### Interpretation:
- Excess_Value < 0 → conglomerate discount (market penalizes diversification)
- Excess_Value > 0 → conglomerate premium
- Typical Indian conglomerate discount: -10% to -25%

### Peer Mapping (for Indian companies):
```
L&T Segments → Pure-play peers:
  Infrastructure → NCC, KEC International
  IT & Technology → TCS, Infosys, HCL Tech
  Financial Services → Bajaj Finance, Shriram Finance
  Energy Projects → Thermax, BHEL
  Hi-Tech Manufacturing → BEL, HAL
  Development Projects → DLF, Godrej Properties
```

### Output:
```typescript
interface ConglomerateDiscount {
  excessValue: number;           // ln(actual/imputed)
  discountPercent: number;       // as percentage
  method: "revenue" | "ebit" | "assets";
  segmentImputedValues: Array<{
    segment: string;
    revenue: number;
    peerMultiple: number;
    imputedValue: number;
    peerGroup: string[];
  }>;
  totalImputedEV: number;
  actualEV: number;
  narrative: string;             // "Market applies 18% conglomerate discount..."
  historicalDiscount: number[];  // trend over years
}
```

---

## MODULE 8: FELTHAM-OHLSON LINEAR INFORMATION DYNAMICS

### Full Model:
```
Abnormal earnings dynamics:
  x_t^a = ω × x_{t-1}^a + v_t + ε1_t
  v_t   = γ × v_{t-1} + ε2_t

Where:
  x_t^a = Earnings_t - r × Book_{t-1}  (residual income)
  v_t = "other information" (captures what's known but not yet in financials)
```

### Valuation Function:
```
P_t = B_t + α1 × x_t^a + α2 × v_t

Where:
  α1 = ω / (1 + r - ω)
  α2 = (1 + r) / [(1 + r - ω)(1 + r - γ)]
```

### Estimating "Other Information" v_t:
```
v_t = P_t - B_t - α1 × x_t^a    (back out from market price)

Or proxy with:
  v_t ≈ analyst_consensus_EPS_{t+1} - (ω × x_t^a + r × B_t)
  
For companies without analyst coverage:
  v_t ≈ Order_book_growth × historical_conversion_rate × margin
  (For L&T: order book is the strongest forward indicator)
```

### Extended Feltham-Ohlson (Conservative Accounting):
```
ox_t^a = ω11 × ox_{t-1}^a + ω12 × oa_{t-1} + v1_t + ε1_t
oa_t   = ω22 × oa_{t-1} + v2_t + ε2_t

ω12 > 0 indicates conservative accounting (assets understated)
ω22 > 1 indicates growing firm (operating assets expanding)
```

### Output:
```typescript
interface FelthamOhlsonModel {
  // Estimated parameters
  omega: number;                 // earnings persistence
  gamma: number;                 // other-info persistence
  omega12: number;               // conservatism parameter
  
  // Valuation
  bookValue: number;
  abnormalEarnings: number;
  otherInformation: number;      // v_t
  intrinsicValue: number;        // P = B + α1×x^a + α2×v
  
  // Decomposition of value
  bookValueComponent: number;    // % of value from B
  earningsComponent: number;     // % from α1×x^a
  otherInfoComponent: number;    // % from α2×v (growth expectations)
  
  // Diagnostic
  marketPriceVsModel: number;    // deviation
  conservatismAdjustment: number; // ω12 effect on value
}
```

---

## MODULE 9: CAPITAL ALLOCATION EFFICIENCY

### Incremental ROIC (Credit Suisse HOLT methodology):
```
Incremental_ROIC = Δ_NOPAT / Δ_Invested_Capital_{prior_year}

Where:
  Δ_NOPAT = NOPAT_t - NOPAT_{t-1}
  Δ_Invested_Capital = IC_{t-1} - IC_{t-2}  (lagged: capital deployed before returns)
```

### Segment-Level Capital Allocation Score:
```
Segment_ROIC_i = Segment_EBIT_i × (1-tax) / Segment_Capital_i
Capital_Allocation_Score = Σ_i [Δweight_i × (Segment_ROIC_i - WACC)]

Where:
  Δweight_i = change in capital allocation to segment i
  Positive score = management is allocating MORE capital to above-WACC segments
  Negative score = capital flowing to value-destroying segments
```

### Marginal Capital Productivity:
```
For each segment, over rolling 3Y windows:
  MCP_i = Σ(Δ Segment_EBIT_i) / Σ(Δ Segment_Capital_i)

"Each additional ₹1 of capital in IT services generated ₹0.15 of EBIT,
 vs ₹0.05 in Infrastructure"
```

### Output:
```typescript
interface CapitalAllocationScore {
  firmIncrementalROIC: number;
  firmIncrementalROIC_3Y: number;
  segments: Array<{
    name: string;
    roic: number;
    incrementalROIC: number;
    capitalShare: number;          // % of firm capital in this segment
    capitalShareChange: number;    // Δ allocation over 3 years
    marginalProductivity: number;  // MCP
    verdict: "value_creating" | "neutral" | "value_destroying";
  }>;
  allocationQuality: "excellent" | "good" | "poor" | "value_destructive";
  misallocationCost: number;       // ₹ Cr of value lost to suboptimal allocation
  optimalReallocation: string;     // narrative recommendation
}
```

---

## MODULE 10: REAL OPTIONS OVERLAY

### Option to Expand (for order-book companies like L&T):
```
C_expand = λ × V_segment × N(d1) - I_required × e^(-rT) × N(d2)

d1 = [ln(λ×V/I) + (r + σ²/2)×T] / (σ×√T)

Where:
  λ = expansion factor (order_book / current_revenue)
  V_segment = current segment value (from SOTP)
  I_required = estimated capex to execute order book
  σ = segment revenue volatility
  T = average order execution period
```

### Option to Abandon (for loss-making segments):
```
P_abandon = Salvage × e^(-rT) × N(-d2) - V_segment × N(-d1)

Where:
  Salvage = segment assets × estimated liquidation discount
  V_segment = going-concern value of segment (may be negative if losses persist)
```

### Expanded Firm Value:
```
Total_Value = NPV_assets_in_place + Σ(Real_Options)
            = Penman_Nissim_Value + C_expand + P_abandon + Option_to_Defer
```

### Practical Application for L&T:
```
Order_Book_Option:
  λ = Order_Book / Trailing_Revenue ≈ 4.0x for L&T
  σ = historical segment revenue volatility ≈ 15-20%
  T = average execution period ≈ 2-3 years
  I = required working capital + capex per ₹ of order book ≈ 0.15-0.25

  This option value explains WHY market gives L&T higher P/E than
  its current RNOA alone would justify.
```

---

## IMPLEMENTATION PRIORITY & DATA REQUIREMENTS

| Module | Data Needed | New Inputs Required | Complexity | Impact |
|--------|------------|--------------------:|:----------:|:------:|
| 1. Fade Rate | ReOI series (exists) | None | Low | Very High |
| 2. Reverse DCF | Market cap, WACC | Market price (exists) | Medium | Very High |
| 3. Segment RNOA | Segment data (just fixed!) | None | Low | High |
| 4. Accrual Quality | NI, CFO, TA (exists) | None | Very Low | High |
| 5. Beneish M-Score | PL + BS items (exists) | None | Low | Medium |
| 6. Merton Credit | Market cap, equity vol | Daily returns/vol | Medium | High |
| 7. Conglomerate Discount | Segment data + peer multiples | Peer mapping | High | High |
| 8. Feltham-Ohlson | ReOI + market price | Analyst estimates (optional) | High | Medium |
| 9. Capital Allocation | Segment data over time | None | Medium | High |
| 10. Real Options | Order book, capex, volatility | Order book data | High | Medium |

---

## SUGGESTED BUILD ORDER

**Sprint 1 (immediate — all data available):**
1. Accrual Quality Score (3 lines of formula)
2. Segment RNOA Decomposition (segment data just fixed)
3. Fade Rate Estimation (OLS on existing ReOI series)

**Sprint 2 (high-value, moderate effort):**
4. Reverse DCF / Price-Implied Expectations
5. Beneish M-Score
6. Capital Allocation Efficiency

**Sprint 3 (requires additional inputs):**
7. Merton Credit Model (needs equity volatility — could compute from NSE daily data)
8. Conglomerate Discount (needs peer multiple mapping)
9. Feltham-Ohlson LID

**Sprint 4 (advanced / research-quality):**
10. Real Options Overlay

---

## GAPS & ADVANCED EXTENSIONS (Research Deep-Dive)

### GAP 1: Fade Rate — Beyond Naive OLS

**Problem with raw AR(1):** 15 observations is statistically weak. OLS omega on short
series is noisy (SE ≈ 0.15-0.25), giving wide confidence intervals that make the
terminal value estimate unreliable — the single most important number in the model.

**Fix: Bayesian Shrinkage Toward Industry Prior**

Instead of pure company-specific ω, use empirical Bayes:
```
ω_final = λ × ω_company + (1-λ) × ω_industry

Where:
  λ = n / (n + κ)   [shrinkage weight, n=observations, κ=prior strength≈10]
  ω_company = OLS estimate from company's own ReOI series
  ω_industry = cross-sectional median ω for the sector (pre-computed)

Effect: with 15 years of data, λ≈0.60 → still company-dominant
        with 5 years, λ≈0.33 → industry prior dominates (appropriate)
```

**Industry Prior Table (Indian sectors, estimated from NSE-500):**
| Sector | Prior ω | Rationale |
|--------|---------|-----------|
| IT Services | 0.72 | Sticky contracts, high switching costs |
| FMCG | 0.70 | Brand moats, distribution lock-in |
| Pharma (domestic) | 0.65 | Pricing power, R&D pipeline |
| Banking (private) | 0.62 | Franchise value, deposit base |
| Infrastructure | 0.48 | Project-based, competitive bidding |
| Metals / Commodities | 0.35 | Price-taker, cyclical mean-reversion |
| Real Estate | 0.30 | Lumpy, no recurring revenue |
| Telecom | 0.55 | Oligopoly but capital-intensive |
| Insurance | 0.68 | Embedded value compounds |
| NBFC | 0.55 | Spread business, regulatory risk |

**Non-Linear Fade (S-Curve Model):**

Empirical evidence (Nissim & Penman 2001) shows fade isn't constant — it's faster
in the first 3-5 years then stabilizes. Model as logistic:
```
ω(t) = ω_long + (ω_short - ω_long) × e^(-κt)

Where:
  ω_short = short-term persistence (first 3 years) ≈ 0.75-0.85
  ω_long = long-term equilibrium persistence ≈ 0.45-0.60
  κ = decay speed ≈ 0.3-0.5
  
For terminal value, use ω_long (not ω_short)
For explicit forecast period (years 1-5), use ω(t)
```

**Structural Break Detection:**

Before estimating ω, test for regime changes in ReOI series:
```
Chow test: split sample at each possible breakpoint
  F = [(SSR_pooled - SSR_1 - SSR_2) / k] / [(SSR_1 + SSR_2) / (n-2k)]
  If F > critical → structural break → only use post-break data for ω

Common causes in Indian context:
  - ITC demerger (FY2024): Hotels segment removed → discontinuity
  - Ind-AS transition (FY2017-18): Reclassifications change NOA
  - COVID (FY2020-21): temporary spike then reversion
  - Major acquisition: step-change in scale
```

**Competitive Dynamics Link (Porter Quantified):**
```
ω_theoretical = f(entry_barriers, switching_costs, network_effects, scale_economies)

Quantifiable proxies from financial data:
  Entry barrier score = Capex/Revenue ratio × Market share concentration
  Switching cost proxy = Revenue retention rate (1 - churn)
  Network effect proxy = Revenue per user growth rate
  Scale economy = OPM improvement per 10% revenue growth

Composite: ω_porter = 0.40 + 0.15×entry + 0.15×switching + 0.15×network + 0.15×scale
  (calibrated to produce ω in [0.30, 0.85] range)
```

---

### GAP 2: Value-Creating Growth vs Value-Neutral Growth

**Critical Penman insight often missed:** Not all growth creates value.
Growth that earns exactly the cost of capital is value-neutral (book value grows but
intrinsic value per share stays flat).

```
Value_Creation = Growth × (ROIC - WACC) / WACC

Decompose:
  g_total = g_value_creating + g_neutral
  g_value_creating = g_total × (ROIC - WACC) / ROIC  [only this portion adds value]
  g_neutral = g_total × WACC / ROIC                  [keeps up with cost of capital]
```

**Sustainable Growth Rate (self-financing capacity):**
```
g_sustainable = RNOA × (1 - dividend_payout) × (1 / (1 - FLEV×(1-tax)))

Or simplified:
  g_internal = ROE × (1 - payout_ratio)
  
If actual_growth > g_sustainable → company MUST raise external capital
  → dilution risk or leverage increase → valuation discount
If actual_growth < g_sustainable → company accumulates excess cash
  → buyback potential or inefficient capital deployment
```

**For Reverse DCF:** The implied growth rate should be compared not just to
historical growth, but to g_sustainable. If market implies growth > g_sustainable,
the model should flag: "this price requires external capital raises."

---

### GAP 3: Clean Surplus Violations & Dirty Surplus

**Why this matters:** The Penman-Nissim framework assumes Clean Surplus Accounting
(all gains/losses flow through income statement). In reality, Indian Ind-AS routes
several items through OCI (Other Comprehensive Income), breaking the model.

**Common Clean Surplus Violations in Indian Ind-AS:**
```
1. Fair value changes on FVOCI equity investments → OCI
2. Cash flow hedge reserve changes → OCI  
3. Remeasurement of defined benefit plans → OCI
4. Foreign currency translation reserves → OCI
5. Revaluation surplus on PPE (rare under Ind-AS) → OCI
```

**Adjustment for Valuation:**
```
Adjusted_ReOI = Standard_ReOI + Dirty_Surplus_Adjustment

Where:
  Dirty_Surplus = ΔCSE - NI + Dividends  [from CSE reconciliation]
  
  If |Dirty_Surplus / CSE| > 5%:
    → Material violation → adjust ReOI OR
    → Flag reduced confidence in ω estimate
    
  Persistence of dirty surplus items is LOWER than clean earnings:
    β_dirty_surplus ≈ 0.35-0.45 (vs 0.62 for clean ReOI)
    → Assign separate, lower fade rate to dirty surplus component
```

**Implementation:** Already have `dirty_surplus` and `dirty_surplus_pct_cse` in the
existing Ratios interface. The gap is using this to ADJUST the fade rate estimation
and flag periods where clean surplus is violated.

---

### GAP 4: Penman's "Accounting-Based Valuation Without Forecasting"

**Source:** Penman (2011, 2021) — the "anchoring" approach.

**Core idea:** Instead of forecasting future earnings (unreliable), anchor
valuation to what accounting ALREADY tells you, then price the uncertainty.

```
Step 1: Compute "no-growth" value (EPV)
  V_no_growth = NOA + ReOI_normalized / r_F - NFO
  
Step 2: Ask "what premium for growth?"
  Growth_premium = V_market - V_no_growth
  Growth_premium_as_pct = Growth_premium / V_no_growth
  
Step 3: Evaluate if growth premium is justified
  Justified if: historical g_ReOI > 0 AND ω > 0.5 AND ROIC > WACC
  Unjustified if: g_ReOI declining AND ω < 0.4 AND ROIC converging to WACC
```

**The "Accounting Anchor" — Greenwald-Penman synthesis:**
```
Valuation Layers:
  Layer 0: Asset Value (liquidation) = reproduction cost of assets
  Layer 1: EPV (earnings power) = normalized earnings / cost of capital
  Layer 2: Growth Value = EPV × growth multiplier (only if moat exists)
  
  BUY signal:  Price < EPV (paying nothing for growth that exists)
  HOLD signal: EPV < Price < EPV + justified_growth_premium
  AVOID signal: Price > EPV + max_justifiable_growth_premium
```

**For our tool:** This becomes the META-FRAMEWORK that wraps all other modules.
The dashboard verdict should be grounded in this hierarchy, not just a single
DCF number.

---

### GAP 5: Residual Income Under Stochastic Discount Rates

**Problem:** Standard RIV uses constant r_F. In reality, discount rates are
time-varying and correlated with earnings (systematic risk).

**Ang & Liu (2001) extension:**
```
V_0 = B_0 + Σ_{t=1}^∞ E_0[M_t × ReOI_t]

Where M_t = stochastic discount factor (not constant 1/(1+r)^t)

Approximation for implementation:
  V_0 ≈ B_0 + Σ_{t=1}^T [ReOI_t / (1+r_t)^t]
  
  Where r_t = r_base + β_earnings × λ_t
    β_earnings = sensitivity of firm's ReOI to market-wide earnings cycle
    λ_t = time-varying price of risk
```

**Practical implementation:** Use India's credit cycle as λ_t proxy:
```
r_t = rf_t + ERP_base + cyclical_adjustment

cyclical_adjustment:
  GDP growth > 7%: -50bps (optimistic times → lower discount)
  GDP growth 5-7%: 0bps (normal)
  GDP growth < 5%: +100bps (stress → higher discount)
  
For cyclical companies (Tata Steel, L&T Infra):
  Use β_earnings > 1.0 → amplified discount rate variation
For defensive (HUL, ITC, Nestle):
  Use β_earnings < 0.8 → muted discount rate variation
```

---

### GAP 6: Industry Equilibrium RNOA (What Does It Converge TO?)

**Common mistake:** Assuming RNOA converges to cost of capital in terminal value.
Empirically false. Industry structure creates stable above/below-cost equilibria.

```
RNOA converges to RNOA_equilibrium, NOT necessarily to r_F

RNOA_eq by Indian industry:
  IT Services: 35-45% (intangible-heavy, low NOA denominator)
  FMCG: 25-35% (brand premiums, asset-light distribution)
  Banking: 1.5-2.0% (ROA terms; very different structure)
  Infrastructure: 8-12% (competitive bidding, thin margins)
  Pharma: 18-25% (IP protection, complex manufacturing)
  Metals: 8-14% (cyclical, converges to replacement cost economics)
  
These equilibria are STRUCTURAL, driven by:
  - Capital intensity (higher NOA → lower equilibrium RNOA even if profitable)
  - Competitive intensity (more players → lower margins → lower RNOA)
  - Regulatory environment (rate-regulated utilities converge to allowed ROE)
```

**For terminal value:**
```
Instead of: CV = ReOI_T × ω / (1 + r_F - ω)  [assumes decay toward zero]

Use: CV = (ReOI_T - ReOI_eq) × ω / (1 + r_F - ω) + ReOI_eq / r_F

Where ReOI_eq = (RNOA_eq - r_F) × NOA_T  [the structural equilibrium residual]

This means: even at ω=0 (complete fade), residual income doesn't go to zero —
it goes to the industry equilibrium. Only the EXCESS above equilibrium fades.
```

---

### GAP 7: India-Specific Adjustments

**7a. Promoter Holding & Governance Premium:**
```
Indian companies with >60% promoter holding:
  - Lower agency costs → slight premium (+2-5% to terminal value)
  - But also: related-party risk, minority shareholder extraction
  
Governance_Score = f(promoter_holding, pledge_ratio, related_party_txns, board_independence)

Valuation impact:
  If Governance_Score > 75th percentile: ω_adj = ω + 0.03 (moat protected by governance)
  If Governance_Score < 25th percentile: ω_adj = ω - 0.05 (moat leaks via extraction)
  If pledge_ratio > 20%: apply 10-15% liquidity discount to equity value
```

**7b. PSU vs Private Sector Fade Rates:**
```
PSU empirical: ω_PSU ≈ 0.40-0.50 (government interference limits optimization)
Private sector: ω_private ≈ 0.55-0.70 (full management discretion)

Exception: PSU monopolies (Coal India, IRCTC) → ω ≈ 0.65-0.75
  (monopoly persists regardless of management quality)
```

**7c. Ind-AS Transition Adjustment:**
```
For companies with data spanning pre/post Ind-AS (FY2016-17 transition):
  - Flag discontinuity in NOA series (Ind-AS 116 leases, fair value adjustments)
  - Option 1: Only use post-transition data for ω (loses history)
  - Option 2: Adjust pre-transition data with a level-shift dummy
    ReOI_t = α + ω×ReOI_{t-1} + δ×D_IndAS + ε
    Where D_IndAS = 1 for pre-transition periods
```

**7d. India Country Risk Premium & Cost of Capital:**
```
r_F (cost of operations) for Indian company:
  = India_10Y_Gsec + Equity_Risk_Premium + Size_Premium
  
Current calibration:
  India 10Y Gsec: 7.0-7.2%
  ERP (India): 5.5-6.5% (Damodaran estimate, updated annually)
  Size premium (mid-cap): +1.0-1.5%
  Size premium (small-cap): +2.0-3.0%
  
Total r_F range:
  Large-cap: 12.5-13.5%
  Mid-cap: 14.0-15.5%
  Small-cap: 15.5-17.0%
  
NOTE: This is HIGHER than US (9-11%) → Indian residual income goes negative faster
→ lower terminal values → makes fade rate estimation even more critical
```

---

### GAP 8: Dividend Displacement Property (Ohlson's Key Insight)

**The property:** Dividends reduce book value 1:1 but do NOT affect value
(they're a transfer, not value creation/destruction).

```
Formally:  ∂V/∂d = -1  (value drops by exactly dividend amount, no more, no less)
           ∂x_{t+1}^a/∂d_t = r × d_t  (next period's residual income increases by r×d)
```

**Why this matters for implementation:**
- Special dividends / buybacks should NOT affect our ω estimation
- If a company pays a large special dividend, BV drops → next year's ReOI mechanically rises
  (because the capital charge r×B falls) → this is NOT improved operations
- Must normalize ReOI for dividend policy changes before running AR(1)

```
Adjustment:
  ReOI_adjusted_t = ReOI_t + r_F × (Cumulative_Abnormal_Dividends_t)
  
Where:
  Normal_Dividend_t = Payout_Ratio_median × NI_t
  Abnormal_Dividend_t = Actual_Dividend_t - Normal_Dividend_t
  Cumulative_Abnormal = running sum of Abnormal_Dividend
```

---

### GAP 9: Multi-Horizon Expectations (Short vs Long-Term Implied)

**Extension to Reverse DCF:** Don't just solve for ONE implied growth rate.
Decompose market price into what's implied for NEAR-TERM vs FAR-TERM.

```
Price decomposition (Leibowitz & Kogelman "Franchise Value"):

  P/E = 1/r + Franchise_Factor × Growth_Factor
  
Where:
  1/r = tangible value (no-growth P/E)
  Franchise Factor = (ROIC - r) / (ROIC × r)  [value per $ of new investment]
  Growth Factor = g / (r - g)  [PV of growth opportunities]
  
Applied:
  P/E_observed = P/E_no_growth + P/E_growth_near_term + P/E_growth_long_term
  
  Near-term (years 1-5): use actual order book / capacity additions / guidance
  Long-term (years 5+): what RESIDUAL premium does market assign?
```

**Implementation:**
```
1. Compute V_no_growth = Normalized_NOPAT / WACC
2. Compute V_visible_growth = NPV of explicitly forecast-able growth (order book, capex)
3. V_implied_long_term = Market_Cap - V_no_growth - V_visible_growth

If V_implied_long_term < 0: market DISCOUNTS the company (doesn't believe stated growth)
If V_implied_long_term > 50% of price: market assigns heroic long-term assumptions
```

---

### GAP 10: Earnings Quality Composite — Beyond Individual Scores

**Problem:** Beneish, Piotroski, Sloan, Altman each capture ONE dimension.
Need a unified "trustworthiness" score for the entire earnings stream.

**Proposed Composite: Earnings Reliability Index (ERI)**
```
ERI = w1×Accrual_Score + w2×Persistence_Score + w3×Manipulation_Score 
    + w4×CashConversion_Score + w5×Conservatism_Score

Where (each scored 0-100):
  Accrual_Score = 100 × (1 - |Accrual_Ratio| / 0.15)  [lower accruals → higher score]
  Persistence_Score = 100 × min(1, β_cf×CFshare + β_acc×AccShare)  [Sloan decomposition]
  Manipulation_Score = 100 × N(-M_Score - (-1.78)) / N(3)  [distance from threshold]
  CashConversion_Score = 100 × min(1, CFO/NI)  [closer to 100% → better]
  Conservatism_Score = 100 × max(0, ω12) / 0.05  [F-O conservatism parameter]

Weights: w1=0.25, w2=0.20, w3=0.25, w4=0.20, w5=0.10

Interpretation:
  ERI > 80: High-quality earnings — trust the ReOI series, use full ω
  ERI 60-80: Moderate quality — apply 10% haircut to ω
  ERI 40-60: Low quality — shrink ω toward industry prior by 50%
  ERI < 40: Unreliable earnings — use asset-based valuation, not earnings-based
```

**Connection to valuation:** ERI directly modulates the fade rate:
```
ω_quality_adjusted = ω_raw × (0.5 + 0.5 × ERI/100)

Intuition: if earnings are unreliable, their persistence is overstated by OLS
(noise looks like persistence in short samples). Haircut accordingly.
```

---

### GAP 11: Segment Lifecycle Classification & Differential Valuation

**Each segment of a conglomerate is in a different lifecycle stage:**
```
Stage 1 — STARTUP (negative ReOI, high capex, accelerating revenue)
  → Value as REAL OPTION (DCF inappropriate for pre-profit businesses)
  → Example: L&T's "Development Projects" in early years

Stage 2 — GROWTH (positive ReOI, ReOI growing > 15% p.a., reinvestment rate > 60%)
  → Value with HIGH ω (0.70-0.85), explicit forecast 5-7 years
  → Example: L&T "IT & Technology Services" in 2015-2020

Stage 3 — MATURE (positive ReOI, stable, reinvestment rate < 40%)
  → Value with MODERATE ω (0.50-0.65), shorter explicit forecast
  → Example: L&T "Infrastructure" (stable margins, predictable)

Stage 4 — DECLINE (shrinking revenue, ReOI declining or negative)
  → Value at LIQUIDATION or with ω < 0.30
  → Example: L&T "Hydrocarbon" (divested)

Classification algorithm:
  revenue_cagr_3y = trailing 3-year revenue CAGR
  reoi_positive = latest ReOI > 0
  reinvestment_rate = capex / depreciation
  
  if !reoi_positive && revenue_cagr_3y > 20%: STARTUP
  elif reoi_positive && revenue_cagr_3y > 15% && reinvestment_rate > 1.5: GROWTH
  elif reoi_positive && revenue_cagr_3y < 5%: MATURE
  elif revenue_cagr_3y < -5% || reoi declining 3 straight years: DECLINE
  else: MATURE (default)
```

**Segment-differentiated SOTP:**
```
V_firm = Σ_i V_segment_i(lifecycle_i)

Where:
  V_startup = Real_Option_Value (Black-Scholes on segment)
  V_growth = NOA_i + ReOI_i × ω_growth / (1 + r - ω_growth)
  V_mature = NOA_i + ReOI_i × ω_mature / (1 + r - ω_mature)  
  V_decline = max(Liquidation_Value_i, NOA_i × (1 - impairment))
```

---

### GAP 12: Transfer Pricing & Related-Party Distortion Detection

**Indian conglomerates routinely distort segment economics via internal pricing.**

```
Detection signals:
  1. Inter-segment revenue > 10% of segment revenue → pricing may be non-arm's-length
  2. Segment margin diverges sharply from pure-play peers → possible margin transfer
  3. Segment RNOA is suspiciously uniform across all segments → artificial smoothing
  
Adjustment:
  Segment_OPM_adjusted = Peer_median_OPM × (Segment_OPM / Peer_median_OPM)^0.5
  (Shrink toward peer median — Bayesian logic: extreme values likely distorted)

For L&T specifically:
  Inter-segment revenue in "IT & Technology" → check if IT segment is earning
  inflated margins from captive L&T infrastructure projects at above-market rates
```

---

### GAP 13: Macro-Conditional Valuation (Regime-Switching Applied)

**Not just DD/credit models — apply regime-switching to the ENTIRE valuation:**
```
V_firm = π_expansion × V(expansion) + π_recession × V(recession)

Where:
  V(expansion) = uses lower discount rate, higher growth, higher ω
  V(recession) = uses higher discount rate, lower growth, lower ω
  
  π_expansion = probability of expansion regime ≈ 0.75 (India long-term)
  π_recession = probability of recession regime ≈ 0.25

Regime parameters for India:
  Expansion: g=12-15%, OPM stable, r_F = 12.5%, ω = ω_base
  Recession: g=3-5%, OPM compressed 20%, r_F = 15%, ω = ω_base - 0.10
```

**Stress test output:**
```typescript
interface RegimeConditionalValuation {
  baseCase: number;              // probability-weighted
  expansion: number;             // value if expansion persists
  recession: number;             // value if recession hits
  drawdownRisk: number;          // % decline from base to recession case
  regime: "expansion" | "late_cycle" | "recession" | "recovery";
  indicatorScore: number;        // composite macro indicator
}
```

---

### GAP 14: The Penman "What You Pay vs What You Get" Framework

**Penman's most practical recent work (2021):** Frame every stock as:

```
What you GET: E[RNOA], persistence (ω), growth (g)
What you PAY: P/B ratio (premium to book value)

Required Return = (1/P_B) × [RNOA + (RNOA - r_F) × ω/(1+r_F-ω)] + g × (1 - 1/P_B)

If Required_Return > your hurdle rate: BUY
If Required_Return < your hurdle rate: AVOID

This elegantly combines:
  - Current profitability (RNOA)
  - Sustainability (ω)  
  - Growth expectations (g)
  - Price paid (P/B)
into a SINGLE expected return number.
```

**Output:**
```typescript
interface PenmanExpectedReturn {
  expectedReturn: number;        // annualized
  rnoaComponent: number;         // return from current profitability
  persistenceComponent: number;  // return from moat (ω)
  growthComponent: number;       // return from growth
  pricePaid: number;             // P/B ratio (cost)
  verdict: "attractive" | "fair" | "expensive";
  // What would need to change for 15% return:
  requiredForHurdle: {
    atCurrentRNOA: number;       // max P/B you could pay
    atCurrentPB: number;         // min RNOA needed
  };
}
```

**This is arguably THE most useful single output for an investor.**
It answers: "Given what I observe (profitability, moat, growth) and what I pay (P/B),
what annual return should I expect?" No forecasting required.

---

### REVISED ARCHITECTURE (incorporating gaps)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 5: DECISION ENGINE                                                    │
│  Penman Expected Return, Buy/Hold/Avoid verdict, Risk scoring               │
├─────────────────────────────────────────────────────────────────────────────┤
│  LAYER 4: PORTFOLIO INTELLIGENCE                                             │
│  Cross-company benchmarking, conglomerate discount, regime-conditional       │
├─────────────────────────────────────────────────────────────────────────────┤
│  LAYER 3: MARKET-FACING MODELS                                               │
│  Reverse DCF (multi-horizon), Merton, Real options, Franchise value          │
├─────────────────────────────────────────────────────────────────────────────┤
│  LAYER 2: ADVANCED PENMAN-NISSIM                                             │
│  Bayesian fade rates, Feltham-Ohlson LID, Segment lifecycle RNOA,            │
│  Industry equilibrium, Dividend displacement, Clean surplus adjustment       │
├─────────────────────────────────────────────────────────────────────────────┤
│  LAYER 1: QUALITY & SIGNAL                                                   │
│  ERI composite, Accrual quality, Transfer pricing detection,                 │
│  Governance scoring, Structural break detection                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  DATA PIPELINE                                                               │
│  Capitaline parser → Recast → RNOA/FLEV/NBC → Segments → Ind-AS normalize   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### REVISED BUILD ORDER (accounting for gaps)

**Sprint 1 — Foundation (zero new data, highest insight):**
1. Fade Rate with Bayesian shrinkage + structural break detection
2. Segment RNOA decomposition + lifecycle classification
3. Penman Expected Return calculator (the "one number" output)
4. ERI composite score (unifies existing Beneish/Piotroski/Sloan)

**Sprint 2 — Market-facing (needs market price, already available):**
5. Reverse DCF with multi-horizon decomposition
6. Accounting-anchor framework (EPV → growth premium → verdict)
7. Value-creating growth separation
8. Industry equilibrium RNOA (converges to sector, not zero)

**Sprint 3 — Segment intelligence (uses fixed segment parser):**
9. Capital allocation efficiency scoring
10. Transfer pricing distortion detection
11. Conglomerate discount measurement
12. Segment-differentiated SOTP with lifecycle-appropriate models

**Sprint 4 — Advanced / external data:**
13. Merton credit model (needs equity volatility)
14. Regime-conditional valuation (needs macro state detection)
15. Real options overlay (needs order book / capex plans)
16. Feltham-Ohlson with "other information" proxies
