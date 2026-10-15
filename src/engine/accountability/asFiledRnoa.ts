import type { OperatingFigures } from "../filings/xbrlInstance";
import { DEFAULT_CONFIG } from "../types";

/**
 * Core RNOA from as-filed results, on the recast's definitions as far as a
 * results filing allows. Set against the app's Capitaline core RNOA for the
 * corpus companies (FY2024 on, 46 company-years), the median gap is 0.2
 * points and the interquartile range −1.1 to +2.0
 * (docs/generated/persistence-panel.md); the wide gaps are bases the recast
 * changes (TCS, Paytm, a carved lending arm at M&M and L&T).
 *
 * - Core operating income before tax is revenue less expenses other than
 *   finance costs: other income, exceptional items and associates' share
 *   are left out by construction, as the filing's own totals exclude them.
 * - It is taxed at the effective rate where that lies between 1% and 55%,
 *   else at the statutory rate (recast.ts).
 * - NOA is total equity plus borrowings less cash, other bank balances and
 *   every investment: the recast counts long-term investments as financial
 *   too. Lease liabilities are not tagged apart and stay operating.
 */
export function asFiledCoreOperatingIncome(figures: OperatingFigures): number | null {
  const { revenue, expenses, financeCosts, profitBeforeTax, taxExpense } = figures;
  if (revenue == null || expenses == null) return null;
  const pretax = revenue - (expenses - (financeCosts ?? 0));
  const effective = profitBeforeTax != null && profitBeforeTax > 0 && taxExpense != null ? taxExpense / profitBeforeTax : null;
  const rate = effective != null && effective > 0.01 && effective < 0.55 ? effective : DEFAULT_CONFIG.statutory_tax_rate;
  return pretax * (1 - rate);
}

/** Null when the filing carries no balance sheet (results filings before FY2023). */
export function asFiledNoa(figures: OperatingFigures): number | null {
  const { assets, equity, borrowings, cash, investments } = figures;
  if (assets == null || equity == null) return null;
  return equity + (borrowings ?? 0) - (cash ?? 0) - (investments ?? 0);
}

/**
 * Core RNOA by fiscal year on the opening NOA, as the panel persistence input
 * is measured (scripts/accountability/company-run.ts): a year counts only when
 * the year before it was filed with a positive NOA.
 */
export function asFiledRnoaPoints(byYear: ReadonlyMap<number, OperatingFigures>): { year: number; rnoa: number }[] {
  const points: { year: number; rnoa: number }[] = [];
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const opening = byYear.get(year - 1);
    const noa = opening ? asFiledNoa(opening) : null;
    const income = asFiledCoreOperatingIncome(byYear.get(year)!);
    if (noa != null && noa > 0 && income != null) points.push({ year, rnoa: income / noa });
  }
  return points;
}
