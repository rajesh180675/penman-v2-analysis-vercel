import { describe, expect, it } from "vitest";
import itcAuditedFixture from "../__fixtures__/itc-capitaline-audited.json";
import { processCompanyData } from "../pipeline";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";
import { CroreShares } from "../types/units";
import { resolveShareBasis, toPerShare } from "../shareCountTools";

/**
 * Helper: build a 2-period recast where period 1 has 100 Cr shares and period 2
 * has 110 Cr (mid-period issuance, e.g. ESOP). Used to prove the dual-basis
 * split separates per-share and market-cap denominators correctly.
 */
function buildMidPeriodIssuanceFixture(): RawPeriodData[] {
  return [
    {
      company_id: "ISSUER",
      period_end: "2024-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 10000,
        "Total Equity__BalanceSheet": 5000,
        "Number of Equity Shares - Paid Up__BalanceSheet": 100.0,
        "Number of Equity Shares - Subscribed__BalanceSheet": 100.0,
        "Weighted Average Number of Shares in Issue - Basic__ProfitLoss": 100.0,
        "Weighted Average Number of Shares in Issue - Diluted__ProfitLoss": 100.0,
      },
    },
    {
      company_id: "ISSUER",
      period_end: "2025-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 12000,
        "Total Equity__BalanceSheet": 6500,
        // Period-end paid-up: 110 Cr (ESOPs allotted during the year).
        "Number of Equity Shares - Paid Up__BalanceSheet": 110.0,
        "Number of Equity Shares - Subscribed__BalanceSheet": 110.0,
        // Weighted average over the year: a 100→110 step gives ≈105 Cr basic
        // (and slightly higher diluted once ESOPs intrinsic-value-vest).
        "Weighted Average Number of Shares in Issue - Basic__ProfitLoss": 105.0,
        "Weighted Average Number of Shares in Issue - Diluted__ProfitLoss": 107.0,
      },
    },
  ];
}

describe("share count tools", () => {
  it("resolves audited shares into valuation config when config shares are absent", () => {
    const rawData = (itcAuditedFixture as { rawData: RawPeriodData[] }).rawData;
    const latestOnly = rawData.filter((row) => row.period_end === "2025-03-31");
    const periods = processCompanyData(latestOnly, { ...DEFAULT_CONFIG, company_type: "industrial" as const });

    const resolved = resolveShareBasis(periods, DEFAULT_CONFIG, 180000);

    // Per-share basis: diluted weighted average (the most defensible
    // valuation denominator — ties to reported diluted EPS).
    expect(resolved.sharesForPerShare).toBeCloseTo(1252.10, 2);
    // Market-cap basis: period-end paid-up (the equity outstanding today).
    expect(resolved.sharesForMarketCap).toBeCloseTo(1251.41, 2);
    // Back-compat alias still equals per-share.
    expect(resolved.shares).toBeCloseTo(resolved.sharesForPerShare ?? -1, 4);
    expect(resolved.valuationConfig.shares_outstanding).toBeCloseTo(1252.10, 2);
    // Per-share source mentions diluted; market-cap source mentions period-end paid-up.
    expect(resolved.source).toContain("Diluted");
    expect(resolved.sourceForMarketCap.toLowerCase()).toContain("paid up");
  });

  it("separates per-share and market-cap bases when there's mid-period issuance", () => {
    const rawData = buildMidPeriodIssuanceFixture();
    const periods = processCompanyData(rawData, { ...DEFAULT_CONFIG, company_type: "industrial" as const });
    const resolved = resolveShareBasis(periods, DEFAULT_CONFIG, 1000);

    // Per-share = diluted WA (107), market-cap = period-end paid-up (110).
    expect(resolved.sharesForPerShare).toBeCloseTo(107.0, 4);
    expect(resolved.sharesForMarketCap).toBeCloseTo(110.0, 4);
    // The two bases must differ for this case.
    expect(resolved.sharesForPerShare).not.toBe(resolved.sharesForMarketCap);
    // Each is sourced from a different field.
    expect(resolved.source).toContain("Diluted");
    expect(resolved.sourceForMarketCap).toContain("Paid Up");
  });

  it("uses direct period-end shares with HIGH confidence when weighted-average shares are absent", () => {
    const rawData: RawPeriodData[] = [
      {
        company_id: "DIRECT_ONLY",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 12000,
          "Total Equity__BalanceSheet": 6500,
          "Number of Equity Shares - Paid Up__BalanceSheet": 110.0,
        },
      },
    ];
    const periods = processCompanyData(rawData, { ...DEFAULT_CONFIG, company_type: "industrial" as const });
    const resolved = resolveShareBasis(periods, DEFAULT_CONFIG, 1000);

    expect(resolved.sharesForPerShare).toBeCloseTo(110.0, 4);
    expect(resolved.sharesForMarketCap).toBeCloseTo(110.0, 4);
    expect(resolved.confidence).toBe("HIGH");
    expect(resolved.sourceForMarketCap.toLowerCase()).toContain("paid up");
  });

  it("uses diluted weighted-average shares even when basic WA and period-end shares are absent", () => {
    const rawData: RawPeriodData[] = [
      {
        company_id: "DILUTED_ONLY",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 12000,
          "Total Equity__BalanceSheet": 6500,
          "Weighted Average Number of Shares in Issue - Diluted__ProfitLoss": 107.0,
        },
      },
    ];
    const periods = processCompanyData(rawData, { ...DEFAULT_CONFIG, company_type: "industrial" as const });
    const resolved = resolveShareBasis(periods, DEFAULT_CONFIG, 1000);

    expect(resolved.sharesForPerShare).toBeCloseTo(107.0, 4);
    expect(resolved.sharesForMarketCap).toBeCloseTo(107.0, 4);
    expect(resolved.shares).toBeCloseTo(107.0, 4);
    expect(resolved.confidence).toBe("HIGH");
    expect(resolved.source).toContain("Diluted");
  });

  it("honours a config-supplied shares_outstanding as authoritative for BOTH bases", () => {
    const rawData = (itcAuditedFixture as { rawData: RawPeriodData[] }).rawData;
    const latestOnly = rawData.filter((row) => row.period_end === "2025-03-31");
    const periods = processCompanyData(latestOnly, { ...DEFAULT_CONFIG, company_type: "industrial" as const });

    const override = CroreShares(999.99);
    const resolved = resolveShareBasis(periods, { ...DEFAULT_CONFIG, shares_outstanding: override }, 180000);

    // Config override applies to BOTH bases (audited config input is authoritative).
    expect(resolved.sharesForPerShare).toBe(override);
    expect(resolved.sharesForMarketCap).toBe(override);
    expect(resolved.source).toContain("Config");
  });

  it("converts crore values to rupees per share using crore shares", () => {
    expect(toPerShare(180000, 1251.4119781)).toBeCloseTo(143.84, 2);
  });
});
