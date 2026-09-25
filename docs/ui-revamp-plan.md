# UI revamp: from module tabs to a research case

**Status:** Phase 5 next (2026-09-26) — shell, hash router, Library, Case skeleton, run store, Verdict, Business & economics, Evidence & trust, Forecast, Valuation, Peers, Record and Lab live behind `?ui=next`; see "Progress" below. Plan written 2026-09-25. Supersedes the *layout* of `docs/greenfield-ui-redesign.md`, which was a visual reskin (tokens, `wb-panel`, SVG icons) and is kept as the design-token foundation.
**Premise:** today's UI is organised the way the engine is built — 22 tabs, one per module (Statements, Ratios, Quality, Scope, Atlas, Business Model, Forecast, Valuation, Bank, Comparison, Report, Thesis, Regression, V3 Analytics, Debug…). A reviewer who wants the one thing the app exists to answer — *what is this company worth, how sure are we, and what would change our mind* — has to open six tabs and assemble it themselves. The revamp organises the UI around that question, and around the two things this application now does that nothing else does: **every number is traceable**, and **every forecast is scored against what happened**.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Rewrite or reskin | Rewrite the information architecture and shell; reuse engine, primitives and charts | The engine and the `wb-*` design tokens are sound; the structure is what fails the reader |
| Primary unit | **The company case** — one scrolling, sectioned page per company | Answers the question in one place; sections replace tabs |
| Navigation model | 4 spaces (Library, Case, Record, Lab) + URL routes | 22 flat tabs → 4 destinations; every view linkable |
| Router | Add a real router (URL = company + section + as-of date + scenario) | Today a deep link can only name a tab; a reviewer can't share "ITC, valuation, as of FY23, bear case" |
| Device | Desktop-first (1280–1920px); tablet/phone **read-only** Case | Model editing is desk work; reading a verdict on a phone is not |
| Migration | Strangler: new shell behind `?ui=next`, section by section, parity-tested, then delete old tabs | Never a big-bang; old UI keeps working until each replacement is proven |
| Dark mode, a11y | Keep dark mode; WCAG 2.2 AA is an exit criterion, not polish | Already paid for; the new shell must not regress it |
| Charts | Keep Recharts; one chart grammar (units, axes, confidence bands) enforced by wrappers | Five past bug classes were chart/label/unit mismatches (see memory sweeps) — the wrapper is the fix |

## Information architecture

```
Library ─────────── Case (per company) ─────────── Record ─────────── Lab
companies,          1 Verdict                       thesis, journal,  regression,
watchlist,          2 Business & economics          frozen forecasts, V3 analytics,
ingest, filings     3 Evidence & trust              scored outcomes,  run inspector,
freshness           4 Forecast (+ track record)     "what changed"    debug, charts,
                    5 Valuation                     bridges           design system
                    6 Peers
```

Where today's 22 tabs go:

| Today | New home |
|---|---|
| Data, Watchlist, Workspace | **Library** (one page: company grid with freshness, rigor level, verdict chip; ingest is a drawer, not a tab) |
| Dashboard | **Case §1 Verdict** |
| Statements, Ratios, Business Model, Atlas | **Case §2 Business & economics** (reformulated statements → RNOA drivers → pattern breaks, as one narrative) |
| Quality, Scope, trust panels | **Case §3 Evidence & trust** (rigor ladder, reconciliation, as-filed tie-out, earnings quality) |
| Forecast | **Case §4 Forecast**, with the walk-forward track record *beside* the drivers |
| Valuation, Bank | **Case §5 Valuation** (industrial and financial-institution variants of one section, chosen by analysis family) |
| Comparison | **Case §6 Peers** + a Library compare mode (2–4 companies side by side) |
| Report, Thesis | **Record** (thesis, journal, exports) — Report becomes an *export of the Case*, not a separate view |
| Runs | **Lab** (run inspector) and a per-number lineage drawer everywhere |
| Regression, V3 Analytics, Debug, Charts, Design | **Lab** |

## The Case page, section by section

**§1 Verdict** (above the fold, the only thing most visits need)
- Value range vs price on one axis: bear / base / bull and the self-consistent model's range, price marked, margin of safety.
- Confidence as one sentence plus the rigor level reached ("Structurally reconciled; valuation-eligible; not production-ready because…"). When a gate fails closed, the value is **withheld, not greyed** — the slot says what blocked it and links to §3.
- "What would change our mind": the three drivers the value is most sensitive to, each with its break-even (the value at which price is justified).
- Track record chip, from the walk-forward backtest (illustrative wording): "This company's base forecast has beaten a random walk on sales in 8 of 10 years; on earnings in 4 of 10."

