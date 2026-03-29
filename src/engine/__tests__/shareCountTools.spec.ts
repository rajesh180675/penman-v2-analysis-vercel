import { describe, expect, it } from "vitest";
import itcAuditedFixture from "../__fixtures__/itc-capitaline-audited.json";
import { processCompanyData } from "../pipeline";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";
import { resolveShareBasis, toPerShare } from "../shareCountTools";

describe("share count tools", () => {
  it("resolves audited shares into valuation config when config shares are absent", () => {
    const rawData = (itcAuditedFixture as { rawData: RawPeriodData[] }).rawData;
    const latestOnly = rawData.filter((row) => row.period_end === "2025-03-31");
    const periods = processCompanyData(latestOnly, DEFAULT_CONFIG);

    const resolved = resolveShareBasis(periods, DEFAULT_CONFIG, 180000);

    expect(resolved.shares).toBeCloseTo(1251.4119781, 4);
    expect(resolved.valuationConfig.shares_outstanding).toBeCloseTo(1251.4119781, 4);
    expect(resolved.source).toContain("Number of Equity Shares");
  });

  it("converts crore values to rupees per share using crore shares", () => {
    expect(toPerShare(180000, 1251.4119781)).toBeCloseTo(143.84, 2);
  });
});
