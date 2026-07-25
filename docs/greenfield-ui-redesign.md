# Greenfield UI Redesign — Penman V2 Analysis

Date: 2026-07-18
Author: UI/UX audit of current codebase (208 components, ~43k LOC in src/)
Status: Design proposal — no code changed

---

## 1. Current-State Diagnosis

### 1.1 What exists today

The app is a single-page React 19 + Tailwind 4 dashboard with:

- **20 tabs** organized in 6 groups (input / analysis / valuation / peers / export / advanced), all rendered in one sticky top nav bar (`AppHeader.tsx`)
- **AppShell.tsx** (513 lines) — one giant orchestrator holding ~30 pieces of state, passing 40+ props down to `TabRouter`
- **TabRouter.tsx** — a 346-line switch that mounts one full-page report component per tab
- Each tab is a monolithic "report" component (300–700 lines): `ValuationReport`, `QualityReport`, `RatioReport`, `ComparisonReport`, `ForecastReport`, `AcademicReport`, `FinancialInstitutionReport`, `DataEntry`, `DebugPanel`
- A shared `DesignSystem.tsx` with ~15 primitives (MetricCard, VerdictBanner, badges, sparklines, etc.)
- Global CSS in `index.css` (161 lines) with `.card-base`, `.trust-gate-*`, chart/table overrides
- Dark mode via `.dark` class on `<html>`, toggled in `useConfigManager`

### 1.2 Concrete pain points (observed in code)

**A. Navigation overload.** 20 tabs in a single horizontal bar. Group labels are 9px uppercase text that only shows on `lg:` screens. On smaller screens it's an icon-only scroll strip. Users can't tell where they are in the analysis workflow. There is no hierarchy — "Debug" sits next to "Valuation".

**B. Wall-of-cards dashboards.** `DashboardView.tsx` stacks: verdict banner → risk flags → 4 KPI tiles → narrative → period delta → 2 charts → gauge → 2 more chart rows → moat panel → cap-alloc panel → thesis card → segment breakdown → advanced panels (teal) → next steps. ~15+ full-width sections, all competing for attention. No visual hierarchy beyond vertical order.

**C. Inconsistent styling.** Some panels use `.card-base`, some hand-roll `rounded-xl border bg-white dark:bg-slate-900`, some use teal (`bg-teal-50/60`), some use slate. `ValuationReport.tsx` has exactly 1 `dark:` class; `QualityReport.tsx` has 14. Light/dark contrast bugs are a recurring theme (skill notes: "authored dark-mode-first with hardcoded dark colors").

**D. No layout grid.** Everything is `space-y-6` vertical stacking with occasional `grid-cols-2 lg:grid-cols-4`. No sidebar, no master-detail, no persistent context. The 1400px max-width container means wide screens show one long scroll column.

**E. State complexity leaks into UI.** `AppShell` passes 40+ props into `TabRouter`; each report component receives 10–20 props. There's no UI-level state model (e.g., "which panel is expanded", "what's pinned") — everything re-derives from engine outputs.

