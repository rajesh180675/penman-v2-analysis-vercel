/**
 * A filed total summed beside its own parts counts them twice: the summing
 * helper's duplicate-source guard compares keys, not values. These lists read
 * the total where it is filed and sum the parts only when it is not.
 */
import { describe, expect, it } from "vitest";
import { recastBalanceSheet, recastIncome } from "../PenmanNissimEngine/recast";
import { DEFAULT_CONFIG, type RawPeriodData } from "../types";

const period = (values: Record<string, number>): RawPeriodData => ({
  company_id: "FILED_TOTALS",
  period_end: "2025-03-31",
  raw_metric_values: {
    "Total Assets__BalanceSheet": 10_000,
    "Total Stockholders' Equity__BalanceSheet": 6_000,
    "Total Equity__BalanceSheet": 6_000,
    "Minority Interest__BalanceSheet": 0,
    "Revenue From Operations(Net)__ProfitLoss": 8_000,
    "Other Expenses__ProfitLoss": 900,
    ...values,
  },
});

describe("bridge debt", () => {
  it("reads current maturities once when the total is filed beside its parts", () => {
    // ITC/Idea shape: the total equals secured + unsecured.
    const bs = recastBalanceSheet(period({
      "Total Current Maturities of Long-term Borrowings__BalanceSheet": 300,
      "Total Current Maturities of Secured Long-term Debt__BalanceSheet": 120,
      "Total Current Maturities of Unsecured Long-term Debt__BalanceSheet": 180,
    }), DEFAULT_CONFIG);
    expect(bs.BridgeDebtCurrentMaturities).toBe(300);
  });

  it("sums the parts when no total is filed", () => {
    const bs = recastBalanceSheet(period({
      "Total Current Maturities of Secured Long-term Debt__BalanceSheet": 120,
      "Total Current Maturities of Unsecured Long-term Debt__BalanceSheet": 180,
    }), DEFAULT_CONFIG);
    expect(bs.BridgeDebtCurrentMaturities).toBe(300);
  });

  it("reads debentures once when Total Debentures is filed beside its non-convertible line", () => {
    const bs = recastBalanceSheet(period({
      "Total Debentures__BalanceSheet": 500,
      "Non Convertible Debentures__BalanceSheet": 500,
    }), DEFAULT_CONFIG);
    expect(bs.BridgeDebtDebentures).toBe(500);
  });
});

describe("repairs", () => {
  const repairsOf = (values: Record<string, number>) => {
    const data = period(values);
    const bs = recastBalanceSheet(data, DEFAULT_CONFIG);
    return recastIncome(data, bs, DEFAULT_CONFIG).is_.operatingCostBridge?.sgaRepairs;
  };

  it("reads Repairs and Maintenance once beside its three parts, and still adds the other items", () => {
    expect(repairsOf({
      "Repairs and Maintenance__ProfitLoss": 90,
      "Repairs to Building__ProfitLoss": 20,
      "Repairs to Machinery__ProfitLoss": 50,
      "Repairs to Other Assets__ProfitLoss": 20,
      "Travelling and Conveyance__ProfitLoss": 15,
    })).toBe(105);
  });

  it("sums the parts when the total is not filed", () => {
    expect(repairsOf({
      "Repairs to Building__ProfitLoss": 20,
      "Repairs to Machinery__ProfitLoss": 50,
      "Travelling and Conveyance__ProfitLoss": 15,
    })).toBe(85);
  });
});
