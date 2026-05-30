import type { BankValuationModelResult } from "./types";

/** Long-run ROE that any bank's ROE fades toward in residual-income terminal. */
export const LONG_RUN_BANK_ROE = 0.13;

/** Long-run ROA the typical NBFC mean-reverts to. Bajaj historically prints 3-5%
 *  but the broader NBFC universe (gold, microfinance, vehicle, housing) is
 *  closer to 2.5%. Used in the ROA × Leverage RI decomposition. */
export const LONG_RUN_NBFC_ROA = 0.025;

/** Long-run leverage that a regulated NBFC mean-reverts to. RBI Scale-Based
 *  Regulation places gearing limits between 4x (NBFC-UL) and 7x (NBFC-BL).
 *  5x is a defensible mid-cycle anchor across the industry. */
export const LONG_RUN_NBFC_LEVERAGE = 5.0;

/** Typical earnings multiple applied to NBFC ROA when expressing AUM as
 *  market value. AUM × ROA gives normalized PAT; PAT × P/E gives equity
 *  value. So fair P/AUM ≈ ROA × P/E. We use 12x as the through-cycle
 *  Indian NBFC P/E anchor (slightly below the broader Nifty 50 multiple
 *  to reflect cyclicality of credit). */
export const NBFC_PAUM_PE_MULTIPLIER = 12;

/** RBI minimum CRAR for NBFC-Upper Layer. NBFC-Middle Layer is 15% too;
 *  NBFC-Base Layer follows the same baseline. Source: RBI Master Direction
 *  on Scale Based Regulation (October 2022). */
export const NBFC_MIN_CRAR_PCT = 15;

/** Buffer above the regulatory CRAR floor below which growth must
 *  throttle. NBFC-UL guidelines effectively require 200-300bps headroom
 *  to absorb stress. We use 300bps to be conservative — at headroom <
 *  300bps the model penalises g. */
export const NBFC_CRAR_BUFFER_BPS = 300;

// ── ECL Stress Governor thresholds ──────────────────────────────────────────
// Calibrated against Indian NBFC distress episodes:
//   - Bajaj/Chola/Sundaram (healthy): uncovered < 1%
//   - Vehicle-finance mild stress: uncovered 2-3%
//   - DHFL FY18, IL&FS subsidiaries: uncovered 5-8%
//   - Microfinance crisis (FY16 demonetization): uncovered 8-12%
//   - Pre-IBC severe distress (DHFL FY19): uncovered > 10%
//
// Two-segment linear fade:
//   [0, WARNING)     → factor 1.0 (no fade)
//   [WARNING, MID)   → linear 1.0 → MID_FACTOR
//   [MID, DISTRESS)  → linear MID_FACTOR → MIN_FACTOR
//   [DISTRESS, ∞)    → factor MIN_FACTOR (floor)

/** Below this uncovered-stress %, no fade is applied. */
export const NBFC_ECL_STRESS_WARNING_PCT = 2.0;
/** Breakpoint between the two linear fade segments. */
export const NBFC_ECL_STRESS_MID_PCT = 5.0;
/** Above this, maximum fade applies (floor factor). */
export const NBFC_ECL_STRESS_DISTRESS_PCT = 10.0;
/** Fade factor at the mid-point breakpoint. */
export const NBFC_ECL_STRESS_MID_FACTOR = 0.50;
/** Floor fade factor at distress — franchise residual value. Even at 100%
 *  wipe-out of the uncovered book, the origination engine, customer base,
 *  and operational infrastructure retain ~25% of book value. This is the
 *  same logic Indian distress investors use when bidding for IBC NBFCs. */
export const NBFC_ECL_STRESS_MIN_FACTOR = 0.25;

/** Default terminal growth: India long-run nominal GDP growth proxy. */
export const DEFAULT_TERMINAL_GROWTH = 0.05;

/** Margin between ke and g for the no-blow-up gate. ke must exceed g by this. */
export const MIN_KE_MINUS_G = 0.01;

// ─── Helpers ────────────────────────────────────────────────────────────────

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function skipped(reason: string, diagnostics: Record<string, number | null> = {}): BankValuationModelResult {
  return { status: "skipped", intrinsicValue: null, premiumOverMarket: null, reason, diagnostics };
}

export function computed(intrinsicValue: number, reason: string, diagnostics: Record<string, number | null>, marketCap: number | null): BankValuationModelResult {
  const premiumOverMarket = marketCap != null && marketCap > 0
    ? intrinsicValue / marketCap - 1
    : null;
  return { status: "computed", intrinsicValue, premiumOverMarket, reason, diagnostics };
}
