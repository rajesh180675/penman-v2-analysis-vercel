# Institutional Investor Platform Roadmap

## Purpose

This document takes the repository as it exists on March 30, 2026 and turns it into an end-to-end roadmap for evolving it from a strong accounting-led valuation application into a sophisticated investor tool for:

- statement ingestion and normalization,
- rigorous accounting reformulation,
- quality and fraud-forensics analysis,
- forecast and scenario modeling,
- valuation and market-opportunity analysis,
- portfolio/watchlist workflow,
- research governance, reproducibility, and release discipline.

This is not a greenfield product brief. It is grounded in the codebase that already exists in:

- `src/engine/*`
- `src/components/*`
- `src/lib/audit.ts`
- `api/audit/*`
- `api/market-data/snapshot.js`
- `docs/production-grade-plan-itc.md`
- `docs/valuation-command-center-roadmap.md`

## Executive Summary

### Current state

The application already has a serious core:

- multi-source ingestion (`capitaline`, `screener`, `json`, `xbrl`, `manual`),
- statement reformulation into operating and financing views,
- residual income and reformulated operating income valuation,
- owner-earnings / DCF-style valuation command center,
- share-count extraction and per-share reporting,
- anomaly detection, unusual-item normalization, and valuation readiness gating,
- mapping audit, backlog triage, and quality tiers,
- run persistence, traceability, monitor automation, and inspector UI,
- golden-company release gates.

This is materially beyond a prototype.

### What it is not yet

It is not yet an institutional-grade investor platform because it still lacks:

- company knowledge that persists beyond a single run,
- a full research workflow around thesis, catalysts, and disconfirming evidence,
- rigorous market-implied expectations decomposition beyond current reverse DCF,
- richer academic forecast models for accruals, cash flows, growth, and terminal fade,
- full historical replay and signal calibration across many real companies,
- portfolio-level ranking, risk budgeting, and position-sizing workflow,
- explicit treatment of corporate actions, segment changes, and accounting regime changes,
- model-governance layers expected of a high-trust finance product.

### Target end state

The target product is a disciplined investor workbench that:

1. ingests messy real-world financial statement data,
2. reformulates it into economically meaningful structures,
3. scores quality, manipulation risk, and distress risk,
4. builds explicit forecasts with scenario control,
5. triangulates intrinsic value across accounting-led and cash-flow-led models,
6. compares current price to intrinsic value and to history,
7. decides whether the setup is merely interesting or genuinely rare,
8. explains exactly why,
9. persists all evidence, assumptions, versions, and outputs for auditability.

## Current Codebase Foundation

## 1. Data Ingestion Surface

### Implemented today

The app already supports:

- Capitaline ZIP ingestion via `src/engine/capitalineParser.ts`
- Screener paste ingestion via `src/engine/screenerParser.ts`
- raw JSON ingestion via `src/engine/jsonIngestion.ts`
- XBRL XML ingestion via `src/engine/xbrlParser.ts`
- manual structured entry via `src/components/ManualEntryWizard.tsx`

### Current strengths

- multiple input routes reduce dependence on one provider,
- Capitaline ingestion is proven against real persisted runs,
- debug metadata is captured and persisted,
- raw period structures are normalized before downstream modeling.

### Remaining limitations

- there is no canonical issuer master-data layer,
- there is no persistent concept of filing, statement version, amendment, or restatement,
- there is no statement lineage graph across multiple providers,
- no dedicated corporate-action layer exists for splits, buybacks, mergers, or demergers,
- no segment-level, geography-level, or product-line ingestion path exists.

## 2. Canonical Schema

### Implemented today

`src/engine/types.ts` already defines a rich analytical schema:

- `RawPeriodData`
- `CanonicalBalanceSheet`
- `CanonicalIncome`
- `CoreUnusual`
- `CashFlowData`
- `Ratios`
- `QualityMetrics`
- `ResidualIncome`
- `RecastPeriod`
- `EngineConfig`
- scenario, valuation, Monte Carlo, and company-registry types

### Strengths

