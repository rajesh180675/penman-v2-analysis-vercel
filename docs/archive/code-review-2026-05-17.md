# Code Review — 2026-05-17

Range: `d3e52038ee5091501badd1704297a1587a3673c7..HEAD` (18 commits, 32 files, +6404/-33)

Reviewed surfaces:
- Bank/NBFC pipeline (`bankPipeline.ts`, `scopePolicy.ts`, `scopeDetection.ts`)
- Scope-aware loader (consolidated + standalone alignment)
- Segment parser + SOTP bridge + Monte Carlo segment integration
- Four valuation modules: moat, capital allocation, Graham-Dodd EPV, relative valuation
- Mapping spec expansion 234 → 380 labels
- AR(1) phi wired into Ohlson reversion CV
- V3AnalyticsPanel surfaces

Build status at review time: TypeScript clean except 2 unused-var warnings (`ke` declared and never read in `capitalAllocationScoring.ts:452` and `grahamDoddEPV.ts:201`). 384/384 tests pass.

---

## CRITICAL — fix before next deploy

### C1. `bankPipeline.ts:76,82,86` — `pickValue` rejects legitimate zeros
```ts
if (val != null && Number.isFinite(val) && val !== 0) return val;
```
A clean year with zero provisions or zero borrowings looks "missing" → `creditCost = null` instead of `0%`. Drop the `val !== 0` filter; only reject `null/undefined/NaN`.

### C2. `bankPipeline.ts:72-87` — cross-statement leakage when statement is supplied
After the explicit-statement attempt fails, the code falls through to `["BalanceSheet","ProfitLoss","CashFlow"]` for the SAME alias. Aliases like `Other Income` and `Total Investments` exist in multiple statements with different semantics. Guard the all-statements loop behind an explicit `tryAllStatements` flag.

### C3. `bankPipeline.ts:175-178` — NIM denominator inflates when one component is null
```ts
const earningAssets = avg(
  sum(current.advances, current.investments),
  sum(prev.advances,    prev.investments),
);
```
`sum(a,b)` returns `(a ?? 0) + (b ?? 0)`. If `investments` is null in a period, NIM is computed against advances alone — overstates NIM by 20-30%. Make `sum` return null when any required component is null for the NIM denominator.

### C4. `scopePolicy.ts:159` — insurance escapes the block when bank/NBFC signals coexist
```ts
if (isInsurance && !isBank && !isNbfc) return blocked;
```
For HDFC Group consolidated (bank + insurance + NBFC), insurance signals silently disappear into the bank pipeline. Add a "mixed-financial-conglomerate" classification or insurance materiality check.

### C5. `pipeline.ts:46` — fail-OPEN on blocked scope
Insurance-only datasets have `family === "financial-institution"` AND `scope.blocked === true`, but the bank dispatch only checks `family`. Execution falls through to industrial Penman-Nissim recast → produces a valuation result for an unsupported scope. Project rule is fail-closed. Add explicit branch: if `family === "financial-institution" && scope.blocked` return inert result with structured reason.

### C6. `capitalAllocationScoring.ts:269-271` — sign bug parallel to the moat fix in 8a796f1
```ts
iROIC = dNOPAT / Math.abs(dNOA);
```
Moat was fixed to use signed dNOA; capalloc still uses `Math.abs`. Same firm gets opposite-sign iROIC across the two modules in divestment years. Fix to match moat.

### C7. `moatScoring.ts:124-178, 600` — phi NOT clamped to [0, 0.95]
`estimatePhi` explicitly says "we do not clamp here". `estimateCAP` only gates `phi > 0 && phi < 1`. Phi=0.99 produces 5–10× overstated CAP. Bank moat (line 600) reuses unbounded phi. Add a `clampPhi` helper called inside `estimateCAP` and at the bank-moat call site.

### C8. `v3Analytics.ts:1942-1952` — moat/capalloc/EPV/relval bypass structural kw
Pipeline derives kw structurally via `deriveKwFromStructure` and registers `kw_derived_latest`. But the four valuation modules are called with raw `cfg`, where each re-derives kw via `deriveKwFromConfig` (80/20 fallback). The kw used by these modules is NOT the kw used by the rest of the pipeline. Violates S-9.4C single-source-of-truth. Pass derived kw as override or augment cloned cfg.

### C9. `v3Analytics.ts:1881-1897` — Ohlson reversion CV uses PM persistence as RE persistence proxy
Ohlson (1995) is defined on the abnormal earnings (RE) series. Code substitutes phi from PM AR(1) regression. PM and RE persistence are not interchangeable — a stable margin coexists with declining RE when CSE grows. Estimate phi directly on the RE series (N≥10) or document explicitly as a known approximation.

