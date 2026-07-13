import { describe, expect, it } from "vitest";
import { parseSegmentFinanceHTML } from "../segmentParser";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Raw Capitaline XLS files are gitignored (~2 MB each). On a clean clone
// or in CI they don't exist; locally they do. Guard the suite so it runs
// when fixtures are present and skips cleanly when they aren't.
const fixturesDir = resolve(__dirname, "../../../public/data/companies/ITC");
const itcSegmentXls = resolve(fixturesDir, "SegmentFinance_.xls");
const relianceSegmentXls = resolve(__dirname, "../../../public/data/companies/Reliance Industries/SegmentFinance_.xls");
const fixturesAvailable = existsSync(itcSegmentXls) && existsSync(relianceSegmentXls);

describe("segmentParser regressions", () => {
  it("keeps newest visible years when Capitaline detail rows are wider than the header", () => {
    const html = `
      <table>
        <tr>
          <th>Year</th>
          <th class="SubSbHdrLeft ng-binding ng-scope">202503</th>
          <th class="SubSbHdrLeft ng-binding ng-scope">202403</th>
        </tr>
        <tr><td><label>REVENUE</label></td></tr>
        <tr>
          <td><label class="ng-binding ng-scope">Revenue from Operations</label></td>
          <td><div class="ng-binding ng-scope">300</div></td>
          <td><div class="ng-binding ng-scope">250</div></td>
        </tr>
        <tr class="clsBreakUp_2 beakUpCss">
          <td><label>SEGMENT A</label></td>
          <td class="datarow">120</td>
          <td class="datarow">90</td>
          <td class="datarow">70</td>
        </tr>
        <tr class="clsBreakUp_2 beakUpCss">
          <td><label>SEGMENT B</label></td>
          <td class="datarow">80</td>
          <td class="datarow">60</td>
          <td class="datarow">40</td>
        </tr>
        <tr><td><label>RESULT</label></td></tr>
        <tr>
          <td><label class="ng-binding ng-scope">Profit/Loss Before Interest & Tax</label></td>
          <td><div class="ng-binding ng-scope">100</div></td>
          <td><div class="ng-binding ng-scope">80</div></td>
        </tr>
        <tr class="clsBreakUp_2 beakUpCss">
          <td><label>SEGMENT A</label></td>
          <td class="datarow">30</td>
          <td class="datarow">20</td>
          <td class="datarow">10</td>
        </tr>
        <tr class="clsBreakUp_2 beakUpCss">
          <td><label>SEGMENT B</label></td>
          <td class="datarow">15</td>
          <td class="datarow">10</td>
          <td class="datarow">5</td>
        </tr>
      </table>
    `;

    const result = parseSegmentFinanceHTML(html);

    expect(result).not.toBeNull();
    expect(result!.years).toEqual(["FY2025", "FY2024"]);
    expect(result!.data["SEGMENT A"]!["FY2025"]!.revenue).toBe(120);
    expect(result!.data["SEGMENT A"]!["FY2024"]!.revenue).toBe(90);
    expect(result!.data["SEGMENT A"]!["FY2025"]!.result).toBe(30);
    expect(result!.data["SEGMENT A"]!["FY2024"]!.result).toBe(20);
  });
});

