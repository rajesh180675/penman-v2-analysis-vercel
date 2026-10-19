import { isUnusualTaxRate, NORMAL_TAX_WINDOW } from "../PenmanNissimEngine/unusualTax";
import { DEFAULT_CONFIG } from "../types";

/** The lines of one year's results filing a core operating income is built from (₹ crore). */
export interface FiledIncomeLines {
  readonly revenue: number | null;
  /** Total expenses, finance costs included. */
  readonly expenses?: number | null | undefined;
  readonly financeCosts?: number | null | undefined;
  readonly profitBeforeTax?: number | null | undefined;
  readonly taxExpense?: number | null | undefined;
  readonly regulatoryDeferralMovement?: number | null | undefined;
}

/** The effective rate where the recast takes it (recast.ts: 1%–55% of a positive profit before tax), else null. */
function effectiveRate(year: FiledIncomeLines): number | null {
  const { profitBeforeTax: pbt, taxExpense: tax } = year;
  if (pbt == null || pbt <= 0 || tax == null) return null;
  const rate = tax / pbt;
  return rate > 0.01 && rate < 0.55 ? rate : null;
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : null;
};

/**
 * Core operating income after tax for each filed year (oldest first), on the
 * recast's rules as far as a results filing allows, so a forecast's margin can
 * be followed in its company's filings.
 *
 * - Revenue less expenses other than finance costs: other income, exceptional
 *   items and associates' share are left out, as the filing's own totals do.
 * - Taxed as the recast's top-down OI (CNI + NFE + MII) is: the items left
 *   out carry tax at the effective rate, or at the statutory rate where the
 *   recast would not take the effective one (a loss, a tax credit, a rate
 *   outside 1%–55%), and core operating income keeps the rest of the year's
 *   tax charge. A benefit more than 10 points below the median of the three
 *   filed rates before it is unusual, as the recast takes it (unusualTax.ts):
 *   that year is taxed at the median throughout.
 * - A rate-regulated entity's net movement in regulatory deferral balances is
 *   operating income, and its rate is not normalized: the tax it recovers
 *   through its tariff is filed in that movement, as the recast keeps a
 *   utility's rate (recastNormalTaxRate). Only NTPC and Power Grid file one,
 *   every year.
 *
 * Set against the recast's core margin, year on year, for 22 industrial
 * companies: taxed at each year's effective rate alone, the filed move
 * differed by more than a point in 36% of 110 company-years (ITC FY2020 4.0
 * points, a deferred-tax remeasurement; Vodafone Idea FY2020 60, a loss year).
 * On these rules, with the two filings that contradict themselves on profit
 * left out (snapshot.ts firstFiledYears), 11% of 106, a median 0.24 points
 * (75th percentile 0.62, 90th 1.16). Into FY2023–FY2026, the filings with
 * declared annual contexts, 6% and a median 0.20 points (0.43, 0.87; 53).
 * The level differs more, a median 0.5 points (TCS's recast margin sits
 * 0.2–0.6 above its filed one in every year), which is why a forecast's margin
 * is scored as a move from its cutoff year.
 */
export function filedCoreOperatingIncome(years: readonly FiledIncomeLines[]): (number | null)[] {
  const rates = years.map(effectiveRate);
  return years.map((year, i) => {
    // NTPC's FY2017–18 records carry a revenue of 0: no year to measure.
    if (year.revenue == null || year.revenue <= 0 || year.expenses == null) return null;
    const pretax = year.revenue - (year.expenses - (year.financeCosts ?? 0));
    const regulatory = year.regulatoryDeferralMovement ?? 0;
    const filed = rates[i]!;
    const normal = regulatory === 0
      ? median(rates.slice(Math.max(0, i - NORMAL_TAX_WINDOW), i).filter((r): r is number => r != null))
      : null;
    if (isUnusualTaxRate(filed, normal)) return pretax * (1 - normal) + regulatory;
    const rate = filed ?? DEFAULT_CONFIG.statutory_tax_rate;
    // Nil at the effective rate; at the statutory rate, the part of the tax charge it does not explain.
    const rest = year.profitBeforeTax != null && year.taxExpense != null ? year.profitBeforeTax * rate - year.taxExpense : 0;
    return pretax * (1 - rate) + rest + regulatory;
  });
}
