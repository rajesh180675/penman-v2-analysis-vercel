# Comprehensive Business Valuation Tool — Design Document

## Executive Summary

This document defines what it takes to make penman-v2-analysis a **10/10 business valuation tool** — not just a Penman-Nissim calculator, but a complete fundamental analysis platform that an institutional investor would trust for buy/sell decisions on **any Indian listed equity**, regardless of sector, size, or business model.

The tool must handle:
- A consumer conglomerate (ITC) with 6 segments and a demerger
- A private bank (HDFC Bank) with loan books and NPA cycles
- A single-segment IT exporter (TCS) with geographic revenue splits
- A cyclical commodity producer (Tata Steel) with volatile margins
- A recently-listed fintech (Paytm) with 3 years of data and no profits
- A PSU utility (NTPC) with regulated returns and capex cycles

The framework adapts its analysis pipeline, valuation models, and quality checks based on what the company IS and what data is AVAILABLE — not a one-size-fits-all template.

---

## Part 1: What's Already Built (Strengths)

### Valuation Models (9 implemented)
1. Residual Earnings (RE) — equity-level
2. Residual Operating Income (ReOI) — enterprise-level
3. FCFF — enterprise cash flow
4. FCFE — equity cash flow
5. DDM — dividend discount
6. AEG — abnormal earnings growth
7. Growth Accounting — value decomposition
8. Market-Implied (reverse DCF) — implied g, implied ke
9. EV/EBITDA cross-check — relative valuation

### Analytical Infrastructure
- Full Penman-Nissim reformulation (OA/FA/OL/FO separation)
- 60+ ratio decomposition (DuPont, Eq.16, OLLEV)
- Dirty surplus accounting with categorization
- AR(1) persistence estimation
- Monte Carlo with Web Workers
- Multi-scenario forecasting (stress/base/bull/panic)
- Anomaly detection (7 types + contamination tiers)
- 5-level rigor ladder with traceability envelope
- Reconciliation residuals (6 identity dimensions)
- India regime overlays (tax cut, GST, Ind AS 116, demonetization)

### Quality & Governance
- Piotroski F-Score, Beneish M-Score, Altman Z', Zmijewski, Ohlson O-Score
- Dechow-Dichev accrual quality
- Roychowdhury real earnings management
- India-specific: promoter holding, RPT, pledging, auditor changes
- Golden company regression suite
- Release gate validation

---

## Part 2: Critical Shortcomings (What Prevents 10/10)

### A. Company-Type Blindness

The engine currently assumes every company is an industrial with:
- Inventory, receivables, payables (working capital cycle)
- Property/plant/equipment (fixed assets)
- Revenue from operations (product/service sales)
- Operating profit margin as key driver

This breaks for:

| Company Type | What's Different | Current Engine Behavior |
|-------------|-----------------|----------------------|
| **Banks/NBFCs** | Assets = loans, liabilities = deposits, NII not revenue, NPA provisions not COGS | `financial_institution_mode` zeros out FA — no real reformulation |
| **Insurance** | Premium income, claims ratio, investment income is core, embedded value | Completely unsupported |
| **IT Services** | Employee cost is 50%+ of revenue, utilization/billing rates matter, forex hedging | Treated as generic industrial |
| **Commodity/Cyclical** | Margins swing 5x through cycle, replacement cost matters, reserve life | No cycle normalization in valuation |
| **Utilities/Regulated** | Returns are regulated (ROE cap), capex = growth, tariff structure | No regulated-return model |
| **Real Estate** | NAV-based valuation, project pipeline, land bank, cash flow lumpy | Completely unsupported |
| **Holding Companies** | Value = sum of stakes minus discount, no operating business | No holding company model |
| **Loss-making/Early-stage** | No earnings to capitalize, revenue growth is only signal | Engine requires positive earnings for most models |
| **PSU** | Government ownership, social obligations, dividend mandates | No PSU-specific adjustments |

### B. Data Structure Variability

Capitaline exports differ by company type:

| Company Type | BS Labels | PL Labels | CF Labels | Extra Data |
|-------------|-----------|-----------|-----------|-----------|
| Industrial | Standard Ind-AS | Standard | Standard | Segment, Investment |
| Bank | Advances, Deposits, NPA, CASA | NII, Fee Income, Provisions | Different structure | Basel ratios, ALM |
| NBFC | Loan book, AUM, securitization | Spread income, provisions | Different | Capital adequacy |
| Insurance | Policyholders' funds, reserves | Premium, claims, investment | Different | Solvency, persistency |
| IT Services | Standard (light BS) | Standard | Standard | Employee metrics |

The parser must handle ALL of these from the same Capitaline source — the HTML structure is identical, only the labels differ.

**CRITICAL FINDING (from HDFC Bank data study):**

Capitaline uses the **same label universe** for ALL company types. HDFC Bank's PL has zero bank-only labels — it's a subset of the same 632 labels ITC uses. The difference is **which labels have non-null values**.

This means:
- The **parser needs no company-type-specific code** — it already works for banks
- The **mapping and interpretation layer** is what needs company-type awareness
- Same label, different economic meaning:
  - "Change in Deposits" in CF: for ITC = trivial; for HDFC Bank = core operating activity
  - "Investments" on BS: for ITC = financial asset; for HDFC Bank = core earning asset
  - "Provisions" in PL: for ITC = minor; for HDFC Bank = credit cost (key driver)
  - "Interest Income" in PL: for ITC = financial income; for HDFC Bank = core revenue

