# UI Redesign Plan — Penman V2 Analysis

## Design Philosophy

From "data-processing tool" → "investment research workbench"

The current UI is built around the engine's internal structure (statements, ratios, forecast, valuation).
The redesign organizes around the USER's workflow:
  1. Load a company
  2. Understand it at a glance
  3. Dig deeper into what matters
  4. Compare against peers
  5. Make a decision

---

## Phase 1: Navigation Restructure

### Current: 15 flat tabs
```
Upload | Watchlist | Workspace | Runs | Statements | Ratios | Forecast |
Valuation | Bank | Quality | Comparison | Report | Regression | V3 Analytics | Debug
```

### Proposed: 3-level hierarchy

**Primary Nav (left sidebar, always visible):**
```
📊 Dashboard        ← NEW: single-screen company overview
📂 Data Input       ← simplified upload + smart config
📈 Analysis         ← grouped: Statements / Ratios / Quality / Forecast
💰 Valuation        ← grouped: DCF / EPV / Relative / SOTP
👥 Peers            ← Comparison + Peer Relative
📚 Export           ← Report / Excel / Academic
⚙️ Advanced         ← Debug / Regression / V3 Analytics / Runs
```

**Benefit:** 7 primary items instead of 15. Analysis and Valuation expand into sub-tabs on click.

---

## Phase 2: Dashboard (NEW — highest impact)

A single-screen "company health card" shown immediately after data loads.
No tab-clicking needed to understand the company.

### Layout (top to bottom):

```
┌─────────────────────────────────────────────────────────────────┐
│  COMPANY HEADER                                                  │
│  [ITC Ltd]  [Consumer/FMCG]  [₹485.20 ▲2.1%]  [Mkt Cap: ₹6.1T]│
│  Confidence: ●●●○ Production-Ready  |  Moat: Wide  |  Cyclical: No │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  ROCE        │ │  Revenue     │ │  Free Cash   │ │  Intrinsic   │
│  ████████░░  │ │  Growth      │ │  Flow Yield  │ │  Value       │
│  28.4%       │ │  +8.3% CAGR  │ │  4.2%        │ │  ₹520-580    │
│  P72 vs peers│ │  5Y trend ↗  │ │  vs 2.8% avg │ │  MoS: +12%   │
│  [sparkline] │ │  [sparkline] │ │  [sparkline] │ │  [bar range] │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘

┌────────────────────────────────┐ ┌────────────────────────────────┐
│  PENMAN DECOMPOSITION (chart)  │ │  VALUATION TRIANGULATION       │
│                                │ │                                │
│  [Stacked area: PM × ATO over │ │  [Horizontal bar chart]        │
│   10 years, showing RNOA      │ │  V_RE:    ████████░░  ₹545     │
│   decomposition visually]     │ │  V_ReOI:  ███████░░░  ₹520     │
│                                │ │  EPV:     █████░░░░░  ₹410     │
│                                │ │  SOTP:    ████████░░  ₹560     │
│                                │ │  Relative:██████░░░░  ₹490     │
│                                │ │  ──────── Market: ₹485 ──────  │
└────────────────────────────────┘ └────────────────────────────────┘

┌────────────────────────────────┐ ┌────────────────────────────────┐
│  QUALITY SIGNALS (traffic)     │ │  RATIO SANITY (Phase 9)        │
│                                │ │                                │
│  ● Reconciliation: PASS       │ │  PM:   ●  30% [normal band]    │
│  ● Parser Fidelity: 98%       │ │  ROCE: ●  28% [normal band]    │
│  ● Earnings Quality: HIGH     │ │  ATO:  ●  1.2x [normal band]   │
│  ● BS Reconciliation: PASS    │ │  FLEV: ●  0.15x [normal band]  │
│  ○ Segment Data: Available    │ │                                │
│  ○ Market Data: Live (NSE)    │ │  Status: ALL CLEAR ✓           │
└────────────────────────────────┘ └────────────────────────────────┘
```

### Components needed:
- `DashboardView.tsx` — orchestrator
- `CompanyHeaderCard.tsx` — name, type, price, confidence badge
- `KPITile.tsx` — reusable metric card with sparkline + percentile
- `ValuationTriangulationChart.tsx` — horizontal bar showing all anchors
- `PenmanDecompositionChart.tsx` — stacked area (PM × ATO → RNOA)
- `QualitySignalPanel.tsx` — traffic-light indicators
- `RatioSanityMini.tsx` — compact version of the Phase 9 panel

---

## Phase 3: DataEntry Simplification

### Current problems:
- 15+ config fields visible at once
- Cost-of-capital inputs shown before data exists
- No guidance on what to fill vs what's auto-detected

