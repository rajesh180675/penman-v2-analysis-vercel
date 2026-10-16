import type { EngineConfig, RecastPeriod } from "../types";

/**
 * Penman's unusual tax items. OI is built top-down (CNI + NFE + MII), so core
 * OI carries the year's whole tax charge, and a one-time tax benefit — a
 * deferred-tax asset recognized, a remeasurement — is filed in the tax line,
 * not as an exceptional item: Airtel FY25 was taxed at 2.4% against 32.5% the
 * year before, and its core OI rose ₹22,616 Cr on ₹23,003 Cr of sales. A year
 * whose filed rate is more than this many points from the median of the three
 * years before it is taxed at that median, and the difference is unusual
 * operating income. The trailing window takes a lasting change in the rate
 * (FY2020's move to 25.17%) as normal after two years.
 */
export const CORE_TAX_RATE_BAND = 0.10;
const NORMAL_TAX_WINDOW = 3;

/** The rate the year's filing gives, before normalization; null where effective mode fell back to statutory. */
export function filedTaxRate(period: RecastPeriod, cfg: EngineConfig): number | null {
  const filed = period.is?.filedTaxRate;
  if (filed !== undefined) return filed;
  // A period built without the field (a fixture, an older snapshot) carries
  // only the rate applied, which was the filed one before normalization.
  const rate = period.is?.taxRate;
  if (rate == null || !Number.isFinite(rate)) return null;
  if (cfg.tax_rate_mode === "effective" && rate === cfg.statutory_tax_rate) return null;
  return rate;
}

/** The median filed rate of the (up to) three years before, or null with none. */
export function normalTaxRate(prior: readonly RecastPeriod[], cfg: EngineConfig): number | null {
  const rates = prior.slice(-NORMAL_TAX_WINDOW)
    .map((p) => filedTaxRate(p, cfg))
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);
  if (!rates.length) return null;
  const m = Math.floor(rates.length / 2);
  return rates.length % 2 === 0 ? (rates[m - 1]! + rates[m]!) / 2 : rates[m]!;
}

export function isUnusualTaxRate(filed: number | null, normal: number | null): normal is number {
  return filed != null && normal != null && Math.abs(filed - normal) > CORE_TAX_RATE_BAND;
}
