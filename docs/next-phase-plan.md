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
- Report: `docs/generated/forecast-accountability.md` (`npm run accountability`).

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

Abnormal profitability barely fades across this sample — but the sample is survivors (measured against a survivorship-free panel in next step 5: φ 0.89 there). The self-consistent ReOI model therefore **shows** the value at the panel's φ beside its own estimate and does not adopt it.

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

## Slice 3: the hard margin cap and the turnover floor (2026-09-27)

The base forecast capped the core-margin target at 20% (and its start at 30%) and floored asset turnover at 0.35–0.4×, whatever the company's history. Lifting the margin caps alone fixed Powergrid's margin (46–48%) but exposed the turnover floor: a utility turns its NOA ~0.2× a year, so the floor halved its forecast NOA and doubled RNOA (the two wrong clamps had been cancelling: 20% × 0.4 ≈ 8% against a true 48% × 0.2 ≈ 9.6%). Both now stay within the guardrail band around the company's own history (outer bounds 60% margin, 0.1× turnover).

Walk-forward, median skill vs a random walk (t+1 / t+2 / t+3):

| Metric | Before | After |
|---|---|---|
| CNI | −26% / −12% / +20% | **−9% / −0.3% / +27%** |
| Core RNOA | −14% / −7% / +10% | **+6% / −3% / +12%** |
| Core margin | −6% / +21% / +24% | −4% / +21% / +23% |

