# Critical Review: UI Revamp Design Spec

**Date:** 2026-05-22
**Reviewer:** Self-audit after full codebase inventory

---

## VERDICT: Spec covers ~40% of actual surface area

The design spec addresses 6 of the 19 tabs and is unaware of several major components
that already exist. It's a good starting framework but has significant blind spots.

---

## 1. WHAT THE SPEC MISSES ENTIRELY

### 1.1 Existing Tabs/Views Not Addressed

| Component | LOC | What it does | Spec says |
|-----------|-----|--------------|-----------|
| AcademicReport.tsx | 1690 | KaTeX equations, PDF export, SHA-256 audit trail, V3 analytics | Nothing |
| V3AnalyticsPanel.tsx | 1469 | Dirty surplus, terminal anchoring, accruals, confidence | Nothing |
| BusinessModelReport.tsx | 205+5 sub-views | Buffett lenses (DuPont 5-step, margin cascade, CCC, cap alloc, compounder test) | Nothing |
| ComparisonReport.tsx | 503 | Multi-company peer comparison, scatter plots, percentile bars | Nothing |
| RegressionReport.tsx | 280 | Baseline guardrail deltas | Nothing |
| FinancialInstitutionReport.tsx | ~800 | Bank/NBFC-specific NIM, GNPA, credit cost, CRAR | Mentioned once |
| WatchlistDashboard.tsx | ? | Portfolio-level screening | Nothing |
| PortfolioAllocator.tsx | ? | Position sizing | Nothing |
| ResearchJournalPanel.tsx | ? | Research notes/annotations | Nothing |
| CalibrationDashboardPanel.tsx | ? | Signal calibration | Nothing |
| SignalHistoryTimeline.tsx | ? | Historical signal accuracy | Nothing |
| ExpectationBridgePanel.tsx | ? | Expectation vs reality bridge | Nothing |
| ValuationWorkbench.tsx | ? | Interactive valuation sandbox | Nothing |
| CompanyWorkspace.tsx | ? | Multi-company workspace | Nothing |
| AtlasReport.tsx + 4 sub-views | ? | Cross-company pattern detection | Nothing |

**Impact:** The spec redesigns 6 screens beautifully but leaves 13+ screens untouched,
creating an inconsistent experience. User hits polished Dashboard → jumps to raw
V3 Analytics → jarring.

### 1.2 Major Features Not Designed

1. **PDF/Print export** — AcademicReport already generates PDFs with html2canvas + jsPDF.
   Spec mentions "print-optimized CSS" in Wave 4 but doesn't design it.

2. **Multi-company workflows** — ComparisonReport, WatchlistDashboard, AtlasReport,
   CompanyWorkspace all deal with multi-company views. No navigation design for switching
   between single-company and portfolio-level analysis.

3. **Research workflow** — ResearchJournalPanel, ValuationAssumptionDiff, RunInspector,
   FilingHistoryPanel — these form a research workflow loop. No design for how they
   connect or what the UX journey is.

4. **Onboarding/Education** — GlossaryModal and OnboardingCard exist but the spec doesn't
   address how a first-time user learns the Penman-Nissim framework while using the tool.

---

## 2. DESIGN GAPS (Things the spec addresses poorly)

### 2.1 No Information Architecture (IA) for 19 tabs

The spec proposes a navigation redesign (§2.6) but only wireframes it as ASCII art.
Missing:
- **Tab hierarchy definition** — which tabs are primary (always visible) vs secondary
  (advanced/expert)?
- **User journey flows** — what's the typical analysis workflow?
  Load company → Dashboard → drill into Ratios → check Quality → arrive at Valuation?
  Or: Load → Business Model → Forecast → Valuation?
- **Contextual navigation** — clicking ROCE in Dashboard should deep-link to Ratios
  with the ROCE node pre-selected in the DuPont tree.

### 2.2 No State Communication Between Tabs

The spec treats each tab as independent. But professional tools need:
- **Cross-tab references** — "This ROCE (see Ratios tab) feeds the RI model (Forecast tab)"
- **Dirty state indicators** — "Assumptions changed in Forecast — Valuation outdated"
- **Progress breadcrumbs** — "You've reviewed 4/7 analysis sections. Next: Valuation"

### 2.3 No Comparative Context

Every metric is shown in isolation. Missing:
- **Historical rank** — "This ROCE is ITC's 3rd-highest in 10 years"
- **Peer rank** — "This PM puts ITC in the 92nd percentile of Indian FMCG"
- **Regime context** — "During 2020 COVID, margins compressed 400bp but recovered in 18 months"
- **Industry cycle position** — "Steel margins are currently peak-cycle; mean-revert expected"

### 2.4 No "So What?" Layer

The spec adds narratives, but they're descriptive ("ROCE is 47%"). Professional
analysis needs prescriptive insight:
- "ROCE is 47%, which implies the market should price this at 5-6× book. Currently
   trading at 7.2× book — is the premium justified?"
- "Revenue grew 12% but ROIC declined — growth is destroying value unless margins recover."
- "Share of wallet for cigarettes declining 3% p.a. — at current rate, FMCG overtakes
   in 2028. Rerating catalyst."

