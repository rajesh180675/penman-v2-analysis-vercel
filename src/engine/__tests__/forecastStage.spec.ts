import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type ForecastScenario, type RecastPeriod } from "../types";
import { CroreShares } from "../types/units";
import { buildIndustrialForecastFromLegacyScenario, type IndustrialForecastResult } from "../forecastState";
import type { ScenarioCalibrationObservation, ScenarioCalibrationPolicy } from "../scenarioCalibration";
import { FORECAST_GATE_STAGE_VERSION, runForecastGates } from "../forecastStage";

const LATEST = {
  period_end: "2026-03-31",
  bs: {
    TA: 1_500, CSE: 750, MI: 50, FA: 150, FO: 450, OA: 1_350, OL: 250,
    NOA: 1_100, NFO: 300, Inventory: 150, TradeReceivables: 150,
    OA_Inventory: 150, OA_TradeReceivables: 150, OA_PPE: 700, PPE: 700,
    OA_ROU: 100, OA_OtherIntangibles: 100, OA_Goodwill: 50, Goodwill: 50,
    OA_Other: 100, FO_LeaseLiabilities: 100, FO_FinancialDebtExLease: 350,
    separationScore: 100,
  },
  is: {
    Sales: 2_200, taxRate: 0.25, FinanceCost: 32, FinanceIncome: 4,
    CNI: 180, operatingCostBridge: { depreciation: 70 },
  },
  cf: { DividendPaid: 50 },
} as unknown as RecastPeriod;

function scenario(name: "stress" | "base" | "bull", growth: number): ForecastScenario {
  return {
    // The legacy scenario names the stress case "bear".
    name: name === "stress" ? "bear" : name,
    probability: 1 / 3,
    horizonT: 3,
    drivers: {
      sales_growth: [growth, growth, growth],
      core_sales_pm: [0.15, 0.15, 0.15],
      ato: [2, 2, 2],
      flev: [0.2, 0.2, 0.2],
      nbc: [0.06, 0.06, 0.06],
      g_terminal: 0.03,
      ke: 0.12,
      kw: 0.10,
    },
  };
}

function caseFor(name: "stress" | "base" | "bull", growth: number): IndustrialForecastResult {
  return buildIndustrialForecastFromLegacyScenario({
    caseId: name, label: name, scenario: scenario(name, growth), latest: LATEST,
    config: { ...DEFAULT_CONFIG, shares_outstanding: CroreShares(100) },
    analysisWindowId: "window-1", assumptionIds: [], evidenceRefs: [],
    probabilityStatus: "not-assigned", probabilityRationale: null,
  });
}

const ORDERED = [caseFor("stress", 0.02), caseFor("base", 0.07), caseFor("bull", 0.12)];

function observation(index: number, realizedScenario: "stress" | "base" | "bull"): ScenarioCalibrationObservation {
  return {
    observationId: `obs-${index}`, issuerId: `issuer-${index}`, family: "industrial", regime: "normal", horizonYears: 3,
    forecastAsOf: "2022-03-31", realizedAt: "2025-03-31", availableAt: "2026-01-01T00:00:00.000Z", realizedScenario,
    forecastProbabilities: realizedScenario === "base" ? { stress: 0.1, base: 0.8, bull: 0.1 } : realizedScenario === "stress" ? { stress: 0.7, base: 0.2, bull: 0.1 } : { stress: 0.1, base: 0.2, bull: 0.7 },
    benchmarkProbabilities: { stress: 1 / 3, base: 1 / 3, bull: 1 / 3 }, sourceRefs: [`source-${index}`],
  };
}

const OBSERVATIONS = [observation(1, "stress"), observation(2, "base"), observation(3, "base"), observation(4, "bull"), observation(5, "base")];
const policy = (overrides: Partial<ScenarioCalibrationPolicy> = {}): ScenarioCalibrationPolicy => ({
  family: "industrial", regime: "normal", horizonYears: 3, calibrationAsOf: "2026-07-12",
  minimumSampleSize: 5, dirichletPriorPerScenario: 1, minimumSkillVsBenchmark: 0, ...overrides,
});

describe("forecast gate stage", () => {
  it("passes ordered, validated cases through unchanged without calibration evidence", () => {
    expect(ORDERED.every((result) => result.status === "computed")).toBe(true);
    const output = runForecastGates({ forecastResults: ORDERED, scenarioCalibration: null, asOf: "2026-10-30" });
    expect(output.stageVersion).toBe(FORECAST_GATE_STAGE_VERSION);
    expect(output.blocks).toEqual([]);
    expect(output.forecastResults).toEqual(ORDERED);
    expect(output.scenarioCalibration).toBeNull();
    expect(output.scenarioOrdering?.status).toBe("passed");
  });

  it("calibrates the cases where the evidence binds, without changing the cases it was given", () => {
    const given = structuredClone(ORDERED);
    const output = runForecastGates({ forecastResults: given, scenarioCalibration: { observations: OBSERVATIONS, policy: policy() }, asOf: "2026-10-30" });
    expect(output.blocks).toEqual([]);
    expect(output.scenarioCalibration?.status).toBe("calibrated");
    const base = output.forecastResults.find((result) => result.status === "computed" && result.forecastCase.scenarioKey === "base");
    expect(base?.status === "computed" && base.forecastCase.probabilityStatus).toBe("calibrated");
    expect(given).toEqual(ORDERED);
  });

  it("refuses calibration evidence dated after the run, and leaves the cases uncalibrated", () => {
    const output = runForecastGates({ forecastResults: ORDERED, scenarioCalibration: { observations: OBSERVATIONS, policy: policy() }, asOf: "2026-07-11" });
    expect(output.blocks.map((block) => block.code)).toEqual(["SCENARIO_CALIBRATION_BINDING_MISMATCH"]);
    expect(output.forecastResults).toEqual(ORDERED);
  });

  it("refuses calibration evidence for another horizon", () => {
    const output = runForecastGates({ forecastResults: ORDERED, scenarioCalibration: { observations: OBSERVATIONS, policy: policy({ horizonYears: 5 }) }, asOf: "2026-10-30" });
    expect(output.blocks.map((block) => block.code)).toEqual(["SCENARIO_CALIBRATION_BINDING_MISMATCH"]);
  });

  it("blocks cases out of order, and reports both blocks in the order raised", () => {
    const disordered = [caseFor("stress", 0.12), caseFor("base", 0.07), caseFor("bull", 0.02)];
    expect(runForecastGates({ forecastResults: disordered, scenarioCalibration: null, asOf: "2026-10-30" }).blocks.map((block) => block.code))
      .toEqual(["FORECAST_SCENARIO_ORDERING_BLOCKED"]);
    expect(runForecastGates({ forecastResults: disordered, scenarioCalibration: { observations: OBSERVATIONS, policy: policy({ horizonYears: 5 }) }, asOf: "2026-10-30" }).blocks.map((block) => block.code))
      .toEqual(["SCENARIO_CALIBRATION_BINDING_MISMATCH", "FORECAST_SCENARIO_ORDERING_BLOCKED"]);
  });
});
