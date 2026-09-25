/**
 * Phase 5 exit criterion (docs/ui-revamp-plan.md): a Case viewed as of a past
 * date uses only what existed by then. Driven through the real executor on
 * real TCS data, with the worker swapped for the in-process executor.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { executeLegacyAnalysisRun, type LegacyAnalysisRunInputV1 } from "../../engine/analysisRun";
import { parseCapitalineZip } from "../../engine/capitalineParser";
import type { RawPeriodData } from "../../engine/types";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { CasePage } from "../CasePage";
import { CompanyRunCache, loadCompanyRun, type CompanyRunDependencies } from "../companyRun";
import { caseRoute } from "../route";

const FOLDER = "Tata Consultancy Services Ltd";
const tcs: LibraryCompany = { folder: FOLDER, name: "TCS", ticker: "TCS", sector: "IT", type: "it-services", description: "", emoji: "" };

function deps(overrides: Partial<CompanyRunDependencies> = {}): CompanyRunDependencies {
  return {
    fetchZip: async () => {
      const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    parse: async (bytes, id) => (await parseCapitalineZip(bytes, { companyId: id })).periods,
    fetchMarketSnapshot: async () => null,
    run: (input) => executeLegacyAnalysisRun(input),
    now: () => new Date("2026-09-26T10:00:00Z"),
    ...overrides,
  };
}

describe("as-of Case (Phase 5 exit)", () => {
  it("analyses only years ending by the date, through the real executor", async () => {
    const asOf = "2023-03-31";
    const state = await loadCompanyRun(tcs, undefined, deps(), asOf);
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    const { result } = state;
    // The executor blocks any raw period after the run's asOf; the run went through.
    expect(result.diagnostics.map((d) => d.code)).not.toContain("RAW_PERIOD_AFTER_AS_OF");
    expect(result.run?.asOf).toBe(asOf);
    const periods = result.materialization.pipelineResult?.periods ?? [];
    expect(periods.length).toBeGreaterThanOrEqual(2);
    expect(periods.every((p) => p.period_end <= asOf)).toBe(true);
    expect(periods[periods.length - 1]!.period_end).toBe(asOf);
    // The valuation is anchored no later than the date.
    const anchor = result.materialization.commandCenter?.anchorPeriod.period_end;
    if (anchor) expect(anchor <= asOf).toBe(true);
  }, 240_000);

  it("is guarded by the executor: a later year slipped in would block the run", async () => {
    const leaky = deps({
      run: (input) => executeLegacyAnalysisRun({
        ...input,
        rawData: [...input.rawData, { ...(input.rawData[0] as RawPeriodData), period_end: "2024-03-31" }],
      } as LegacyAnalysisRunInputV1),
    });
    const state = await loadCompanyRun(tcs, undefined, leaky, "2023-03-31");
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.result.status).toBe("blocked");
      expect(state.result.diagnostics.map((d) => d.code)).toContain("RAW_PERIOD_AFTER_AS_OF");
    }
  }, 240_000);

  it("fetches no live price for a dated view, and refuses a date with fewer than two years", async () => {
    const fetchMarketSnapshot = vi.fn(async () => null);
    const run = vi.fn(async () => ({ status: "completed" }) as never);
    const d = deps({ fetchMarketSnapshot, run });
    await loadCompanyRun(tcs, undefined, d, "2023-03-31");
    expect(fetchMarketSnapshot).not.toHaveBeenCalled();
    const early = await loadCompanyRun(tcs, undefined, d, "1990-03-31");
    expect(early).toEqual({ status: "error", message: "Fewer than two reported years end on or before 1990-03-31; the analysis needs at least two." });
  }, 240_000);

  it("keeps one run per company and date", async () => {
    const run = vi.fn(async () => ({ status: "completed" }) as never);
    const cache = new CompanyRunCache(deps({ run }));
    await cache.get(tcs);
    await cache.get(tcs, undefined, "2023-03-31");
    await cache.get(tcs, undefined, "2023-03-31");
    expect(run).toHaveBeenCalledTimes(2);
  }, 240_000);

  it("says what an as-of view does and does not guarantee", () => {
    const html = renderToStaticMarkup(
      <CasePage route={{ ...caseRoute("TCS"), asOf: "2023-03-31" }} company={tcs} run={null} />,
    );
    expect(html).toContain("as of <strong>2023-03-31</strong>");
    expect(html).toContain("may include later restatements");
  });
});