### 2.5 No Risk/Bear Case Prominence

The spec is bullish-biased in its wireframes. Professional tools need:
- **Red team section** — "What could go wrong?" prominently displayed
- **Key man/concentration risk** — single customer, single product dependency
- **Regulatory risk calendar** — GST changes, SEBI regulations, RBI norms
- **Downside scenario prominence** — show stress case FIRST (the spec already does
  this in Valuation Command Center, but not in Dashboard or Forecast)

---

## 3. WHAT NEEDS ENHANCEMENT

### 3.1 Narrative Engine — Too Simple

Current narrativeEngine.ts generates 3-4 sentences per tab. For professional grade:

**Missing narrative types:**
- **Anomaly callouts** — "ALERT: Working capital days jumped from 45 to 82. Investigate."
- **Trend inflection** — "Margin expansion reversed this year after 5 years of improvement."
- **Cross-metric contradictions** — "Revenue growing but FCF declining — accrual quality concern."
- **Assumption sensitivity** — "If margins revert to 5Y average, intrinsic value drops 22%."
- **Temporal context** — "Pre-COVID average ROCE was 52%; current 47% represents 90% recovery."

**Missing narratives for:**
- Bank/NBFC companies (NIM, credit cost, PCR, CRAR language)
- Loss-making companies (path to profitability, cash runway)
- Cyclical companies (normalized earnings vs reported)
- Conglomerates (segment-level divergence)

### 3.2 Design System — Missing Components

The shared library has 8 components. For full coverage, needs:

| Component | Purpose |
|-----------|---------|
| `<Sparkline>` | Inline 7-point trend (fits in table cells, KPI cards) |
| `<HeatmapCell>` | Color-scaled table cell (green→red by magnitude) |
| `<AnnotatedTimeline>` | Timeline with event markers (results, dividends, splits) |
| `<AssumptionChip>` | Editable inline assumption (ke=12%, g=6%) with sensitivity |
| `<CrossReference>` | Clickable link to another tab/section ("See Ratios → ROCE") |
| `<ComparisonStack>` | Side-by-side metric comparison (this year vs last, vs peer) |
| `<RiskFlag>` | Red/amber alert chip with severity and category |
| `<DataFreshness>` | Shows data age ("Last updated: Mar 2024, 2 months stale") |
| `<FormulaTooltip>` | Hover to see formula + inputs (KaTeX-rendered) |
| `<ScenarioToggle>` | Switch between base/stress/bull inline |
| `<SourceBadge>` | "Capitaline", "Manual", "Estimated" provenance tag |
| `<ProgressRing>` | Analysis completeness indicator |

### 3.3 Typography — No Data Table Design System

The spec defines typography scale but doesn't address the #1 visual element: DATA TABLES.

Needs:
- **Column alignment rules** — numbers always right-aligned, labels left
- **Row grouping** — subtotals highlighted, sub-items indented with lighter weight
- **Frozen columns** — label column sticky on horizontal scroll
- **Column-level sparklines** — inline mini-charts in the rightmost column
- **Period highlighting** — latest period column gets accent background
- **Conditional formatting vocabulary** — not just YoY, but vs benchmark, vs 5Y avg

---

## 4. NEW TABS/FEATURES TO ADD

### 4.1 "Investment Thesis" Tab (NEW)

**Rationale:** No current tab synthesizes everything into a single investment memo.

**Content:**
- One-page summary: what the company does, why it's interesting, what could go wrong
- Key metrics table (5 numbers that matter)
- Bull/Bear/Base thesis statements
- Position sizing suggestion (Kelly criterion or fixed-fraction)
- Time horizon and catalyst calendar
- Print-ready format (A4 PDF)

### 4.2 "Assumptions Audit" Tab (NEW)

**Rationale:** ValuationWorkbench and AssumptionManifestPanel exist but no centralized
view of ALL assumptions driving the valuation.

**Content:**
- List every assumption (ke, g, fade rate, terminal RNOA, tax rate, etc.)
- Show which are user-set vs auto-derived
- Sensitivity ranking: "which assumption moves intrinsic value the most?"
- Historical calibration: "your assumed PM of 33% vs trailing 10Y range of 28-36%"
- One-click "reset to conservative" and "reset to median"

### 4.3 "What Changed" Tab (NEW)

**Rationale:** When you reload data (new quarter), no quick diff of what moved.

**Content:**
- Side-by-side: last analysis vs current
- Delta waterfall: "Intrinsic value moved from ₹598 to ₹612 because: +₹20 (better margins), -₹6 (higher ke)"
- Assumption drift detection: "Your ke was 11% last time; now 12%. Why?"
- Quality gate changes: "Previously Tier 1; now Tier 2 because [reason]"

### 4.4 "Screener" Mode (Enhancement to existing)

**Rationale:** WatchlistDashboard exists but there's no quick multi-company screening
with filters.

**Content:**
- Table of all loaded companies with sortable columns (ROCE, PE, MoS, Moat, Quality)
- Filter chips: "ROCE > 20%", "MoS > 25%", "Quality = Tier 1"
- Color-coded cells (heatmap style)
- Click any row → opens that company's full analysis
- Export: filtered list as CSV

