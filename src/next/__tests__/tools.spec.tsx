/**
 * The Record and Lab tools render in the next UI on the company's shared run
 * (docs/ui-revamp-plan.md, Phase 4 follow-up). Driven through the real
 * executor on real TCS data: the tools take the classic panels' props, and
 * only a real run proves the derivation feeds them what they read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import InvestmentThesis from "../../components/InvestmentThesis";
import V3AnalyticsPanel from "../../components/V3AnalyticsPanel";
import { executeLegacyAnalysisRun } from "../../engine/analysisRun";
import { parseCapitalineZip } from "../../engine/capitalineParser";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { loadCompanyRun, type CompanyRunState } from "../companyRun";
import { buildToolInputs, withDerivedShares } from "../toolInputs";
import { noRecastReason } from "../ToolPanel";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../engine/types";
import { CroreShares } from "../../engine/types/units";

const FOLDER = "Tata Consultancy Services Ltd";
const tcs: LibraryCompany = { folder: FOLDER, name: "TCS", ticker: "TCS", sector: "IT", type: "it-services", description: "", emoji: "" };

let ready: Extract<CompanyRunState, { status: "ready" }>;

beforeAll(async () => {
  const state = await loadCompanyRun(tcs, undefined, {
    fetchZip: async () => {
      const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    parse: async (bytes, id) => {
      const { periods, debug } = await parseCapitalineZip(bytes, { companyId: id });
      return { periods, debug };
    },
    fetchMarketSnapshot: async () => null,
    run: (input) => executeLegacyAnalysisRun(input),
    now: () => new Date("2026-09-28T10:00:00Z"),
  });
  if (state.status !== "ready") throw new Error(`TCS run did not settle ready: ${JSON.stringify(state)}`);
  ready = state;
}, 240_000);

describe("tool inputs from the shared run", () => {
  it("carries the run's own periods, trust envelope and parser diagnostics", () => {
    const inputs = buildToolInputs(ready.result, ready.debug ?? null);
    const periods = ready.result.materialization.pipelineResult?.periods ?? [];
    expect(inputs.recastData?.map((p) => p.period_end)).toEqual(periods.map((p) => p.period_end));
    expect(inputs.traceability?.confidence).toEqual(ready.result.run?.trustEnvelope.confidence);
    expect(inputs.publication?.runIdentity?.runId).toBe(ready.result.run?.runId);
    expect(inputs.debugInfo?.detectedPeriods.length).toBeGreaterThan(0);
    expect(inputs.companyId).toBe("TCS");
    expect(inputs.engineError).toBeNull();
  });

  it("gives the tools a copy: nothing they do reaches the run the Case reads", () => {
    const inputs = buildToolInputs(ready.result, null);
    const original = ready.result.materialization.pipelineResult!.periods[0]!.is.Sales;
    inputs.recastData![0]!.is.Sales = -1;
    expect(ready.result.materialization.pipelineResult!.periods[0]!.is.Sales).toBe(original);
  });

  it("fills the share count from the latest recast period, as the classic shell does, unless one is set", () => {
    const inputs = buildToolInputs(ready.result, null);
    expect(inputs.config.shares_outstanding).toBeGreaterThan(0);
    const set = withDerivedShares({ ...DEFAULT_CONFIG, shares_outstanding: CroreShares(1) }, inputs.recastData);
    expect(set.shares_outstanding).toBe(1);
    expect(withDerivedShares(DEFAULT_CONFIG, [] as RecastPeriod[]).shares_outstanding).toBe(DEFAULT_CONFIG.shares_outstanding);
  });

  it("renders the thesis and V3 analytics on it", () => {
    const inputs = buildToolInputs(ready.result, null);
    const itServices = inputs.pipelineResult?.itServices ?? null;
    const thesis = renderToStaticMarkup(<InvestmentThesis data={inputs.recastData!} config={inputs.config} itServices={itServices} />);
    expect(thesis).toContain("Investment Thesis");
    const v3 = renderToStaticMarkup(
      <V3AnalyticsPanel data={inputs.recastData!} config={inputs.config} traceability={inputs.traceability}
        traceabilitySummary={inputs.publication?.traceabilitySummary ?? null} itServices={itServices} />,
    );
    expect(v3).toContain("V3 Analytics");
  });
});

describe("a tool with no reformulation to read", () => {
  it("says why, rather than rendering an empty panel", () => {
    expect(noRecastReason({ engineError: "boom", pipelineResult: null })).toBe("The analysis failed: boom");
    expect(noRecastReason({ engineError: null, pipelineResult: { analysisFamily: "financial-institution" } as never }))
      .toContain("banks, NBFCs and insurers");
  });
});
