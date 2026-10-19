import type { EngineConfig, RecastPeriod } from "../types";

/**
 * Penman's unusual tax items. OI is built top-down (CNI + NFE + MII), so core
 * OI carries the year's whole tax charge, and a one-time tax benefit — a
 * deferred-tax asset recognized, a remeasurement — is filed in the tax line,
 * not as an exceptional item: Airtel FY25 was taxed at 2.4% against 32.5% the
 * year before, and its core OI rose ₹22,616 Cr on ₹23,003 Cr of sales. A year
 * whose filed rate is more than this many points below the median of the three
 * years before it is taxed at that median, and the difference is unusual
 * operating income. The trailing window takes a lasting change in the rate
 * (FY2020's move to 25.17%) as normal after two years.
 *
 * Only a benefit is unusual. A rate far above normal comes from losses the
 * group cannot relieve or charges the tax code disallows, and those recur:
 * taxing such years at the normal rate too made the walk-forward's core-margin
 * forecast worse wherever one was scored (Power Grid FY2018 3.9 → 15.6 points
 * of sales, Tata Steel FY2019 4.3 → 7.5), and the median one-year margin skill
 * fell from 28.6% (no normalization) to 21.6%. Benefits alone: 27.7%, with
 * RNOA and CNI errors lower than either at every horizon.
 */
export const CORE_TAX_RATE_BAND = 0.10;
export const NORMAL_TAX_WINDOW = 3;

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

/**
 * The normal rate the recast taxes a year at, or null where it keeps the filed
 * rate. A regulated utility's tax is passed through its tariff: the deferred
 * tax it recovers from beneficiaries is filed below PAT (Ind AS 114 regulatory
 * deferral, Capitaline's "Extraordinary Items After Tax"), and core OI carries
 * both, so its rate swings cancel there (Power Grid FY2018: deferred tax
 * ₹3,069 Cr, recovered ₹3,284 Cr). Normalizing the tax side alone broke that:
 * Power Grid's one-year margin forecast error rose from 4.1 to 5.7 points of
 * sales, NTPC's from 1.1 to 1.4.
 */
export function recastNormalTaxRate(prior: readonly RecastPeriod[], cfg: EngineConfig): number | null {
  return cfg.company_type === "utility" ? null : normalTaxRate(prior, cfg);
}

/**
 * A loss year that books no tax has no tax shield to give, so its financing
 * and unusual items are taxed at its marginal rate, nil (Penman), not the
 * statutory rate. Across the library, every loss year either books a tax
 * within 2.8% of the loss (Paytm's nine, Vodafone Idea FY2021–25) or a credit
 * or charge of 19.5% or more (Airtel, Tata Steel, Idea FY2017–20: a deferred-
 * tax asset recognized or written off), so the band leaves room on both sides.
 * At 25.17%, Idea's ₹17,900–25,700 Cr of yearly net financing cost carried a
 * shield of ₹4,500–6,500 Cr it never received, and core OI absorbed it: FY2025
 * core margin −22.4% where nil gives −8.8%. Paytm's net financial income was
 * taxed the same way, up to ₹135 Cr a year.
 */
export function isUntaxedLoss(profitBeforeTax: number | null | undefined, taxExpense: number | null | undefined): boolean {
  return profitBeforeTax != null && taxExpense != null && profitBeforeTax < 0 && Math.abs(taxExpense) <= CORE_TAX_RATE_BAND * -profitBeforeTax;
}

export function isUnusualTaxRate(filed: number | null, normal: number | null): normal is number {
  return filed != null && normal != null && filed < normal - CORE_TAX_RATE_BAND;
}
