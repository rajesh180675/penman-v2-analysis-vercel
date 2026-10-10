import { describe, expect, it, vi } from "vitest";
import type { LegacyAnalysisRunExecutionResult, LegacyAnalysisRunInputV1 } from "../../engine/analysisRun";
import type { LiveMarketDataSnapshot } from "../../engine/marketData";
import { ACTIVE_MARKET_PACKS } from "../../engine/marketPacks";
import type { RawPeriodData } from "../../engine/types";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { CompanyRunCache, loadCompanyRun, type CompanyRunDependencies } from "../companyRun";

const company: LibraryCompany = {
  folder: "Mahindra & Mahindra", name: "Mahindra & Mahindra Ltd", ticker: "M&M", sector: "Autos",
  type: "cyclical", description: "", emoji: "",
};
const period = { company_id: "M&M", period_end: "2025-03-31", raw_metric_values: {} } as RawPeriodData;
const snapshot = { lastPrice: 1450 } as unknown as LiveMarketDataSnapshot;
const result = { status: "completed", run: {} } as unknown as LegacyAnalysisRunExecutionResult;

function deps(overrides: Partial<CompanyRunDependencies> = {}) {
  return {
    fetchZip: vi.fn(async () => new Uint8Array([1])),
    parse: vi.fn(async () => ({ periods: [period], debug: null })),
    fetchMarketSnapshot: vi.fn(async () => snapshot),
    run: vi.fn(async () => result),
    now: () => new Date("2026-09-26T10:00:00Z"),
    ...overrides,
  } satisfies CompanyRunDependencies;
}

describe("loadCompanyRun", () => {
  // Nestlé India-shaped: consolidated accounts only from FY24, standalone back to Dec 2011.
  const nestle: LibraryCompany = { ...company, folder: "Nestlé India", ticker: "NESTLEIND", hasStandalone: true };
  const years = (n: number) => Array.from({ length: n }, (_, i) => ({ ...period, period_end: `${2025 - i}-03-31` }));
  const byZip = (consolidated: number, standalone: number) => vi.fn(async (bytes: Uint8Array) => ({
    periods: years(bytes[0] === 2 ? standalone : consolidated),
    debug: null,
  }));
  const fetchByUrl = vi.fn(async (url: string) => new Uint8Array([url.endsWith("/standalone.zip") ? 2 : 1]));

  it("analyses the standalone history when consolidated accounts cover too few years", async () => {
    const run = vi.fn(async (_input: LegacyAnalysisRunInputV1, _requestId: string) => result);
    const state = await loadCompanyRun(nestle, undefined, deps({ run, fetchZip: fetchByUrl, parse: byZip(2, 14) }));
    expect(state.status === "ready" && state.basis).toBe("standalone");
    expect(fetchByUrl).toHaveBeenCalledWith("/data/companies/Nestl%C3%A9%20India/standalone.zip");
    expect(run.mock.calls[0]![0].rawData).toHaveLength(14);
  });

  it("keeps consolidated accounts once they cover enough years", async () => {
    const fetchZip = vi.fn(async (url: string) => new Uint8Array([url.endsWith("/standalone.zip") ? 2 : 1]));
    const state = await loadCompanyRun(nestle, undefined, deps({ fetchZip, parse: byZip(3, 14) }));
    expect(state.status === "ready" && state.basis).toBe("consolidated");
    expect(fetchZip).toHaveBeenCalledTimes(1);
  });

  it("keeps short consolidated accounts when there is no standalone export", async () => {
    const run = vi.fn(async (_input: LegacyAnalysisRunInputV1, _requestId: string) => result);
    const state = await loadCompanyRun({ ...nestle, hasStandalone: false }, undefined, deps({ run, parse: byZip(2, 14) }));
    expect(state.status === "ready" && state.basis).toBe("consolidated");
    expect(run.mock.calls[0]![0].rawData).toHaveLength(2);
  });

  it("fetches the bundled zip, parses it and runs the analysis with the company's config and the active packs", async () => {
    const run = vi.fn(async (_input: LegacyAnalysisRunInputV1, _requestId: string) => result);
    const d = deps({ run });
    const steps: string[] = [];
    const state = await loadCompanyRun(company, (s) => steps.push(s), d);

    expect(state).toEqual({ status: "ready", result, debug: null, basis: "consolidated" });
    expect(steps).toEqual(["fetching", "parsing", "analysing"]);
    expect(d.fetchZip).toHaveBeenCalledWith("/data/companies/Mahindra%20&%20Mahindra/Mahindra%20&%20Mahindra.zip");
    expect(d.parse).toHaveBeenCalledWith(expect.any(Uint8Array), "M&M");

    const input = run.mock.calls[0]![0];
    expect(input.config.company_type).toBe("cyclical");
    expect(input.config.ticker).toBe("M&M");
    // Same packs the current shell supplies: shown and recorded ke agree (S-9.4C).
    expect(input.macroPack).toBe(ACTIVE_MARKET_PACKS.macroPack);
    expect(input.betaPack).toBe(ACTIVE_MARKET_PACKS.betaPack);
    expect(input.metadata?.asOf).toBe("2026-09-26");
    // The live overlay reaches the run, as in the current shell.
    expect(input.marketSnapshot).toBe(snapshot);
  });

  it("runs without a market overlay when the snapshot is unavailable", async () => {
    const run = vi.fn(async (_input: LegacyAnalysisRunInputV1, _requestId: string) => result);
    const state = await loadCompanyRun(company, undefined, deps({ run, fetchMarketSnapshot: async () => null }));
    expect(state.status).toBe("ready");
    expect(run.mock.calls[0]![0].marketSnapshot).toBeNull();
  });

  it("settles to an error, never a rejection, when the data is missing or empty", async () => {
    const missing = await loadCompanyRun(company, undefined, deps({ fetchZip: async () => { throw new Error("Company data not found (404)."); } }));
    expect(missing).toEqual({ status: "error", message: "Company data not found (404)." });

    const empty = await loadCompanyRun(company, undefined, deps({ parse: async () => ({ periods: [], debug: null }) }));
    expect(empty.status).toBe("error");
  });

  it("runs the Capitaline parse through parser fidelity, and keeps the diagnostics beside the run for the Debug tool", async () => {
    const debug = { files: [] } as never;
    const run = vi.fn(async (_input: LegacyAnalysisRunInputV1, _requestId: string) => result);
    const state = await loadCompanyRun(company, undefined, deps({ run, parse: async () => ({ periods: [period], debug }) }));
    expect(state).toEqual({ status: "ready", result, debug, basis: "consolidated" });
    // Labelled "manual" without the parse trail, a library zip skipped the
    // Capitaline checks (files, headers, periods, warnings) the classic upload runs.
    const input = run.mock.calls[0]![0];
    expect(input.debugInfo).toBe(debug);
    expect(input.metadata.sourceMode).toBe("capitaline");
  });
});

