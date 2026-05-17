# 10-Company Coverage Status — 2026-05-17

Snapshot of how each company in `public/data/companies/` is expected to flow
through the current engine pipelines. Year coverage comes from the BS column
headers; sector inference comes from engine code understanding (the Python
text-sniff was unreliable because Capitaline's HTML embeds zero-valued
template rows for every line item).

| Company                | Years     | Sector       | Pipeline             | Status |
|------------------------|-----------|--------------|----------------------|--------|
| ITC                    | 2011-2025 | Industrial   | Penman-Nissim + SOTP | ✅ Working — golden test fixture |
| HDFC Bank              | 2011-2025 | Bank         | Bank + valuation B4  | ✅ Working post-B4 |
| ICICI Bank             | 2011-2025 | Bank+subs    | Bank or mixed-financial-conglomerate | ⚠️ Likely fail-closed if insurance/AMC subsidiaries trigger materiality |
| Bajaj Finance          | 2015-2025 | NBFC         | Bank (NBFC subtype)  | ⚠️ Subtype detection needs validation; valuation models reuse bank ones |
| LIC                    | 2019-2025 | Insurance    | Fail-closed          | ✅ Correctly blocked — insurance pipeline not built |
| Reliance Industries    | 2011-2025 | Mixed conglomerate | Industrial (post Jio Financial spin-off) | ⚠️ Mixed-financial-conglomerate detection may fail-close |
| Tata Steel             | 2011-2025 | Cyclical     | Industrial           | ⚠️ Cycle normalization not implemented; ROIC will be peak-biased |
| Power Grid             | 2011-2025 | Regulated utility | Industrial      | ⚠️ Regulated returns not modelled; RAB-based valuation absent |
| TCS                    | 2012-2026 | IT services / asset-light | Industrial | ⚠️ Asset-light franchisePct fix from C12 should kick in; tested |
| Paytm                  | 2020-2025 | Loss-making fintech | Industrial      | 🔴 Will produce NaN or skip across most ratios — robustness gap |

## Verdict by sector

**Working out of the box:**
- ITC (industrial, segment-rich) — golden fixture
- HDFC Bank (private bank) — Phase B4 valuation now produces 3 models

**Working but unverified:**
- TCS, Tata Steel, Power Grid — Penman-Nissim should run; outputs may be misleading without sector-specific normalization
- Bajaj Finance — bank pipeline routes NBFC; metrics like NIM make sense but cost-to-income and CASA don't

**Correctly blocked:**
- LIC — insurance fail-closed is the right behaviour until insurance pipeline exists

**Likely problematic:**
- ICICI Bank — has insurance + AMC subsidiaries; mixed-financial-conglomerate detection may fail-close incorrectly
- Reliance — same risk after Jio Financial spinoff
- Paytm — loss-making across most periods will hit `?? 0` fallthroughs in capital allocation, RNOA, residual income

## Architectural gaps surfaced

Listed in priority order for Phase I (robustness) and beyond:

### 1. Loss-makers and turnaround stories (Paytm)

Current engine assumes positive RNOA, positive book value, positive earnings.
A loss-making period silently produces:
- ROE returning negative without skip-with-reason
- Capital allocation ROIC computed off `cni ?? 0` (`capitalAllocationScoring.ts:444`)
- Residual income compounding negative spreads with no convergence guard
- DDM/EPV would refuse to run but iROIC/moat would still produce a number

Fix scope: add explicit `lossMakingPeriod` flag at recast time; gate downstream
modules (moat, capalloc, EPV) on minimum-positive-history threshold; document
which models skip-with-reason.

### 2. Mixed-financial-conglomerate over-blocking (ICICI, Reliance)

`scopePolicy.ts` after C4 fail-closes any company with bank/NBFC AND material
insurance/AMC subsidiaries. ICICI Bank has ICICI Lombard, ICICI Prudential,
ICICI AMC. Reliance has Jio Financial Services historically.

Both are LEGITIMATELY analysable as banks with consolidation adjustments,
but the current logic refuses. Need:
- A `dominant-segment` detection that allows analysis when the parent
  business contributes ≥80% of revenue/PAT
- An override flag the user can set
- Better materiality thresholds tuned to real Indian financial-conglomerate data

### 3. Regulated utility valuation (Power Grid)

ROE-as-headline-driver framework misleads for regulated utilities where
returns are RBI/CERC-capped. Need:
- Regulated Asset Base (RAB) recognition: PPE + capex backlog
- Tariff-regulated equity return: 14% post-tax cap on AGGR
- DCF normalised to allowed return rather than historical ROE

Marked LOW priority — Power Grid is one company; framework can wait.

### 4. Cyclical normalization (Tata Steel)

Mid-cycle margin and trough-cycle ROIC absent. Current engine treats latest
period as steady-state. Tata Steel FY2022 had EBITDA margin >25%; FY2024 fell
to 8%. Naive Penman-Nissim valuation snaps to whichever period is latest.

Fix: peak-trough span detection on EBITDA margin → flag latest-period ROE/RNOA
as cyclical and provide median-of-cycle alternative.

### 5. Asset-light services (TCS — already partially handled)

C12 in the code review fixed the asset-light franchisePct issue in EPV.
TCS should run cleanly. Validation pending against the actual TCS file.

## Action items before declaring "works for all sectors"

In priority order:

1. **Phase I robustness pass** — loss-makers (Paytm) and edge cases. Add
   explicit skip-with-reason to all valuation/scoring modules. Audit every
   `?? 0` in valuation math.
2. **Mixed-conglomerate routing fix** — let ICICI Bank and Reliance flow
   through their dominant-business pipeline with consolidation flag rather
   than fail-closing.
3. **Wire Phase B4 valuation into UI** — `bankResult.valuation` is computed
   but no component renders it. HDFC Bank user sees no output.
4. **NBFC validation on Bajaj Finance** — confirm subtype detection;
   replace bank-only ratios (CASA, cost-to-income, NIM-on-deposits) with
   NBFC-appropriate equivalents (cost-to-AUM, NIM-on-AUM).
5. **Cyclical detection flag** — Tata Steel will visibly mislead users
   until peak-trough alerts exist.

Power Grid (RAB model) and full insurance pipeline (LIC) are deferred —
they're each company-of-one investments with high architectural cost.

## Conclusion

Data coverage is **architecturally sufficient**. The 10 companies span every
distinct pipeline shape Indian markets need (industrial, conglomerate, bank,
NBFC, insurance, cyclical, regulated utility, IT services, loss-maker).
Adding more companies in the same sectors won't expose new engine gaps.

The remaining work is engine breadth, not data breadth.
