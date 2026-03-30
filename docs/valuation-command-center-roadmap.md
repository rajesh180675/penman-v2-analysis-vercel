# Valuation Command Center Roadmap

## Purpose

This document extends the production work already completed in the Penman analysis app and defines the next major product step:

- turn the current valuation tab into a rigorous valuation command center,
- add a DCF engine that operates alongside the existing residual-income and ReOI stack,
- update valuation dynamically using current market data and current financing assumptions,
- show a disciplined stressed/base-case view,
- and only surface a top conviction buy signal when the setup is historically extreme and economically well-supported.

This is not a plan for a flashy valuation widget. It is a plan for a decision-grade research tool that is conservative by default and only becomes aggressive when the evidence is overwhelming.

## Evidence Base Used

This roadmap is based on the actual system state already built in the repository and audited production runs.

### Live audited runs used

- ITC
  - run ID: `243da112-8772-4c74-adda-b132017600c8`
  - source: Capitaline ZIP
  - latest period: `2025-03-31`
  - key finding: latest-period contamination existed; valuation needed guarding

- ASIAN PAINTS
  - run ID: `a3d075cb-d43a-4d08-aa2e-9299ba5c096a`
  - source: Capitaline ZIP
  - latest period: `2025-03-31`
  - key finding: much cleaner terminal setup; still too much backlog review density for an unqualified confidence label

### Current product capabilities already in place

- audited input, snapshot, and artifact persistence
- per-run traceability and run inspector
- scope gating for unsupported financial companies
- share-count extraction from audited Capitaline data
- per-share reporting in valuation and forecast views
- unusual-item policy and valuation readiness guardrails
- golden-company suite with real audited fixtures
- mapping backlog triage and coverage tiering
- release validation gates in CI

### Current valuation architecture already in code

The app currently supports:

- residual earnings valuation,
- reformulated operating income valuation,
- FCFF and FCFE outputs inside the valuation stack,
- AEG support,
- forecast scenarios with bull/base/bear,
- Monte Carlo distribution support,
- per-share triangulation.

This is a strong base. The next step is not replacing it. The next step is integrating DCF as a first-class valuation regime and making the valuation surface more selective, more current, and more decision-aware.

## Current Strengths And Current Gaps

### What is strong now

- audited accounting ingestion is real, not mock-driven
- the operating vs financing reformulation architecture is directionally correct
- the app now handles guarded vs blocked valuation better than before
- share-basis resolution is materially improved
- production runs can be inspected and traced

### What is still missing

- DCF is not yet a primary command-center view with explicit stressed/base-case discipline
- current market data is not refreshed automatically into the valuation surface
- valuation confidence is still more model-centric than market-opportunity-centric
- there is no explicit framework for a rare, historically extreme buy setup
- the UI does not yet make it obvious when valuation is merely interesting versus when it is exceptional

## Product Goal

Build a valuation tab that answers five questions clearly:

1. What is the company worth under conservative, base, and extreme stress assumptions?
2. What is the market currently implying?
3. How unusual is the current setup relative to the company’s own history?
4. Is the opportunity large enough, robust enough, and clean enough to qualify as a high-conviction buy?
5. What exact assumptions would invalidate the thesis?

The output should not merely produce numbers. It should produce a disciplined conclusion state.

## Target End State

The valuation tab becomes a command center with six pillars:

1. `Accounting Base`
   Uses the existing recast statements, unusual-item normalization, share-basis logic, and valuation-readiness policy.

2. `DCF Core`
   Adds a first-class FCFF DCF and owner-earnings DCF module, anchored on reformulated operating performance rather than raw reported earnings.

3. `Current Market Layer`
   Automatically pulls market price and current financing inputs, stamps them with source and timestamp, and re-runs valuation on the fly.

4. `Historical Opportunity Layer`
   Compares current implied valuation and current margin of safety to the company’s own historical range and regime history.

5. `Signal Engine`
   Produces states such as:
   - `blocked`
   - `guarded`
   - `watchlist`
   - `interesting`
   - `high conviction`
   - `screaming buy`

6. `Research Explainability`
   Shows the exact assumptions, bridge drivers, risk flags, and kill-switch conditions behind the signal.

## Core Valuation Design

## 1. Multi-Model Stack

Do not trust one model. Use a structured stack.

### Model family

- Residual Earnings
- ReOI
- FCFF DCF
- FCFE DCF
- Owner Earnings / Maintenance-Capex DCF
- AEG
- Reverse DCF

### Role of each model