**HDFC Bank data profile (actual):**
- 9 years (FY2017-FY2025), 787 BS labels, 527 PL labels, 75 CF labels
- Segments: Treasury, Retail Banking, Wholesale Banking, Other Banking Ops, Insurance, Digital Banking
- 83 bank-only BS labels (loan detail, guarantees, contingent liabilities)
- CF structure identical to ITC — same 75 labels, different magnitudes

### C. Valuation Model Applicability

Not every model works for every company:

| Model | Works For | Fails For | Why |
|-------|-----------|-----------|-----|
| RE/ReOI | Stable industrials, consumers | Banks, loss-makers | Requires clean OA/FA separation |
| DCF (FCFF) | Capital-intensive, predictable | Banks, early-stage | Banks don't have "free cash flow" |
| DDM | Mature dividend payers | Growth companies, PSUs with mandated dividends | Assumes dividend = shareholder value |
| P/B (Gordon) | Banks, NBFCs | Asset-light IT, brands | Book value is meaningful for financials |
| EV/EBITDA | Industrials, telecom | Banks, insurance | EBITDA meaningless for financials |
| SOTP | Conglomerates, holding cos | Single-segment | Requires segment data |
| NAV | Real estate, holding cos | Operating businesses | Requires asset-level valuation |
| Residual Income (bank) | Banks, NBFCs | Industrials | Uses equity spread (ROE - ke) |

### D. Data Availability Spectrum

The framework must degrade gracefully:

| Data Available | What's Possible | Companies |
|---------------|----------------|-----------|
| **Full 15Y + Segment + Standalone** | Complete analysis, SOTP, trend, persistence | Large-cap (ITC, Reliance, TCS) |
| **10Y consolidated only** | Good analysis, no SOTP, decent persistence | Mid-cap, recently consolidated |
| **5Y consolidated** | Basic analysis, limited persistence, no fade estimation | Recently listed, post-restructuring |
| **3Y or less** | Screening only, no valuation confidence | IPOs, demerged entities |
| **Quarterly only** | TTM-based screening, no annual depth | Very recent listings |

### B. Framework Gaps (Beyond Penman-Nissim)

| Framework | Status | What's Missing |
|-----------|--------|----------------|
| **Graham-Dodd (Value Investing)** | Not implemented | Margin of safety, intrinsic value vs price, net-net, earnings power value |
| **Porter's Five Forces** | Not implemented | Industry structure, competitive advantage period (CAP) |
| **Buffett/Munger (Moat Analysis)** | Not implemented | Economic moat width/trend, ROIC sustainability, capital allocation scoring |
| **Greenblatt (Magic Formula)** | Not implemented | Earnings yield + ROIC ranking |
| **Damodaran (Narrative + Numbers)** | Partial (reverse DCF exists) | Story-to-value bridge, lifecycle stage, option value |
| **DuPont Extended (5-factor)** | Partial | Tax burden × Interest burden × Margin × Turnover × Leverage |
| **EVA/MVA (Stern Stewart)** | Not implemented | Economic Value Added, Market Value Added, capital charge |
| **Ohlson Clean Surplus** | Partial (dirty surplus exists) | Full linear information dynamics model |
| **Real Options** | Not implemented | Growth options, abandonment options, timing options |
| **Credit Analysis (Merton)** | Not implemented | Distance to default, probability of default, credit spread |

### C. Engine Gaps (Mathematical)

1. **OLLEV decomposition doesn't close** — wrong imputed interest rate on OL
2. **AR(1) phi unused in terminal value** — estimated but only used for forecast fade
3. **No growth accounting** — can't answer "what am I paying for growth?"
4. **Lease liability = 0** — Ind AS 116 right-of-use assets not mapped
5. **Pension obligations = 0** — not mapped from raw data
6. **Financial institution mode is blunt** — just zeros out FA, no proper bank reformulation
7. **No proforma restatement** — demergers/M&A break time series
8. **No R&D capitalization** — pharma/tech companies understated

### D. UX/Workflow Gaps

1. **No batch processing UI** — can only analyze one company at a time
2. **No watchlist/portfolio view** — no way to monitor multiple positions
3. **No alert system** — no notification when assumptions break
4. **No collaboration** — single-user, no sharing of analysis
5. **No PDF/report export** — Excel exists but no formatted report
6. **No data refresh** — manual re-upload required for new periods

---

## Part 3: Additional Data Needed from Capitaline

### Currently Downloaded (ITC)
- BalanceSheet (Ind-AS, X-Detailed, Consolidated) ✓
- ProfitLoss (Ind-AS, X-Detailed, Consolidated) ✓
- CashFlow (Detailed, Consolidated) ✓
- SegmentFinance (3 files) ✓
- Investment (portfolio holdings) ✓

### Additional Data Needed

| Data Type | Why Needed | Capitaline Path |
|-----------|-----------|-----------------|
| **Standalone financials** | Parent-only for SOTP, subsidiary contribution | Finance >> BS/PL/CF (Standalone) |
| **Quarterly results** | Timeliness, seasonality, trend detection | Finance >> Quarterly Results |
| **Shareholding pattern** | Promoter holding, FII/DII, pledging | Shareholding >> Pattern |
| **Key ratios (pre-computed)** | Cross-validation, historical PE/PB/EV | Ratios >> Key Ratios |
| **Dividend history** | Payout policy, sustainability | Finance >> Dividends |
| **Share capital history** | Splits, bonus, buybacks, dilution | Finance >> Share Capital |
| **Board of Directors** | Governance quality, independence | Company >> Board |
| **Auditor reports** | Qualifications, emphasis of matter | Company >> Auditor |
| **Credit ratings** | Debt quality, refinancing risk | Company >> Credit Rating |
| **Peer group data** | Relative valuation, sector benchmarks | Industry >> Peer Comparison |

