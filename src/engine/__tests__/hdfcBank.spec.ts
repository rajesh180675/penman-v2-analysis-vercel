/**
 * HDFC Bank — bank pipeline integration test
 *
 * @vitest-environment jsdom
 *
 * Loads the real HDFC Bank ZIP once and asserts that the bank pipeline
 * produces metrics within expected ranges.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull, PipelineResult } from "../pipeline";
import { DEFAULT_CONFIG } from "../types";

describe("HDFC Bank — bank pipeline integration", () => {
  let result: PipelineResult;

  beforeAll(async () => {
    const zipPath = resolve(__dirname, "../../../public/data/companies/HDFC Bank/HDFC Bank.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "HDFC Bank.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    expect(parsed.periods.length).toBeGreaterThanOrEqual(10);
    result = processCompanyDataFull(parsed.periods, {
      ...DEFAULT_CONFIG,
      company_type: "bank" as const,
    });
  }, 60_000);

  it("routes to financial-institution family", () => {
    expect(result.analysisFamily).toBe("financial-institution");
    expect(result.bankResult).toBeTruthy();
    expect(result.periods).toHaveLength(0); // bank pipeline — no industrial recast
  });

  it("produces bank metrics with ROA and ROE in expected ranges", () => {
    const metrics = result.bankResult?.bankMetrics ?? [];
    expect(metrics.length).toBeGreaterThanOrEqual(10);

    const latest = metrics[metrics.length - 1]!;
    expect(latest).toBeTruthy();

    // ROA: HDFC Bank historically 1.5–2.2%
    expect(latest.roa).not.toBeNull();
    expect(latest.roa!).toBeGreaterThan(0.01);
    expect(latest.roa!).toBeLessThan(0.03);

    // ROE: HDFC Bank historically 13–20%
    expect(latest.roe).not.toBeNull();
    expect(latest.roe!).toBeGreaterThan(0.10);
    expect(latest.roe!).toBeLessThan(0.25);

    // Credit cost: 0.3–2.5%
    expect(latest.creditCost).not.toBeNull();
    expect(latest.creditCost!).toBeGreaterThanOrEqual(0.001);
    expect(latest.creditCost!).toBeLessThan(0.03);
  });

  it("produces CASA ratio from current-account sub-line", () => {
    const metrics = result.bankResult?.bankMetrics ?? [];
    const latest = metrics[metrics.length - 1]!;

    // CASA (partial — current accounts only): HDFC Bank ~4–6%
    expect(latest.casaRatio).not.toBeNull();
    expect(latest.casaRatio!).toBeGreaterThan(0.02);
    expect(latest.casaRatio!).toBeLessThan(0.15);
  });

  it("subtype is bank", () => {
    expect(result.bankResult?.subtype).toBe("bank");
  });
});