**§2 Business & economics** — the reformulation as a story: sales → core margin × turnover = RNOA → spread over cost of capital → ReOI. Each ratio row expands to its time series and its lineage. Pattern breaks (Atlas) annotate the series instead of living on a separate map.

**§3 Evidence & trust** — the rigor ladder as a stepper that says what was checked and what failed; reconciliation residuals; Capitaline vs as-filed tie-out per year; restatement markers; earnings-quality flags. This is where every "withheld" link lands.

**§4 Forecast** — the driver table (growth, margin, turnover, leverage, minority share) with inline editing and live value delta; the fade shown as a chart against history; **beside each driver, its walk-forward error and skill** for this company and its sector. Frozen snapshots appear as ghost lines so the reader sees past forecasts against what happened.

**§5 Valuation** — model triangulation (ReOI, RE, self-consistent, DCF cross-check, relative) as one comparable chart with each model's disagreement explained; sensitivity grid; ke/kw provenance (kw read-only, derived — S-9.4C). Financial institutions get their own variant of this section, not a separate tab.

**§6 Peers** — the company against 3–6 peers on the same reformulated basis; relative valuation.

## Cross-cutting interaction patterns

1. **Lineage drawer.** Any number, anywhere, opens a right-hand drawer: source line(s) → mapping → recast step → formula → the value. This replaces Debug/Run Inspector for everyday use and makes "defensible under review" a click, not a hunt.
2. **As-of time machine.** A date control in the Case header re-renders the whole Case as it would have looked on that date (point-in-time filings + frozen forecasts) — the accountability work made visible.
3. **Scenario switch.** Bear / base / bull / custom as a header control; every section follows it. Custom scenarios persist in the Record.
4. **Withheld, not wrong.** One component for "no number because a gate failed", always with the reason and a link — never a plausible-looking number beside a skip flag (the scorers-disown-scores class).
5. **Units in the type system.** A `Money`, `Pct`, `PerShare`, `Ratio` value type rendered by one formatter, so ₹Cr vs ₹/share and pp vs % cannot be mixed on screen (the unit-scale class).
6. **Lists state their totals.** Every truncated list shows "n of N" and which end was kept (the truncated-list class).
7. **Command palette + keyboard.** Jump to company/section/number; `g v` → valuation, `[`/`]` → previous/next company.

## Architecture

- **Routing:** `/:company/:section?asOf=&scenario=` for the Case; `/library`, `/record/:company`, `/lab/:tool`. Deep links, back/forward and shareable views come free.
- **State:** split the 23.6 KB `AppShell` into (a) a company-run store keyed by company + as-of + scenario — computed once, memoised, consumed by all sections; (b) URL state; (c) per-viewer UI prefs. Sections become pure views over the run; no section recomputes the pipeline.
- **Work off the main thread:** the pinned analysis run already executes in a worker (`src/engine/analysisRun/browserClient.ts`), but interactive recomputes — the Valuation tab's `useMemo` chain over readiness, share basis, kw and the models — run on the main thread. Route driver edits through the same worker protocol so editing never blocks typing.
- **Components:** keep `shared/` primitives (Panel, Metric, EmptyState, RigorStepper, Icon); add `Value` (typed units), `Withheld`, `LineageDrawer`, `TrackRecord`, `ChartFrame` (enforces units, axis domain, confidence band).
- **Bundle:** route-level code splitting — Lab and exports (exceljs, jspdf, katex) never load on a Case visit. Budget: Case first load ≤ 350 KB gzipped.

## Phases

| # | Phase | Delivers | Exit criteria |
|---|---|---|---|
| 0 | Foundations | Router, run store on the existing run worker, `?ui=next` flag, Library, Case skeleton | Old UI untouched; new shell renders Library + an empty Case for all 33 companies |
| 1 | Verdict | Case §1 end to end, incl. withheld states and track-record chip | Verdict numbers identical to today's Valuation hero for all 33 companies (parity test) |
| 2 | Economics + Evidence | §2 and §3, lineage drawer on every number in both | Every ratio/statement number from today's tabs present (parity inventory); drawer resolves for 100% of them |
| 3 | Forecast + Valuation | §4 with inline driver editing in the worker, §5 incl. financial-institution variant | Edited-driver value matches engine; edit→repaint ≤ 150 ms on the largest company |
| 4 | Peers, Record, Lab | §6, compare mode, Record (thesis/journal/snapshots/exports), Lab | All 22 old tabs reachable in the new IA; exports byte-compare with today's where format is unchanged |
| 5 | Time machine | As-of control across the Case | A Case rendered as of FY23 uses only data filed by then (tested against the filings ledger) |
| 6 | Cutover | `ui=next` becomes default; old tabs deleted | e2e suite passes on the new UI; axe: zero serious violations; old tab components removed |