### External Data Sources (Non-Capitaline)

| Source | Data | Purpose |
|--------|------|---------|
| **NSE/BSE** | Daily price, volume, market cap | Beta, implied metrics, technicals |
| **RBI** | Risk-free rate (10Y G-Sec yield) | CAPM, discount rates |
| **SEBI** | Shareholding, insider trades | Governance signals |
| **MCA** | Annual returns, charge register | Debt covenants, related parties |
| **Screener.in** | Pre-computed ratios, peer data | Cross-validation |
| **Moneycontrol** | Consensus estimates | Forecast anchoring |

---

## Part 4: Comprehensive Framework Design

### Layer 1: Data Foundation

```
┌─────────────────────────────────────────────────────────┐
│                    DATA LAKE                              │
├─────────────────────────────────────────────────────────┤
│ Capitaline (BS/PL/CF/Segment/Quarterly/Standalone)      │
│ Market Data (NSE price, volume, corporate actions)       │
│ Governance (SEBI shareholding, insider trades)           │
│ Macro (RBI rates, inflation, GDP, sector indices)        │
│ Peer Universe (sector companies, global comps)           │
│ Management (guidance, concalls, investor presentations)  │
└─────────────────────────────────────────────────────────┘
```

### Layer 2: Normalization & Mapping

```
┌─────────────────────────────────────────────────────────────────┐
│              CANONICAL DATA MODEL                                 │
├─────────────────────────────────────────────────────────────────┤
│ Multi-Standard Ingestion:                                        │
│   ├── Ind-AS (FY2017+)     — current parser handles this        │
│   ├── Revised Sch-VI (FY2012-FY2016) — different labels, same   │
│   │                                     HTML structure            │
│   └── Old GAAP/Standard (pre-FY2012) — oldest format            │
│                                                                   │
│ The same Capitaline HTML export format is used for all three     │
│ standards — only the LABELS change. Parser works unchanged.      │
│ Mapping spec needs standard-aware aliases:                       │
│   "Reserves & Surplus" (Old GAAP) = "Other Equity" (Ind-AS)     │
│   "Sundry Debtors" (Old) = "Trade Receivables" (Ind-AS)         │
│   "Secured Loans" (Old) = "Long Term Borrowings" (Ind-AS)       │
│                                                                   │
│ Period Stitching:                                                 │
│   - Detect standard from header ("Balance Sheet IND" = Ind-AS,  │
│     "Balance Sheet REV" = Revised Sch-VI, else = Standard)       │
│   - Map each standard's labels to canonical Penman metrics       │
│   - Flag transition years (FY2017 Ind-AS adoption = structural  │
│     break for most companies — revaluation, lease reclassif)     │
│   - Rigor ladder marks pre-Ind-AS periods as lower confidence   │
│                                                                   │
│ Other Normalization:                                              │
│   - Sign normalization (Capitaline → accounting convention)      │
│   - Currency normalization (Cr → absolute)                       │
│   - Scope detection (Consolidated vs Standalone from header)     │
│   - Proforma restatement engine (demergers, M&A, reclass)       │
└─────────────────────────────────────────────────────────────────┘
```

**Accounting Standard Timeline (India):**

| Period | Standard | Key Differences from Ind-AS |
|--------|----------|----------------------------|
| Pre-FY2012 | Old Indian GAAP | No fair value, no OCI, different depreciation, no deferred tax |
| FY2012-FY2016 | Revised Schedule VI | Closer to Ind-AS structure but no FVTPL/FVTOCI, no lease capitalization |
| FY2017+ | Ind-AS (IFRS-converged) | Fair value, OCI, Ind AS 116 leases (FY2020+), expected credit loss |

**Practical implication:** For most companies, Capitaline has:
- Ind-AS: 9 years (FY2017-FY2025)
- Revised Sch-VI: 5 years (FY2012-FY2016)
- Standard: varies (some have 5+ years back to FY2006)

To get 15-year history, the tool must ingest all three and stitch them. The parser already handles the HTML — only the mapping spec needs standard-aware label aliases.

### Layer 3: Adaptive Analysis Engine (Company-Type Aware)

```
┌─────────────────────────────────────────────────────────────────┐
│                  COMPANY CLASSIFICATION                           │
│  Auto-detect from data labels + config override                  │
├─────────────────────────────────────────────────────────────────┤
│ INDUSTRIAL    │ BANK/NBFC     │ INSURANCE    │ IT SERVICES      │
│ COMMODITY     │ UTILITY/PSU   │ REAL ESTATE  │ HOLDING CO       │
│ CONGLOMERATE  │ EARLY-STAGE   │ PHARMA       │ TELECOM          │
└───────┬───────┴───────┬───────┴──────┬───────┴────────┬─────────┘
        │               │              │                │
        ▼               ▼              ▼                ▼
┌───────────────┐┌──────────────┐┌─────────────┐┌──────────────────┐
│ INDUSTRIAL    ││ FINANCIAL    ││ REGULATED    ││ ASSET-BASED      │
│ PIPELINE      ││ PIPELINE     ││ PIPELINE     ││ PIPELINE         │
├───────────────┤├──────────────┤├─────────────┤├──────────────────┤
│ OA/FA/OL/FO   ││ Loan book    ││ RAB/tariff   ││ NAV computation  │
│ separation    ││ NII/NIM      ││ Regulated ROE││ Stake valuation  │
│ RNOA/PM/ATO   ││ NPA/PCR      ││ Capex→growth ││ Discount to NAV  │
│ FCFF/FCFE     ││ CASA/CD ratio││ Fuel pass-   ││ Holding discount │
│ Working cap   ││ Capital adeq ││ through      ││ Sum of stakes    │
│ cycle         ││ ROA/ROE/NIM  ││ Volume growth││                  │
│ Margin decomp ││ Credit cost  ││ Tariff hikes ││                  │
└───────────────┘└──────────────┘└─────────────┘└──────────────────┘
```