- Residual earnings and ReOI remain the accounting-quality anchor
- FCFF DCF becomes the primary enterprise-value cross-check
- FCFE and owner-earnings DCF become equity-holder reality checks
- Reverse DCF shows what the market is assuming right now
- AEG remains a useful earnings-growth interpretation check

### Production rule

No single model should be allowed to dominate the conclusion by itself. The command center should show convergence or divergence explicitly.

## 2. DCF Should Use Recast Economics, Not Raw Reported Noise

The new DCF engine should not be a simplistic `EBIT × multiple` style wrapper.

It should derive cash-flow drivers from the reformulated model:

- revenue growth
- operating margin quality
- operating tax
- reinvestment intensity
- asset turnover
- incremental return on new capital
- working-capital drag
- maintenance vs growth capex
- financing drag

### Preferred cash-flow definitions

Primary:

- FCFF from reformulated operating income and reinvestment

Secondary:

- owner earnings with maintenance capex separation

Optional:

- FCFE only when leverage and debt policy are stable enough to make it decision-useful

### Why this matters

This keeps DCF aligned with the same accounting truth the rest of the engine uses, instead of introducing a disconnected spreadsheet model.

## 3. Stress Architecture

The valuation tab should make the stressed case impossible to ignore.

### Required scenarios

- `Base`
  - normalized but still conservative business assumptions

- `Bear`
  - weaker growth, margin fade, and less favorable capital turns

- `Stress`
  - explicit recessionary / disruption assumptions
  - weaker revenue, lower margin, slower recovery, higher reinvestment drag
  - tighter cost of capital

- `Historical Panic`
  - uses valuation regimes and operating assumptions anchored to the company’s worst credible historical window

### Production display rule

The tab should lead with:

- stressed intrinsic value per share
- base intrinsic value per share
- current market price
- margin of safety under both stressed and base views

The user should never have to hunt for the stressed case.

## 4. “Screaming Buy” Must Be Intentionally Rare

The system should never label a company a screaming buy just because one optimistic model says so.

### Proposed qualification framework

The label should require all of the following:

- scope is supported
- valuation status is not blocked
- confidence status is at least guarded, preferably production-ready
- no critical terminal contamination
- no severe unresolved mapping issue in valuation-critical lines
- stressed intrinsic value is materially above current market price
- base intrinsic value is far above current market price
- reverse DCF implied market assumptions are unusually pessimistic
- current valuation percentile versus the company’s own history is near extreme lows
- balance sheet and liquidity do not signal existential fragility
- recent capital allocation does not invalidate shareholder capture

### Suggested signal ladder

- `watchlist`
  - some upside, but not enough robustness

- `interesting`
  - clear upside in base case, limited support in stress case

- `high conviction`
  - strong base case and acceptable stress-case downside protection

- `screaming buy`
  - a historically rare setup with deep upside even under stressed assumptions, plus strong quality and solvency

### Suggested quantitative guardrails

These should be tuned empirically, not hard-coded from day one, but a good initial design is:

- `interesting`
  - base-case upside > `25%`
  - stressed-case upside > `5%`

- `high conviction`
  - base-case upside > `40%`
  - stressed-case upside > `20%`
  - quality/confidence not below guarded

- `screaming buy`
  - base-case upside > `60%`
  - stressed-case upside > `35%`
  - current valuation in bottom decile of company history
  - reverse DCF implies pessimism near historical extremes
  - no major solvency or governance kill-switch

These labels should be framed as internal research states, not retail-style hype badges.

## Dynamic Current-Data Layer

## 1. What should update automatically

The valuation engine should refresh the current market layer independently of the audited accounting base.

### Required dynamic inputs

- current share price
- current market capitalization
- current enterprise value inputs
- current treasury / government bond rate for discounting baseline
- latest beta or a stable internal beta proxy
- current cash, debt, and shares if a fresher source is available than the last annual filing
- dividend yield / payout signal
- latest quarterly or trailing-twelve-month bridge if supported cleanly

### Optional dynamic inputs

- analyst estimate ranges
- peer multiples
- commodity / FX overlays for sensitive sectors
- event calendar and earnings date

## 2. Source discipline

Do not mix “latest” data with no provenance.

Every live input must carry:

- source name
- timestamp
- as-of date
- freshness status
- fallback behavior if unavailable

### Production rule

If live data is stale or missing, the UI should not silently pretend it is current. It should show:

- `live`
- `stale`
- or `fallback`

## 3. Data architecture

