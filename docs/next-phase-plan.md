# Next phase: from traceable to accountable

**Status:** Phase 1 in progress — first slice shipped 2026-09-25 (this document's PR).
**Premise:** the app proves every number is *traceable*. It has never shown that its numbers are *right* — measured against what actually happened — and it only works for companies whose Capitaline exports someone downloads by hand. This phase changes the data (uploaded spreadsheets → point-in-time filings), the models (assumed parameters → parameters measured against outcomes) and the product (single report → living research record).

## Decisions

| Question | Decision | Why |
|---|---|---|
| Audience | Personal research tool built to institutional rigor | No commercial constraints; rigor is the point |
| Universe | Current 33 companies; infrastructure built to scale | Scaling before the data layer is point-in-time would scale the look-ahead problem |
| AI document extraction (Track D) | Deferred | Needs a labelled evaluation set and API spend before it can be trusted |
| First tracks | A (point-in-time filings) + B (outcome calibration) | Everything else rests on them |
| Survivorship-biased estimates | Measured and shown, never silently adopted | The corpus is today's large caps, selected because their returns persisted |

## Tracks

- **A — Point-in-time filings ledger.** As-filed XBRL from NSE/BSE, every fact keyed by filing date; reformulation by construction with an explicit unclassified bucket.
- **B — Outcome-calibrated valuation.** Forecast accountability ledger, walk-forward backtests against naive benchmarks, panel-estimated priors.
- **C — Research workflow.** Monitored thesis assumptions, "what changed" value bridges, reviewer mode.
- **D — Document intelligence.** Deferred (see decisions).
- **E — Engine rewrite.** New stage-based run engine with a parity harness; delete `legacyExecutor.ts` (1,701 lines; 0/14 stages native).

## Shipped in this slice

### Forecast accountability (Track B) — `src/engine/accountability/`

- `walkForwardCompany` re-runs the app's own base forecast (`buildAnchoredForecast` — exactly what the Valuation tab shows) at every historical cutoff with ≥5 years of history and scores t+1…t+3 against later actuals, beside a **random walk** and a **trailing trend** benchmark built from the same truncated history. Actuals are matched by fiscal year, never by array position; ke uses config defaults, never today's dated packs.
- Metrics are scale-free so companies pool: sales log error, operating-margin error (OI error ÷ sales), core RNOA error (only on an NOA base ≥ 10% of sales) and CNI error in ROE points. Means *and* medians are reported.
- **Forecast ledger:** today's forecasts for all 23 industrial companies are frozen in `accountability/snapshots/2026-09-25/` and are never regenerated; `scoreSnapshot` scores them look-ahead-free as FY27 results arrive.
- Report: `docs/generated/forecast-accountability.md` (`npx tsx scripts/accountability/run-all.ts`).

**What the backtest says** (218 forecast origins, 22 companies; medians):

| Forecast of | Skill vs random walk | Verdict |
|---|---|---|
| Sales | +29% (t+1) … +51% (t+3) | Clearly informative — beats both benchmarks at every horizon |
| Operating margin | −11% (t+1) … +26% (t+3) | About naive; optimistic by ~1.5pp of sales |
| Core RNOA | −26% (t+1) … +9% (t+3) | Mean skill is large but comes from outliers; fades durable high-RNOA firms too fast (−5.5pp at t+2/t+3; TCS, Maruti, Britannia) |
| Earnings (CNI) | −22% (t+1) | **Worse than naive and optimistic by 4.4–6.7 ROE points** — this inflates valuations |

Caveat on every number: Capitaline serves restated figures, so the backtest sees restatements of its own history (Track A removes this).

### Panel persistence priors — `src/engine/accountability/persistence.ts`

Pooled AR(1) of each firm's core-RNOA deviation from the year's cross-sectional median (Nissim–Penman fade), trimmed on the regressor (clipping biased φ upward — caught by a synthetic-panel test). Generated into `persistencePriors.generated.ts`:

| Group | φ | Companies |
|---|---|---|
| all | 0.96 | 21 |
| consumer | 0.84 | 6 |
| conglomerate | 0.96 | 3 |
| industrial | 0.98 | 3 |
| cyclical | 0.23 | 3 |

Abnormal profitability barely fades across this sample — but the sample is survivors. The self-consistent ReOI model therefore **shows** the value at the panel's φ beside its own estimate and does not adopt it.

### As-filed XBRL ingestion (Track A spike → working slice) — `src/engine/filings/`

- **Feasibility confirmed:** NSE's `corporates-financial-results` API lists every annual results filing with its filing timestamp and a direct XBRL link (verified with curl and a browser user agent; the existing market-data handler notes NSE blocks some server-side clients). 79 annual filings fetched for 13 companies (FY2018–FY2024; consolidated, or standalone where a company files no consolidated results).
- Two traps handled in `parseXbrlInstance`/`extractAnnualHeadline`: the year-to-date context `FourD` is stamped with the **quarter's** dates (so date matching returns the quarter as the year), and older filings reference `FourD`/`OneI` without **declaring** them. The exchange utility's ID convention is authoritative; undeclared contexts are labelled as such.
- `data/filings/<SYMBOL>/as-filed.json` holds each year as first reported, keyed by filing date (raw XML is git-ignored and re-downloadable).

**Tie-out, Capitaline vs as-filed** (`docs/generated/source-tieout.md`, 270 comparisons):

- Balance sheet and equity: **100% match** (75/75). Operating cash flow: 36/37.
- Revenue: 65/79 match. ITC is systematically 3–12% lower in Capitaline (net vs gross revenue from operations — a definitional gap that feeds every margin and turnover ratio).
- PAT: 62/79 match. L&T FY21 differs by 36% (a ₹8,238 Cr discontinued-operations gain). **Asian Paints' FY22 XBRL is itself wrong** — PAT ₹9,167 Cr against PBT ₹4,156 Cr — so filings get internal-consistency checks and cannot arbitrate blindly.

### Valuation anchor lag (finding)

9 of 23 industrial companies are valued from a period older than their latest report (ITC from FY2023 against FY2025). The walk-back is legitimate — ITC FY2025 carries the ITC Hotels demerger (January 2025), Infosys FY2026 a structural event — so the fix is **pro-forma restatement around corporate actions** (Track A), not a looser gate.

## Slice 2: the earnings optimism, diagnosed

Decomposing every t+1 CNI error into margin, sales, unusual items, financing and minority interest showed the "+4–7 ROE-point optimism" was a **mean driven by three outliers**; the median forecast was slightly *pessimistic* (−0.9 points). Four causes, one of them a data bug:

1. **Recast minority-interest sign (bug, fixed unconditionally).** Capitaline reports TCI as the *owners'* share and the NCI line as a signed deduction (verified against L&T's FY23 as-filed XBRL to the rupee, and consistent across all 27 companies). The recast read TCI as group income, so CNI was the group's (Grasim FY25: ₹8,181 Cr vs ₹3,811 Cr owners'; Reliance off by ₹11,658 Cr) and OI lost the minority's share. The comprehensive-income bridge — a structural reconciliation check — carried the whole NCI share as a residual (~100% at Grasim).
2. **The forecast never deducted the minority's share**, and its balance sheet ignored MI (NFO_f = NOA_f − CSE_f absorbed it). Now MI is held at the anchor's MI/CSE and the minority takes its trailing three-year income share.
3. **Held leverage is ill-conditioned when operating assets ≈ 0.** HUL before FY21 had net cash above equity; CSE_f = NOA_f / (1 + flev) divided by ~0.05, so forecast equity was 20× the business and its phantom cash earned interest (+229 ROE points at one origin). Below NOA/CSE = 0.25 the forecast now holds NFO in rupees.
4. **The base margin was floored at +4%**, forecasting every loss-maker profitable in year 1 (Paytm, Vodafone Idea).