### Layer 3b: Valuation Model Selection (Automatic)

```
┌─────────────────────────────────────────────────────────────────┐
│              MODEL SELECTION MATRIX                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Company Type    Primary Models       Secondary        Skip       │
│  ─────────────   ──────────────       ─────────        ────       │
│  Industrial      RE, ReOI, FCFF       EV/EBITDA, DDM   P/B        │
│  Bank/NBFC       P/B Gordon, RI       DDM, PE          FCFF, ReOI │
│  Insurance       EV, P/EV             P/B, DDM         FCFF       │
│  IT Services     PE, FCFE, RE         DCF, DDM         P/B        │
│  Commodity       EV/EBITDA, NAV       Normalized PE    RE (noisy) │
│  Utility/PSU     DDM, Regulated DCF   P/B, PE          ReOI       │
│  Real Estate     NAV, SOTP            PE (normalized)  DCF        │
│  Holding Co      SOTP, NAV            Discount to NAV  All others │
│  Conglomerate    SOTP + blended       RE, FCFF         Single-TV  │
│  Early-stage     Revenue multiple     DCF (long-term)  RE, DDM    │
│  Pharma          DCF + pipeline       PE, EV/EBITDA    P/B        │
│  Telecom         EV/EBITDA, DCF       Subscriber val   P/B        │
│                                                                   │
│  Selection logic:                                                 │
│  1. Classify company (auto from labels + manual override)         │
│  2. Check data sufficiency per model (min periods, required keys) │
│  3. Run applicable models only                                    │
│  4. Weight results by model reliability for this company type     │
│  5. Flag when primary model can't run (data gap)                  │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 3c: Mapping Spec Architecture (Multi-Company)

Since Capitaline uses the **same label universe** for all company types (confirmed: HDFC Bank PL = subset of ITC PL), the mapping spec doesn't need separate label dictionaries per type. Instead it needs a **single comprehensive label registry** with **interpretation rules** that vary by company type:

```
CapitalineMappingSpec (single registry, ~800 labels)
│
├── Universal Labels (work the same for all companies)
│   ├── "Total Assets" → TA
│   ├── "Total Equity" → CSE
│   ├── "Profit After Tax" → PAT
│   ├── "Depreciation and Amortization" → D&A
│   └── ... (~200 labels)
│
├── Context-Dependent Labels (same label, different Penman bucket)
│   ├── "Current Investments"
│   │   ├── Industrial → FA (financial asset)
│   │   └── Bank/NBFC → OA (core earning asset)
│   ├── "Interest Income"
│   │   ├── Industrial → NFI (net financial income)
│   │   └── Bank/NBFC → Revenue (core operating)
│   ├── "Provisions"
│   │   ├── Industrial → OL (operating liability)
│   │   └── Bank/NBFC → Credit Cost (key P&L driver)
│   ├── "Change in Deposits" (CF)
│   │   ├── Industrial → Financing activity
│   │   └── Bank → Operating activity (core funding)
│   └── ... (~50 labels)
│
└── Type-Specific Labels (only populated for certain types)
    ├── Bank-only: "Letter of Credit", "Bank Guarantees", "Contingent Liabilities"
    ├── Insurance-only: "Premiums (Insurance Business)", "Claims Paid"
    └── ... (~100 labels)

CompanyTypeClassifier
│
├── Input: set of non-null labels from parsed data
├── Rules:
│   ├── IF "Change in Deposits" > 10% of Total Assets → BANK
│   ├── IF "Premiums (Insurance Business)" non-null → INSURANCE
│   ├── IF "Interest Earned" > 50% of Revenue → FINANCIAL
│   ├── IF "Employee Cost" > 40% of Revenue AND low PPE → IT_SERVICES
│   ├── IF segment count > 3 AND no single segment > 70% → CONGLOMERATE
│   └── DEFAULT → INDUSTRIAL
├── Output: CompanyType enum
└── Override: user can force classification
```

**Key insight:** The same `pickOneWithSource()` function works for all companies. What changes is:
1. Which Penman bucket a label maps to (OA vs FA, Revenue vs NFI)
2. Which ratios are computed (NIM for banks, PM/ATO for industrials)
3. Which valuation models are selected
4. Which quality checks apply (NPA for banks, inventory for industrials)

### Layer 3d: Graceful Degradation

```
┌─────────────────────────────────────────────────────────────────┐
│           DATA SUFFICIENCY → ANALYSIS DEPTH                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Available Data          Analysis Level        Output             │
│  ──────────────          ──────────────        ──────             │
│  15Y + Segment + SA      FULL                  Complete valuation │
│                           - All models run       + SOTP            │
│                           - Persistence est.     + Confidence high │
│                           - Fade calibrated      + Monitoring      │
│                                                                   │
│  10Y consolidated        STANDARD               Valuation range   │
│                           - Primary models       + No SOTP         │
│                           - Persistence est.     + Confidence med  │
│                           - Default fade         + Basic monitor   │
│                                                                   │
│  5Y consolidated         BASIC                  Indicative value  │
│                           - 2-3 models           + Wide range      │
│                           - No persistence       + Confidence low  │
│                           - Sector fade          + Screening only  │
│                                                                   │
│  3Y or less              SCREENING              Relative metrics  │
│                           - Multiples only       + No intrinsic    │
│                           - No DCF               + Flag as thin    │
│                           - Peer comparison      + Watch list      │
│                                                                   │
│  Missing statements      PARTIAL                What's possible   │
│  (e.g., no CF)           - Skip CF-dependent    + Flag gaps       │
│                           - BS/PL models only    + Suggest data    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 4: Valuation Synthesis

