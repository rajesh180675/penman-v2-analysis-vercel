# Moat Scoring Feature — Code Review & Fixes (COMPLETED)

**Commit Range**: `43ceaa6` → `f3063b3` (feat) → `8a796f1` (fixes)

**Test Status**: All 384 tests pass (65 test files)

---

## Executive Summary

The economic moat scoring feature is well-architected and thoroughly tested. 5 critical issues were identified during review and have all been fixed. `deriveKwFromConfig()` now provides cross-module capital cost per S-9.4C.

---

## Issues Found & Fixed

### [FIXED] FIX-001: `kw` approximation hardcoded in 3 modules
- **Location**: `moatScoring.ts`, `capitalAllocationScoring.ts`, `grahamDoddEPV.ts`
- **Root cause**: `kw = ke * 0.80 + kd_aftertax * 0.20` duplicated exactly across 3 modules
- **Fix**: Extracted `deriveKwFromConfig(config)` in `types.ts` with default fallbacks for `kd_pretax` (0.08) and `tax_rate_for_kd` (0.25)
- **Files changed**: `src/engine/types.ts`, `src/engine/moatScoring.ts`, `src/engine/capitalAllocationScoring.ts`, `src/engine/grahamDoddEPV.ts`

### [FIXED] FIX-002: `scoreReinvestmentQuality` used `Math.abs(dNOA)`
- **Location**: `moatScoring.ts` line 361-364
- **Root cause**: `Math.abs(dNOA)` made shrinking-NOA companies appear to have positive reinvestment even when they were releasing capital
- **Fix**: Changed to signed `dNOA` so negative incremental RNOA is captured when NOA shrinks while earnings grow
- **Files changed**: `src/engine/moatScoring.ts`

### [FIXED] FIX-003: EPV discount rate comment was misleading
- **Location**: `grahamDoddEPV.ts` lines 198-207
- **Root cause**: Comment said "uses ke" but code used `kw`. Justification was garbled.
- **Fix**: Rewrote comment to honestly state: "EPV is traditionally capitalized at ke (Greenwald) ... We use WACC (kw) here to align with the full capital structure visible in recast data."
- **Files changed**: `src/engine/grahamDoddEPV.ts`

### [FIXED] FIX-004: CAP `estimatePhi()` clamped phi to [0, 0.99]
- **Location**: `moatScoring.ts` line 134
- **Root cause**: Mean-reversion was assumed (phi ≥ 0). Negative phi (oscillatory RNOA, e.g., cyclical industries) was hidden by the clamp.
- **Fix**: Remove clamp. Negative phi is now returned. `estimateCAP()` already handles `phi > 0 && phi < 1` guard, falling through to linear extrapolation when phi is outside that range.
- **Files changed**: `src/engine/moatScoring.ts`

### [FIXED] FIX-005: Moat classification thresholds were too generous
- **Location**: `moatScoring.ts` lines 445-450
- **Root cause**: `compositeScore >= 40` + 60% positive SPREAD = "narrow moat" which is a D-grade.
- **Fix**: Tightened to:
  - Wide: compositeScore ≥ 75 AND strong spread in ≥ 70% of periods
  - Narrow: compositeScore ≥ 55 AND positive spread in ≥ 50% of periods
- **Impact**: Tests still pass (wide moat fixture scores ~80, above new 75 threshold)
- **Files changed**: `src/engine/moatScoring.ts`

---

## Remaining Tech Debt (Deferred to Future Session)

| Issue | Priority | Reason |
|-------|----------|--------|
| FIX-006: `makePeriod` test fixture is brittle (~60 hardcoded fields) | Low | Works fine, large refactor for marginal benefit |
| FIX-007: `clamp` and `medianOf` redefined in 4 files | Low | Minor duplication, not affecting correctness |
| FIX-008: Variance calculation inconsistency | Very low | Different denominators don't affect test outcomes |

---

## Change Set Summary

```textnsrc/engine/types.ts                    +10 lines  (deriveKwFromConfig, with defaults)
src/engine/moatScoring.ts              ~-7 lines  (use deriveKwFromConfig, dNOA sign, phi, thresholds)
src/engine/capitalAllocationScoring.ts ~-6 lines  (use deriveKwFromConfig)
src/engine/grahamDoddEPV.ts            ~-9 lines  (use deriveKwFromConfig, fix comment)
```

## Verification

```bash
npm run test -- moatScoring  ✓ 25 passed
npm run test -- capitalAllocation  ✓ 24 passed
npm run test -- all  ✓ 384 passed (65 files)
```

