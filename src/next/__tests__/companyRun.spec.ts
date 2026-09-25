import { describe, expect, it, vi } from "vitest";
import type { LegacyAnalysisRunExecutionResult, LegacyAnalysisRunInputV1 } from "../../engine/analysisRun";
import { ACTIVE_MARKET_PACKS } from "../../engine/marketPacks";
import type { RawPeriodData } from "../../engine/types";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { CompanyRunCache, loadCompanyRun, type CompanyRunDependencies } from "../companyRun";

const company: LibraryCompany = {
  folder: "Mahindra & Mahindra", name: "Mahindra & Mahindra Ltd", ticker: "M&M", sector: "Autos",
  type: "cyclical", description: "", emoji: "",
};
const period = { company_id: "M&M", period_end: "2025-03-31", raw_metric_values: {} } as RawPeriodData;
const result = { status: "completed", run: {} } as unknown as LegacyAnalysisRunExecutionResult;

function deps(overrides: Partial<CompanyRunDependencies> = {}) {
  return {
    fetchZip: vi.fn(async () => new Uint8Array([1])),
    parse: vi.fn(async () => [period]),
    run: vi.fn(async () => result),
    now: () => new Date("2026-09-26T10:00:00Z"),
    ...overrides,
  } satisfies CompanyRunDependencies;
}

describe("loadCompanyRun", () => {
  it("fetches the bundled zip, parses it and runs the analysis with the company's config and the active packs", async () => {
    const run = vi.fn(async (_input: LegacyAnalysisRunInputV1, _requestId: string) => result);
    const d = deps({ run });
    const steps: string[] = [];
    const state = await loadCompanyRun(company, (s) => steps.push(s), d);

    expect(state).toEqual({ status: "ready", result });
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
  });

  it("settles to an error, never a rejection, when the data is missing or empty", async () => {
    const missing = await loadCompanyRun(company, undefined, deps({ fetchZip: async () => { throw new Error("Company data not found (404)."); } }));
    expect(missing).toEqual({ status: "error", message: "Company data not found (404)." });

    const empty = await loadCompanyRun(company, undefined, deps({ parse: async () => [] }));
    expect(empty.status).toBe("error");
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