```
┌─────────────────────────────────────────────────────────┐
│           VALUATION SYNTHESIS ENGINE                      │
├─────────────────────────────────────────────────────────┤
│ 1. Intrinsic Value Range (multi-model triangulation)     │
│    - Accounting models: RE, ReOI, AEG                    │
│    - Cash flow models: FCFF, FCFE, DDM, APV              │
│    - Relative: peer multiples, regression-predicted       │
│    - Asset-based: liquidation, replacement cost           │
│                                                          │
│ 2. Confidence Weighting                                  │
│    - Model reliability per company type                   │
│    - Data quality adjustment                              │
│    - Rigor ladder gate                                    │
│                                                          │
│ 3. Margin of Safety Computation                          │
│    - Current price vs intrinsic range                     │
│    - Quality-adjusted discount                            │
│    - Governance risk premium                              │
│                                                          │
│ 4. Investment Decision Framework                         │
│    - Buy/Hold/Sell signal with confidence                 │
│    - Position sizing suggestion (Kelly-adjacent)          │
│    - Risk-reward asymmetry scoring                        │
│    - Catalyst identification                              │
└─────────────────────────────────────────────────────────┘
```

### Layer 5: Monitoring & Alerts

```
┌─────────────────────────────────────────────────────────┐
│           CONTINUOUS MONITORING                           │
├─────────────────────────────────────────────────────────┤
│ - Quarterly result deviation from forecast               │
│ - Shareholding pattern changes (promoter selling)        │
│ - Credit rating changes                                  │
│ - Insider trading signals                                │
│ - Price vs intrinsic value drift                         │
│ - Peer relative performance                              │
│ - Macro regime shifts (rate changes, policy)             │
│ - Corporate action alerts (splits, buybacks, rights)     │
└─────────────────────────────────────────────────────────┘
```

---

## Part 5: Implementation Priorities

### Phase 1: Strengthen the Industrial Pipeline (Weeks 1-3)
**Goal: Make the existing pipeline produce correct, complete results for industrials**

1. **Expand mapping spec** — 234 → 600 labels (cover CF detail, expense granularity, share count, tax, OCI)
2. **Fix OLLEV closure** — correct imputed interest rate on operating liabilities
3. **Wire AR(1) phi into terminal value** — use Ohlson reversion CV as primary
4. **Map lease liabilities** — Ind AS 116 right-of-use assets
5. **Sign normalization** — consistent convention across all Capitaline exports
6. **Segment data ingestion** — parse SegmentFinance files, store as typed segment data
7. **Scope detection** — extract Consolidated/Standalone from HTML header, process both

### Phase 2: Company Classification & Model Selection (Weeks 4-6)
**Goal: Auto-detect company type and run appropriate models**

8. **Company classifier** — score parsed labels against type dictionaries (bank labels → financial, NII → bank, etc.)
9. **Model selection matrix** — given company type + data availability, select which valuation models to run
10. **Graceful degradation** — when data is insufficient for a model, skip it cleanly with explanation
11. **SOTP for conglomerates** — wire segment data into per-segment standalone valuation
12. **Proforma restatement** — handle demergers, M&A, discontinued operations in time series
13. **Cyclical normalization** — mid-cycle earnings for commodity/cyclical companies

### Phase 3: Financial Institution Pipeline (Weeks 7-10)
**Goal: Banks and NBFCs produce meaningful analysis**

14. **Bank reformulation** — NII decomposition, loan book quality, provision coverage
15. **Bank-specific ratios** — NIM, CASA, credit cost, ROA, slippage, PCR
16. **Bank valuation** — P/B Gordon growth (justified P/B = ROE-g / ke-g), residual income on equity
17. **NBFC adaptation** — AUM-based metrics, spread analysis, capital adequacy
18. **NPA cycle detection** — identify credit cycle position, normalize provisions
19. **Bank mapping spec** — Capitaline bank labels (Advances, Deposits, Interest Earned, etc.)

### Phase 4: Relative Valuation & Peers (Weeks 11-14)
**Goal: Cross-company comparison with appropriate metrics per type**

20. **Peer group engine** — auto-select peers by sector + size + business model
21. **Multi-metric relative valuation** — PE, PB, EV/EBITDA, PS with quality adjustment
22. **Sector-appropriate metrics** — P/B for banks, EV/EBITDA for industrials, PE for IT
23. **Regression-based fair value** — predicted PE from growth + quality + size
24. **Batch processing** — analyze 30+ companies from folder of Capitaline exports
25. **Portfolio dashboard** — watchlist with signal states, opportunity scores per company