- the schema is already accounting-aware rather than UI-driven,
- operating and financing structures are separated,
- quality metrics and residual income are first-class fields,
- traceability and contamination concepts already exist,
- forecast and valuation config are already explicit and typed.

### Remaining limitations

The schema is still too single-run and single-company-analysis oriented. It needs to grow into:

- `Issuer`
- `Security`
- `Listing`
- `CorporateAction`
- `Filing`
- `StatementArtifact`
- `NormalizedStatementVersion`
- `AnalystAssumptionSet`
- `ResearchNote`
- `Catalyst`
- `ValuationSnapshot`
- `SignalDecision`
- `PortfolioPosition`
- `PeerSet`

That means the current `RecastPeriod` should remain the analytical kernel, but should sit inside a wider research data model.

## 3. Core Processing Pipeline

### Implemented today

`src/engine/pipeline.ts` already does the right high-level sequence:

1. sort raw periods chronologically,
2. derive recast periods,
3. compute ratios,
4. derive `kw` from structure,
5. compute residual income,
6. compute quality metrics,
7. run anomaly detection,
8. attach spec flags and unusual-item policy.

### Why this matters

This pipeline reflects proper analytical order:

- normalize accounting first,
- then compute ratios,
- then compute valuation-relevant earnings constructs,
- then compute risk and quality overlays.

This is a solid foundation and should be preserved.

### Remaining limitations

- the pipeline is still largely annual-period oriented,
- there is no quarterly or rolling-TTM mode,
- no dedicated normalization stage exists for one-off accounting transitions,
- no revision-aware pipeline exists for updated filings,
- there is no explicit stage for segment decomposition,
- there is no stateful company memory across runs.

## 4. Mapping and Coverage Governance

### Implemented today

The repository already contains:

- `mappingSpec.ts`
- `mappingAudit.ts`
- `mappingPolicy.ts`
- `mappingBacklogPolicy.ts`
- `provenanceAudit.ts`
- `scopePolicy.ts`

This is unusually strong for a finance app.

### Current strengths

- explicit mapping spec rather than ad hoc field picking,
- unresolved lines are tiered by severity,
- out-of-spec labels are triaged,
- unsupported financial companies are blocked,
- mapping backlog is mined from live audited runs.

### Remaining limitations

- mapping remains mostly line-item level, not disclosure-structure level,
- the backlog is still label-centric rather than concept-centric,
- mapping confidence is not yet probabilistic,
- there is no ontology for alternate accounting presentation patterns,
- there is no persistent mapping-learning workflow by sector and provider.

### Next-state requirement

Add a `Financial Concept Ontology` layer:

- canonical concept
- aliases
- provider variants
- statement ownership
- sign convention
- aggregation rules
- quality tier
- valuation relevance
- sector relevance

This should become the bridge between raw provider labels and the analytical schema.

## 5. Valuation and Forecasting Base

### Implemented today

The app already has:

- reformulated RE and ReOI valuation,
- FCFF, FCFE, DDM, AEG outputs in the stack,
- forecast scenario generation in `forecastingEngine.ts`,
- valuation gating in `valuationPolicy.ts`,
- sector-aware DCF command center in `valuationCommandCenter.ts`,
- per-share and market-overlay integration,
- reverse DCF and historical replay,
- signal ladder and opportunity scoring.

### Current strengths

- the app is not pretending one model is enough,
- it already uses accounting-led valuation logic,
- `kw` is derived rather than arbitrarily entered,
- quality and valuation readiness can suppress bad output,
- the valuation tab is now directionally professional.

### Remaining limitations

- forecast drivers remain mostly financial-statement driven and not business-driver driven,
- there is no explicit model for volume, price, mix, cost inflation, or capacity,
- reinvestment and margin fade are still stylized rather than company-memory based,
- historical replay is useful but still too simple for true backtesting,
- reverse DCF needs broader expectation decomposition,
- there is no valuation engine for financial institutions,
- there is no full peer-relative valuation layer.

## 6. Auditability and Operations

### Implemented today

The app already has:

- persisted input files,
- persisted analysis snapshots,
- persisted artifacts,
- monitor cron,
- run inspector UI,
- retention/governance metadata,
- release validation in CI,
- golden-company suite.

