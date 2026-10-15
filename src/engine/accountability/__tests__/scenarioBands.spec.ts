/**
 * Scenario band coverage: each cutoff's stress, base and bull forecasts set
 * against what was filed after it.
 *
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { placeInBand, summarizeScenarioBands, walkForwardScenarioBands, type ScenarioBandObservation } from "../scenarioBands";
import { walkForwardCompany } from "../walkForward";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { DEFAULT_CONFIG, type EngineConfig, type RecastPeriod } from "../../types";

describe("placeInBand", () => {
  it("places an outcome below stress, between, or above bull", () => {
    expect(placeInBand(80, 90, 110)).toBe("below");
    expect(placeInBand(90, 90, 110)).toBe("within");
    expect(placeInBand(100, 90, 110)).toBe("within");
    expect(placeInBand(120, 90, 110)).toBe("above");
    // A band whose ends are inverted (a loss-maker's CNI) is read either way round.
    expect(placeInBand(-5, 10, -20)).toBe("within");
  });
});

describe("summarizeScenarioBands", () => {
  const obs = (actual: number, horizon = 1): ScenarioBandObservation =>
    ({ cutoffPeriod: "2020-03-31", metric: "sales", horizon, panic: 70, stress: 90, base: 100, bull: 110, actual, position: placeInBand(actual, 90, 110) });

  it("counts each side of the band and the panic tail, and sets every path against the base", () => {
    const [summary] = summarizeScenarioBands([obs(60), obs(85), obs(95), obs(105), obs(130)]);
    expect(summary!.n).toBe(5);
    expect(summary!.below).toBeCloseTo(0.4, 12);
    expect(summary!.within).toBeCloseTo(0.4, 12);
    expect(summary!.above).toBeCloseTo(0.2, 12);
    expect(summary!.belowPanic).toBeCloseTo(0.2, 12);
    expect(summary!.stressToBase).toBeCloseTo(0.9, 12);
    expect(summary!.bullToBase).toBeCloseTo(1.1, 12);
    expect(summary!.actualToBase!.p50).toBeCloseTo(0.95, 12);
  });

  it("summarizes each metric and horizon on its own", () => {
    const rows = summarizeScenarioBands([obs(95, 1), obs(95, 2), obs(130, 2)]);
    expect(rows.map((r) => [r.metric, r.horizon, r.n])).toEqual([["sales", 1, 1], ["sales", 2, 2]]);
  });
});

const ZIP = resolve(__dirname, "../../../../public/data/companies/ITC/ITC.zip");
const itIfData = existsSync(ZIP) ? it : it.skip;

describe("walkForwardScenarioBands on ITC", () => {
  let periods: RecastPeriod[] = [];
  const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "conglomerate", ticker: "ITC" };

  beforeAll(async () => {
    if (!existsSync(ZIP)) return;
    const parsed = await parseCapitalineZip(new File([readFileSync(ZIP)], "ITC.zip", { type: "application/zip" }));
    periods = processCompanyDataFull(parsed.periods, config).periods;
  }, 120_000);

  itIfData("builds the walk-forward's own base forecast at each cutoff", () => {
    const bands = walkForwardScenarioBands(periods, config);
    const walk = walkForwardCompany(periods, config, { ticker: "ITC", companyType: "conglomerate" });
    expect(bands.length).toBeGreaterThan(0);
    // The base path is the forecast the accountability report scores: its log
    // error against the filed sales is the walk-forward's, cutoff by cutoff.
    for (const origin of walk.origins) {
      for (const scored of origin.observations.filter((o) => o.metric === "sales-log-error")) {
        const band = bands.find((b) => b.metric === "sales" && b.cutoffPeriod === origin.cutoffPeriod && b.horizon === scored.horizon)!;
        expect(Math.log(band.base / band.actual)).toBeCloseTo(scored.model, 9);
      }
    }
  });

  itIfData("orders each cutoff's sales paths from panic to bull", () => {
    for (const b of walkForwardScenarioBands(periods, config).filter((o) => o.metric === "sales")) {
      expect(b.panic).toBeLessThanOrEqual(b.stress);
      expect(b.stress).toBeLessThanOrEqual(b.base);
      expect(b.base).toBeLessThanOrEqual(b.bull);
    }
  });
});
