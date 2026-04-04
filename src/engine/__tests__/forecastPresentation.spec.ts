import { describe, expect, it } from "vitest";
import {
  buildForecastProbabilityState,
  buildForecastDisplayMode,
  normalizeScenarioWeighting,
} from "../forecastPresentation";

describe("normalizeScenarioWeighting", () => {
  it("preserves four-scenario policy weights that already sum to 1", () => {
    const weighting = normalizeScenarioWeighting({
      stress: 0.30,
      base: 0.38,
      bull: 0.19,
      historicalPanic: 0.13,
    });

    expect(weighting.total).toBeCloseTo(1, 6);
    expect(weighting.isValid).toBe(true);
  });

  it("marks manual weights invalid when they do not sum to 1", () => {
    const weighting = buildForecastProbabilityState({
      stress: 0.30,
      base: 0.38,
      bull: 0.19,
      historicalPanic: 0,
    });

    expect(weighting.total).toBeCloseTo(0.87, 6);
    expect(weighting.isValid).toBe(false);
    expect(weighting.reason).toContain("must equal 1.00");
  });
});

describe("buildForecastDisplayMode", () => {
  it("suppresses actionable valuation outputs when the run is blocked", () => {
    expect(buildForecastDisplayMode({ valuationStatus: "blocked", probabilityValid: true })).toEqual({
      mode: "diagnostic-only",
      showExpectedValue: false,
      showMonteCarlo: false,
      showActionableScenarioCards: false,
    });
  });
});