### C10. `v3Analytics.ts:1887` — dead conditional masquerading as gating
```ts
phi_effective = pmFade?.source === "COMPANY_SPECIFIC" ? pmFade.phi : (pmFade?.phi ?? 0.87)
```
Both branches return the same value when pmFade exists. Intent (only use phi when company-specific OLS fit succeeded) is silently broken; NP_DEFAULT runs with `phi_source = "NP_DEFAULT"` written to registry but the model treats it as company-specific. Either branch on source to fall back to Gordon Growth, or surface the source as a UI badge.

### C11. `v3Analytics.ts:1891-1954` — `V_RE_ohlson_reversion` computed but never returned
Written to registry but not included in returned bundle. V3AnalyticsPanel has no field for it. The phi-driven terminal value never reaches the user. If commit 4ae5ffb's intent is to give reviewers an alternative to Gordon Growth CV, surface it in the bundle and OverviewSection.

### C12. `grahamDoddEPV.ts:213, 223-228` — asset-light and negative-EPV paths misclassify
```ts
franchisePct = V_A > 0 ? franchiseValue / V_EPV : 0;
```
When `latestNOA ≤ 0` (services, brokerages, asset-light franchisors), franchisePct silently becomes 0 → "competitive" regardless of actual moat strength. `marginOfSafety` and `priceToEPV` flip sign when V_EPV < 0. Guard V_EPV ≤ 0 explicitly; surface a "negative EPV" status rather than nonsense ratios.

---

## WARNINGS

### bankPipeline
- **W1** `detectSubtype` is order-dependent (`kinds.has("banking")` before `"nbfc"`) — NBFCs holding banking-business investments get misclassified as banks
- **W7** NII has no sign sanity check — sign-flipped raw data produces negative NII silently
- **W8** c/i ratio outside `prev` guard — works but undocumented why

### scopeDetection / scopeAwareLoader
- **W2** keyword fallback false-positives on "the consolidated entity" in disclaimers — restrict to `<title>` or first 4KB
- **W3** single brittle header regex — no handling of `&#62;` or reordered tokens
- **W4** `safePct` misleads on negative consolidated values — loss-year subsidiary contribution is meaningless as a percentage
- **W5** `computeTrend` uses half-vs-half averages — single recent outlier reads as "trend"; use linear regression slope
- **W6** alphabetical period sort assumes ISO-8601 — breaks if quarterly data uses "Q1 FY25"

### Valuation modules
- **W1** doc/code drift on moat width: header says "wide ≥7 years SPREAD>5%, narrow ≥4 years SPREAD>0", actual code uses 75/55 cutoffs with no minimum-period rule
- **W2** buyback quality: only flags net issuance (>1.1×), not gross; SPREAD-null periods stay neutral 50; median hides single disastrous years
- **W3** relative valuation filters loss years out of historical bands — cyclicals look cleaner than reality
- **W4** "historical multiples" use CURRENT marketCap with historical fundamentals — they're implied multiples, not historical. Variable should be `peImpliedSeries`
- **W5** EPV mixes Greenwald methodology — uses (NOPAT/kw)−NOA instead of (NOPAT/ke)−bookEquity; dimensionally inconsistent
- **W6** bank EPV recomputes ROE instead of consuming bankPipeline's cycle-adjusted bm.roe
- **W7** two scoring frameworks disagree at iROIC=kw (moat ~40, capalloc ~50) — pick one
- **W8** FCF conversion floored to [20,100] not [0,100] due to `+20` constant
- **W10** bank moat ROE-ke threshold reuses 0.05 from RNOA-kw — banks have wider gradient, may under-discriminate
- **W11** NaN propagation through `?? 0` defaults — `??` doesn't catch NaN, only null/undefined

### Segment / Monte Carlo
- **W1** segmentParser td filter admits empty strings — leading layout cells shift years by one column
- **W2** `monteCarloTypes:182` uses population variance (`/n`) not sample (`/(n-1)`) — under-disperses with N=3-5
- **W3** only-positive EBIT filter biases share variance — loss-period volatility never enters std estimate
- **W4** SOTP MC perturbs only operatingProfitShare + ke; RE/ReOI perturbs ke+kw+g — SOTP confidence band looks artificially tight
- **W5** `segmentSOTPBridge:192-194` floors negative segment CAGR at 2% silently — declining segments inflate value
- **W6** `segmentAssets` stored on EnhancedSOTPResult but never consumed by `buildSOTPValuation`
- **W7** share draws have no upper clamp — runaway draw on dominant segment crowds others to ~0
- **W8** segment detection requires uppercase — mixed-case segment files silently dropped