describe("CompanyRunCache", () => {
  it("runs each company once per session", async () => {
    const run = vi.fn(async () => result);
    const cache = new CompanyRunCache(deps({ run }));
    await cache.get(company);
    await cache.get(company);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lists the companies analysed this session, latest runs only, for the Lab's Regression tool", async () => {
    const cache = new CompanyRunCache(deps({ run: vi.fn(async () => ({ ...result, materialization: { rawData: [period], pipelineResult: { periods: [] } } }) as never) }));
    expect(cache.registry().companies).toEqual({});
    await cache.get(company, undefined, "2025-03-31");
    await Promise.resolve();
    expect(Object.keys(cache.registry().companies)).toEqual([]);
    await cache.get(company);
    await Promise.resolve();
    expect(cache.registry().companies["M&M"]).toMatchObject({ id: "M&M", label: "Mahindra & Mahindra Ltd", companyType: "cyclical", rawData: [period] });
    // A new upload of the company drops it until it is analysed again.
    cache.registerUpload(company, new Uint8Array([2]));
    expect(cache.registry().companies).toEqual({});
  });

  it("retries a company whose load failed", async () => {
    const fetchZip = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Uint8Array([1]));
    const cache = new CompanyRunCache(deps({ fetchZip }));
    expect((await cache.get(company)).status).toBe("error");
    await Promise.resolve();
    expect((await cache.get(company)).status).toBe("ready");
  });
});

describe("loadCompanyRun — a financial institution's quality sidecar", () => {
  // HDFC Life is valued on embedded value alone, which only the sidecar carries.
  const insurer: LibraryCompany = {
    folder: "HDFC Life Insurance Company Ltd", name: "HDFC Life", ticker: "HDFCLIFE", sector: "Insurance",
    type: "insurance", description: "", emoji: "",
  };
  const sidecar = { periods: [{ period_end: "2025-03-31", embedded_value: 61_000 }] } as unknown as import("../../engine/bankQualityIndicators").BankQualityIndicators;
  const runOf = () => vi.fn(async (_input: LegacyAnalysisRunInputV1, _requestId: string) => result);

  it("hands the sidecar to the run", async () => {
    const run = runOf();
    const fetchBankQuality = vi.fn(async () => sidecar);
    await loadCompanyRun(insurer, undefined, deps({ run, fetchBankQuality }));
    expect(fetchBankQuality).toHaveBeenCalledWith(insurer);
    expect(run.mock.calls[0]![0].bankQuality).toBe(sidecar);
  });

  it("gives an uploaded zip no sidecar: it may be another vintage of the accounts", async () => {
    const run = runOf();
    const fetchBankQuality = vi.fn(async () => sidecar);
    await loadCompanyRun(insurer, undefined, deps({ run, fetchBankQuality }), null, new Uint8Array([9]));
    expect(fetchBankQuality).not.toHaveBeenCalled();
    expect(run.mock.calls[0]![0].bankQuality).toBeNull();
  });

  it("does not give a standalone-basis run the consolidated sidecar", async () => {
    const run = runOf();
    const years = (n: number) => Array.from({ length: n }, (_, i) => ({ ...period, period_end: `${2025 - i}-03-31` }));
    await loadCompanyRun({ ...insurer, hasStandalone: true }, undefined, deps({
      run,
      fetchBankQuality: vi.fn(async () => sidecar),
      fetchZip: vi.fn(async (url: string) => new Uint8Array([url.endsWith("/standalone.zip") ? 2 : 1])),
      parse: vi.fn(async (bytes: Uint8Array) => ({ periods: years(bytes[0] === 2 ? 14 : 2), debug: null })),
    }));
    expect(run.mock.calls[0]![0].rawData).toHaveLength(14);
    expect(run.mock.calls[0]![0].bankQuality).toBeNull();
  });

  it("runs without a sidecar when no loader is supplied", async () => {
    const run = runOf();
    await loadCompanyRun(insurer, undefined, deps({ run }));
    expect(run.mock.calls[0]![0].bankQuality).toBeNull();
  });
});
