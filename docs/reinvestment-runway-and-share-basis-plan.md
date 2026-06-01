# Reinvestment-Runway Valuation + Share-Basis Split — Plan to Land

**Status:** Proposed. Phase A (share-basis split) is a small, well-scoped fix.
Phase B (reinvestment-runway / compounder signal) is a substantive new metric.

**Author:** drafted with Claude Code (model: MiniMax-M3).

**Drives from:** the DMART cross-check verdict — Capitaline ⇄ AR to the rupee
(data trustworthy), but `moatSignal: "no-moat"` on a compounder shows the
EPV model is using the wrong frame for a business whose value is in future
reinvestment, not current earnings power on existing assets.

---

## 0. The diagnosis (concise)

### 0.1 Share basis — one number, two purposes
The engine resolves a single `shares` value via `resolveShareBasis` and uses
it for BOTH per-share valuation AND market cap / enterprise value.

For DMART FY25 (verified against AR Note 16, page 161):
- Issued, subscribed and fully paid up: **65,07,33,068** shares = **65.07 Cr**
- Weighted average diluted (FY25): **65.23 Cr**
- Market cap @ ₹4,071.8:
  - paid-up (65.07) = ₹264,952 Cr
  - diluted-WA (65.23) = ₹265,604 Cr
  - delta: **₹652 Cr (0.25%)**

Per-share metrics (P/E, intrinsic-per-share, EV/EBITDA) should use diluted WA
(ties to reported EPS, matches what analysts quote). Market cap / EV should
use paid-up period-end (what is the equity outstanding today).

### 0.2 EPV moat signal — wrong frame for compounders
Graham-Dodd EPV is the **no-growth floor** — what is the business worth if it
never grows again? For a compounder (after-tax ROIC > WACC, growth capex > 0), this
*understates* the value because the value of incremental investment is real
and material.

For DMART, current run-rate after-tax RNOA is ≈9.45% versus kw ≈13.02%, so
the reinvestment spread is *negative* today. The "no-moat" call is honest
Graham-Dodd. But:

1. The normalized after-tax RNOA (median over 10 years) is even lower — DMART's
   *historical* run-rate is a destroyer-of-value. Current run-rate is the
   *turnaround* story.
2. For a true compounder (HDFC AMC, Asian Paints at peak, Infosys at scale,
   Nestle), current after-tax RNOA > WACC and the reinvestment runway has real value
   that Graham-Dodd misses.
3. The engine today reports "no-moat" for both a value-destroyer AND a
   compounder. That is exactly the wrong frame.

The fix is a separate, named signal: the **reinvestment-runway value** —
the PV of the spread earned on growth capex over a forward horizon.

---

## 1. The math (defended)

### 1.1 Reinvestment-runway value (Phase B)