Build a valuation market-data service with three layers:

### Layer A: audited accounting base

- annual / interim fundamentals from uploaded financials
- normalized and traceable
- lower-frequency, high-trust

### Layer B: live market layer

- price
- market cap
- debt and cash refresh when available
- discount-rate refresh
- medium-frequency, current-state layer

### Layer C: internal historical valuation store

- daily or weekly snapshots of:
  - market price
  - implied growth
  - DCF range
  - margin of safety
  - confidence state
  - signal state

This historical store is necessary for the “how extreme is today?” question.

## Historical Opportunity Framework

The app should learn not just what the company is worth, but how unusual today is.

### Historical comparisons to compute

- current price vs historical DCF-based valuation gap
- current price vs historical RE / ReOI gap
- current EV / normalized operating profit percentile
- current price-to-book percentile
- current implied growth percentile
- current margin-of-safety percentile
- current signal state relative to prior crisis windows

### Output behavior

The valuation tab should show whether today is:

- ordinary
- below fair value
- deeply undervalued
- historically dislocated

This is where the “truck-load buy” idea becomes disciplined instead of emotional.

## Valuation Tab Redesign

## 1. Summary strip at the top

Show:

- current price
- stressed intrinsic value per share
- base intrinsic value per share
- upside/downside under stress and base
- signal state
- confidence state
- as-of timestamp for live data

## 2. Valuation fan chart

Visualize a range, not a single number.

Recommended layers:

- panic / stress floor
- bear range
- base range
- bull range
- current price line
- historical percentile band markers

## 3. Market-implied panel

Show:

- reverse DCF implied growth
- implied margin persistence
- implied returns fade
- what must go wrong for the current price to be fair

## 4. Historical dislocation panel

Show:

- current margin-of-safety percentile
- prior dislocation dates
- best historical buying windows
- how current setup ranks versus those windows

## 5. Kill-switch panel

Show what would cancel a buy thesis:

- abnormal leverage
- unresolved mapping debt
- contaminated terminal period
- cash-flow deterioration
- capital-allocation red flags
- unsupported company type

## 6. Research notebook panel

Show:

- exact assumptions behind stressed and base cases
- bridge-driver fade assumptions
- discount-rate assumptions
- sensitivity hotspots

This is where a serious analyst should be able to challenge the model.

## Business Logic Enhancements Required

## 1. DCF engine additions

Add a dedicated DCF module that supports:

- FCFF DCF from recast operating economics
- owner-earnings DCF with maintenance-capex logic
- explicit reinvestment and fade modeling
- terminal value under:
  - zero growth
  - stable growth
  - fade-to-normal-return regimes

### Key implementation rule

Terminal value must be denied or degraded when valuation-readiness rules already detect terminal contamination.

## 2. Maintenance vs growth capex

For industrial companies, maintenance capex estimation should use:

- depreciation
- asset age / gross PPE signals when available
- recent replacement capex patterns
- asset-turnover and sales-growth consistency

This will improve owner earnings materially.

## 3. Better reinvestment logic

Reinvestment should not be a blind percentage of sales.

It should incorporate:

- incremental sales-to-NOA relationship
- working-capital intensity
- capex intensity
- historical ATO behavior
- scenario-specific capital drag

## 4. Better unusual-item normalization

DCF should inherit the unusual-item policy:

- exceptional items normalized out
- discontinued operations excluded
- financing unusuals separated
- capital-transaction years blocked from naive terminal assumptions

## 5. Trailing and interim bridge

When current quarterly data is available and cleanly sourced, create a TTM bridge layer:

- last audited annual remains the anchor
- TTM updates the live valuation overlay
- confidence is reduced if TTM mapping is incomplete

This makes the valuation more current without pretending quarterly input is as clean as annual audited statements.

## Signal Engine Design

The valuation tab should produce a structured signal object.

### Proposed fields

- `signalState`
- `confidenceState`
- `stressUpsidePct`
- `baseUpsidePct`
- `historicalPercentile`
- `reverseDcfImpliedGrowth`
- `killSwitches`
- `supportingFlags`
- `asOf`
- `liveDataFreshness`

### Proposed kill-switches

- unsupported scope
- valuation blocked
- terminal contamination
- unresolved Tier 1 mapping gap
- severe solvency deterioration
- negative owner earnings in normalized state
- live market data unavailable or stale beyond threshold

### Proposed supporting flags

- bottom-decile valuation percentile
- stress case still materially undervalued
- strong historical return on capital
- stable cash conversion
- low dilution risk