### Proposed: Progressive disclosure with 3 stages

**Stage 1: Upload (minimal)**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Company Name: ________]  [Type: Auto ▼]                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                         │    │
│  │         Drop Capitaline ZIP here                        │    │
│  │         or click to browse                              │    │
│  │                                                         │    │
│  │  ── or ──                                               │    │
│  │                                                         │    │
│  │  [Load from Library ▼]  [Screener.in]  [JSON]  [XBRL]  │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  [▸ Advanced Config]  ← collapsed by default                    │
└─────────────────────────────────────────────────────────────────┘
```

**Stage 2: After upload succeeds — show summary + ask for market data**
```
┌─────────────────────────────────────────────────────────────────┐
│  ✓ Loaded 10 periods (2015-2024)  |  Segments: 4 detected       │
│                                                                  │
│  Market Data (needed for valuation):                             │
│  [Market Price: ₹___]  [Shares (Cr): ___]  [Auto-fetch NSE ▼]  │
│                                                                  │
│  [→ Go to Dashboard]                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Stage 3: Advanced Config (expandable accordion)**
```
▸ Cost of Capital (ke, kd, tax)
▸ Sector Template Override
▸ Market Data Provider
▸ Audit & Governance
```

---

## Phase 4: Valuation Tab — Chart-First

### Current: Text-heavy scenario cards with numbers
### Proposed: Visual-first with drill-down