### Phase 5: Market Data & Decision Engine (Weeks 15-18)
**Goal: Live data integration and investment decision output**

26. **NSE price feed** — daily close, market cap, 52-week range
27. **Beta computation** — rolling returns vs Nifty 50
28. **Margin of safety** — current price vs intrinsic range, quality-adjusted
29. **Investment decision synthesis** — buy/hold/sell with confidence, key risks, catalysts
30. **Sensitivity dashboard** — interactive ke × g grid, scenario toggles

### Phase 6: Institutional Quality (Weeks 19-24)
**Goal: Professional output, monitoring, collaboration**

31. **PDF report generation** — formatted investment memo per company
32. **Peer comparison matrix** — sector-level relative valuation table
33. **Quarterly monitoring** — alert when results deviate from forecast
34. **Insurance pipeline** — embedded value, solvency, persistency (if demand exists)
35. **Real estate/holding company** — NAV model, stake valuation (if demand exists)
36. **Backtest framework** — historical signal accuracy measurement

---

## Part 6: Capitaline Data Requirements (Per Company Type)

### Universal (All Companies)

| # | Statement | Format | Purpose |
|---|-----------|--------|---------|
| 1 | Balance Sheet | Ind-AS, X-Detailed, Consolidated | Core reformulation |
| 2 | Profit & Loss | Ind-AS, X-Detailed, Consolidated | Core reformulation |
| 3 | Cash Flow | Detailed, Consolidated | FCF, capital allocation |
| 4 | Investment Schedule | Current | Portfolio/subsidiary valuation |

### Industrial/Consumer/Pharma/Auto (add to universal)

| # | Statement | Purpose |
|---|-----------|---------|
| 5 | BS/PL/CF Standalone | SOTP, subsidiary contribution |
| 6 | Segment Finance (Business) | Segment-level revenue/profit/assets |
| 7 | Segment Finance (Geographic) | Geographic diversification |

### Banks/NBFCs (different label universe)

| # | Statement | Purpose |
|---|-----------|---------|
| 5 | Schedule of Advances | Loan book composition, NPA |
| 6 | Schedule of Deposits | CASA ratio, cost of funds |
| 7 | Basel III Disclosure | Capital adequacy, risk weights |
| 8 | Asset Quality Statement | GNPA, NNPA, PCR, slippage |

### Insurance (different label universe)

| # | Statement | Purpose |
|---|-----------|---------|
| 5 | Revenue Account | Premium, claims, commission |
| 6 | Profit & Loss (Form B-PL) | Investment income, management expenses |
| 7 | Solvency Statement | Solvency ratio, available capital |

### Utilities/PSU

| # | Statement | Purpose |
|---|-----------|---------|
| 5 | Segment Finance | Generation/Transmission/Distribution |
| 6 | Tariff Orders (external) | Regulated return, RAB |

### Minimum Company Universe (Covering All Types)

| Sector | Companies | Type | Priority |
|--------|-----------|------|----------|
| Consumer | ITC, HUL, Nestle, Britannia, Dabur | Industrial-Conglomerate/Single | P1 |
| IT | TCS, Infosys, Wipro, HCL Tech | IT Services | P1 |
| Banks | HDFC Bank, ICICI, Kotak, SBI | Financial-Bank | P1 |
| NBFC | Bajaj Finance, Shriram Finance, Muthoot | Financial-NBFC | P2 |
| Pharma | Sun Pharma, Dr Reddy's, Cipla, Divi's | Industrial-Pharma | P1 |
| Industrial | L&T, Siemens, ABB, Cummins | Industrial | P2 |
| Auto | Maruti, M&M, Tata Motors, Bajaj Auto | Industrial-Cyclical | P2 |
| Materials | Asian Paints, UltraTech, Tata Steel, JSW | Industrial-Commodity | P2 |
| Energy | Reliance, ONGC, NTPC, Power Grid | Conglomerate/Utility | P1 |
| Telecom | Bharti Airtel | Telecom | P2 |
| Insurance | HDFC Life, SBI Life, ICICI Lombard | Insurance | P3 |
| Real Estate | DLF, Godrej Properties | Real Estate | P3 |
| Holding | Tata Investment, Bajaj Holdings | Holding Company | P3 |

---

## Part 7: What Makes This 10/10

A 10/10 business valuation tool would:

1. **Ingest any Indian listed company** in <5 minutes from Capitaline export — industrial, bank, NBFC, insurance, utility, or conglomerate
2. **Auto-classify the company type** and select appropriate analysis pipeline (no manual configuration needed for standard cases)
3. **Produce 3-5 independent valuations** using models appropriate for that company type, triangulating to a defensible range
4. **Degrade gracefully** when data is incomplete — run what's possible, flag what's missing, never produce garbage
5. **Handle structural events** (demergers, M&A, regime changes, NPA cycles, tariff revisions) without manual intervention
6. **Provide investment decision** — not just a number, but buy/hold/sell with confidence level and key risks
7. **Compare across peers** — relative positioning within sector using appropriate metrics (PE for IT, P/B for banks, EV/EBITDA for industrials)
8. **Explain in plain language** — why this company is worth X, what the key drivers are, what could go wrong
9. **Be auditable** — every number traceable to source, every assumption explicit, every model choice justified
10. **Scale to 50+ companies** — batch processing, portfolio view, cross-sector screening