Each phase ships as its own PR(s) through the normal CI/merge workflow; the old UI keeps working until phase 6.

## Progress

**Phase 0 (2026-09-26)** — `src/next/`:
- `?ui=next` mounts `NextApp` as a lazily-loaded chunk (4 kB gzipped); without the flag `App` renders the current `AppShell` exactly as before.
- Hash router (`route.ts`): `#/library`, `#/case/:company/:section?asOf=&scenario=`, `#/record`, `#/lab`. Hash, not path, because the deployment has no SPA rewrites — a path route would 404 on refresh.
- Run store (`companyRun.ts`): fetch the bundled zip → parse → run in the existing analysis-run worker with the same inputs and market packs as the current shell; one run per company per session, failures not cached.
- Library lists every company with its total; the Case header shows the run's confidence headline and rigor level; each section says which phase builds it and links to today's equivalent tab.
- Tests: route round-trip and fallbacks, run-store inputs (packs, config, URL encoding for `M&M`), page rendering, and a browser e2e (`e2e/next-ui.spec.ts`, in the CI pipeline-e2e job) that opens TCS and waits for the worker run to settle.

**Phase 1 — Verdict (2026-09-26):**
- `sections/VerdictSection.tsx` reads the run's command center (`materialization.commandCenter` — the object the current Valuation hero reads in run-backed mode) through the hero's own formatters: signal, current price, stress/base/bull value with upside, stress CAGR, and the valuation range with the price on one ₹/share axis; the anchor period and, when older than the latest report, the readiness reason.
- `ui/Withheld.tsx`: a missing figure is shown as *Withheld* with its reason (no market price, no share count, financial-institution family, blocked or failed run) — never the hero's bare "—".
- The run store now fetches the live market snapshot the current shell fetches and passes it into the run.
- **Exit test** `verdictParity.spec.tsx`: TCS and M&M command centers built from bundled data; the hero and the Verdict render from the same object and every shared figure is the same string (or "—" ↔ Withheld). Mutation-checked: reading the wrong scenario or reformatting the price fails it.
- **What would change our mind** (`engine/valuationCommandCenter/breakEven.ts`): for year-1 sales growth, year-1 core margin and the cost of equity, the value at which the base case equals the price, each moved alone (kw follows ke structurally, S-9.4C). The base card is re-valued along the exact path behind its displayed value — with no shift it reproduces the card to 9 decimals (tested on real TCS data). Beyond ±25pp (ke: −6/+15pp) the answer is withheld, not extrapolated.
- **Track record**: `run-all.ts` now writes `public/data/accountability/track-record.json` (per company, one year ahead: forecasts scored and how many beat a random walk); the Verdict states the counts for sales, operating margin and earnings, or withholds them.
- Found on the way: `buildScenarioCards` computes each card's value *with* the owner-earnings DCF, and `normalizeScenarioCards` then replaces it with the RE/ReOI median — the first computation never reaches the screen. Also, the market-implied ledger compares implied terminal ROIC against the *growth* anchor, so it reads "optimistic" for nearly every company. Neither is surfaced in the new UI; both are left for their own fixes.

**Phase 2 — Economics + Evidence (2026-09-26):**
- `lineage.ts` resolves every displayed number: statement lines to the recast's own trace (the Capitaline rows, or the derivation it recorded) plus, for derived lines, the formula and component lines; ratios to the formula in `ratiosResidual.ts` with this and the prior year's operands. `ui/LineageDrawer.tsx` shows source rows, formula and drill-down.
- `sections/EconomicsSection.tsx`: income, balance sheet and drivers (PM, ATO, RNOA, NBC, FLEV, SPREAD, ROCE) for the latest six years ("latest 6 of N" stated), every number a button into the drawer; pattern breaks (anomaly flags) by year.
- `sections/EvidenceSection.tsx`: rigor ladder (achieved / not, with detail), reconciliation checks and parser-fidelity checks — failures first, totals stated, diagnostic checks marked.
- **Exit tests** `economics.spec.tsx` on real TCS and M&M data: all 15 statement lines the section shares with the Statements tab are the same strings for the same years; every displayed number (100+ per company) resolves to source rows or components; NOA = OA − OL and OI = CNI + NFE + MII add up in the drawer. Mutation-checked (formatting, a wrong field, a lost trace each fail).
- Not yet in §3: the Capitaline-vs-as-filed tie-out (it lives in `data/filings/`, not served to the browser).

