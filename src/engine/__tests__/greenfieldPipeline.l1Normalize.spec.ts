import { describe, expect, it } from "vitest";
import { normalizePeriods, croreToInrNumber, inrToCroreNumber } from "../greenfieldPipeline";
import { DEFAULT_CONFIG, type RawPeriodData } from "../types";

function raw(period_end: string, values: Record<string, number | null>, standard: RawPeriodData["accounting_standard"] = "ind-as"): RawPeriodData {
  return { company_id: "DMART", period_end, accounting_standard: standard, currency_unit: "Crores", raw_metric_values: values };
}

describe("greenfield L1 normalization", () => {
  it("converts INR crore values to absolute INR and keeps legacy conversion reversible", () => {
    expect(croreToInrNumber(3423.04)).toBe(34_230_400_000);
    expect(inrToCroreNumber(34_230_400_000)).toBeCloseTo(3423.04, 6);

    const periods = normalizePeriods([
      raw("2024-03-31", { "Revenue From Operations(Net)__ProfitLoss": 50_780, "Total Equity__BalanceSheet": 18_000, "Profit After Tax__ProfitLoss": 2_400 }),
      raw("2025-03-31", { "Revenue From Operations(Net)__ProfitLoss": 59_358.05, "Total Equity__BalanceSheet": 21_426.7, "Profit After Tax__ProfitLoss": 2_900, "Net Cash from Operating Activities__CashFlow": 2_462.97, "Purchased of Fixed Assets__CashFlow": 3_423.04 }),
    ], { ...DEFAULT_CONFIG, company_type: "consumer" });

    expect(periods).toHaveLength(2);
    expect(periods[1]!.values.revenue).toBe(593_580_500_000);
    expect(periods[1]!.values.capex).toBe(34_230_400_000);
    expect(periods[1]!.industry.companyType).toBe("consumer");
    expect(periods[1]!.industry.confidence).toBe("explicit");
  });

  it("tags accounting-standard adoption windows and mixed/partial periods", () => {
    const periods = normalizePeriods([
      raw("2016-03-31", { "Total Equity__BalanceSheet": 100, "Profit After Tax__ProfitLoss": 10 }, "revised-sch-vi"),
      raw("2017-03-31", { "Total Equity__BalanceSheet": 120, "Profit After Tax__ProfitLoss": 12 }, "ind-as"),
      raw("2020-06-30", { "Total Equity__BalanceSheet": 140, "Profit After Tax__ProfitLoss": 14, "Lease Liabilities__BalanceSheet": 50 }, "ind-as"),
    ], DEFAULT_CONFIG);

    expect(periods[1]!.accountingStandard).toBe("ind-as");
    expect(periods[2]!.standardAdoptions.indAS116).toBe(true);
    expect(periods[2]!.isPartialPeriod).toBe(true);
    expect(periods[2]!.periodLengthDays).not.toBeNull();
  });

  it("pre-computes dirty-surplus seed using equity, net income, dividends, issues, and buybacks", () => {
    const periods = normalizePeriods([
      raw("2024-03-31", { "Total Equity__BalanceSheet": 100, "Profit After Tax__ProfitLoss": 10 }),
      raw("2025-03-31", { "Total Equity__BalanceSheet": 120, "Profit After Tax__ProfitLoss": 15, "Dividend Paid__CashFlow": 2, "Proceeds from Issue of Share Capital__CashFlow": 3, "Buy Back of Shares__CashFlow": 1 }),
    ], DEFAULT_CONFIG);

    // ΔCSE 20Cr − (NI 15Cr − div 2Cr + issue 3Cr − buyback 1Cr) = 5Cr, normalized to INR.
    expect(periods[1]!.derived.dirtySurplusSeed).toBe(50_000_000);
  });
});