Walk-forward, CNI error in ROE points (218 origins; step 1 re-measures the baseline on corrected actuals):

| | t+1 MAE | t+1 bias | t+1 skill vs RW (mean / median) | t+2 skill (mean / median) | t+3 skill (mean / median) |
|---|---|---|---|---|---|
| Before (slice 1) | 11.8 | +4.4 | −32% / −22% | −28% / −5% | +3% / +16% |
| 1. Recast fixed | 11.5 | +5.5 | −34% / −28% | −30% / −11% | +3% / +18% |
| 2. + minority + NFO hold | 9.9 | +3.3 | −15% / −27% | −4% / −14% | +11% / +20% |
| 3. + no margin floor | **8.1** | **+1.4** | **+6% / −26%** | **+1% / −12%** | **+12% / +20%** |

Operating-margin bias fell from +1.3pp to 0.0pp. Per company: the NFO hold only moves HUL (mean error 40.9 → 7.7) and Paytm; the margin floor only moves loss-making origins (Paytm 13.2 → 5.5, now better than a random walk; Vodafone Idea 183 → 159, still worse than its 150). The minority deduction is roughly neutral on accuracy (Grasim bias +3.9 → +0.9; L&T, ITC, Tata Steel a little worse) and is kept because without it the forecast scores group earnings against owners' actuals.

**What is not fixed:** the *median* one-year CNI forecast still loses to a random walk (−26%). That is the typical profitable company, and it sits in the margin/persistence path — the next step.

The frozen 2026-09-25 snapshots predate the recast fix; for companies with minority interests their OI forecasts are on the old (owners-only) basis and should be read with that in mind when scored.

## Next steps, in order

1. **Slow the RNOA fade for durable franchises, and fix the one-year CNI median**, gated on backtest skill. Start from the margin target's hard 20% cap (after-tax core margin: Powergrid ~48%, ITC 24–27%, TCS ~19%; Powergrid's CNI is forecast 8 ROE points low) and the turnover clamp that imposes NOA ≥ 40% of sales.
2. **Loss-maker trajectories.** Vodafone Idea is still forecast to fade toward a +3% margin target and loses to a random walk.
3. **Integrated filings.** NSE moved results to "Integrated Filing" in 2025; FY2025+ filings need that endpoint before the as-filed ledger reaches the current year.
4. **Revenue definition.** Resolve the ITC-style net/gross revenue gap in the Capitaline mapping, verified by the tie-out.
5. **Survivorship-free panel.** Add delisted and mid-cap companies (as-filed XBRL makes this cheap) before adopting panel priors.
6. **Ledger-based reformulation** with an unclassified bucket, so structural reconciliation becomes a measured quantity rather than 26/33 failing bridge checks.
7. **Pro-forma restatement** for demergers and mergers, removing the anchor lag.
8. **Engine rewrite (Track E)** once the ledger defines the new inputs.
9. **Research workflow (Track C)** on top: thesis assumptions monitored against newly filed data.