---

## SUGGESTIONS

- `types.ts:726-727` `kd_pretax ?? 0.08` and `tax_rate_for_kd ?? 0.25` are unreachable (non-optional fields) — drop the `??` to surface real bugs
- Remove unused `ke` declarations at `capitalAllocationScoring.ts:452` and `grahamDoddEPV.ts:201` (TS6133 build warnings)
- Externalize moat magic numbers (0.15, 0.10, 0.20, 0.05, 75/55 cutoffs, 70%/50%) into EngineConfig
- Provide both `V_EPV_kw` (current) and `V_EPV_ke` (Greenwald) so EPV reviewers can audit both
- Rename `peSeries` → `peImpliedSeries` in relativeValuation.ts to reflect actual semantics
- Add `confidence` field to scopeDetection (`"header-match" | "fallback-keyword" | "unknown"`)
- Externalize `NP_2001_PHI_PM_DEFAULT` (0.87) — currently hardcoded twice
- Move SOTP subsidiary-consistency threshold (20pp) into EngineConfig
- Surface MC convergence on all three series (RE/ReOI/SOTP), report worst — currently RE-only
- Add regression test that replays same period stream through moat and capalloc, asserts iROIC sign consistency
- Tests missing for: phi > 0.95, V_EPV ≤ 0 path, latestNOA ≤ 0 path, relative valuation with negative-PAT year
- bankPipeline.spec.ts: 4 tests, none verify NIM/ROA/ROE/credit-cost numeric outputs
- Tiered minimum-period rule for moat width: wide ≥7, narrow ≥4 — matches doc header
- bankPipeline `casaRatio` declared but never populated — wire it or remove

---

## LOOKS GOOD

- `deriveKwFromConfig` correctly imported in moat / capalloc / EPV at module level (integration-level slip is C8)
- Division-by-zero guards on dNOA (`Math.abs(dNOA) > 1`) consistent across moat and capalloc
- `estimatePhi` zero-variance guard at `moatScoring.ts:133`
- CAP early return when SPREAD ≤ 0
- EPV tax-rate clamp [0.15, 0.40] appropriate for India
- Trim-tails for ≥7 observations is robust normalization
- Period sorting in moat/relval prevents off-by-one
- Composite scores correctly clamped to [0,100]
- `bankPipeline` structural separation: extraction → ratios → result. Clean.
- `scopeDetection` handles both `>` and `&gt;` via `(?:&gt;|>)`
- `scopePolicy` composite-key parsing (`lastIndexOf("__")`) handles labels containing underscores
- `segmentParser.parseNumber` handles all 3 Capitaline conventions: comma thousands, parenthesized negatives, "-" as null
- `segmentParser.yearFromYYYMM` correctly applies Indian FY calendar
- `segmentParser` cycle-counter section assignment matches Capitaline export structure
- `segmentSOTPBridge` EBIT-share excludes loss-makers from SOTP definitions but keeps them in segmentTimeSeries
- `monteCarloWorker` normalization keeps perturbed shares summing to 1.0 each iteration
- `monteCarloWorker.runSOTP` gates on both definitions and uncertainties non-empty
- V3AnalyticsPanel: all four new tab surfaces have typed null-state guards
- Test coverage of <3 periods, weight-sum, structural invariants is consistent across moat/capalloc/EPV/relval specs
- 384/384 tests pass

---

## VERDICT

The architecture is sound and well-tested at the unit level — the bank pipeline, segment parser, and four valuation modules each ship with focused specs. But integration-level rigor needs work:

1. Fail-closed gating is broken in two places (insurance fallthrough, pickValue zero filter)
2. Capital-cost consistency (S-9.4C) is broken for the four valuation modules
3. Phi clamp is missing across moat/CAP/bank
4. Phi proxy in Ohlson CV is mis-stated as company-specific when it's not
5. EPV degrades silently for asset-light and negative-margin firms
6. Sign-convention drift (iROIC abs() in capalloc) parallels a bug already fixed in moat

### Priority order to fix
1. Bank `pickValue` zero filter + cross-statement leakage (C1, C2)
2. Insurance fail-closed (C4, C5)
3. iROIC sign in capalloc to match moat (C6)
4. Phi clamp helper used everywhere (C7)
5. Pass structural kw into the four valuation modules (C8)
6. Phi proxy: either compute on RE series or document, and either fix the dead-branch gate or add a UI badge (C9, C10)
7. Surface V_RE_ohlson_reversion in the bundle (C11)
8. EPV asset-light + negative-V_EPV guards (C12)