### Current strengths

- the app can be inspected after the fact,
- valuation outputs are not ephemeral,
- the monitoring model is compatible with production diagnostics.

### Remaining limitations

- it still lacks a central research database,
- no long-lived company dashboard exists,
- no portfolio-level observability exists,
- no “as-of” valuation history explorer exists,
- no assumption diffing UI exists,
- no analyst approval workflow exists.

## Academic Foundation For The Next Stage

The product should continue to be anchored in serious valuation and accounting research rather than generic investing heuristics.

## 1. Core accounting-led valuation foundation

Primary foundation:

- Ohlson (1995): earnings, book values, and dividends in equity valuation
- Feltham and Ohlson (1995): clean-surplus valuation with explicit operating and financing activities
- Nissim and Penman (2001): ratio analysis and equity valuation from research to practice
- Nissim and Penman (2003): leverage decomposition distinguishing operating and financing leverage
- Penman and Sougiannis (1998): comparison of dividend, cash-flow, and earnings approaches
- Penman (2001): finite-horizon valuation favors explicit accounting model design rather than naive cash-flow equivalence assumptions

Implication for the product:

- keep reformulated accounting central,
- do not degrade into a generic spreadsheet DCF tool,
- treat book value, earnings, and balance-sheet structure as economically informative, not just report decoration.

## 2. Quality, distress, and manipulation overlays

Primary foundation:

- Piotroski (2000): simple financial statement signals separate stronger from weaker value firms
- Altman: distress scoring remains useful as a screening and early-warning overlay, not a single decision rule
- Beneish: earnings manipulation indicators belong in the research stack as warning systems, not final verdicts

Implication for the product:

- quality overlays should affect margin of safety and confidence,
- forensic signals should gate aggressive buy conclusions,
- distress and manipulation metrics should become explicit thesis-breakers.

## 3. Practical cost-of-capital and market-data layer

Primary practical foundation:

- Damodaran’s valuation datasets and cost-of-capital workflow remain the right reference for risk-free rates, ERP framing, and scenario discipline

Implication for the product:

- cost of capital should remain explicit, explainable, and auditable,
- market inputs should be stamped with source and freshness,
- the user must always know which part of the valuation is accounting-derived and which part is market-derived.

## Product North Star

The north-star product is:

`An accounting-first, scenario-explicit, market-aware, historically calibrated investor research system for Indian listed companies.`

It should behave like a hybrid of:

- a forensic accounting workbench,
- a valuation lab,
- a company-history memory system,
- a portfolio watchlist and signal monitor,
- and a governed research notebook.

## Major Workstreams

## Workstream A: Research Data Model And Company Memory

### Goal

Move from “single uploaded run” to “persistent company research system”.

### Features

1. Issuer master record
- legal name
- tickers
- exchange
- sector
- sub-sector
- business model classification
- support status

2. Filing registry
- source provider
- filing date
- period end
- annual / quarterly / TTM
- statement version
- amendment / restatement markers

3. Corporate actions ledger
- stock split
- bonus issue
- rights issue
- buyback
- merger / demerger
- spin-off
- major capital raise

4. Research notebook
- analyst thesis
- key assumptions
- catalysts
- red flags
- disconfirming evidence
- conclusion history

5. Valuation history store
- timestamped valuation snapshots
- market inputs
- scenario outputs
- signal states
- expected returns

### Why this matters

Without company memory, the app is a run-based analyzer. With company memory, it becomes an investor system.

## Workstream B: Statement Intelligence And Accounting Normalization

### Goal

Improve the statement layer from good line mapping to robust economic interpretation.

### Features

1. Concept ontology and provider harmonization
- concept IDs
- aliases by source
- disclosure ownership rules
- sign rules
- scaling rules
- derived fallbacks

2. Statement diagnostics
- detect presentation regime shifts
- detect line migration across statements
- detect scale / unit drift
- detect taxonomy changes between years
- detect restatement-like discontinuities