### Current Score: 6/10
- Strong mathematical foundation (Penman-Nissim is best-in-class for industrials)
- Good governance infrastructure (rigor ladder, traceability)
- Weak on company-type diversity (only industrial pipeline works)
- Weak on data breadth (6% mapping, no market data, no quarterly)
- Missing alternative frameworks (no bank reformulation, no relative valuation)
- No automation (manual upload, single company)
- No investment decision synthesis

### Gap to 10/10 by Company Type

| Company Type | Current Capability | Gap |
|-------------|-------------------|-----|
| Industrial (ITC, HUL) | 7/10 — full pipeline works, mapping thin | Expand mapping, SOTP, segment |
| IT Services (TCS, Infy) | 6/10 — works but misses employee metrics | Add IT-specific ratios |
| Banks (HDFC, ICICI) | 2/10 — `financial_institution_mode` is a stub | Need full bank reformulation |
| NBFCs (Bajaj Finance) | 2/10 — same stub as banks | Need NBFC-specific pipeline |
| Insurance | 0/10 — completely unsupported | New pipeline from scratch |
| Commodity/Cyclical | 4/10 — works but no cycle normalization | Add mid-cycle valuation |
| Utilities/PSU | 4/10 — works but no regulated-return model | Add RAB/tariff framework |
| Conglomerate | 5/10 — SOTP stub exists | Wire segment data, discount |
| Real Estate | 0/10 — unsupported | NAV model needed |
| Holding Company | 0/10 — unsupported | Stake valuation + discount |

---

## Part 8: Architecture Decisions

### Keep (Working Well)
- Client-side compute for single-company analysis
- Vite + React + TypeScript stack
- Deterministic pipeline (Sort → Recast → Ratios → Anomaly)
- Traceability envelope as shared trust signal
- Golden company regression suite
- Vercel deployment

### Change
- **Add server-side compute** for batch processing (Vercel serverless or dedicated)
- **Add database** for company universe (SQLite via Turso, or Supabase)
- **Add market data cron** for daily price/volume updates
- **Add quarterly parser** to Capitaline ingestion
- **Add standalone parser** (same format, different scope detection)
- **Restructure mapping spec** into 3-tier ontology with auto-discovery

### Add
- **Company Universe Store** — persistent registry of all analyzed companies
- **Peer Group Engine** — automatic sector classification and peer selection
- **Investment Thesis Module** — structured narrative + quantitative synthesis
- **Alert/Monitoring Service** — cron-based quarterly result checking
- **Report Generator** — PDF/HTML institutional-quality output

---

## Appendix A: Valuation Framework Comparison

| Framework | Best For | Limitations | Priority |
|-----------|----------|-------------|----------|
| Penman-Nissim RE/ReOI | Stable companies with clean accounting | Sensitive to terminal value | ✅ Built |
| DCF (FCFF/FCFE) | Capital-intensive, predictable cash flows | Garbage-in-garbage-out | ✅ Built |
| DDM | Mature dividend payers | Useless for growth companies | ✅ Built |
| EPV (Graham-Dodd) | Cyclicals, turnarounds | Ignores growth entirely | 🔴 Phase 3 |
| Relative (multiples) | Quick screening, sanity check | Assumes peers are fairly valued | 🟡 Partial |
| SOTP | Conglomerates, holding companies | Ignores synergies/dis-synergies | 🟡 Stub exists |
| EVA/MVA | Capital allocation assessment | Requires WACC accuracy | 🔴 Phase 3 |
| Real Options | R&D-heavy, early-stage | Complex, assumption-sensitive | 🔴 Phase 5 |
| Merton Credit | Distressed, leveraged | Requires equity volatility | 🔴 Phase 5 |
| LBO | PE-style returns analysis | Assumes leverage, exit multiple | 🔴 Phase 5 |

## Appendix B: India-Specific Considerations

| Factor | Impact on Valuation | How to Handle |
|--------|--------------------|--------------| 
| Promoter holding >50% | Governance premium/discount | Score in quality module |
| Pledged shares | Downside risk amplifier | Red flag in governance |
| Related party transactions | Value leakage risk | Intensity scoring vs revenue |
| Ind AS 116 (2019) | EBITDA inflated, debt inflated | Regime overlay adjustment |
| Corporate tax cut (2019) | One-time PAT boost | Normalize effective tax rate |
| GST transition (2017) | Revenue recognition change | Structural break detection |
| Demonetization (2016) | Cash-heavy businesses hit | Event flag, exclude from trend |
| IBC/NCLT | Distressed asset resolution | Credit analysis module |
| SEBI LODR | Disclosure quality | Governance scoring input |
| Dividend tax abolition (2020) | Payout policy shift | Dividend regime classification |

---

---

## Part 9: Mapping Expansion Priority (872 Unmapped Keys with Values)

### Category Breakdown (FY2025 ITC)

