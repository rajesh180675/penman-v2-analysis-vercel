/* ================================================================
   Regression: Capitaline's minority-interest convention in the recast.

   Capitaline reports "Total Comprehensive Income for the Year" as the
   OWNERS' share and "Non-Controlling Interests" as the minority's share
   as a SIGNED DEDUCTION from group income (negative when minorities share
   a profit). The recast used to read TCI as group income and the NCI line
   as a positive share, so CNI = TCI − TCI_NCI came out as GROUP income and
   OI (= CNI + NFE + MII) lost the minority's share.

   Pinned to L&T FY2023 — the Capitaline lines below, and the as-filed
   NSE XBRL (INDAS_91509_840577): ComprehensiveIncomeForThePeriod
   ₹11,572.08 Cr, ...AttributableToOwnersOfParent ₹9,715.98 Cr,
   ...NonControllingInterests ₹1,856.10 Cr.
================================================================ */

import { describe, expect, it } from "vitest";
import { computeRecastPeriod } from "../../PenmanNissimEngine";
import { DEFAULT_CONFIG, RawPeriodData } from "../../types";

function lt2023(overrides: Record<string, number> = {}): RawPeriodData {
  return {
    company_id: "LT",
    period_end: "2023-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 330000,
      "Total Stockholders' Equity__BalanceSheet": 89000,
      "Minority Interest__BalanceSheet": 14241,
      "Total Equity__BalanceSheet": 103241,
      "Revenue From Operations(Net)__ProfitLoss": 183340,
      "Profit Before Tax__ProfitLoss": 16900,
      "Tax Expenses__ProfitLoss": 4275,
      "Profit After Tax__ProfitLoss": 12624.87,
      "Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss__ProfitLoss": -958.57,
      "Total Comprehensive Income for the Year__ProfitLoss": 9715.98,
      "Non-Controlling Interests__ProfitLoss": -1856.1,
      "Finance Cost__ProfitLoss": 3546,
      "Other Income__ProfitLoss": 2976,
      ...overrides,
    },
  };
}

describe("recast minority-interest convention (Capitaline: TCI = owners, NCI = signed deduction)", () => {
  it("takes CNI as the owners' comprehensive income, as filed", () => {
    const recast = computeRecastPeriod(lt2023(), DEFAULT_CONFIG);
    expect(recast.is.CNI).toBeCloseTo(9715.98, 2);
    // The old reading (TCI − TCI_NCI) is the GROUP's income.
    expect(recast.is.CNI).not.toBeCloseTo(11572.08, 0);
  });

  it("carries the minority's share as positive MII, so CNI + MII is group income as filed", () => {
    const recast = computeRecastPeriod(lt2023(), DEFAULT_CONFIG);
    expect(recast.is.MII).toBeCloseTo(1856.1, 2);
    expect(recast.is.CNI + recast.is.MII).toBeCloseTo(11572.08, 2);
  });

  it("measures OI on the group basis NOA is measured on: OI − NFE = group comprehensive income", () => {
    const recast = computeRecastPeriod(lt2023(), DEFAULT_CONFIG);
    expect(recast.is.OI - recast.is.NFE).toBeCloseTo(11572.08, 2);
  });

  it("flips the sign when the minority absorbs a loss", () => {
    const recast = computeRecastPeriod(lt2023({
      "Total Comprehensive Income for the Year__ProfitLoss": 500,
      "Non-Controlling Interests__ProfitLoss": 120,
    }), DEFAULT_CONFIG);
    expect(recast.is.CNI).toBeCloseTo(500, 6);
    expect(recast.is.MII).toBeCloseTo(-120, 6);
    expect(recast.is.OI - recast.is.NFE).toBeCloseTo(380, 6);
  });

  it("deducts the minority's share from group PAT + OCI when no TCI line is reported", () => {
    const recast = computeRecastPeriod(lt2023({ "Total Comprehensive Income for the Year__ProfitLoss": 0 }), DEFAULT_CONFIG);
    expect(recast.is.CNI).toBeCloseTo(12624.87 - 958.57 - 1856.1, 2);
    expect(recast.is.CNI + recast.is.MII).toBeCloseTo(12624.87 - 958.57, 2);
  });
});