**Phase 3 — Forecast + Valuation (2026-09-26):**
- Engine: `revalueBase(cc, shifts)` (in `breakEven.ts`) re-values the base case with any combination of shifts — sales-growth path, core-margin path, ke (kw follows structurally), terminal growth — along the base card's own path, returning the value and the forecast years. The break-even solver now uses it.
- `sections/ForecastSection.tsx`: editable shifts with the value recomputed live and withheld (with the reason) when terminal growth reaches the discount rates; the forecast year by year (sales, growth, core margin, turnover, OI, NOA, CNI, CSE); the walk-forward track record for sales, margin, RNOA and earnings.
- `sections/ValuationSection.tsx`: every catalogued model's result from the run (`materialization.modelResults` joined to the model catalog) — computed values, or withheld with the model's own reason code — covering financial institutions too; cost of capital with each input's source, date and provenance tier, kw marked derived; a ke × terminal-growth sensitivity grid centred on the base card.
- **Exit tests** `forecastValuation.spec.tsx` (real TCS and ITC data): the edited value and every forecast row are the engine's; the model table shows every computed value and every withheld reason; the grid's centre is the base card.
- **Measured, and a plan change:** a re-valuation takes 0.05 ms (median; p95 0.10 ms) on ITC, the largest bundled company, and the 25-cell grid 1.7 ms — three orders of magnitude inside the 150 ms budget. Driver edits therefore stay on the main thread; routing them through the worker would add latency, not remove it.
- Not done: the fade chart (the year-by-year table carries it) and frozen snapshots as ghost lines (`accountability/snapshots/` is not served to the browser).

**Phase 4 — Peers, Record, Lab (2026-09-26):**
- `sections/PeersSection.tsx`: the company beside up to four same-type library peers — latest-year RNOA, margin, turnover, ROCE, sales growth, base value and upside. Peers are analysed only when the reader asks (each is a full run), one at a time, through the session run cache.
- `legacyTools.ts` maps **every one of the 22 current tabs** to a home, keyed by `TabId` so a new tab without a home fails to compile: 11 to rebuilt Case sections, 3 to the Library (own-data upload, watchlist, workspace), 2 to the Record (report, thesis), 6 to the Lab (run inspector, regression, V3 analytics, debug, design, charts).
- `ToolsPage.tsx` (Record and Lab) and the Library's "Your data and lists" open those tools **in the classic interface** for the chosen company (`/?ui=classic&tab=…&company=…`, the deep link the current shell already reads); a tool that needs a company is withheld until one is chosen.
- **Decision, a change to the plan:** hosting the classic tabs inside the new shell would mean re-creating the classic shell's whole state (registry, workspace, uploads, sidecars, market data) — i.e. the classic shell itself. The Record and Lab therefore launch the classic interface rather than embed it, and Phase 6 keeps it available at `?ui=classic` instead of deleting the tabs: the Lab tools and own-data upload still live there. Tabs are deleted one by one as each is rebuilt.
- Exit test `phase4.spec.tsx`: all 22 tabs mapped exactly once; Case homes are real sections; classic links carry the deep link; peers chosen, measured and gated as specified.

**Decision:** `Value`, `Withheld`, `ChartFrame` and `LineageDrawer` are built with the first section that uses them (Phase 1–2), not in Phase 0 — a component with no consumer has no contract to test against. Interactive driver edits move with the Forecast section (Phase 3).

## Measures of success

- **Time to verdict:** company chosen → value, confidence and top risk visible without scrolling or switching views (today: ≥ 3 tabs).
- **Clicks to lineage:** any displayed number → its source in 1 click (today: Debug tab + search).
- **Views:** 22 tabs → 4 spaces, 6 Case sections.
- **Performance:** Case first load ≤ 350 KB gzipped; driver edit → repaint ≤ 150 ms.
- **Correctness:** zero parity diffs on the phase exit tests; the five known display bug classes each guarded by a component (`Value`, `Withheld`, `ChartFrame`, n-of-N lists), not by review.

## Not in scope

- Engine changes (the accountability roadmap in `docs/next-phase-plan.md` continues independently; the Case surfaces its outputs as they land).
- Multi-user collaboration and sharing permissions (Track C in the next-phase plan).
- A mobile editing experience.
