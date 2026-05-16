import { describe, expect, it } from "vitest";
import { parseSegmentFinanceHTML } from "../segmentParser";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("segmentParser", () => {
  const fixturesDir = resolve(__dirname, "../../../public/data/companies/ITC");

  it("parses ITC business segment file", () => {
    const html = readFileSync(resolve(fixturesDir, "SegmentFinance_.xls"), "utf-8");
    const result = parseSegmentFinanceHTML(html);

    expect(result).not.toBeNull();
    expect(result!.segmentationType).toBe("business");
    expect(result!.segments).toContain("FMCG - CIGARETTES");
    expect(result!.segments).toContain("HOTELS");
    expect(result!.segments).toContain("AGRI BUSINESS");
    expect(result!.segments).toContain("PAPERBOARDS, PAPER AND PACKAGING");
    expect(result!.segments).toContain("FMCG - OTHERS");
    expect(result!.segments).toContain("OTHERS");
    expect(result!.segments.length).toBe(6);
    expect(result!.years.length).toBe(15);
    expect(result!.years[0]).toBe("FY2025");

    // Check that revenue data is populated for cigarettes
    const cigData = result!.data["FMCG - CIGARETTES"];
    expect(cigData).toBeDefined();
    const latestRevenue = cigData["FY2025"]?.revenue;
    expect(latestRevenue).not.toBeNull();
    if (latestRevenue != null) {
      expect(latestRevenue).toBeGreaterThan(10000); // ITC cigarettes > 10k Cr
    }
  });

  it("parses ITC geographic segment file", () => {
    const html = readFileSync(resolve(fixturesDir, "SegmentFinance_ (1).xls"), "utf-8");
    const result = parseSegmentFinanceHTML(html);

    expect(result).not.toBeNull();
    expect(result!.segmentationType).toBe("geographic");
    expect(result!.segments.length).toBe(2);
    expect(result!.segments).toContain("WITHIN INDIA");
    expect(result!.segments).toContain("OUTSIDE INDIA");
  });

  it("returns null for empty/invalid HTML", () => {
    expect(parseSegmentFinanceHTML("")).toBeNull();
    expect(parseSegmentFinanceHTML("<html><body>no data</body></html>")).toBeNull();
  });
});
