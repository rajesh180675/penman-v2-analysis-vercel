# Comprehensive Audit — Penman V2 Analysis
**Date**: 2026-04-06 | **Deployed URL**: https://penman-v2-analysis-vercel.vercel.app/

## 1. Deployment Status

| Item | Status |
|------|--------|
| Frontend App | Live and serving (Vite SPA, ~1.2MB gzipped JS) |
| Research API `/api/research` | Live, responds to queries |
| Vercel Admin API Token | **EXPIRED/REVOKED** — returns 403 on all v13/v9 endpoints |
| Blob Storage (`BLOB_READ_WRITE_TOKEN`) | Configured — comparison registry writes succeed |

The deployed research API stores data in Vercel Blob storage, keyed by `companyId`. The serverless function at `api/research/index.js` handles both GET (read) and POST (write) for comparison data, profiles, valuations, filings, alerts, journal entries, and analyses.

## 2. Companies Found in Deployed Research API

Only **1 company** is stored in the shared research API blob storage:

### ITC
| Property | Value |
|----------|-------|
| Raw Periods | **15** (FY2011–FY2025, annual periods ending March 31) |
| Recast Data | **0** (pipeline not executed on server — computation is client-side) |
| Traceability Envelope | **Not persisted** (only raw `rawData` stored) |
| Unique Metric Keys | **3,234** per period, distributed as: |
| - BalanceSheet keys | 922 |
| - ProfitLoss keys | 644 |
| - CashFlow keys | 75 |
| - Other/derived | 1,593 |

**Why is recastData empty?** The Penman–Nissim engine runs entirely in-browser. Raw Capitaline data uploaded by users is persisted to blob storage, but the recast pipeline (mapping + ratio computation + valuation) executes on the client via React state. The server is a dumb persistence layer.

## 3. Golden Company Suite (6 Companies Wired in Tests)

These are the canonical fixtures used for regression testing and release gates:

| # | Company ID | Source | Type | Quality Tier | Valuation Status | Periods | Notes |
|---|-----------|--------|------|-------------|-----------------|---------|-------|
| 1 | **ITC** | audited-run | Real | Tier 1 | **guarded** (BLOCKED) | ≥15 | Has structural events, ROCE/RNOA outliers, PM outliers |
| 2 | **ASIAN PAINTS** | audited-run | Real | Tier 1 | **production-ready** | ≥10 | Clean industrial; no structural events or capital transactions |
| 3 | **VST** | real-company-sample | Real | Tier 2 | **guarded** (BLOCKED) | 5 | Negative FLEV, extreme ROCE (0.2–1.5 range) |
| 4 | **NETCASH_CONSUMER** | curated-contrast | Synthetic | Tier 2 | **production-ready** | 3 | Net-cash compounder; stable economics; FLEV [-1.0, 0.05] |
| 5 | **LEVERAGED_INDUSTRIAL** | curated-contrast | Synthetic | Tier 1 | **warning** | 3 | High debt (FLEV 0.3–1.5); healthy but leveraged |
| 6 | **EXCEPTIONAL_EVENT_CO** | curated-contrast | Synthetic | Tier 2 | **guarded** (BLOCKED) | 3 | Exceptional items, discontinued ops contaminate latest year |

## 4. Capitaline Data Field → Canonical Mapping

### Mapping Spec (`CapitalineIndASDetailedMappingSpec.yaml`)
Raw Capitaline labels are mapped through a **4-tier mapping spec**:

**Balance Sheet** canonical keys:
- `TA` — Total Assets
- `CSE` — Stockholders' Equity → Total Equity (fallback)
- `MI` — Minority Interest
- `FA.*` (Financial Assets) → cash_bank, investments_current, investments_long_term, deposits_restricted, other_financial_assets
- `FO` (Financial Obligations) → borrowings, lease liabilities, financial liabilities
- `OL.*` (Operating Liabilities) → trade_payables, other_current_liabilities, provisions, tax liabilities, deferred tax

**Income Statement** canonical keys:
- `sales` — Revenue From Operations(Net) + 8 aliases
- `cni` (Core Net Income) ← TCI - NCI + comprehensive income groups
- `FinanceCost` — 20+ aliases (Finance Cost, Interest variants, etc.)
- `FinanceIncome` — Interest Income, Finance Income, Investment Income
- `quality_inputs` — COGS components, expense buckets, SGA sub-categories

**Cash Flow** canonical keys:
- `CFO` — Net Cash from Operating Activities
- `Capex` — Purchased of Fixed Assets
- `debt_proceeds` / `debt_repayment` — multiple borrowing line aliases
- `share_buybacks`, `dividend_paid`, `interest_received`, `dividend_received`

### Mapping Resolution Tiers (A → D)
- **Tier A**: Exact match from the correct statement
- **Tier B**: Exact match from wrong statement (cross-statement)
- **Tier C**: Fuzzy match (normalized text comparison)
- **Tier D**: Derived (composite sum from sub-components)