## Visual Design Direction

This tab should feel like a serious research cockpit, not a generic dashboard.

### Recommended visual elements

- top conviction banner with muted but strong color semantics
- fan chart for valuation range
- valuation regime ladder
- historical percentile sparkline
- stress/base cards with direct comparison to market
- scenario tree for bull/base/bear/stress/panic
- kill-switch checklist

### Design rule

Do not use bright celebratory UI for buy states. A screaming buy should look rare and sober, not promotional.

## Data Storage And Observability Additions

To support dynamic valuation, persist:

- live market snapshots
- valuation refresh events
- scenario sets used at each refresh
- signal transitions over time
- historical percentile calculations

This should allow the run inspector and audit endpoints to answer:

- what price did the model use?
- when was it fetched?
- what signal did the app generate at that price?
- what changed since the prior refresh?

## Testing And Release Discipline

This feature needs stronger validation than ordinary UI work.

## 1. Golden-company valuation expectations

For each real audited company fixture, create expected ranges for:

- stressed intrinsic value
- base intrinsic value
- signal state ceiling
- reverse DCF sanity
- historical percentile logic

### Important rule

The suite should prove not only that undervaluation can be detected, but that the app does not over-label companies as screaming buys.

## 2. Historical backtest harness

Add a backtest harness that replays prior dates for the same company and checks:

- whether the signal would have triggered,
- whether it aligned with real historical dislocation periods,
- whether the signal remains rare.

This is essential before trusting a “truck-load buy” label.

## 3. Staleness and source failure tests

Add tests for:

- missing live price
- stale rate data
- inconsistent share count
- debt/cash source mismatch
- interim update missing critical lines

The signal should degrade gracefully, not fail silently.

## 4. Human review gates

Before any release that changes valuation logic:

- run golden-company suite
- run historical signal backtests
- inspect at least one clean industrial and one contaminated-period company manually
- confirm no new company is labeled `screaming buy` without explicit review

## Implementation Roadmap

## Phase 1: DCF foundation

Deliverables:

- dedicated DCF engine module
- FCFF and owner-earnings valuation outputs
- stressed/base display in valuation tab
- terminal-value guardrails wired into DCF

Success criteria:

- DCF outputs reconcile directionally with existing RE / ReOI models
- values are per-share first
- guarded/blocked states apply consistently

## Phase 2: dynamic market layer

Deliverables:

- market-data fetch service
- live price and rate overlay
- source freshness UI
- reverse DCF tied to live market data

Success criteria:

- valuation updates on refresh without mutating audited accounting history
- stale or missing live data is visible and safe

## Phase 3: historical dislocation engine

Deliverables:

- valuation history store
- percentile and dislocation calculations
- historical opportunity panel

Success criteria:

- the app can tell whether today is ordinary or rare
- prior crisis windows can be visualized against the current setup

## Phase 4: signal engine

Deliverables:

- structured signal states
- screaming-buy gate
- kill-switch logic
- signal transition logging

Success criteria:

- signals are rare, explainable, and reviewable
- false-positive excitement is minimized

## Phase 5: backtest and release hardening

Deliverables:

- historical replay harness
- expected-signal regression tests
- release gate for valuation signal changes

Success criteria:

- the label system survives historical replay
- no release can loosen the signal discipline silently

## Non-Negotiable Product Rules

These rules should not be compromised.

1. No valuation without visible confidence and freshness.
2. No screaming-buy label on contaminated or unsupported cases.
3. No live market input without timestamped provenance.
4. No single-model buy conclusion.
5. No optimistic default scenario as the lead message.
6. The stressed case must always be visible.
7. Historical extremity must be demonstrated, not guessed.
8. The app must make it easy to reject a thesis, not just support it.

## Recommended Next Build Order

The highest-value implementation order is:

1. build dedicated DCF engine and stressed/base UI
2. add live market-data overlay with freshness controls
3. add reverse DCF and historical percentile framework
4. add structured signal engine with kill-switches
5. add historical backtest harness for signal validation

## Bottom Line

The app already has the accounting reformulation and audit foundation needed for a serious research product.

The next leap is not more cosmetic reporting. It is a valuation discipline layer that:

- uses recast economics,
- updates against live market reality,
- reasons in stressed and base cases,
- compares current opportunity to the company’s own history,
- and only declares a top-tier buy when the case is genuinely rare and robust.

That is the right path if the goal is not just to analyze companies, but to recognize exceptional opportunities with real caution and real traceability.