Given:
- `RNOA_current` = latest period CoreOI × (1 - tax rate) / latest period NOA
- `kw` = structural cost of capital (WACC)
- `growthCapex` = avg growth capex = max(0, avgCapex - avgDepreciation)
  (= Greenwald's "excess capex" — capex above maintenance)
- `horizon` = 5 years (explicit forecast)
- `terminal_growth` = 5% (long-run reinvestment)
- `spread` = after-tax RNOA_current - kw
- Reinvestment qualifies as a **compounder** only if:
  - `growthCapex > 0` (the company is actually reinvesting)
  - `spread > 0.02` (i.e. > 200 bps above WACC — durability threshold)
  - after-tax `RNOA_current > kw` in ≥ 60% of recent periods (stickiness)

Value:
```
For t in 1..horizon:
  incremental_NOA_t = growthCapex × t  (linear reinvestment)
  avg_NOA_t = incremental_NOA_t / 2 + (incremental_NOA_t - growthCapex) / 2
  spread_earnings_t = spread × avg_NOA_t
  PV += spread_earnings_t / (1 + kw) ** t

# Terminal: spread fades linearly from `spread` at horizon to 0 at year 10
residual_spread = spread × 0.5
terminal_value = (residual_spread × growthCapex × (1 + terminal_growth)) / (kw - terminal_growth)
PV += terminal_value / (1 + kw) ** horizon
```

`reinvestmentValue` is the result. Sanity cases:
- `spread ≤ 0` → 0 (the engine already correctly reads "no-moat" via Graham-Dodd)
- `spread > 0` but `growthCapex = 0` → 0 (no reinvestment, so no value)
- Both positive → positive, with the value reflecting the duration of the spread

For a true compounder (HDFC AMC-shape: after-tax operating return materially
above WACC, growth capex positive):
- Annual spread Y1 = average incremental NOA × after-tax spread
- PV over 5y + terminal: ~₹400-500 Cr
- This is *real value* Graham-Dodd misses, and material as a fraction of EPV

### 1.2 Share basis split (Phase A)

`resolveShareBasis` already exposes `weightedAverageBasicShares`,
`weightedAverageDilutedShares`, and `endPeriodShares` via the upstream
`shareCountInput`. The fix is to **stop conflating them at the resolver**.

New contract on `ShareCountResult`:
- `sharesForPerShare: number | null`  — diluted weighted average
- `sharesForMarketCap: number | null` — period-end paid-up
- `shares` (existing field, kept for back-compat) = `sharesForPerShare`

Consumers:
- `valuationCommandCenter/core.ts:297` (marketCapFromPrice): use `sharesForMarketCap`
- `valuationCommandCenter/core.ts:298` (enterpriseValueFromPrice): use `sharesForMarketCap`
- All per-share consumers (EPV, RIV, EP, ratio panels): use `sharesForPerShare`

The `confidence` and `source` fields remain on the consolidated result;
`sourceForMarketCap` is added for auditability (e.g. "AR Note 16 —
65,07,33,068 equity shares of ₹10 each").

---

## 2. Test plan (TDD: tests first, then code)

### 2.1 Share basis split tests (`shareCountTools.spec.ts` — extend)
1. ITC audited fixture: `sharesForPerShare` and `sharesForMarketCap` both
   resolve to the same value when there's no share issuance history (the
   common case).
2. New fixture: a company with FY24 issuance (e.g. ESOP allotment) — the
   diluted WA at year-end should be larger than the paid-up count from
   the latest balance sheet.
3. `marketCapFromPrice` uses `sharesForMarketCap` (not the diluted WA).
4. Per-share consumers (P/E, intrinsic per share) use `sharesForPerShare`.

### 2.2 Reinvestment-runway tests (`grahamDoddEPV.spec.ts` — extend)
1. **Zero spread, positive growth capex** → `reinvestmentValue = 0`,
   `compounderScore = false`, `moatSignal` unchanged.
2. **Positive after-tax spread (>200bps), positive growth capex, sticky RNOA** →
   `reinvestmentValue > 0`, `compounderScore = true`, `moatSignal` stays
   Graham-Dodd (we don't override), but `interpretation` includes
   "growth-runway" or "compounder" qualifier.
3. **Positive spread, zero growth capex** (mature TCS-like) →
   `reinvestmentValue = 0` (no reinvestment to discount), but
   `compounderScore = true` (the company *would* reinvest if there were
   opportunities — flag it as quality without growth).
4. **Borderline spread = 100 bps** (just under threshold) →
   `reinvestmentValue > 0` (we still compute the value), but
   `compounderScore = false` (200 bps durability gate not met).
5. **RNOA flapping** (after-tax RNOA > kw in only 40% of recent periods) →
   `compounderScore = false` (stickiness gate not met).
6. **Sanity: the explicit-period PV is 60-80% of total reinvestment value;
   terminal is 20-40%** — for a 5-year horizon at kw=13%, 5% terminal.
7. **DMART fixture** — drives the real run, asserts:
   - `afterTaxRNOA_current ≈ 9.45%`
   - `spread < 0` (negative, as computed)
   - `reinvestmentValue = 0` (correct: DMART is a *current* value-destroyer
     on existing book, not a compounder today)
   - `moatSignal = "no-moat"` (Graham-Dodd stays correct)
   - `compounderScore = false` (spread gate not met)
   - This proves the model correctly identifies DMART as a *value
     destroyer* in the current period — a *more* honest verdict than the
     engine gives today (it says "no-moat" without saying *why*).

### 2.3 Moat signal test (regression)
The existing "no-moat" test (line 165) must still pass: a value-destroyer
still reads "no-moat" (Graham-Dodd is preserved), and the new
`reinvestmentValue = 0` for the negative-spread case keeps the verdict honest.

---

## 3. Implementation outline (two PRs, staged)

### PR 1: Share basis split (small, low-risk)
- `src/engine/v3Analytics/shareCount.ts` — add `sharesForPerShare`,
  `sharesForMarketCap` to the result; pick `weightedAverageDilutedShares`
  for per-share and `endPeriodShares` for market cap.
- `src/engine/shareCountTools.ts` — propagate the new fields.
- `src/engine/valuationCommandCenter/core.ts` — `marketCapFromPrice` and
  `enterpriseValueFromPrice` use `sharesForMarketCap`.
- `src/engine/grahamDoddEPV.ts` — keep using `config.shares_outstanding`
  (which is the per-share value); this is the "Diluted shares outstanding
  (Cr)" comment — correct.
- Extend `src/engine/__tests__/shareCountTools.spec.ts`.

### PR 2: Reinvestment runway (substantive)
- `src/engine/grahamDoddEPV.ts`:
  - Compute `latestROIC = latest.CoreOI / latest.NOA` (RNOA on existing
    book — different from the median used in EPV)
  - Compute `currentSpread = latestROIC - kw`
  - Compute `growthCapex` (already in EPVResult as `growthCapex`)
  - Compute `reinvestmentValue` via the formula in §1.1
  - Add `reinvestmentValue`, `latestROIC`, `currentSpread`, `compounderScore`
    to `EPVResult`
  - Update `interpretation` to include "growth-runway" and "compounder"
  - Add explanation lines
- `src/engine/__tests__/grahamDoddEPV.spec.ts` — extend with the 7 tests
  in §2.2.

---

## 4. Open questions / non-goals

- **What is the moat signal for a hybrid?** A company with positive static
  EPV AND reinvestment runway (e.g. Asian Paints at peak) gets a single
  label. Proposed: `interpretation = "moat-with-growth-runway"`. Decision
  to be confirmed during PR review.
- **Should the reinvestment value feed into the trust envelope's
  valuation-eligible gate?** No — it's a *display* layer / qualitative
  signal, not a per-share value. The per-share value is still RIV, which
  is the poly-paradigm Phase 1's job to make independent of the recast.
- **What about companies with negative static EPV but positive reinvestment
  value?** That's a "compounder" in the strict sense (the market
  under-prices current earnings power but the spread on growth is real).
  We expose both numbers; the user judges.

---

## 5. Why this is the right shape

1. **Doesn't override the Graham-Dodd moat signal** — that signal is
   correct for what it claims to measure (current excess returns on
   existing assets). We add a *separate* signal for what Graham-Dodd
   *doesn't* measure (future excess returns on growth).
2. **The 200 bps durability gate** means a transient spread (1-year
   anomaly) doesn't get a compounder label. Spread must be *material*
   and *sticky* to count.
3. **Both numbers exposed** — a sophisticated user sees static EPV
   (₹6,917), reinvestment value (₹X), reproduction (₹21,374), and
   current ROIC (12.7%) — and can make a defensible call. The
   `interpretation` field is a default summary, not a verdict.
4. **The DMART test (§2.2 #7) is the negative control** — it proves the
   model correctly identifies a *value-destroyer* today, not a
   compounder. That is the most defensible possible answer to a
   reviewer: "DMART's existing assets earn 12.7% vs 13.0% cost of
   capital — currently a destroyer. If you believe that RNOA is
   trough and will recover, the compounder reading can be re-evaluated."
