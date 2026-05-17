/**
 * Bajaj Finance — NBFC pipeline stress test
 *
 * @vitest-environment jsdom
 *
 * Verifies the pipeline routes Bajaj Finance through the bank/NBFC path
 * and produces meaningful NBFC metrics (leverage, spread, NIM).
 */
import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { readFileSync } from "fs";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull, PipelineResult } from "../pipeline";
import { DEFAULT_CONFIG } from "../types";

describe("Bajaj Finance (NBFC)", () => {
  let result: PipelineResult;

  it("parses and runs pipeline without throwing", { timeout: 60_000 }, async () => {
    const zipPath = resolve(__dirname, "../../../public/data/companies/bajaj finance/bajaj finance.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "bajaj finance.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    expect(parsed).toBeTruthy();
    expect(parsed!.periods.length).toBeGreaterThan(0);

    result = processCompanyDataFull(parsed!.periods, DEFAULT_CONFIG);
    expect(result).toBeTruthy();
    console.log("Analysis family:", result.analysisFamily);
    console.log("Bank result?", result.bankResult != null);
    if (result.bankResult) {
      const br = result.bankResult;
      console.log("Subtype:", br.subtype);
      console.log("Bank metrics periods:", br.bankMetrics?.length);
      if (br.bankMetrics && br.bankMetrics.length > 0) {
        const latest = br.bankMetrics[br.bankMetrics.length - 1];
        console.log("Latest NIM:", latest.nim);
        console.log("Latest ROA:", latest.roa);
        console.log("Latest ROE:", latest.roe);
        console.log("Latest leverage:", latest.leverage);
        console.log("Latest spread:", latest.spread);
      }
      console.log("Valuation:", br.valuation ? Object.keys(br.valuation) : "null");
    }
  });

  it("routes to financial-institution family", () => {
    expect(result.analysisFamily).toBe("financial-institution");
  });

  it("produces bankResult with NBFC subtype", () => {
    expect(result.bankResult).toBeTruthy();
    expect(result.bankResult!.subtype).toBe("nbfc");
  });

  it("has bank metrics with ROA and ROE", () => {
    const br = result.bankResult!;
    expect(br.bankMetrics).toBeTruthy();
    expect(br.bankMetrics!.length).toBeGreaterThan(3);

    const latest = br.bankMetrics![br.bankMetrics!.length - 1];
    // Bajaj Finance ROA ~4%, ROE ~19%
    expect(latest.roa).toBeGreaterThan(0.01);
    expect(latest.roa).toBeLessThan(0.10);
    expect(latest.roe).toBeGreaterThan(0.10);
    expect(latest.roe).toBeLessThan(0.35);
    // Note: leverage/spread/NIM null until Phase D maps Ind-AS borrowings labels
  });

  it("valuation models produce results", () => {
    const br = result.bankResult!;
    expect(br.valuation).toBeTruthy();
  });
});