### Resolution Logic
1. **Statement-aware lookup**: prefers `BalanceSheet`-qualified, then `ProfitLoss`, then unqualified
2. **Composite summation**: e.g., `FA.cash_bank` sums "Cash and Cash Equivalents" + "Bank Balances Other Than Cash" + "Earmarked Balances" + "Margin Money Balances", with no double-counting
3. **Primary/fallback**: e.g., `CSE` tries "Total Stockholders' Equity" first, falls back to "Total Equity"

## 5. Canonical Recast Types (What Every Metric Computes)

### Balance Sheet Recast (`CanonicalBalanceSheet`)
`TA, CSE, MI, FA, FO, OA, OL, NOA, NFO, Goodwill, PPE, Inventory, TradeReceivables, TradePayables, CurrentAssets, CurrentLiabilities, separationScore` + 20+ sub-components

### Income Statement Recast (`CanonicalIncome`)
`Sales, PAT, OCI, TCI, TCI_NCI, CNI, OI, NFE, MII, CoreOI, UOI, CoreNFE, UFE, COGS, FinanceCost, FinanceIncome, TaxExpense, taxRate` + operating cost bridge

### Cash Flow Recast (`CashFlowData`)
`CFO, Capex, DividendPaid, EquityIssued, ShareBuybacks, FCF_accounting, FCF_cash, d_t, d_t_formula, d_t_discrepancy, EBITDA, DebtProceeds, DebtRepayment`

### Ratios (25+ metrics)
`ROCE, RNOA, NBC, SPREAD, FLEV, PM, ATO, SalesPM, interest_coverage, accrual_ratio_bs, accrual_ratio_cf, cash_conversion_ratio, ROOA, OLLEV, OLSPREAD, ROTCE, MSR, current_ratio, quick_ratio, days_receivable, days_payable, days_inventory, cash_conversion_cycle, CNOA_growth, CNI_growth`

### Quality Metrics
- **Piotroski F-Score** (9 components): ROA, delta ROA, CFO, accrual, leverage, liquidity, dilution, margin, turnover
- **Beneish M-Score** (8 ratios): DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA
- **Altman Z'** (5 ratios): WC/TA, RE/TA, EBIT/TA, BVE/TL, S/TA
- **Zmijewski X-Score**: ROA, leverage, liquidity
- **Ohlson O-Score**: size, leverage, liquidity, negative ROE, change in NI

### Residual Income
`RE, ReOI` — computed from CNI and operating income minus capital charge

### V3 Valuation Output
5 methods: `RE, ReOI, FCFF, FCFE, AEG` with per-share results, implied P/B, P/E, margin of safety

## 6. Pipeline Flow (Client-Side)

```
Raw RawPeriodData[]
  → Sort chronologically
  → ComputeRecastPeriod (per-period): BS recast + IS recast + CF recast + TraceMap
  → ComputeRatios (per-period-from-2nd): 25+ ratios
  → DeriveKwFromStructure (S-9.4): structural kw from BS, never hardcoded
  → ComputeResidualIncome: RE + ReOI
  → ComputeQuality: Piotroski + Beneish + Altman + Zmijewski + Ohlson
  → RunAnomalyDetection: outlier detection across all periods
  → BuildUnusualItemPolicy: classify exceptional items
  → RecastPeriod[] ← complete output
```

## 7. Rigor Ladder (5 gates, fail-closed)

| Level | Check | Threshold |
|-------|-------|-----------|
| `syntactically-valid` | Parser fidelity score + no engine error | score >= 60 |
| `structurally-reconciled` | Scope ok + no blocking issues + identity residuals | reconciliation.status != "failed" |
| `economically-plausible` | Structural achieved + no valuation-critical blockers | valuationBlocked = false |
| `valuation-eligible` | Structural + eligible valuation status | status != "guarded" |
| `production-ready` | analysisStatus.status == "production-ready" | — |

**Reconciliation checks**: Balance Sheet identity, Cash-Distribution bridge, Share-Capital tie-out, Debt-Flow bridge (long-term + short-term), Income Statement bridges (PAT+OCI=TCI, CNI=OI-NFE-MII, CoreOI+UOI=OI, CoreNFE+UFE=NFE), Operating-Cost bridge (when 60% source coverage), Ending-Cash bridge

## 8. Key Findings

1. **Single company in production blobs**: Only ITC raw data is persisted. No recast results stored server-side. All analysis happens client-side.
2. **Vercel Admin token expired**: Cannot access deployment logs, team info, environment variables, or deployment history.
3. **ITC raw data has 3,234 keys per period**: This is ~10x more than a typical Capitaline extraction, suggesting the Capitaline parser extracts massive label inventories across all statements with fuzzy/composite matching.
4. **Traceability envelope NOT stored in blob**: The ITC record in blob storage has no `traceability` field — it's purely raw `rawData`. Trust state only exists in React session memory or the comparison registry (localStorage + blob).
5. **No valuation data stored**: The research API valuations endpoint returns empty for all companies — valuations are ephemeral client-side computations.