3. Segment and disclosure parsing
- revenue by segment
- EBIT by segment where available
- geographic sales
- product-line splits
- capacity or utilization disclosures

4. Capital-allocation normalization
- separate maintenance vs expansion capex
- classify acquisitions vs organic capex
- isolate one-time capital injections
- detect hidden dilution and option issuance

5. Working-capital decomposition
- receivables
- inventory
- payables
- contract assets/liabilities
- other operating working capital

### Required schema additions

- `NormalizedConceptValue`
- `StatementDiagnostic`
- `DisclosureSegment`
- `CorporateActionEvent`
- `CapitalAllocationEvent`

## Workstream C: Forecasting Engine 2.0

### Goal

Move from ratio-fade forecasting to business-driver forecasting with explicit model families.

### Features

1. Driver-based forecasts
- volume
- price
- product mix
- gross margin
- employee cost intensity
- SG&A intensity
- working-capital days
- maintenance capex
- growth capex

2. Forecast modes
- accounting fade mode
- business-driver mode
- analyst override mode
- historical regime mode
- cyclical normalization mode

3. Explicit terminal design
- ROIC fade
- margin fade
- growth fade
- reinvestment fade
- terminal competition pressure

4. Quarterly and TTM mode
- annual-only modeling is not enough for live investing decisions
- the engine should support quarterly recast and rolling normalization

5. Scenario grammar
- macro stress
- commodity shock
- demand slowdown
- margin compression
- balance-sheet stress
- dilution event
- recovery case

### Required new engine modules

- `forecastDriverModel.ts`
- `terminalEconomics.ts`
- `cyclicalNormalization.ts`
- `quarterlyPipeline.ts`
- `scenarioGrammar.ts`

## Workstream D: Valuation Lab 2.0

### Goal

Turn the current command center into a rigorous multi-model valuation lab.

### Features

1. Full model stack
- RE
- ReOI
- FCFF
- FCFE
- owner earnings
- AEG
- reverse DCF
- implied market expectations by driver
- peer-relative valuation

2. Reverse-engineered expectations
- implied growth
- implied steady-state margin
- implied reinvestment rate
- implied fade speed
- implied ROIC persistence

3. Better terminal economics
- terminal ROIC must converge realistically
- terminal reinvestment must be internally consistent with growth
- terminal value must be penalized when quality is weak

4. Regime-aware discounting
- cost of equity scenarios
- rate regime overlays
- country/market spread overlays
- quality-adjusted hurdle rates

5. Financial institutions path
- separate valuation framework for banks / NBFCs / insurers
- do not force industrial logic onto unsupported sectors

### Required components

- `ValuationWorkbench`
- `ExpectationBridgePanel`
- `TerminalEconomicsPanel`
- `PeerComparisonPanel`
- `ValuationAssumptionDiff`

## Workstream E: Market Opportunity Engine

### Goal

Make the product decide whether current market pricing constitutes a real opportunity.

### Features

1. Historical cheapness engine
- current price percentile
- price-to-value percentile
- drawdown regime
- earnings / book / EV history context

2. Expected-return engine
- stress expected CAGR
- base expected CAGR
- downside to guarded value
- expected return spread over risk-free

3. Mispricing engine
- accounting-implied value gap
- market-implied expectation gap
- historical dislocation score
- quality-adjusted conviction score

4. Signal ladder
- blocked
- guarded
- watchlist
- interesting
- accumulate
- high conviction
- rare dislocation

5. Thesis-breaker logic
- valuation signal must degrade if:
  - quality deteriorates,
  - dilution appears,
  - debt stress rises,
  - reverse DCF becomes too optimistic,
  - market price exceeds stress value,
  - accounting confidence degrades.

### Required persistence

- every signal change should be stored with:
  - timestamp
  - assumptions
  - price
  - source
  - confidence state
  - reason for upgrade/downgrade

## Workstream F: Portfolio And Watchlist Workflow

### Goal

Move from company analysis to investable decision workflow.

### Features

1. Watchlist
- ranked by opportunity score
- ranked by stress CAGR
- ranked by confidence
- ranked by rare-dislocation probability

