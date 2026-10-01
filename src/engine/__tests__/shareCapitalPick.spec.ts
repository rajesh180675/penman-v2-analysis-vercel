import { describe, expect, it } from "vitest";
import { extractShareCountInput } from "../PenmanNissimEngine/picking";
import type { RawPeriodData } from "../types";

const period = (lines: Record<string, number>): RawPeriodData => ({
  company_id: "X",
  period_end: "2013-03-31",
  raw_metric_values: Object.fromEntries(Object.entries(lines).map(([k, v]) => [`${k}__BalanceSheet`, v])),
});

describe("share capital for capital ÷ face value", () => {
  it("reads ordinary equity capital, not share capital that includes preference shares", () => {
    // TCS FY13 as filed: 295.72 of share capital = 195.72 equity + 100 preference.
    const input = extractShareCountInput(period({
      "Share Capital": 295.72,
      "Total Equity Capital(Ordinary)": 195.72,
      "Preference Share Paid up": 100,
      "Face Value of Subscribed Shares Fully Paid up": 1,
      "Number of Equity Shares - Subscribed Fully Paid up": 1957220996,
    }));
    expect(input.shareCapital).toBe(195.72);
    expect(input.endPeriodShares).toBeCloseTo(195.7220996, 6);
  });

  it("reads the exact ordinary line over share capital rounded to the crore", () => {
    // HUL FY16: 216 rounded vs 216.39 ordinary.
    const input = extractShareCountInput(period({ "Share Capital": 216, "Total Equity Capital(Ordinary)": 216.39, "Face Value of Subscribed Shares Fully Paid up": 1 }));
    expect(input.shareCapital).toBe(216.39);
  });

  it("falls back to share capital when no ordinary line is filed", () => {
    const input = extractShareCountInput(period({ "Share Capital": 120, "Face Value of Subscribed Shares Fully Paid up": 10 }));
    expect(input.shareCapital).toBe(120);
  });
});
