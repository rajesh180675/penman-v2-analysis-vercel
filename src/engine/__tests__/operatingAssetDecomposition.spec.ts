/**
 * The operating-asset decomposition (OA = PPE + ROU + goodwill + other
 * intangibles + … + OA_Other). Two Capitaline readings broke it: the intangible
 * schedule's net total includes goodwill as a row, and "Deferred Tax Assets"
 * alone is the tax note's gross figure, not the balance sheet's net one.
 */
import { describe, expect, it } from "vitest";
import { recastBalanceSheet } from "../PenmanNissimEngine/recast";
import { DEFAULT_CONFIG, type RawPeriodData } from "../types";

const period = (values: Record<string, number>): RawPeriodData => ({
  company_id: "OA_FIXTURE",
  period_end: "2025-03-31",
  raw_metric_values: {
    "Total Assets__BalanceSheet": 79_880,
    "Total Stockholders' Equity__BalanceSheet": 50_000,
    "Total Equity__BalanceSheet": 50_000,
    "Minority Interest__BalanceSheet": 0,
    ...values,
  },
});

describe("goodwill and other intangibles", () => {
  it("takes the schedule's goodwill row out of its net intangible total (HUL FY25)", () => {
    const bs = recastBalanceSheet(period({
      "Goodwill__BalanceSheet": 17_466,
      "Goodwill - Net__BalanceSheet": 17_466,
      "Intangible Assets__BalanceSheet": 45_710,
      "Net Intangible Assets__BalanceSheet": 45_710,
    }), DEFAULT_CONFIG);
    expect(bs.OA_Goodwill).toBe(17_466);
    expect(bs.OA_OtherIntangibles).toBe(45_710 - 17_466);
  });

  it("reads goodwill on consolidation from the schedule when the face line is zero (Tata Steel FY25)", () => {
    const bs = recastBalanceSheet(period({
      "Goodwill__BalanceSheet": 0,
      "Goodwill on Consolidation - Net__BalanceSheet": 5_958.53,
      "Intangible Assets__BalanceSheet": 17_610.94,
      "Net Intangible Assets__BalanceSheet": 17_610.94,
    }), DEFAULT_CONFIG);
    expect(bs.OA_Goodwill).toBe(5_958.53);
    expect(bs.OA_OtherIntangibles).toBeCloseTo(17_610.94 - 5_958.53, 6);
  });

  it("leaves a face intangibles line alone when no schedule goodwill row is filed", () => {
    const bs = recastBalanceSheet(period({
      "Goodwill__BalanceSheet": 300,
      "Intangible Assets__BalanceSheet": 500,
    }), DEFAULT_CONFIG);
    expect(bs.OA_Goodwill).toBe(300);
    expect(bs.OA_OtherIntangibles).toBe(500);
  });
});

describe("deferred tax assets", () => {
  it("reads the balance sheet's net figure, not the tax note's gross one (Tata Steel FY25)", () => {
    const bs = recastBalanceSheet(period({
      "Deferred Tax Assets__BalanceSheet": 21_659.91,
      "Deferred Tax Assets (Net)__BalanceSheet": 3_936.22,
    }), DEFAULT_CONFIG);
    expect(bs.OA_DTA).toBe(3_936.22);
  });

  it("falls back to the plain label when no net figure is filed", () => {
    const bs = recastBalanceSheet(period({ "Deferred Tax Assets__BalanceSheet": 17 }), DEFAULT_CONFIG);
    expect(bs.OA_DTA).toBe(17);
  });
});