**F. Trust signals are scattered.** `AnalysisStatusBadge` appears in the header, again above the tab content, and trust-gate banners appear inside individual panels. The rigor ladder (the product's core differentiator) has no dedicated visual home.

**G. Emoji icons.** Tab icons, badges, and section headers use emoji (📊💰📐🔍…), which renders inconsistently across platforms and undermines the "institutional" positioning.

**H. No onboarding/empty-state design system.** Empty states are hand-rolled per tab (`card-base p-12 text-center` with an emoji).

---

## 2. Greenfield Design — "Penman Workbench"

### 2.1 Design goals

1. **Institutional credibility** — looks like a Bloomberg/FactSet-lite research terminal, not a student project. Restrained color, real iconography, consistent type scale.
2. **Workflow-shaped navigation** — the UI mirrors the analysis process: Load → Understand → Analyze → Value → Decide → Export. Users always know where they are.
3. **Progressive disclosure** — verdict-first, evidence-on-demand. Tier 1 visible immediately; tiers 2–3 behind expandable rails.
4. **One design language** — a small, enforced token set. Every panel uses the same card, spacing, and color semantics. Dark mode is a first-class citizen, not an afterthought.
5. **Trust as a first-class surface** — the rigor ladder gets a persistent, glanceable home.

### 2.2 Information architecture

Replace 20 flat tabs with **5 workflow stages** in a left sidebar, each containing focused views:

```
┌─────────────────────────────────────────────────────────┐
│ TOP BAR: logo · company switcher · trust pill · ⌘K · ⚙ │
├──────────┬──────────────────────────────────────────────┤
│ SIDEBAR  │  MAIN CANVAS                                 │
│          │                                              │
│ ▸ Setup  │  (contextual per selected view)              │
│   Load   │                                              │
│   Library│                                              │
│          │                                              │
│ ▸ Analyze│                                              │
│   Dash   │                                              │
│   Stmts  │                                              │
│   Ratios │                                              │
│   Quality│                                              │
│   Atlas  │                                              │
│          │                                              │
│ ▸ Value  │                                              │
│   Value  │                                              │
│   Forecast                                             │
│   Bank   │                                              │
│          │                                              │
│ ▸ Compare│                                              │
│   Peers  │                                              │
│   Watchlist                                            │
│   Workspace                                            │
│          │                                              │
│ ▸ Decide │                                              │
│   Thesis │                                              │
│   Report │                                              │
│   V3     │                                              │
│          │                                              │
│ ───────  │                                              │
│ Runs     │                                              │
│ Debug    │                                              │
└──────────┴──────────────────────────────────────────────┘
```

Key moves:
- **20 tabs → 14 sidebar items** grouped under 5 labeled sections. Runs/Debug become footer utilities, not peers of Valuation.
- Each sidebar item shows a **status dot** (green/amber/red) driven by that view's trust gate — the rigor state is visible in the nav itself.
- The active stage is highlighted; collapsed groups on small screens become a bottom sheet or top dropdown.

### 2.3 Main canvas layout pattern

Every analysis view adopts a **3-zone canvas**:

```
┌────────────────────────────────────────────────────┐
│ ZONE A — Context header (always)                   │
│ Ticker · type · periods · price · verdict · trust  │
├────────────────────────────────────────────────────┤
│ ZONE B — Primary content (1–2 hero elements)       │
│ e.g. Dashboard: verdict + 4 KPIs + 1 hero chart    │
├────────────────────────────────────────────────────┤
│ ZONE C — Evidence rail (collapsible sections)      │
│ Everything else, in ExpandableSections, lazy       │
└────────────────────────────────────────────────────┘
```

Dashboard example:
- **Zone A:** company identity, live price, verdict pill, confidence ring, trust-ladder mini-stepper (5 dots for the 5 rigor levels, current level lit).
- **Zone B:** verdict banner + 4 KPI tiles + ONE hero visualization (Penman decomposition OR valuation triangulation, user-toggleable).
- **Zone C:** everything currently stacked below — period delta, moat, cap-alloc, segments, advanced teal panels, next steps — each as a collapsed-by-default section with a one-line summary visible in the header row (e.g., "Moat: 72/100 — Wide ▸").

This cuts initial scroll depth from ~15 sections to ~2.

### 2.4 Design tokens (the enforced language)

Extend `index.css` `@theme` into a complete, documented token set. Rules: **no hardcoded hex or ad-hoc Tailwind color classes in components** — everything references tokens.

**Color semantics:**
| Token | Light | Dark | Use |
|---|---|---|---|
| `surface-0` | `#f8fafc` | `#0a0e1a` | app background |
| `surface-1` | `#ffffff` | `#0f172a` | cards |
| `surface-2` | `#f1f5f9` | `#1e293b` | elevated/inset |
| `border` | `#e2e8f0` | `#334155` | default borders |
| `text-1/2/3` | slate-900/600/400 | slate-100/300/500 | type hierarchy |
| `accent` | indigo-600 | indigo-400 | primary actions, active nav |
| `pos/neg/caution/neutral` | emerald/rose/amber/slate | same family dark-tuned | financial semantics |
| `trust-production/guarded/blocked/research` | existing trust-gate palette | existing dark palette | rigor states only |
| `panel-advanced` | teal-50/60 + teal-200 border | teal-950/40 + teal-800 | advanced models (keeps user's teal preference, now tokenized) |

**Type scale (6 steps, nothing else):**
- `display` (24px bold, metric heroes) · `title` (18px semibold, section titles) · `body` (14px) · `label` (12px medium) · `caption` (11px uppercase tracking, table headers/labels) · `mono` (JetBrains Mono, tabular-nums, all numbers)

**Spacing:** 4px base grid. Cards use `p-5`, sections separated by `space-y-6`, grids use `gap-4`/`gap-6`. Nothing else.

**Elevation:** 2 levels only — `shadow-sm` (cards) and `shadow-md` (popover/modal). No glassmorphism, no heavy shadows.

**Icons:** replace all emoji with a single inline SVG icon set (~24 icons: trend-up, trend-down, shield-check, shield-warning, shield-x, doc, chart, table, flask, bank, users, book, gear, search, moon, sun, link, chevron, alert-triangle, info, download, printer, filter, x). A tiny `<Icon name="…" />` component — no new dependency needed, or `lucide-react` (3kb tree-shaken) if preferred.

### 2.5 Component architecture

**New shared primitives (rewrite of `shared/DesignSystem.tsx`):**

1. `<Panel>` — the ONE card component. Props: `title`, `subtitle`, `status` (renders trust dot), `actions`, `collapsible`, `defaultCollapsed`, `padding`. Every existing `.card-base` hand-roll migrates to this.
2. `<Metric>` — value + label + trend + sparkline slot (absorbs MetricCard + KPITile).
3. `<TrustBadge>` / `<TrustGateBanner>` / `<RigorStepper>` — the trust system, one family.
4. `<EmptyState>` — icon + title + body + CTA, used by every tab's no-data state.
5. `<DataTable>` — wrapper enforcing the existing global table CSS + sticky headers + column alignment conventions (numbers right, labels left).
6. `<ChartCard>` — Panel + chart slot + consistent legend/axis/INR formatting (absorbs the chartUtils conventions).
7. `<SectionNav>` — in-page anchor nav for long views (replaces some scrolling).

**Shell refactor:**
- `AppShell` stays the state orchestrator (that's fine), but the header/nav extract into `<TopBar>` + `<SideNav>` presentational components fed by a nav config derived from `tabs.ts` (which becomes `nav.ts` with the 5-group hierarchy).
- `TabRouter` becomes `ViewRouter` — same job, but each view gets a standard `ViewLayout` wrapper providing Zone A context header automatically from shared state (removes per-tab hand-rolled context strips like DashboardView lines 196–218).

### 2.6 Trust ladder as a persistent element

The rigor ladder is the product's moat — give it a permanent home:

- **Top bar:** a compact trust pill (current level + color) next to the company switcher.
- **Sidebar:** per-view status dots.
- **Dashboard Zone A:** `<RigorStepper>` — 5 nodes (Valid → Reconciled → Plausible → Eligible → Production) with the achieved path lit and the blocking node pulsing amber/red. Clicking a node opens the trust panel for that gate.
- **Per-panel:** status dots on `<Panel>` headers where that panel's data is gate-dependent.

### 2.7 Dark mode discipline

- Every token defined in pairs from day one (table above).
- Lint rule / code-review checklist: no `dark:`-less color utilities on new components; no raw `slate-*` in components — only tokens.
- Storybook-style visual checklist page (`/design` route in dev) rendering every primitive in both modes for regression checking.

### 2.8 Print / export

Keep the existing print CSS approach; add a dedicated `print.css` pass per view so Report/Thesis export cleanly. Low priority — current setup mostly works.

---

## 3. Migration Strategy (incremental, no big-bang)

The greenfield is a **target architecture landed in slices**, each shippable:

| Phase | Scope | Deliverable | Risk |
|---|---|---|---|
| 0 | Tokens + Icon component | Extended `@theme`, `<Icon>`, token ESLint note | None — additive |
| 1 | `<Panel>` + migrate 5 highest-traffic panels (Dashboard, Valuation, Quality, Ratios, Statements) | Visual consistency where users spend time | Low |
| 2 | Sidebar nav (`nav.ts` + `<SideNav>` + `<TopBar>`) alongside existing header; feature-flag via config | Users opt into new nav; old nav still works | Medium — routing |
| 3 | Dashboard 3-zone restructure + RigorStepper | Flagship view proves the pattern | Medium |
| 4 | Remaining views migrate to ViewLayout + Panel (mechanical, view by view) | Full consistency | Low, tedious |
| 5 | Remove old header nav + legacy card classes; delete dead styles | Cleanup | Low |
| 6 | Polish: empty states, skeletons (already have `Skeletons.tsx`), micro-interactions | Feel | Low |

Rollback: nav feature flag in Phase 2; everything else is additive or per-view, so a bad view migration reverts in isolation.

## 4. What explicitly does NOT change

- Engine, pipeline, rigor gates, trust envelope schema — zero backend/analytics changes.
- Teal advanced-model panels (user preference — preserved as `panel-advanced` token).
- Trust-gate banner gradients (already institutional — absorbed into the token set).
- Keyboard shortcuts, command palette, glossary — kept, restyled to match.
- Charts stay on Recharts; only theming/formatting standardizes.

## 5. Success measures

- Dashboard initial viewport shows verdict + KPIs + hero chart with zero scrolling on 1440px.
- Any view's trust state identifiable in <2s (nav dot or stepper).
- Zero `dark:`-contrast bug reports after Phase 4 (enforced by token rule + design checklist page).
- Component style audit: `<Panel>` usage >90% of card surfaces by Phase 5.