Median CNI error at t+1 fell from 4.1 to 3.5 ROE points. The price: forecasts are slightly more optimistic (margin bias 0.0 → +0.9pp; CNI bias +1.4 → +1.8 ROE points at t+1). Only four companies move: Powergrid (margin error 20.1 → 4.5pp, CNI 9.0 → 1.6 ROE points) and ITC improve; **Sun Pharma worsens** (margin bias +5.0 → +6.3pp — its 2010s margins, well above today's, now pull the anchor up where the cap had hidden it; that is the fade problem below, not a reason for an arbitrary cap) and TCS slightly (CNI t+3 8.5 → 9.1). At today's anchors only Powergrid (₹126 → ₹150), ITC (₹123 → ₹134) and Vodafone Idea (−₹42 → −₹45) change value.

**Tried and rejected — a recent-window anchor.** The forecast anchors are medians over *all* history before the latest year (10–15 years of Capitaline), so Sun Pharma's early-2010s margins still pull its anchor up. Anchoring on the five years before the latest instead removed the optimism above (margin bias +0.9 → +0.1pp) and improved seven of nine median skills — but it traded bias for variance: Sun Pharma's own margin error got *worse* (6.3 → 6.9pp), Paytm's jumped (13.1 → 19.9pp) as its recent losses dominated, and CNI error rose at t+2 for 8 of 12 companies that moved. Not adopted; searching window lengths until one looks good on 23 companies would be fitting noise.

## Slice 4: the 2.5× turnover cap (2026-09-28)

The "RNOA fades too fast for durable franchises" finding was not a fade at all: the base forecast capped asset turnover at 2.5× (target 2.2×), forcing forecast NOA to ≥ 40% of sales. High-turnover franchises turn NOA ~5× (Maruti, Britannia) or ~4× (TCS, Nestlé), so their forecast NOA doubled — and for net-cash companies, whose forecast equity tracks NOA through held leverage, so did forecast equity and its capital charge. The ceiling is now 8×; a negative turnover (negative NOA) is treated as unknown instead of being floored into a forecast NOA of 10× sales (a latent effect of slice 3's lower floor, which no scored metric caught because the NFO hold keeps earnings independent of NOA and RNOA is not scored on so small a base).

| RNOA, walk-forward | Before | After |
|---|---|---|
| t+2 mean error / bias | 9.0 / −5.7pp | **5.9 / −0.1pp** |
| t+3 mean error / bias | 9.5 / −5.9pp | **6.7 / −0.3pp** |
| median skill t+2 / t+3 | −3% / +12% | **+4% / +30%** |

Margin is untouched and CNI essentially unchanged (t+1 median skill −9.1 → −9.8%). Per company at t+3: Britannia 33.7 → 8.2pp, TCS 27.4 → 10.6, HUL 13.3 → 1.9, Maruti 44.3 → 30.7, Dabur better; Asian Paints worse (4.0 → 5.8pp, now over-forecast).

**Values move a lot, and the old ones were the broken ones.** Maruti's base value was ₹467 — 1.0× its own EPS (₹462), with its residual-earnings value at −₹1,784/share, below its ₹3,061 book, for a company earning 50% on NOA. Now ₹4,609 (10× EPS, 1.5× book). DMart ₹220 → ₹402 (it was valued below book), Britannia ₹695 → ₹1,081 (7.7× → 11.9× EPS), TCS ₹1,509 → ₹1,732, Nestlé ₹478 → ₹542, Dabur +12%, Titan +9%; measured variant on vs off in one code state.

*2026-10-17: the start now holds the latest year-end turnover however small NOA is. Below 10% of sales it had skipped the latest year: Maruti's FY2018 NOA (9.8% of sales) started from the 3.1× median of older years, so forecast NOA rose 3.8× in a year, and HUL before FY21, with no year counted, started from 1× (forecast NOA = sales, 20–140× what it held). At the 14 walk-forward cutoffs this moves (HUL, Nestlé, Maruti, Britannia), NOA error fell from 31% / 24% to 9% / 16% of sales at one / two years. At three years it rose from 21% to 23%, because HUL's GSK merger then lifted NOA to 87% of sales. Pooled CNI error fell at every horizon (10.24 → 10.17, 14.64 → 14.58, 16.89 → 16.83 ROE points). No anchor the app values today is affected (all turn below 7×). **Expect the next accountability run to report a lower core-RNOA skill at two and three years** (mean skill 39% → 33% and 59% → 34%; the 2026-10-17 run, which also carries #464–#467, reported 30% → 35% and 60% → 37%, with mean error lower at every horizon). Five observations leave the sample, because the forecast's own NOA is now under the scorer's 10% floor. Three of them are HUL's merger years, where a random walk carries a pre-merger RNOA of 400–2,100% and the old forecast, at NOA = sales, matched the merger by accident. On the observations scored both times, skill moves 33.5% → 32.5% and 35.0% → 34.0%. That is Maruti FY2018: the old forecast's NOA, 2.7× too high, had offset an income forecast 2.4× too high in FY2020.*

## Next steps, in order

1. **Sun Pharma and Asian Paints**, gated on backtest skill: how fast the forecast fades from the latest margin toward the anchor (a shorter anchor window was tried and rejected above), and why Asian Paints' RNOA now over-forecasts. *Measured 2026-10-15. **Asian Paints is resolved:** its forecast now beats a random walk at every horizon on core RNOA, margin and CNI, with RNOA bias −0.9 / +0.5 / +1.6 points at one / two / three years. **Sun Pharma is not, and fade speed is not its fix.** Its core margin is over-forecast by +3.0 / +6.5 / +11.0 points of sales, and it loses to a random walk on margin at two and three years and on CNI at every horizon. Slowing every company's margin fade (alpha +0.05) lowers margin error on cutoffs to FY2019 (6.26 → 6.16 points a year out) and from FY2020 (2.85 → 2.77), for 14 companies against 9. Sun's own error falls only 7.3 → 6.8 points. A 2–5% gain is within what one cycle of test years can show, and it would move every company's margin path. Not adopted. Sun's over-forecast is its target: the median margin of years before its decline, which a slower fade only delays.*
2. **Loss-maker trajectories.** Vodafone Idea is still forecast to fade toward a +3% margin target and loses to a random walk. *Measured 2026-10-15, and left as it is: the +3% floor on the margin target's band (`forecastDriverModel.ts`) binds at only 7 walk-forward origins: Paytm 3, Tata Steel 3, Idea 1. Targeting each company's own median instead made Paytm's and Tata Steel's forecasts worse (one-year core-margin |error| 10.1 → 11.0 and 3.7 → 3.8 points of sales; CNI 11.6 → 12.1 and 13.8 → 14.0 ROE points). Both were already forecast too low: their losses narrowed faster than their own median implied, so the floor's pull toward profit acts as mean reversion. Idea's median core margin is +2.3%, so the floor barely binds there; its losses come from financing costs, and its CNI error is in the forecast of net financial expense, not the margin target.* *Fixed for negative equity 2026-10-16. The forecast held leverage at NFO / CSE with CSE floored at ₹1 Cr, so from Idea's FY2021–FY2024 cutoffs (equity −₹38,228 to −₹104,167 Cr) forecast equity was ~₹1 Cr from year 1: the deficit vanished, and every forecast loss was funded by new equity rather than debt. Equity now rolls forward on clean surplus, with nothing paid out or raised. At those cutoffs the one-year NFE error falls from ₹3,994 to ₹1,949 Cr, the NFO error from ₹88,680 to ₹25,958 Cr, and the CNI error from ₹6,167 to ₹3,919 Cr (a random walk misses by ₹5,705 Cr). The scored record does not move. CNI is scored in ROE points of opening equity, so a year that opens with negative equity is never scored; Idea's scored years come from its positive-equity cutoffs to FY2020, and those miss on its decline after Jio's entry and on the AGR charge (unusual operating items are 249 of the 273 ROE points of error at the FY2020 cutoff). Across the other companies the NFE forecast is still slightly low (+0.5 / +0.6 / +0.9 ROE points of CNI optimism at one / two / three years); measuring the borrowing rate on average NFO, or pooled over three years, did not reduce it.*
3. **Integrated filings.** NSE moved results to "Integrated Filing" in 2025; FY2025+ filings need that endpoint before the as-filed ledger reaches the current year. *Resolved 2026-10-11 (#440): the fetcher reads both the annual and the integrated listings, and the ledger covers all 23 industrial companies through FY2026.*
4. **Revenue definition.** Resolve the ITC-style net/gross revenue gap in the Capitaline mapping, verified by the tie-out. *Resolved 2026-10-11: the mapping is right. Capitaline's revenue is net of excise duty (a tax collected for the government, not sales) and on the latest restated basis. The tie-out now nets the excise a filing itemizes (ITC FY18: ₹47,689 Cr filed − ₹4,240 Cr excise = Capitaline's ₹43,449 Cr), and revenue mismatches fell from 10 to 3. The three left are later restatements (UltraTech FY19, a common-control merger pooled; ITC FY24, hotels discontinued; L&T FY19, E&A discontinued), which results filings cannot confirm because they carry no restated comparatives.*
5. **Survivorship-free panel.** Add delisted and mid-cap companies (as-filed XBRL makes this cheap) before adopting panel priors. *Measured 2026-10-16 (`docs/generated/persistence-panel.md`). As-filed XBRL is cheaper than Capitaline but shallower than this assumed: results filings carry a balance sheet only from FY2023, and the reserves line that could stand in for book equity before then is off by more than half in 18 of the 107 records a filed balance sheet can check (most by 96–99%; Vodafone Idea's with the wrong sign). So the panel starts at FY2023: 1,007 industrial companies that filed FY2023 results with revenue of at least ₹500 Cr, chosen on that filing alone and followed through FY2026 (35 of the 975 with a measured year stopped filing; they stay in for the years they filed). Core RNOA from the filings matches the app's within 0.2 points at the median (IQR −1.1 to +2.0). φ is **0.89** for the whole panel (firm-bootstrap 90% interval 0.80–0.99; 0.94 and 0.84 on its two year-pairs; 0.85 with opening NOA under 10% of sales left out; 0.86 without companies whose RNOA ever passes ±100%), against **0.96** for the app's companies both on Capitaline over all years and as filed inside this panel (18 companies, 0.78–1.16). Survivorship in the strict sense does nothing measurable over these years (survivors 0.89). Choosing on later size does push φ up: the top 100 by FY2026 revenue give 0.92, the top 100 by FY2023 revenue 0.87. So the shipped prior is at the top of what the market shows, in the direction selection would put it, but the gap is inside every interval and the panel has two year-pairs from one economy. The prior stays as it is: shown beside the model's own estimate, not adopted. Re-run when FY2027 filings add a third year-pair (`npx tsx scripts/filings/fetch-panel.ts`, then `npm run accountability:panel`).*
6. **Ledger-based reformulation** with an unclassified bucket, so structural reconciliation becomes a measured quantity rather than 26/33 failing bridge checks. *First slice 2026-10-16. Reconciliation has been a measured quantity since #350–#382, with no gating failures left. What nothing measured was classification: operating assets are total assets less financial assets, so a financial line the key lists miss is counted operating and one they double-count is taken out of operations.*

   *A ledger of the Ind AS balance sheet's face lines settles both, because the face lines tie to the filed current and non-current subtotals:*
   - *Goodwill is filed in some years both beside "Intangible Assets" and inside it (HUL, Reliance, Sun Pharma and TCS), and in others outside it (ITC FY2017–20).*
   - *Grasim's life-insurance investments are a face line of their own, which the lending-arm carve-out removes.*

   *Set against the face statement's financial lines, the recast's financial assets matched in 163 of the 221 Ind AS company-years and exceeded them in the rest, through two double counts, both now fixed:*
   - *Margin-money deposits are a line inside long-term other financial assets, and they were counted again as cash: TCS FY2024 ₹2,461 Cr, ITC FY2023 ₹2,144 Cr, Paytm FY2020 ₹1,352 Cr.*
   - *With no current investments filed, the fallback summed the long-term schedule's measurement categories: Power Grid FY2018–23 and FY2025 and Paytm FY2022, to the rupee.*

   *All 221 now match. NOA rose up to 6.8% at ITC (FY2023), 4.4% at TCS and 1% at Power Grid, and Paytm's FY2020 rose from ₹451 Cr to ₹1,803 Cr. Values barely move (ITC −0.05%, TCS +0.05%, Power Grid +0.3%), because the bridge adds back what NOA gains. The panel persistence prior moves by under 0.001.*

   *Second slice: loans given. Their interest is already finance income, but the loans sat in operating assets, so they were in RNOA's denominator and not its numerator. TCS's inter-corporate deposits reached ₹11,229 Cr in FY2021 (22% of NOA), and Britannia's unitemized loans were 30–44% of NOA in FY2016–20. The Ind AS "Loans" lines are now financial assets, as "Others Financial Assets" already were. The exception is where a consolidated lending arm's loan book sits on them (M&M, L&T, Grasim), which the carve-out removes as operating.*
   - *Effect: 160 company-years of 20 companies change. In the latest year NOA falls 12% at Paytm, 3% at TCS and 2.7% at Britannia, and under 0.6% elsewhere.*
   - *Eight companies were measured, every one with a year that moves 5% of NOA or more among them, and none changes rung once S-5.5 tests the amount moved against NOA (#465). Across all 23, the only terminal-year flag that changes is Titan's. Without that test, Titan's 10.0% fall in financial assets in FY2025, a ₹534 Cr swap that is 2.6% of NOA, flagged its terminal year.*
   - *Base values move −0.4% to +1.3% (Britannia +1.3%, Titan +1.1%, TCS +0.4%).*
   - *Regenerating the panel persistence prior would move the consumer group's φ from 0.856 to 0.942, through HUL's pre-merger years on a near-zero NOA (FY2019 RNOA 1,288% → 2,157%) and Britannia's RNOA (40–65% → 65–102%). That prior feeds only the experimental self-consistent model, and it is left for the next accountability run.* *Regenerated 2026-10-17: consumer φ 0.856 → 0.951, and the pooled estimate reached the estimator's 0.98 cap (0.986 uncapped; within-company 0.83). The comparison clamps φ at 0.95, so both now give the self-consistent model full persistence. Leaving out years with opening NOA under 10% of sales (the walk-forward's floor) was tried and not adopted: consumer φ rose to the cap, and the industrial group went 0.79 → 0.98 on three fewer year-pairs. The pooled slope is fragile at this panel size either way.*
7. **Pro-forma restatement** for demergers and mergers, removing the anchor lag. *Re-scoped 2026-10-16. The anchor lag is closed: none of the 20 companies the app values is valued from a period older than its latest report (`accountability/summary.json`, 2026-10-11). What was left were the three industrial companies the app does not value, and none of them needs a restatement:*
   - *Vodafone Idea: negative equity, so equity-side values cannot be published.*
   - *Paytm: its FY2025 ticketing divestiture moves operating assets that the export cannot restate.*
   - *Airtel: not the Indus Towers consolidation but a tax credit. FY2025 was filed at 2.4% (₹3,195 Cr of deferred tax credited, current tax 11.6%) against 32.5% the year before. Core OI is built down from earnings, so it carried the whole credit: ₹51,189 Cr, up ₹22,616 Cr on ₹23,003 Cr of sales.*

   *Airtel is fixed with Penman's unusual tax items (`PenmanNissimEngine/unusualTax.ts`). A year filed more than 10 points from the median rate of the three years before it is taxed at that median throughout, including the debt shield and exceptional items, and the rest of its tax is unusual operating income.*
   - *29 company-years in 14 companies are normalized. The terminal year is one only at Airtel.*
   - *Airtel's FY2025 core OI falls to ₹35,397 Cr (incremental core margin 30%), and both terminal flags become itemized warnings. It is valued for the first time, at economically-plausible: ₹61 a share base. The telecom gate holds it below valuation-eligible, because the export has no spectrum or network-cost lines. The low value comes from the forecast fading the margin toward Airtel's 15-year median core margin, which includes the FY2017–21 loss years.*
   - *Values fall where a normalized year lowers the median margin: Reliance −9.1% (FY2021's ₹13,254 Cr tax credit), M&M −8.4%, DMart −3.9%, Tata Steel −2.7%, Grasim −2.4%, and under 1% elsewhere. Only Airtel's rung moves.*
   - *Walk-forward, 215 one-year-ahead origins: neutral. CNI ROE error 9.55 → 9.60 points (median 2.97 both), core RNOA 8.96 → 8.78, core margin 4.45 → 4.46 (median 1.31 → 1.43, partly because outcome years are normalized too). At the 17 origins in a normalized year, CNI error is 7.9 → 7.7 points (median 3.8 both).*
   - *Cost: a lasting change in the rate, such as the FY2020–22 move to 25.17%, is normalized at the old rate for up to two years. DMart FY2020 was filed at 25.4% against a 35.9% median. Exempting rates within 10 points of the statutory rate was measured and rejected: CNI error at the affected origins was 8.4 points, against 7.7.*
   - *2026-10-17: only a tax benefit is unusual now. "Neutral" above understated the margin cost: the median one-year margin skill fell from 28.6% to 21.6%, and it came less from normalized outcome years than from high-rate years taxed down to the median (Power Grid FY2018 filed 51.7%, Tata Steel FY2019 and FY2021): margin error where those years were scored rose 3.9 → 15.6, 4.3 → 7.5 and 2.0 → 3.0 points of sales. A rate far above normal comes from losses the group cannot relieve or charges the tax code disallows, which recur. Benefits alone give a median margin skill of 27.7%, and lower RNOA and CNI errors than either rule at every horizon. Capping the normal rate at the 34.944% statutory ceiling as well lowered margin error by only 0.01–0.03 points, with RNOA slightly worse, and was not adopted. Values fall where a high-rate year now stays in the margin median: Airtel −25% (FY2012–13), Grasim −24% (FY2019), Power Grid −7%; no rung moves. Power Grid's margin forecast is still worse than with no normalization (5.7 against 4.1 points a year out): its FY2021–22 benefits are judged against a median that includes FY2018's 51.7%.*
8. **Engine rewrite (Track E)** once the ledger defines the new inputs.
9. **Research workflow (Track C)** on top: thesis assumptions monitored against newly filed data. *Started 2026-10-11: frozen forecasts are scored against the results filed since (#444, `docs/generated/frozen-forecast-scores.md`), and the Case's Forecast section sets its base case beside any of its years the company has filed.*
