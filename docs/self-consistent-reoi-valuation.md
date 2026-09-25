# Self-consistent ReOI fade valuation (`2026-09-scv-v1`)

Module: `src/engine/selfConsistentValuation/` · Catalog id: `industrial.self-consistent-reoi-fade` (experimental) · UI: Valuation tab, below the triangulation table.

## Why it exists

Two defects surfaced in the September 2026 review motivated an independent model rather than another patch on the shared forecast path:

1. **Valuation dating.** `computeValuation` treats `periods[0]` as the valuation date. Several surfaces passed raw history, valuing the company as of its *oldest* balance sheet and comparing that with today's price. Fixed separately (`buildAnchoredValuationPeriods`); this model is latest-anchored by construction.
2. **Book-weighted kw.** `deriveKwFromStructure` computes `kw = ke·(CSE+MI)/NOA + kd·NFO/NOA` on *book* weights. For a firm with P/B ≫ 1 and a large net-cash position that loads several times its equity onto a small operating base: ITC's book weights give kw ≈ 25–30%, and its RE and ReOI valuations disagreed by ~60% on the same forecast (the PVRE disagreement gate now reports this).

## Model

Anchor: latest NOA₀, NFO₀, MI₀.

**Fade (Nissim & Penman 2001).** The spread of core RNOA over kw starts at today's level (mean of the last two core RNOAs) and decays geometrically:

```
ReOI_t = s₀ · ω^(t−1) · NOA_(t−1)
CV_N   = s₀ · ω^N · NOA_N / (1 + kw − ω(1+g))          (persistence form)
V_op   = NOA₀ + Σ_{t=1..N} ReOI_t/(1+kw)^t + CV_N/(1+kw)^N
V_E    = V_op − NFO₀ − MI₀
```

NOA growth fades from its recent median (last three years, clamped to −10%…30%) toward g at 0.7 a year. Horizon N = 10.

**Persistence ω.** AR(1) on core RNOA, then:

- Kendall (1954) small-sample bias correction, `φ = (nφ̂ + 1)/(n − 3)`: OLS AR(1) is biased down by ≈ (1+3φ)/n, large on 8–15 annual points;
- estimated on the window after the last pipeline-detected structural break when ≥ 4 points follow it (a merger steps NOA, which AR(1) reads as low persistence — HUL's 2021 break);
- shrunk toward a 0.7 prior with 5 pseudo-observations; bounded 0.3–0.92. Fewer than 3 points → prior.

**kw on value weights, solved jointly.** Modigliani–Miller: the equity cost is the value-weighted blend of the operating and financing costs, so

```
kw = (ke·(V_E + MI) + kd·NFO) / V_op
```

V_E depends on kw and kw on V_E; the pair is solved by damped (½) fixed-point iteration from the book-weighted start (tolerance 1e-7, ≤ 200 iterations). kd is the reported after-tax NFE/NFO (signed, so a net-cash firm's yield is positive) when it lies in 0–20%, otherwise the configured after-tax cost of debt.

**Fails closed** (status `skipped`, with a reason) on: fewer than two periods; ke − g < 0.5pp; NOA ≤ 0; no finite continuing value; non-positive equity or operating value at any iterate; non-convergence.

## Outputs

Equity value and per share, margin of safety, kw (value-weighted, book-weighted, market-weighted when priced), kd and its source, ω with its raw estimate and source, a value build (NOA + PV explicit ReOI + PV post-horizon ReOI − NFO − MI), a 3×3 ke × ω sensitivity (kw re-solved per cell), and the **market-implied ω**: the persistence that makes V_E equal market cap, or an explicit statement that none up to 0.98 does.

## Validation run (2026-09-25, packs pinned that day, g = 4%)

| Company | kw book | kw value-weighted | ω (raw → used) |
|---|---|---|---|
| Asian Paints | 13.4% | 13.0% | 0.45 → 0.69 |
| Hindustan Unilever | 15.5% | 14.6% | 0.74 on the 4 post-2021-break years → 0.72 |
| ITC | 24.9% | 19.1% | 0.37 → 0.62 |
| Infosys | 17.6% | 14.9% | 0.81 → 0.90 |
| Larsen & Toubro | 13.9% | 13.9% | 0.45 → 0.69 |
| Maruti Suzuki | 43.6% | 28.1% | 0.71 → 0.90 |

HUL was run with its pipeline-detected structural breaks; the other rows without break periods (the Valuation tab passes them, so their ω can differ where the pipeline detects a break). Every company converged (9–36 iterations). Net-debt firms (L&T) barely move, as they should — their book and value weights are close. Cash-rich, high-P/B firms move most.

Values are **conservative by design**: abnormal returns fade toward zero spread (competitive equilibrium), so durable franchises price well above the model. The market-implied ω is the intended reading — how much more persistent than its own history the market needs the spread to be.

## Status

Experimental: rendered on the Valuation tab, excluded from the headline synthesis until its value-weighted kw has been compared against the book-weighted kw across the full audit corpus.
