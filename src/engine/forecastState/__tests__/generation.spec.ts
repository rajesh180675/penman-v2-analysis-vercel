import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../types";
import { INRAbsolute } from "../../types/units";
import { buildValuationCommandCenter } from "../../valuationCommandCenter/core";
import { resolveValuationReadiness } from "../../valuationPolicy";
import { FORECAST_SCENARIO_KEYS, buildPlannedForecastCases, forecastGenerationInput, generateIndustrialForecastCases, planForecastScenario, planForecastScenarios } from "..";

const FOLDER = "Tata Consultancy Services Ltd";
const CONFIG = { ...DEFAULT_CONFIG, company_type: "it-services" as const, market_price: INRAbsolute(3100) };
const LABELS = { analysisWindowId: "window-spec", assumptionIds: ["terminal-growth"], evidenceRefs: ["fact-set-spec"] };
let periods: RecastPeriod[];
let cc: ReturnType<typeof buildValuationCommandCenter>;

beforeAll(async () => {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: FOLDER });
  periods = processCompanyDataFull(parsed.periods, CONFIG).periods;
  cc = buildValuationCommandCenter({ data: periods, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-09-26" });
}, 120_000);

/** The inputs the command center derives its forecast from (valuationCommandCenter/core.ts). */
function commandCenterInput() {
  const readiness = resolveValuationReadiness(periods);
  return forecastGenerationInput({
    periods: periods.slice(0, Math.max(2, readiness.anchorIndex + 1)),
    config: CONFIG,
    costOfCapital: { ke: cc.costOfCapital.ke, kw: cc.costOfCapital.kw, riskFreeRate: cc.costOfCapital.assumptions!.riskFreeRate.value },
  });
}

describe("native forecast generation", () => {
  it("generates the four cases the command center values, scenario for scenario", () => {
    const generated = generateIndustrialForecastCases(commandCenterInput(), LABELS);
    expect(generated.map((g) => g.key)).toEqual([...FORECAST_SCENARIO_KEYS]);
    for (const g of generated) {
      const card = cc.scenarios.find((s) => s.key === g.key)!;
      expect(g.result.status).toBe("computed");
      // The card carries the solved kw; everything else in its scenario is the one generated.
      expect({ ...card.scenario, drivers: { ...card.scenario.drivers, kw: g.scenario.drivers.kw } }).toEqual(g.scenario);
      expect(card.assumptions.g).toBe(g.scenario.drivers.g_terminal);
      if (g.result.status !== "computed") continue;
      // The labels name the run's window and sourced assumptions; they do not change what is forecast.
      expect(g.result.forecastCase.analysisWindowId).toBe("window-spec");
      expect(g.result.forecastCase.assumptionIds).toEqual(["terminal-growth"]);
    }
  });

  it("values the cards on the cases it is handed rather than deriving its own", () => {
    const generated = generateIndustrialForecastCases(commandCenterInput(), LABELS);
    const handed = buildValuationCommandCenter({ data: periods, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-09-26", forecastCases: generated });
    expect(handed.scenarios.map((s) => s.valuation.V_RE_CV3)).toEqual(cc.scenarios.map((s) => s.valuation.V_RE_CV3));
    // A forecast the command center would not derive is valued as handed.
    const faster = buildPlannedForecastCases({
      planned: planForecastScenarios(commandCenterInput()).map((planned) => ({
        ...planned,
        scenario: { ...planned.scenario, drivers: { ...planned.scenario.drivers, sales_growth: planned.scenario.drivers.sales_growth.map((v) => v + 0.05) } },
      })),
      latest: commandCenterInput().periods.at(-1)!,
      config: CONFIG,
      labels: LABELS,
    });
    const fromFaster = buildValuationCommandCenter({ data: periods, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-09-26", forecastCases: faster });
    const base = (c: typeof cc) => c.scenarios.find((s) => s.key === "base")!.valuation.V_RE_CV3!;
    expect(base(fromFaster)).toBeGreaterThan(base(cc));
  });

  it("holds terminal growth to the sector band, or the configured override", () => {
    const input = commandCenterInput();
    const overridden = planForecastScenario({ ...input, config: { ...CONFIG, g_terminal_override: 0.5 } }, "base");
    expect(overridden.drivers.g_terminal).toBe(input.template.terminalGrowthCap);
    const floored = planForecastScenario({ ...input, config: { ...CONFIG, g_terminal_override: -0.5 } }, "base");
    expect(floored.drivers.g_terminal).toBe(input.template.terminalGrowthFloor);
  });
});
