# Moat Scoring Feature — Code Review & Fixes

**Commit Range**: `43ceaa6` → `f3063b3` (feat: economic moat scoring → V3AnalyticsPanel integration)

---

## Executive Summary

The economic moat scoring feature is well-architected and thoroughly tested, spanning 4 engine modules + UI integration. Tests pass (384/384), but 8 issues were identified ranging from hardcoded triplication to potentially incorrect reinvestment quality scoring.

---

## Issues Found (by priority)

### [CRITICAL] FIX-001: `kw` approximation hardcoded in 3 modules
- **Location**: `moatScoring.ts`, `capitalAllocationScoring.ts`, `grahamDoddEPV.ts`
- **Problem**: `kw = ke * 0.80 + kd_aftertax * 0.20` is duplicated exactly. Any change to capital structure assumptions requires updating all 3 modules.
- **Fix**: Extract to `deriveKwFromConfig(config)` in `types.ts`.

### [HIGH] FIX-002: `scoreReinvestmentQuality` uses `Math.abs(dNOA)`
- **Location**: `moatScoring.ts` line 361-364
- **Problem**: When NOA decreases (e.g., working capital release, asset-light model), `Math.abs(dNOA)` makes this look like positive reinvestment even if the company is shrinking its asset base.
- **Fix**: Use signed `dNOA`. Negative incremental RNOA when NOA decreases is a valid signal.

### [HIGH] FIX-003: EPV discount rate comment is misleading
- **Location**: `grahamDoddEPV.ts` lines 198-207
- **Problem**: The comment says EPV uses `ke` (Greenwald's original), but the code actually uses `kw`. The justification for "conservative" is backwards.
- **Fix**: Either use `ke` (and document) or keep `kw` and fix the comment. Current behavior: uses `kw` which is inconsistent with Greenwald.

### [MEDIUM] FIX-004: CAP `estimatePhi()` clamps phi to [0, 0.99]
- **Location**: `moatScoring.ts` line 134
- **Problem**: Mean-reversion is assumed (phi ≥ 0). Negative phi (oscillatory RNOA, e.g., cyclical industries) is hidden by the clamp.
- **Fix**: Allow phi < 0 and signal it as "oscillatory behavior detected". Fallback to `insufficient-data` method if phi is not in [0, 0.99].

### [MEDIUM] FIX-005: Moat classification thresholds are too generous
- **Location**: `moatScoring.ts` lines 445-450
- **Problem**: 40/100 composite score + 60% positive SPREAD = "narrow moat". A score below 50% should not qualify as a moat.
- **Fix**: Tighten to: Wide ≥ 75 + strong spread 70%; Narrow ≥ 55 + positive spread 50%.

### [LOW] FIX-006: Test fixture `makePeriod` is extremely brittle
- **Location**: `moatScoring.spec.ts` lines 11-100
- **Problem**: Manual ~60-field `RecastPeriod` construction. Any type change breaks everything.
- **Fix**: Export `makeMinimalPeriod()` factory from `test-utils.ts`.

### [LOW] FIX-007: `clamp` and `medianOf` redefined in multiple files
- **Location**: All 4 modules
- **Problem**: Code duplication. `clamp` is identical across all files; `medianOf` has subtle differences.
- **Fix**: Move to shared utils module.

### [LOW] FIX-008: Variance calculation inconsistency (sample vs population)
- **Location**: `moatScoring.ts` line 112 (uses n-1), `capitalAllocationScoring.ts` line 149 (uses n)
- **Fix**: Standardize on sample variance (n-1) everywhere.

---

## File Change Plan

1. `src/engine/types.ts` — add `deriveKwFromConfig()`
2. `src/engine/moatScoring.ts` — replace hardcoded kw, fix dNOA sign, adjust thresholds, fix phi clamp
3. `src/engine/capitalAllocationScoring.ts` — use `deriveKwFromConfig()`
4. `src/engine/grahamDoddEPV.ts` — use `deriveKwFromConfig()`, fix comment
5. `src/engine/__tests__/moatScoring.spec.ts` — use shared makeMinimalPeriod fixture
6. `src/test-utils.ts` — create shared test fixture factory

---

## Test Plan After Fixes

- [ ] All existing tests pass (384)
- [ ] Moat score for wide-moat fixture still ≥ 70
- [ ] Moat score for no-moat fixture still classified as "none"
- [ ] CAP with phi < 0 returns "insufficient-data" method
- [ ] EPV with kw vs ke shows different values (if changed)