2. Position-sizing framework
- research only
- starter
- accumulate
- core
- aggressive / rare dislocation

3. Portfolio context
- sector concentration
- factor exposure
- leverage / cyclicality concentration
- thesis overlap
- valuation crowding

4. Alerting
- stock enters high-conviction zone
- stock leaves high-conviction zone
- quality degrades
- valuation blocked
- market price crosses stress threshold

5. Research journal
- why bought
- why sold
- what changed
- post-mortem versus original thesis

### Required UI

- `WatchlistDashboard`
- `PortfolioAllocator`
- `SignalHistoryTimeline`
- `ResearchJournalPanel`

## Workstream G: Forensic And Quality Research Expansion

### Goal

Make the quality layer strong enough to suppress false confidence in weak accounting cases.

### Features

1. Expand existing forensic stack
- Piotroski as trend signal
- Beneish as manipulation warning
- Altman / Ohlson / Zmijewski as distress lenses
- Sloan accrual reliability
- revenue quality and working-capital integrity

2. Add disclosure-level forensic rules
- receivable growth vs sales growth
- inventory buildup vs demand
- capex intensity vs growth story
- cash tax vs reported tax
- dividend funding quality
- acquisition-heavy EPS optics

3. Add governance and capital-allocation research layer
- dilution history
- buyback quality
- dividend policy consistency
- debt-funded payouts
- insider/promoter pattern overlays where data is available

4. Quality-adjusted valuation rules
- widen margin-of-safety hurdles,
- constrain terminal assumptions,
- reduce conviction,
- or block the aggressive signal entirely.

## Workstream H: Peer, Sector, And Regime Analysis

### Goal

Stop analyzing companies in isolation.

### Features

1. Peer sets
- user-defined peers
- sector templates
- peer median economics
- outlier detection

2. Sector-specific valuation logic
- consumer staples
- paints
- industrials
- commodities
- retail
- services
- financials

3. Market regime overlays
- high-rate regime
- low-rate regime
- commodity inflation regime
- demand-contraction regime

4. Relative valuation
- EV/EBIT
- P/B where relevant
- implied spread to justified multiples
- ROIC vs multiple discipline

## Workstream I: Model Ops, Governance, And Trust

### Goal

Make the product governable like a research system, not just executable like an app.

### Features

1. Full manifesting
- every valuation should have:
  - input data provenance,
  - policy versions,
  - market input versions,
  - scenario set,
  - assumptions,
  - output values,
  - signal state.

2. Reproducibility
- rerun exact historical snapshot
- diff one run vs another
- diff one policy version vs another

3. Approval workflow
- draft
- reviewed
- approved
- archived

4. Release governance
- expand golden-company suite to 10-20 real issuers
- company-by-company expected-output checks
- release block on regression drift

5. Security and data governance
- stronger role separation
- admin vs analyst vs viewer
- sensitive-document retention rules
- deletion and revocation workflow

## Concrete Feature Expansion Plan

## Phase 1: Research System Spine

### Deliverables

- issuer master schema
- filing registry
- company workspace UI
- valuation snapshot history
- assumption manifest persistence
- signal history store

### Outcome

The app stops being just a run inspector and becomes a persistent research workspace.

## Phase 2: Forecast And Valuation Deepening

### Deliverables

- driver-based forecast engine
- richer reverse DCF
- explicit ROIC fade engine
- cyclical normalization mode
- improved maintenance vs growth capex logic
- peer valuation panel

### Outcome

Valuation becomes more realistic and less dependent on one-period heuristics.

## Phase 3: Historical Calibration And Backtesting

### Deliverables

- robust signal replay engine
- backtest database
- outcome analytics by signal state
- calibration dashboard for thresholds
- sector-by-sector threshold tuning

### Outcome

The app begins to know empirically whether its “rare buy” labels deserve trust.

## Phase 4: Portfolio Workflow

### Deliverables

- watchlist dashboard
- alerting engine
- position-sizing panel
- thesis journal
- portfolio concentration analytics

### Outcome

The product becomes useful not only for one-off analysis but for an ongoing investing process.

## Phase 5: Financial Institutions Framework

