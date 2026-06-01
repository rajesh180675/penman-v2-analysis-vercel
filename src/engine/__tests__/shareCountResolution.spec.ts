import { describe, expect, it } from "vitest";
import itcAuditedFixture from "../__fixtures__/itc-capitaline-audited.json";
import { processCompanyData } from "../pipeline";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";
import { CanonicalOutputRegistry, deriveShareCount } from "../v3Analytics";

describe("share count resolution", () => {
  it("uses audited ITC capital schedule metrics before the equity proxy", () => {
    const rawData = (itcAuditedFixture as { rawData: RawPeriodData[] }).rawData;
    const latestOnly = rawData.filter((row) => row.period_end === "2025-03-31");
    const periods = processCompanyData(latestOnly, { ...DEFAULT_CONFIG, company_type: "industrial" as const });
    const latest = periods[periods.length - 1]!;
    const registry = new CanonicalOutputRegistry();
    const shareCount = deriveShareCount(periods, registry, 180000);

    expect(latest.shareCountInput?.endPeriodShares).toBeCloseTo(1251.4119781, 4);
    expect(latest.shareCountInput?.weightedAverageBasicShares).toBeCloseTo(1250.24, 2);
    expect(latest.shareCountInput?.weightedAverageDilutedShares).toBeCloseTo(1252.10, 2);
    // Per-share basis = diluted weighted average (1252.10), market-cap basis = period-end paid-up (1251.41).
    expect(shareCount.shares).toBeCloseTo(1252.10, 2);
    expect(shareCount.sharesForPerShare).toBeCloseTo(1252.10, 2);
    expect(shareCount.sharesForMarketCap).toBeCloseTo(1251.41, 2);
    expect(shareCount.source).toContain("Diluted");
    expect(shareCount.sourceForMarketCap.toLowerCase()).toContain("paid up");
    expect(shareCount.source).not.toContain("Equity proxy");
    expect(shareCount.confidence).toBe("HIGH");
  });
});
