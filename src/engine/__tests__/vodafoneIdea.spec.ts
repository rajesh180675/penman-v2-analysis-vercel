/**
 * Vodafone Idea — negative networth stress test
 *
 * @vitest-environment jsdom
 * 
 * Verifies the pipeline handles CSE < 0 without crashing or producing
 * NaN/Infinity in ratios. Vodafone Idea has massive accumulated losses
 * that turned shareholders' equity negative.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { processCompanyDataFull } from "../pipeline";
import { parseCapitalineZip } from "../capitalineParser";
import { DEFAULT_CONFIG } from "../types";

describe("Vodafone Idea (negative networth)", () => {
  let result: ReturnType<typeof processCompanyDataFull>;

  it("parses and runs pipeline without throwing", { timeout: 60_000 }, async () => {
    const zipPath = resolve(__dirname, "../../../public/data/companies/Vodafone Idea Ltd/Vodafone Idea Ltd.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "Vodafone Idea Ltd.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    
    expect(parsed.periods.length).toBeGreaterThan(0);
    console.log("Parsed periods:", parsed.periods.length);
    console.log("Period ends:", parsed.periods.map(p => p.period_end).join(", "));

    result = processCompanyDataFull(parsed.periods, { ...DEFAULT_CONFIG, company_type: "telecom" as const });
    expect(result.periods.length).toBeGreaterThan(0);
    console.log("Pipeline periods:", result.periods.length);
  });

  it("detects negative networth periods", () => {
    const negNW = result.periods.filter(p => p.bs.CSE < 0);
    console.log(`Negative CSE: ${negNW.length} / ${result.periods.length} periods`);
    negNW.forEach(p => console.log(`  ${p.period_end} CSE=${p.bs.CSE.toFixed(0)} Cr`));
    // Vodafone Idea should have at least some negative CSE periods
    expect(negNW.length).toBeGreaterThan(0);
  });

  it("produces finite ratios (no NaN/Infinity) even with negative CSE", () => {
    for (const p of result.periods) {
      if (!p.ratios) continue;
      const ratioEntries = Object.entries(p.ratios);
      for (const [key, val] of ratioEntries) {
        if (typeof val === "number") {
          expect(Number.isFinite(val), `${p.period_end} ratios.${key} = ${val}`).toBe(true);
        }
      }
    }
  });

  it("flags distress correctly", () => {
    console.log("Distress:", JSON.stringify(result.distress, null, 2));
    // Negative networth = severe distress
    expect(result.distress).not.toBeNull();
    expect(result.distress!.severity).not.toBe("none");
  });

  it("triggers loss-maker valuation", () => {
    console.log("LossMaker:", result.lossMaker ? "YES" : "no");
    // Vodafone Idea is a chronic loss-maker
    expect(result.lossMaker).not.toBeNull();
  });

  it("reports key financials for the latest period", () => {
    const last = result.periods[result.periods.length - 1];
    console.log("\nLatest period:", last.period_end);
    console.log("  CSE:", last.bs.CSE.toFixed(0), "Cr");
    console.log("  NOA:", last.bs.NOA.toFixed(0), "Cr");
    console.log("  NFO:", last.bs.NFO.toFixed(0), "Cr");
    console.log("  CNI:", last.is.CNI.toFixed(0), "Cr");
    console.log("  OI:", last.is.OI.toFixed(0), "Cr");
    console.log("  Sales:", last.is.Sales.toFixed(0), "Cr");
    console.log("  ROCE:", last.ratios?.ROCE);
    console.log("  RNOA:", last.ratios?.RNOA);
    console.log("  FLEV:", last.ratios?.FLEV);
    console.log("  SPREAD:", last.ratios?.SPREAD);
  });
});
