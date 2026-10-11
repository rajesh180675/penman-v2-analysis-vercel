import { describe, expect, it } from "vitest";
import type { RecastPeriod } from "../../types";
import { headlineInconsistencies, tieOutAsFiled, type AsFiledHeadlineRecord } from "../tieOut";
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

describe("tieOutAsFiled, profit after tax", () => {
  // NTPC FY25: Capitaline's PAT ₹20,251 Cr sits above its extraordinary item
  // after tax, the ₹3,701.92 Cr regulatory-deferral movement, which the
  // filing's profit for the period (₹23,953 Cr) includes; so does TCI.
  it("compares the filing's profit for the period with Capitaline's PAT and the lines it files below it", () => {
    const ntpc = {
      period_end: "2018-03-31",
      is: { Sales: 1, PAT: 20251.23, operatingCostBridge: { extraordinaryAfterTax: 3701.92, associatesShareAfterTax: 0 } },
      bs: {}, cf: {},
    } as unknown as RecastPeriod;
    const [row] = tieOutAsFiled([record({ profitAfterTax: 23953.15 })], [ntpc]);
    expect(row!.capitaline).toBeCloseTo(23953.15, 2);
    expect(row!.status).toBe("match");
  });
});

describe("tieOutAsFiled, profit after tax with discontinued operations", () => {
  // ITC FY25: ₹15,016.01 Cr from the demerged hotels, below Capitaline's PAT
  // and inside TCI; the filing's profit for the period includes it.
  it("adds the discontinued operations Capitaline files below its PAT", () => {
    const itc = {
      period_end: "2018-03-31",
      is: { Sales: 1, PAT: 20036.47 },
      cu: { DiscontinuedOperationsAfterTax: 15016.01 },
      bs: {}, cf: {},
    } as unknown as RecastPeriod;
    const [row] = tieOutAsFiled([record({ profitAfterTax: 35052.48 })], [itc]);
    expect(row!.capitaline).toBeCloseTo(35052.48, 2);
    expect(row!.status).toBe("match");
  });
});

describe("headlineInconsistencies, owners' + minority = total", () => {
  it("accepts a large minority the identity explains, where a ratio called it a contradiction", () => {
    // Grasim FY25 and Bharti FY19: PAT well above twice owners' profit.
    expect(headlineInconsistencies(headline({ profitAfterTax: 7756.3, profitAttributableToOwners: 3705.7, profitAttributableToNonControllingInterests: 4050.7 })).size).toBe(0);
    expect(headlineInconsistencies(headline({ profitAfterTax: 1687.5, profitAttributableToOwners: 409.5, profitAttributableToNonControllingInterests: 1278.0 })).size).toBe(0);
  });

  it("still discredits a PAT the filing's own shares do not add up to", () => {
    // Asian Paints FY22: 3,030.6 + 54.2 = 3,084.8 against a filed 9,167.4.
    const issues = headlineInconsistencies(headline({ profitAfterTax: 9167.4, profitAttributableToOwners: 3030.6, profitAttributableToNonControllingInterests: 54.2 }));
    expect(issues.get("profitAfterTax")).toMatch(/3085, not PAT 9167/);
  });

  it("reads a split filed as 0 and 0 as a blank, not as a contradiction", () => {
    // Vodafone Idea FY25 tags owners' and minority profit as 0 beside a loss of 27,383.
    expect(headlineInconsistencies(headline({ profitAfterTax: -27383.4, profitAttributableToOwners: 0, profitAttributableToNonControllingInterests: 0 })).size).toBe(0);
    // Dabur FY19 states its split, and it is not the filed PAT: 1,442.33 + 3.92 against 1,596.93.
    expect(headlineInconsistencies(headline({ profitAfterTax: 1596.93, profitAttributableToOwners: 1442.33, profitAttributableToNonControllingInterests: 3.92 })).has("profitAfterTax")).toBe(true);
  });

  it("accepts owners' equity above total equity when the minority is negative", () => {
    // Paytm FY25: 15,026.7 − 29.6 = 14,997.1.
    expect(headlineInconsistencies(headline({ totalEquity: 14997.1, equityAttributableToOwners: 15026.7, nonControllingInterest: -29.6 })).size).toBe(0);
    expect(headlineInconsistencies(headline({ totalEquity: 14000, equityAttributableToOwners: 15026.7, nonControllingInterest: -29.6 })).has("equityAttributableToOwners")).toBe(true);
  });
});

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
