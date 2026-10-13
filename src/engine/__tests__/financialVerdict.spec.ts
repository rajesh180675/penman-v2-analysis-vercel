/**
 * The figures a financial institution's verdict shows. ₹ Cr ÷ crore shares is
 * ₹ per share; the share count is the statements' paid-up count, the basis the
 * industrial market cap uses.
 */
import { describe, expect, it } from "vitest";
import { buildFinancialVerdict } from "../bankValuation/verdict";
import type { BankValuationBundle, BankValuationModelResult } from "../bankValuation/types";
import type { RawPeriodData } from "../types";

const computed = (intrinsicValue: number): BankValuationModelResult =>
  ({ status: "computed", intrinsicValue, premiumOverMarket: null, reason: "", diagnostics: {} });

// HDFC Bank FY25-shaped: 765.0 crore shares of ₹1.
const latestRaw: RawPeriodData = {
  company_id: "HDFCBANK",
  period_end: "2025-03-31",
  raw_metric_values: {
    "Number of Equity Shares - Paid Up__BalanceSheet": 765,
    "Total Equity Capital(Ordinary)__BalanceSheet": 765,
    "Face Value of Equity Shares__BalanceSheet": 1,
  },
};

const bank = {
  ke: 0.1437,
  triangulatedValue: 627_000,
  scenarios: {
    primary: "base",
    cards: [
      { key: "stress", label: "Stress", roe: 0.12, fairPB: 0.8, intrinsicValue: 430_000 },
      { key: "base", label: "Base", roe: 0.166, fairPB: 1.24, intrinsicValue: 668_446 },
      { key: "bull", label: "Bull", roe: 0.19, fairPB: 1.5, intrinsicValue: 807_000 },
    ],
  },
} as unknown as BankValuationBundle;

describe("buildFinancialVerdict", () => {
  it("puts a bank's median model value per share against the price", () => {
    const v = buildFinancialVerdict({ valuation: bank, subtype: "bank", latestRaw, marketPrice: 1_900 });
    expect(v.headlineLabel).toBe("Median of the financial-institution models");
    expect(v.equityValueCr).toBe(627_000);
    expect(v.shares).toBe(765);
    expect(v.perShare).toBeCloseTo(627_000 / 765, 9);
    expect(v.marketCapCr).toBe(1_900 * 765);
    expect(v.upside).toBeCloseTo(627_000 / 765 / 1_900 - 1, 9);
    expect(v.ke).toBe(0.1437);
    expect(v.scenarios.map((s) => [s.key, s.perShare])).toEqual([
      ["stress", 430_000 / 765],
      ["base", 668_446 / 765],
      ["bull", 807_000 / 765],
    ]);
  });

  it("values an insurer on embedded value + VNB and shows no book scenarios", () => {
    const insurer = { ...bank, triangulatedValue: 102_967, evBased: computed(102_967) } as unknown as BankValuationBundle;
    const v = buildFinancialVerdict({ valuation: insurer, subtype: "insurance", latestRaw, marketPrice: null });
    expect(v.headlineLabel).toBe("Embedded value + value of new business");
    expect(v.equityValueCr).toBe(102_967);
    expect(v.scenarios).toEqual([]);
  });

  it("withholds price-dependent figures without a price, and per-share figures without shares", () => {
    const noPrice = buildFinancialVerdict({ valuation: bank, subtype: "bank", latestRaw, marketPrice: null });
    expect([noPrice.marketPrice, noPrice.marketCapCr, noPrice.upside]).toEqual([null, null, null]);
    expect(noPrice.perShare).not.toBeNull();
    const noShares = buildFinancialVerdict({ valuation: bank, subtype: "bank", latestRaw: { ...latestRaw, raw_metric_values: {} }, marketPrice: 1_900 });
    expect([noShares.shares, noShares.perShare, noShares.upside]).toEqual([null, null, null]);
    expect(noShares.equityValueCr).toBe(627_000);
  });

  // The value is the latest balance sheet's, the price today's: set beside it,
  // the value is carried to the price's date, as an industrial case's is.
  describe("carried to the price's date", () => {
    // Gordon on book, the bank models' steady state: V = B(ROE − g)/(ke − g).
    const book = 500_000;
    const roe = 0.16;
    const g = 0.06;
    const ke = 0.12;
    const value = (book * (roe - g)) / (ke - g);
    const steady = { ...bank, ke, terminalGrowth: g, sustainableROE: roe, latestBookValue: book, triangulatedValue: value } as unknown as BankValuationBundle;

    it("grows as the model does: a year on it is V(1 + g), then accrues at ke", () => {
      // 2023-03-31 → 2024-03-31 is 366 days, a little over a year.
      const v = buildFinancialVerdict({ valuation: steady, subtype: "bank", latestRaw: { ...latestRaw, period_end: "2023-03-31" }, marketPrice: 1_000, priceDate: "2024-03-31T15:30:00Z" });
      const years = 366 / 365.25;
      expect(v.valuationDate).toBe("2023-03-31");
      expect(v.priceDate).toBe("2024-03-31");
      expect(v.yearsToPriceDate).toBeCloseTo(years, 12);
      // Carried a year, less (ROE − g) × book paid out, Gordon on book is V(1 + g).
      expect(v.perShareAtPriceDate).toBeCloseTo((value * (1 + g) * Math.pow(1 + ke, years - 1)) / 765, 9);
      expect(v.perShare).toBeCloseTo(value / 765, 9);
      expect(v.upside).toBeCloseTo(v.perShareAtPriceDate! / 1_000 - 1, 12);
    });

    it("is not carried without a sustainable ROE to forecast distributions, nor without a price date", () => {
      const noRoe = buildFinancialVerdict({ valuation: { ...steady, sustainableROE: null } as unknown as BankValuationBundle, subtype: "bank", latestRaw, marketPrice: 1_000, priceDate: "2026-10-13" });
      expect([noRoe.yearsToPriceDate, noRoe.perShareAtPriceDate]).toEqual([0, noRoe.perShare]);
      const undated = buildFinancialVerdict({ valuation: steady, subtype: "bank", latestRaw, marketPrice: 1_000 });
      expect([undated.yearsToPriceDate, undated.perShareAtPriceDate]).toEqual([0, undated.perShare]);
    });
  });
});
