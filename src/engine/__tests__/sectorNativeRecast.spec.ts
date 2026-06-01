import { describe, expect, it } from "vitest";
import { computeRecastPeriod } from "../PenmanNissimEngine";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";

function makeTelecomPeriod(overrides: Record<string, number> = {}): RawPeriodData {
  return {
    company_id: "TELECOM_RECAST",
    period_end: "2025-03-31",
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Stockholders' Equity__BalanceSheet": 600,
      "Total Equity__BalanceSheet": 600,
      "Minority Interest__BalanceSheet": 0,
      "Property, Plant and Equipment__BalanceSheet": 300,
      "Revenue From Operations(Net)__ProfitLoss": 900,
      "Profit Before Tax__ProfitLoss": 140,
      "Tax Expenses__ProfitLoss": 35,
      "Profit After Tax__ProfitLoss": 105,
      "Total Comprehensive Income for the Year__ProfitLoss": 105,
      "Finance Cost__ProfitLoss": 10,
      "Other Income__ProfitLoss": 5,
      "Net Cash from Operating Activities__CashFlow": 120,
      "Purchased of Fixed Assets__CashFlow": -30,
      "Dividend Paid__CashFlow": -10,
      ...overrides,
    },
  };
}

describe("sector-native recast detail", () => {
  it("surfaces telecom spectrum/licence rights as operating intangibles instead of the OA_Other plug", () => {
    const recast = computeRecastPeriod(
      makeTelecomPeriod({
        "Rights Under Licensing Agreement__BalanceSheet": 250,
      }),
      { ...DEFAULT_CONFIG, company_type: "telecom" },
    );
    const bs = recast.bs as typeof recast.bs & { OA_TelecomSpectrumLicenses?: number };

    expect(bs.OA_TelecomSpectrumLicenses).toBe(250);
    expect(recast.bs.OA_OtherIntangibles).toBe(250);
    expect(recast.bs.OA_Other).toBe(450);
    expect(recast.bs.NOA).toBe(600);
  });

  it("does not double-count detailed spectrum/licence rights when the generic intangible subtotal is present", () => {
    const recast = computeRecastPeriod(
      makeTelecomPeriod({
        "Intangible Assets__BalanceSheet": 400,
        "Rights Under Licensing Agreement__BalanceSheet": 250,
      }),
      { ...DEFAULT_CONFIG, company_type: "telecom" },
    );

    expect(recast.bs.OA_TelecomSpectrumLicenses).toBe(250);
    expect(recast.bs.OA_OtherIntangibles).toBe(400);
    // The detailed spectrum/license field is audit detail inside the generic
    // intangible subtotal, not an additional operating-asset component.
    expect(recast.bs.OA_Other).toBe(300);
    expect(
      recast.bs.OA_PPE + recast.bs.OA_OtherIntangibles + recast.bs.OA_Other,
    ).toBe(recast.bs.OA);
    expect(recast.bs.NOA).toBe(600);
  });

  it("surfaces telecom network/licence opex separately without double-counting Other Expenses", () => {
    const recast = computeRecastPeriod(
      makeTelecomPeriod({
        "Other Income__ProfitLoss": 0,
        "Other Expenses__ProfitLoss": 100,
        "Direct Tele Communication / Network Development Expenses__ProfitLoss": 50,
        "License Fee / Operation Charges__ProfitLoss": 30,
      }),
      { ...DEFAULT_CONFIG, company_type: "telecom" },
    );
    const bridge = recast.is.operatingCostBridge as NonNullable<typeof recast.is.operatingCostBridge> & {
      telecomNetworkOpex?: number;
      licenseFeeOperationCharges?: number;
      sectorSpecificOperatingExpense?: number;
    };

    expect(bridge.telecomNetworkOpex).toBe(50);
    expect(bridge.licenseFeeOperationCharges).toBe(30);
    expect(bridge.sectorSpecificOperatingExpense).toBe(80);
    expect(bridge.otherOperatingExpense).toBe(20);
    expect(bridge.operatingCosts).toBe(100);
    expect(bridge.bridgeCoreOI).toBe(800);
  });
});