### 4.5 "Scenario Comparison" Mode (Enhancement)

**Rationale:** Forecast tab shows 3 scenarios but doesn't let you compare their downstream
effects side-by-side.

**Content:**
- 3-column layout: Stress | Base | Bull
- For each: P&L trajectory → Terminal value → Intrinsic per share
- Probability-weighted expected value
- "Which scenario are we in?" reality-check against latest quarter actuals

---

## 5. ACADEMIC RIGOR ENHANCEMENTS

### 5.1 Formula Transparency

Every computed metric should have a hover/click that shows:
- The formula (KaTeX rendered): `ROCE = \frac{CNI}{avg(CSE)}`
- The actual inputs for this period: `= 15,432 / avg(32,100, 34,500) = 46.3%`
- The textbook reference: "Penman (2013), Chapter 5, Eq. 5.4"
- Link to the engine source line

### 5.2 Assumption Documentation

The AcademicReport already does this for PDF export. But in-app:
- Every adjustable parameter shows its source ("Nifty 50 risk premium, Damodaran 2024")
- Deviations from textbook defaults are flagged
- A "methodology notes" section per tab explaining the academic framework

### 5.3 Audit Trail Visibility

The audit system (persistAuditEvent, SHA-256) exists in the engine but is invisible
to users. Should surface:
- "This analysis was generated at [timestamp] from [file] with hash [SHA]"
- "You can reproduce this by uploading the same ZIP with the same config"
- Version pinning: "Engine version 3.2.1, mapping spec v47"

### 5.4 Textbook Mode Toggle

A toggle that adds academic annotations:
- Show equation numbers (Eq. 5, Eq. 12) next to computed outputs
- Show the Penman-Nissim chapter reference for each section
- Expand all derivation steps (normally hidden)
- Useful for students, auditors, or anyone verifying the math

---

## 6. PROFESSIONAL POLISH MISSING

### 6.1 Loading States

No design for:
- Skeleton screens while data processes
- Progress indicators during ZIP parsing (5-30 seconds)
- Graceful degradation when some data is missing

### 6.2 Error Communication

Current: `setError("Some error message")` → red box.
Needs:
- Error categorization (data error vs config error vs engine error)
- Suggested fixes ("This usually means the ZIP is missing the Balance Sheet file")
- Recovery paths ("Try re-downloading from Capitaline with format X")

### 6.3 Empty States

Each tab needs a designed empty state that:
- Explains what this tab shows
- Says what's needed to populate it
- Shows a preview/example of what it looks like with data

### 6.4 Responsive Design

The spec mentions "mobile-first adjustments" but this tool is inherently desktop.
Needs:
- Minimum supported width: 1024px
- Tablet mode (1024-1280): collapse sidebar, horizontal tabs
- Mobile (< 768): read-only summary mode, no editing capability
- Large screen (> 1440): 2-panel layout (nav + content + optional inspector)

### 6.5 Accessibility

Missing from spec:
- ARIA labels for all expandable sections
- Screen reader announcements for verdict changes
- Color-blind safe palette (don't rely on red/green alone — use shapes)
- Keyboard navigation for all interactive elements
- Focus management on tab switch

---

## 7. IMPLEMENTATION PRIORITY (REVISED)

### Priority 1 — Consistency Pass (2 days)
Apply SectionHeader + InsightBlock + card-base to ALL 19 tabs uniformly.
This alone makes the tool feel 3× more polished.

### Priority 2 — Interactive DuPont Tree (2 days)
Single highest-impact feature for "understanding the business model" users.
Click ROCE → see PM, ATO, FLEV decomposition with trends.
Already have DuPontDecomposition.tsx — enhance with click-to-drill.

### Priority 3 — Assumption Transparency (1 day)
FormulaTooltip component + wire it to the top 20 metrics.
Hover ROCE → see formula + inputs + textbook reference.

### Priority 4 — What Changed / Delta View (2 days)
Most requested by actual analysts. "What moved since last quarter?"
Waterfall chart showing value bridge.

### Priority 5 — DataEntry Progressive Disclosure (1 day)
Search-first, config collapsed, upload secondary.
Biggest first-impression improvement.

### Priority 6 — Print/PDF Overhaul (2 days)
Make AcademicReport output look like a Goldman Sachs initiation report.
Already has the engine — needs design polish.

### Priority 7 — Screener Table (2 days)
Multi-company sortable/filterable table with heatmap cells.
Leverages existing ComparisonReport infrastructure.

---

## 8. OPEN QUESTIONS FOR USER

1. Should all 19 tabs be visible, or should some be gated behind "Advanced" toggle?
2. Should narratives be formal ("The company demonstrates") or conversational ("ITC earns")?
3. Is the primary user a professional analyst, a student, or both? (Affects density)
4. Should we prioritize PDF export quality or in-app experience?
5. Is there a reference product you consider "10/10"? (Bloomberg, Koyfin, Simply Wall St, Finbox, etc.)