### Deliverables

- bank / NBFC / insurance ingestion rules
- separate analytical schema where necessary
- different valuation framework
- proper unsupported-to-supported transition

### Outcome

Scope blocking becomes a staged product boundary instead of a permanent dead end.

## Detailed Component Roadmap

## New core engine modules

- `issuerRegistry.ts`
- `filingRegistry.ts`
- `conceptOntology.ts`
- `statementDiagnostics.ts`
- `corporateActions.ts`
- `forecastDriverModel.ts`
- `terminalEconomics.ts`
- `regimeModel.ts`
- `peerValuation.ts`
- `signalBacktest.ts`
- `portfolioRanking.ts`
- `researchNotebook.ts`

## New UI components

- `CompanyWorkspace.tsx`
- `FilingHistoryPanel.tsx`
- `ValuationWorkbench.tsx`
- `ExpectationBridgePanel.tsx`
- `PeerComparisonPanel.tsx`
- `WatchlistDashboard.tsx`
- `PortfolioAllocator.tsx`
- `ResearchJournalPanel.tsx`
- `AssumptionManifestPanel.tsx`
- `SignalHistoryTimeline.tsx`

## New APIs

- `api/companies/*`
- `api/filings/*`
- `api/valuations/*`
- `api/watchlist/*`
- `api/alerts/*`
- `api/research/*`

## Testing And Acceptance Expansion

## Required additions

1. Golden-company depth
- at least 10 real audited companies
- sector spread
- clean cases and ugly cases

2. Analytical acceptance tests
- recast statement expectations
- ratio bands
- valuation readiness expectations
- signal expectations
- backtest sanity expectations

3. Historical calibration tests
- rare-dislocation labels should stay rare
- blocked labels should correlate with broken or uninvestable cases
- guarded labels should show weaker realized outcomes than production-ready cases

4. Reproducibility tests
- same input + same policy versions => same output
- market input changes only should change only market-linked fields

## Principles That Should Govern All Future Work

1. Accounting first, market second.
The accounting base should remain the truth anchor.

2. Confidence must always be explicit.
No persuasive output without confidence labeling.

3. Aggressive buy labels must be rare.
Scarcity of strong signals is a feature, not a bug.

4. Every valuation must be reproducible.
If it cannot be replayed, it cannot be trusted.

5. The model should explain itself.
The user must know what is driving the conclusion.

6. Unsupported cases should be blocked, not prettified.
False precision is worse than no output.

7. Empirical calibration is mandatory.
Thresholds should be defended by replay, not aesthetics.

## Final Recommendation

The next best move is not a random feature burst. It is a staged expansion in this order:

1. company memory and research data model,
2. deeper forecast and valuation engine,
3. historical calibration and signal backtesting,
4. portfolio/watchlist workflow,
5. financial-company framework.

That sequence preserves the current strengths of the codebase:

- rigorous reformulated accounting,
- traceability,
- valuation guardrails,
- release discipline,

while turning it into a truly differentiated investor platform rather than a one-company valuation app.

## Source Anchors

Key academic and practitioner anchors used for this roadmap:

- Ohlson (1995), `Earnings, Book Values, and Dividends in Equity Valuation`, DOI: `10.1111/j.1911-3846.1995.tb00461.x`
- Feltham and Ohlson (1995), `Valuation and Clean Surplus Accounting for Operating and Financial Activities`, DOI: `10.1111/j.1911-3846.1995.tb00462.x`
- Nissim and Penman (2001), `Ratio Analysis and Equity Valuation: From Research to Practice`
- Nissim and Penman (2003), `Financial Statement Analysis of Leverage and How It Informs About Profitability and Price-to-Book Ratios`
- Penman and Sougiannis (1998), `A Comparison of Dividend, Cash Flow, and Earnings Approaches to Equity Valuation`
- Penman (2001), `On Comparing Cash Flow and Accrual Accounting Models for Use in Equity Valuation`
- Piotroski (2000), `Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers`
- Altman on distress scoring and Z-score extensions
- Damodaran valuation datasets and cost-of-capital framework
