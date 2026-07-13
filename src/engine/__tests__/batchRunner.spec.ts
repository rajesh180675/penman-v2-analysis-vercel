/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runBatchAnalysis, type BatchCompanyInput } from "../batchRunner";
import type { EngineConfig } from "../types";

const ITC_ZIP_PATH = resolve(process.cwd(), "public/data/companies/ITC/ITC.zip");
const hasItcZip = existsSync(ITC_ZIP_PATH);

describe("batchRunner", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.skipIf(!hasItcZip)("runs a single company and returns a populated registry", { timeout: 240_000 }, async () => {
    const zipBuffer = await readFile(ITC_ZIP_PATH);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return new Response(zipBuffer, {
        status: 200,
        headers: { "content-type": "application/zip" },
      });
    });

    const inputs: BatchCompanyInput[] = [
      {
        folder: "ITC",
        name: "ITC Ltd",
        ticker: "ITC",
        type: "conglomerate",
        sector: "FMCG / Cigarettes",
      },
    ];

    const config = {
      ke: 0.12,
      risk_free_rate: 0.07,
      equity_risk_premium: 0.05,
      terminal_growth_rate: 0.03,
      tax_rate: 0.25,
      company_type: "conglomerate",
      market_data_symbol: "ITC",
    } as unknown as EngineConfig;

    const result = await runBatchAnalysis(inputs, config);

    expect(result.summary.total).toBe(1);
    expect(result.summary.succeeded).toBe(1);
    expect(result.summary.failed).toBe(0);
    const itc = result.registry.companies["ITC"];
    expect(itc).toBeDefined();
    expect(itc!.rawData.length).toBeGreaterThan(0);
    expect(itc!.traceability).not.toBeNull();
    expect(result.errors).toEqual({});
  });

  it("records fetch failures as company errors", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const result = await runBatchAnalysis(
      [
        {
          folder: "MissingCo",
          name: "Missing Co",
          ticker: "MISS",
          type: "industrial",
        },
      ],
      { company_type: "industrial" } as unknown as EngineConfig,
    );

    expect(result.summary.total).toBe(1);
    expect(result.summary.succeeded).toBe(0);
    expect(result.summary.failed).toBe(1);
    expect(result.errors["MissingCo"]).toContain("network down");
  });
});