describe.skipIf(!fixturesAvailable)("segmentParser", () => {

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
    const cigData = result!.data["FMCG - CIGARETTES"]!;
    expect(cigData).toBeDefined();
    const latestRevenue = cigData["FY2025"]?.revenue;
    expect(latestRevenue).not.toBeNull();
    if (latestRevenue != null) {
      expect(latestRevenue).toBeGreaterThan(10000); // ITC cigarettes > 10k Cr
    }
  });

  // Capitaline export's secondary segment view (geographic). Filename uses
  // "(1)" suffix as the second variant. This file is local-only Capitaline
  // data — not tracked in git — so the test gracefully skips when missing.
  const geoSegmentFile = resolve(fixturesDir, "SegmentFinance_ (1).xls");
  it.skipIf(!existsSync(geoSegmentFile))("parses ITC geographic segment file", () => {
    const html = readFileSync(geoSegmentFile, "utf-8");
    const result = parseSegmentFinanceHTML(html);

    expect(result).not.toBeNull();
    expect(result!.segmentationType).toBe("geographic");
    expect(result!.segments.length).toBe(2);
    expect(result!.segments).toContain("WITHIN INDIA");
    expect(result!.segments).toContain("OUTSIDE INDIA");
  });

  it("parses Reliance Industries business segment file", () => {
    const relianceDir = resolve(__dirname, "../../../public/data/companies/Reliance Industries");
    const html = readFileSync(resolve(relianceDir, "SegmentFinance_.xls"), "utf-8");
    const result = parseSegmentFinanceHTML(html);

    expect(result).not.toBeNull();
    expect(result!.segmentationType).toBe("business");
    expect(result!.segments.length).toBeGreaterThanOrEqual(3);
    expect(result!.years.length).toBeGreaterThanOrEqual(10);
    expect(result!.years[0]).toBe("FY2025");

    // Reliance should have Oil & Gas, Petrochemicals/Refining, Digital, Retail-type segments
    const segNames = result!.segments.join("|").toLowerCase();
    expect(segNames).toMatch(/oil|petro|refin|o2c/i);

    // Check revenue is populated for latest year on first segment
    const seg0 = result!.segments[0]!;
    const latestData = result!.data[seg0]?.["FY2025"];
    expect(latestData?.revenue).not.toBeNull();
    expect(latestData!.revenue!).toBeGreaterThan(10000);
  });

  it("returns null for empty/invalid HTML", () => {
    expect(parseSegmentFinanceHTML("")).toBeNull();
    expect(parseSegmentFinanceHTML("<html><body>no data</body></html>")).toBeNull();
  });

  // L&T: segments with HTML entities (& → &amp;) must be decoded and parsed correctly
  const ltDir = resolve(__dirname, "../../../public/data/companies/Larsen & Toubro Ltd");
  const ltZip = resolve(ltDir, "Larsen & Toubro Ltd.zip");
  const hasLT = existsSync(ltZip);

  it.skipIf(!hasLT)("parses L&T business segments with & in names", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(ltZip));
    const html = await zip.files["SegmentFinance_.xls"]!.async("text");
    const result = parseSegmentFinanceHTML(html);

    expect(result).not.toBeNull();
    expect(result!.segmentationType).toBe("business");
    expect(result!.segments).toContain("IT & TECHNOLOGY SERVICES");
    expect(result!.segments).toContain("ELECTRICAL & AUTOMATION");
    expect(result!.segments).toContain("ENGINEERING & CONSTRUCTION");
    expect(result!.segments.length).toBe(17);

    expect(result!.data["INFRASTRUCTURE"]!["FY2025"]!.revenue).toBeCloseTo(129896.83, 1);
    expect(result!.data["IT & TECHNOLOGY SERVICES"]!["FY2025"]!.revenue).toBeCloseTo(47844.88, 1);
    expect(result!.data["IT & TECHNOLOGY SERVICES"]!["FY2025"]!.result).toBeCloseTo(7682.15, 1);
    expect(result!.data["INFRASTRUCTURE"]!["FY2025"]!.assets).toBeCloseTo(97183.24, 1);
  });

  it.skipIf(!hasLT)("parses L&T geographic segments with variable-length rows", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(ltZip));
    const html = await zip.files["SegmentFinance_ (1).xls"]!.async("text");
    const result = parseSegmentFinanceHTML(html);

    expect(result).not.toBeNull();
    expect(result!.segmentationType).toBe("geographic");
    expect(result!.segments).toContain("KINGDOM OF SAUDI ARABIA");
    expect(result!.segments).toContain("DOMESTIC");

    expect(result!.data["KINGDOM OF SAUDI ARABIA"]!["FY2025"]!.revenue).toBeCloseTo(61002.04, 1);
    expect(result!.data["UNITED STATES OF AMERICA"]!["FY2025"]!.revenue).toBeCloseTo(33448.58, 1);
    expect(result!.data["DOMESTIC"]!["FY2025"]!.revenue).toBeCloseTo(128168.58, 1);
    expect(result!.data["NETHERLAND"]!["FY2025"]!.revenue).toBeNull();
  });
});