```
┌─────────────────────────────────────────────────────────────────┐
│  VALUATION SUMMARY                                               │
│                                                                  │
│  ┌─── Value Range ───────────────────────────────────────────┐  │
│  │  [Gauge/thermometer showing price vs intrinsic range]     │  │
│  │  ◄──── ₹410 ════════ ₹485 ══════════ ₹580 ────►         │  │
│  │        EPV floor    Market    DCF ceiling                 │  │
│  │                                                           │  │
│  │  Margin of Safety: +12% to +20%                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── Framework Comparison (radar/bar) ──────────────────────┐  │
│  │                                                           │  │
│  │  [Radar chart: 5 axes = RE, ReOI, EPV, SOTP, Relative]   │  │
│  │  Each axis shows implied value normalized to market price │  │
│  │  Center = 0.5x market, outer ring = 2x market            │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── Scenario Sensitivity ─────────────────────────────────┐   │
│  │  [Heatmap: ke (rows) × g (cols) → intrinsic value]       │  │
│  │  Highlights current assumptions with a marker             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [▸ Detailed Scenario Cards]  ← expandable, current content     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 5: Comparison Tab — Visual Peer Ranking

### Current: Pure table with numbers
### Proposed: Visual ranking + charts

```
┌─────────────────────────────────────────────────────────────────┐
│  PEER COMPARISON (5 companies loaded)                            │
│                                                                  │
│  ┌─── Scatter Plot: ROCE vs P/B ────────────────────────────┐  │
│  │  [Each company is a labeled dot]                          │  │
│  │  [Quadrants: Cheap+Good / Expensive+Good / etc]           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── Percentile Bars ───────────────────────────────────────┐  │
│  │  ROCE:    ITC ████████░░ P72  |  TCS █████████░ P89       │  │
│  │  PM:      ITC ██████░░░░ P60  |  TCS ████████░░ P78       │  │
│  │  Growth:  ITC ████░░░░░░ P40  |  TCS ██████░░░░ P55       │  │
│  │  FLEV:    ITC ██░░░░░░░░ P15  |  TCS █░░░░░░░░░ P8        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── Upside Ranking ────────────────────────────────────────┐  │
│  │  [Horizontal bar: each company's MoS, sorted by upside]  │  │
│  │  1. Tata Steel  ████████████████  +45%                    │  │
│  │  2. ITC         ████████████      +18%                    │  │
│  │  3. TCS         ██████            +8%                     │  │
│  │  4. HDFC Bank   ████              +3%                     │  │
│  │  5. Reliance    ██                -2%                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 6: Ratio Report — Trend Visualization

### Current: Has charts but they're small and secondary to tables
### Proposed: Charts primary, table secondary

```
┌─────────────────────────────────────────────────────────────────┐
│  [DuPont 5-Factor Waterfall]  [Penman Decomposition]  [Trends]  │
│                                                                  │
│  ┌─── DuPont Waterfall (latest year) ────────────────────────┐  │
│  │  Tax Burden × Interest Burden × OPM × AT × Equity Mult   │  │
│  │  [Waterfall chart showing each factor's contribution]     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── 10Y Trend: RNOA Decomposition ────────────────────────┐  │
│  │  [Dual-axis: PM (left, line) + ATO (right, bars)]         │  │
│  │  [Shaded band showing RNOA = PM × ATO]                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── Key Ratios Sparkline Grid ────────────────────────────┐   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │  │
│  │  │ROCE    │ │PM      │ │ATO     │ │FLEV    │            │  │
│  │  │28.4%   │ │30.1%   │ │1.2x    │ │0.15x   │            │  │
│  │  │[~~~~~] │ │[~~~~~] │ │[~~~~~] │ │[~~~~~] │            │  │
│  │  │↗ +2pp  │ │→ flat  │ │↗ +0.1x │ │↘ -0.05 │            │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [▸ Full Ratio Table]  ← expandable                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 7: New Chart Components Needed

| Component | Chart Type | Library | Purpose |
|-----------|-----------|---------|---------|
| `SparklineCell` | Tiny line | Recharts `<LineChart>` 60×20px | Inline trend in KPI tiles |
| `ValuationRangeGauge` | Horizontal gauge | Custom SVG | Price vs intrinsic range |
| `FrameworkRadar` | Radar/spider | Recharts `<RadarChart>` | Multi-framework comparison |
| `SensitivityHeatmap` | Heatmap grid | Custom div grid + color scale | ke × g sensitivity |
| `PeerScatterPlot` | Scatter | Recharts `<ScatterChart>` | ROCE vs P/B peer map |
| `PercentileBar` | Horizontal bar | Custom div | Peer ranking per metric |
| `DuPontWaterfall` | Waterfall | Recharts `<BarChart>` stacked | Factor decomposition |
| `DecompositionArea` | Stacked area | Recharts `<AreaChart>` | PM × ATO over time |
| `UpsideRanking` | Horizontal bar | Recharts `<BarChart>` layout=vertical | Sorted MoS |
| `ConfidenceBadge` | Traffic light | Custom SVG circles | Trust status at a glance |

---

## Phase 8: Implementation Order (effort vs impact)

| Priority | What | Effort | Impact |
|----------|------|--------|--------|
| 1 | Dashboard view (new) | 3 days | ★★★★★ |
| 2 | DataEntry simplification (progressive disclosure) | 1 day | ★★★★ |
| 3 | Navigation restructure (sidebar) | 1 day | ★★★★ |
| 4 | Valuation chart-first (gauge + radar + heatmap) | 2 days | ★★★★ |
| 5 | Comparison visual (scatter + percentile bars) | 2 days | ★★★ |
| 6 | Ratio sparkline grid + waterfall | 1 day | ★★★ |
| 7 | Dark mode polish + responsive | 1 day | ★★ |

Total: ~11 days of focused work.

---

## Technical Decisions

1. **Keep Recharts** — already in use, good enough for all chart types needed
2. **Keep Tailwind v4** — already in use, works well for the card/grid layout
3. **Add `recharts` RadarChart + ScatterChart** — already available in the package
4. **No new dependencies** — everything achievable with Recharts + custom SVG + Tailwind
5. **Preserve all existing engine logic** — this is purely a presentation layer rewrite
6. **Keep existing tabs as "detail views"** — Dashboard links INTO them for drill-down

---

## File Structure (proposed)

```
src/components/
  layout/
    Sidebar.tsx              ← primary nav
    PageShell.tsx            ← layout wrapper (sidebar + content)
  dashboard/
    DashboardView.tsx        ← orchestrator
    CompanyHeaderCard.tsx    ← name, type, price, badges
    KPITile.tsx             ← reusable metric + sparkline
    ValuationTriangulation.tsx ← horizontal bar of all anchors
    QualitySignalPanel.tsx   ← traffic lights
    PenmanDecompositionChart.tsx ← stacked area
  charts/
    SparklineCell.tsx        ← tiny inline chart
    ValuationRangeGauge.tsx  ← price vs range
    FrameworkRadar.tsx       ← multi-framework spider
    SensitivityHeatmap.tsx   ← ke × g grid
    PeerScatterPlot.tsx      ← ROCE vs P/B
    PercentileBar.tsx        ← horizontal peer rank
    DuPontWaterfall.tsx      ← factor decomposition
    UpsideRanking.tsx        ← sorted MoS bars
    ConfidenceBadge.tsx      ← traffic light circles
  input/
    DataEntrySimplified.tsx  ← progressive disclosure version
    AdvancedConfigAccordion.tsx ← collapsed config sections
  (existing files remain, refactored incrementally)
```

---

## Key Principle

> The dashboard should answer "should I buy this stock?" in 10 seconds.
> The detail tabs answer "why?" for those who want to dig deeper.
> The current UI answers "why?" but never "what?" at a glance.