| Category | Unmapped Keys | Top Value (Cr) | Priority |
|----------|--------------|----------------|----------|
| EXPENSE_DETAIL | 357 | 44,197 (Non-current Assets total) | P1 — margin decomposition |
| SHARE_COUNT | 283 | 12.5B shares issued | P1 — per-share valuation |
| EQUITY_DETAIL | 237 | 88,091 (Total E&L) | P1 — clean surplus |
| CF_OPERATING | 181 | 15,862 (PBT adjustments) | P1 — FCF accuracy |
| WORKING_CAPITAL | 166 | 70,030 (Total Equity) | P2 — working capital cycle |
| DEBT_DETAIL | 161 | 176 (doubtful debts) | P2 — leverage analysis |
| TAX_DETAIL | 138 | 42,582 (PBT) | P1 — effective tax rate |
| REVENUE_DETAIL | 114 | 76,827 (manufactured goods) | P1 — revenue quality |
| OTHER | 1,096 | 70,921 (appropriations) | P3 — completeness |
| CF_FINANCING | 66 | 17,957 (total dividend) | P1 — capital allocation |
| CF_INVESTING | 32 | 25,541 (raw material) | P2 — investment analysis |
| OCI | 18 | 4,712 (subsidiary investments) | P2 — dirty surplus |

### Phase 1 Mapping Targets (Critical for Valuation)

**Share Count (must-have for per-share output):**
- `Number of Equity Shares - Issued` → share count
- `Number of Equity Shares - Subscribed Fully Paid up` → diluted shares
- `Weighted Average Number of Shares in Issue - Diluted` → diluted EPS denominator
- `Basic EPS` / `Diluted EPS` → cross-validation

**Revenue Granularity (revenue quality scoring):**
- `Sales - Manufactured / Finished Goods` → product revenue
- `Sale of Services` → service revenue
- `Total Other Operating Revenue` → other operating
- `Less: Excise Duty` → net revenue adjustment
- `Cash Discount and Rebate` → revenue quality signal

**Expense Granularity (margin decomposition):**
- `Selling and Administration Expenses` / `Total Selling & Administrative Expenses` → SGA
- `Total Selling and Distribution Expenses` → distribution cost
- `Salaries and Incentives` → employee cost detail
- `Manufacturing / Direct Expenses` → COGS detail
- `Purchases of Raw Material` → material cost
- `Total Raw Material Consumed` → consumption
- `Power, Fuel and Water` → fixed vs variable cost
- `Corporate Social Responsibility` → discretionary spend

**Tax Detail (effective tax rate):**
- `Current Tax` → current tax expense
- `Deferred Tax` → deferred component
- `Net Profit before Tax & Extraordinary Items` → PBT cross-check
- `Profit Before Exceptional Items and Tax` → core PBT

**Cash Flow Detail (capital allocation):**
- `Dividend Paid` → already mapped but verify
- `Direct Taxes Paid` → operating cash tax
- `Net Cash Used in Financing Activities` → financing total
- `Net Cash Used in Investing Activities` → investing total
- `Cash Generated from/(used in) Operations` → pre-tax operating CF
- `Op. Profit before Working Capital Changes` → operating profit proxy
- `Interest Paid` → cash interest (vs accrual)
- `Proceeds from Issue of shares` → equity issuance
- `Special Dividend` → non-recurring distribution

**Equity Detail (clean surplus, book value):**
- `Total Reported Stockholders' Equity` → cross-check CSE
- `General Reserves` → retained earnings component
- `Share Premium` → paid-in capital
- `Capital Work in Progress` → capex pipeline
- `Total Equity and Liabilities` → BS total cross-check

**Working Capital (operating cycle):**
- `Debtor Less than 6 Month - Gross` → receivables aging
- `Closing Stock of Raw Materials` → inventory detail
- `Opening Stock of Raw Materials` → inventory turnover
- `Other Trade Payables` → payables detail

### Mapping Expansion Roadmap

| Phase | Labels Added | Coverage | Timeline |
|-------|-------------|----------|----------|
| Current | 234 | ~15% of active keys | Done |
| Phase 1 | +150 (critical) | ~24% | Week 1 |
| Phase 2 | +200 (important) | ~37% | Week 2-3 |
| Phase 3 | +300 (comprehensive) | ~56% | Week 4-6 |
| Auto-discovery | +200 (pattern-matched) | ~69% | Ongoing |

---

## Part 10: Immediate Action Items (Next Session)

When ready to execute:

1. **Expand mappingSpec.ts** — add the ~150 Phase 1 labels listed above
2. **Fix OLLEV** — correct imputed interest rate formula in PenmanNissimEngine.ts L647
3. **Wire phi into CV** — use `cvReversion()` as primary terminal value (already implemented, just not default)
4. **Parse segment files** — add "segment" to `stmtFromFilename()` detection
5. **Add scope detection** — extract "Consolidated"/"Standalone" from HTML header
6. **Run golden tests** — verify ITC still passes after mapping expansion
7. **Measure coverage** — report new mapping % after Phase 1

---

*Document version: 1.0*
*Created: 2026-05-16*
*Status: PLAN MODE — no implementation yet*

---

## Update 2026-05-17 — Companion Roadmap

After the code-review-2026-05-17 hardening pass, the immediate execution
plan was extracted into `NEXT-PHASE-ROADMAP.md`. That doc:

- Reflects what is actually wired in the engine today (vs aspirational here)
- Lists the two real failure modes blocking multi-company support
  (multi-standard ingestion + Ind-AS-only mapping spec)
- Sequences the work into Phases A-J with a recommended PR-1 scope
  (Phase A — multi-standard ingestion: Ind-AS + Revised Sch-VI + Standard)
- Catalogs ~15 representative companies by failure mode and which phase
  unblocks each

Read `NEXT-PHASE-ROADMAP.md` before starting any new implementation work.
This document remains the strategic frame; the roadmap is the execution
plan derived from it.
