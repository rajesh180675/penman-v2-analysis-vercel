/**
 * "What would change our mind": for the base scenario's key drivers, the value
 * at which the base-case intrinsic value equals the market price.
 *
 * Each driver is moved on its own, everything else held: a parallel shift of
 * the whole sales-growth or core-margin path, or a different cost of equity
 * (with kw following structurally, S-9.4C). The base card is re-valued along
 * EXACTLY the path behind the value it displays — buildScenarioCards' forecast
 * and valuation, then normalizeScenarioCards' primary per-share value (the
 * RE/ReOI median; the owner-earnings DCF is not part of the displayed value) —
 * so with no shift this reproduces the card's intrinsic value, which the tests
 * pin.
 */
import { buildScenario, buildValuationPeriodsFromForecast } from "../forecastingEngine";
import { computeValuation } from "../PenmanNissimEngine";
import { structuralKwForKe } from "../pvre/pvreEngine";
import type { ForecastScenario } from "../types";
import { primaryValuationPerShare } from "./helpers";
import type { ValuationCommandCenterOutput } from "./types";

export type BreakEvenDriver = "sales_growth" | "core_sales_pm" | "ke";

export interface BreakEvenResult {
  readonly driver: BreakEvenDriver;
  /** The base case's value: year-1 sales growth / core margin, or ke. */
  readonly base: number;
  /** The driver value at which base-case value = price, in the same terms as `base`. */
  readonly breakEven: number | null;
  /** Why `breakEven` is null. */
  readonly reason: "no-price" | "no-base-value" | "beyond-range" | null;
}

/** How far each driver is searched from its base value. */
const SEARCH = {
  sales_growth: { lo: -0.25, hi: 0.25 },
  core_sales_pm: { lo: -0.25, hi: 0.25 },
  ke: { lo: -0.06, hi: 0.15 },
} as const;

type CommandCenterLike = Pick<ValuationCommandCenterOutput, "scenarios" | "anchorPeriod" | "shareBasis" | "marketPrice">;

/** Base-case intrinsic value per share with one driver shifted by `delta`. */
export function baseValueWithShift(cc: CommandCenterLike, driver: BreakEvenDriver, delta: number): number | null {
  const card = cc.scenarios.find((s) => s.key === "base");
  if (!card?.scenario?.drivers) return null;
  const latest = cc.anchorPeriod;
  const d = card.scenario.drivers;
  const g = card.assumptions.g;
  const ke = driver === "ke" ? d.ke + delta : d.ke;
  const kw = driver === "ke" ? structuralKwForKe(ke, { ke: d.ke, kw: d.kw }, latest) : d.kw;
  if (!(ke - g > 0.005) || !(kw - g > 0.005)) return null;
  const scenario: ForecastScenario = {
    ...card.scenario,
    drivers: {
      ...d,
      sales_growth: driver === "sales_growth" ? d.sales_growth.map((v) => v + delta) : d.sales_growth,
      core_sales_pm: driver === "core_sales_pm" ? d.core_sales_pm.map((v) => v + delta) : d.core_sales_pm,
      ke,
      kw,
    },
  };
  try {
    const periods = buildScenario(scenario, latest);
    // Anchored at `latest`: the valuation date is the anchor period, as in buildScenarioCards.
    const valuation = computeValuation(buildValuationPeriodsFromForecast(latest, periods), ke, kw, g, cc.shareBasis.valuationConfig);
    const value = primaryValuationPerShare(valuation);
    return value != null && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function baseDriverValue(cc: CommandCenterLike, driver: BreakEvenDriver): number | null {
  const d = cc.scenarios.find((s) => s.key === "base")?.scenario?.drivers;
  if (!d) return null;
  return driver === "ke" ? d.ke : driver === "sales_growth" ? d.sales_growth[0] ?? null : d.core_sales_pm[0] ?? null;
}

/** Break-even for one driver, by bisection on the shift. */
export function solveBreakEven(cc: CommandCenterLike, driver: BreakEvenDriver): BreakEvenResult {
  const base = baseDriverValue(cc, driver) ?? Number.NaN;
  const price = cc.marketPrice;
  if (price == null || !(price > 0)) return { driver, base, breakEven: null, reason: "no-price" };
  if (baseValueWithShift(cc, driver, 0) == null) return { driver, base, breakEven: null, reason: "no-base-value" };

  const gap = (delta: number) => {
    const value = baseValueWithShift(cc, driver, delta);
    return value == null ? null : value - price;
  };
  let lo: number = SEARCH[driver].lo;
  let hi: number = SEARCH[driver].hi;
  let gLo = gap(lo);
  let gHi = gap(hi);
  // Pull an invalid end (e.g. ke at or below terminal growth) in towards zero.
  for (let i = 0; i < 20 && gLo == null; i++) { lo /= 2; gLo = gap(lo); }
  for (let i = 0; i < 20 && gHi == null; i++) { hi /= 2; gHi = gap(hi); }
  if (gLo == null || gHi == null || Math.sign(gLo) === Math.sign(gHi)) {
    return { driver, base, breakEven: null, reason: "beyond-range" };
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const gMid = gap(mid);
    if (gMid == null) break;
    if (Math.sign(gMid) === Math.sign(gLo)) { lo = mid; gLo = gMid; } else { hi = mid; }
  }
  return { driver, base, breakEven: base + (lo + hi) / 2, reason: null };
}

export function solveBreakEvens(cc: CommandCenterLike): BreakEvenResult[] {
  return (["sales_growth", "core_sales_pm", "ke"] as const).map((driver) => solveBreakEven(cc, driver));
}
