import { describe, expect, it } from "vitest";
import type { RecastPeriod } from "../../types";
import { tieOutAsFiled, type AsFiledHeadlineRecord } from "../tieOut";
import type { AnnualHeadline } from "../xbrlInstance";

const headline = (fields: Partial<AnnualHeadline>): AnnualHeadline => ({
  revenue: null, profitBeforeTax: null, profitAfterTax: null, profitFromContinuingOperations: null,
  profitFromDiscontinuedOperations: null, profitAttributableToOwners: null, financeCosts: null,
  totalAssets: null, totalEquity: null, equityAttributableToOwners: null, cashFlowFromOperations: null,
  ...fields,
});
const period = (sales: number) => ({ period_end: "2018-03-31", is: { Sales: sales }, bs: {}, cf: {} }) as unknown as RecastPeriod;
const record = (fields: Partial<AnnualHeadline>): AsFiledHeadlineRecord =>
  ({ fiscalYearEnd: "2018-03-31", filingDate: "2018-06-08T15:27", headline: headline(fields) });

describe("tieOutAsFiled, revenue", () => {
  // ITC FY18: filed gross ₹47,688.55 Cr with ₹4,239.61 Cr excise itemized;
  // Capitaline's net revenue is ₹43,449 Cr.
  it("compares revenue net of the excise duty the filing itemizes, and says so", () => {
    const [row] = tieOutAsFiled([record({ revenue: 47688.55, exciseDuty: 4239.61 })], [period(43449)]);
    expect(row!.asFiled).toBeCloseTo(43448.94, 2);
    expect(row!.status).toBe("match");
    expect(row!.netOf).toEqual({ label: "excise duty", value: 4239.61 });
  });

  it("compares the filed figure as it is when no excise is itemized", () => {
    // A record extracted before excise was read, and one with none to itemize.
    for (const r of [record({ revenue: 47688.55 }), record({ revenue: 47688.55, exciseDuty: null })]) {
      const [row] = tieOutAsFiled([r], [period(43449)]);
      expect(row!.asFiled).toBe(47688.55);
      expect(row!.status).toBe("mismatch");
      expect(row!.netOf).toBeUndefined();
    }
  });
});
