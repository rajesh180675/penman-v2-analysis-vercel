import { describe, expect, it } from "vitest";
import { calibrateScenarioProbabilities } from "../calibrate";
import { InMemoryPointInTimeScenarioVintageStore } from "../vintageStore";
import type { ScenarioCalibrationObservation } from "../contracts";

function observation(index: number, realizedScenario: "stress" | "base" | "bull", availableAt = "2026-01-01T00:00:00.000Z"): ScenarioCalibrationObservation {
  const confident = realizedScenario === "stress" ? { stress: 0.7, base: 0.2, bull: 0.1 } : realizedScenario === "base" ? { stress: 0.1, base: 0.8, bull: 0.1 } : { stress: 0.1, base: 0.2, bull: 0.7 };
  return {
    observationId: `obs-${index}`, issuerId: `issuer-${index}`, family: "industrial", regime: "normal", horizonYears: 3,
    forecastAsOf: "2022-03-31", realizedAt: "2025-03-31", availableAt, realizedScenario,
    forecastProbabilities: confident, benchmarkProbabilities: { stress: 1 / 3, base: 1 / 3, bull: 1 / 3 }, sourceRefs: [`source-${index}`],
  };
}

describe("point-in-time scenario calibration", () => {
  it("calibrates only known observations when sample and benchmark skill pass", () => {
    const observations = [observation(1, "stress"), observation(2, "base"), observation(3, "base"), observation(4, "bull"), observation(5, "base"), observation(6, "bull", "2027-01-01T00:00:00.000Z")];
    const report = calibrateScenarioProbabilities({ observations, policy: { family: "industrial", regime: "normal", horizonYears: 3, calibrationAsOf: "2026-07-12T00:00:00.000Z", minimumSampleSize: 5, dirichletPriorPerScenario: 1, minimumSkillVsBenchmark: 0 } });
    expect(report.status).toBe("calibrated");
    expect(report.sampleSize).toBe(5);
    expect(report.excludedLookAheadCount).toBe(1);
    expect(report.probabilities).toEqual({ stress: 0.25, base: 0.5, bull: 0.25 });
    expect(report.skillVsBenchmark).toBeGreaterThan(0);
  });

  it("stores restatement-safe observations and enforces the known-at query", async () => {
    const store = new InMemoryPointInTimeScenarioVintageStore();
    const original = observation(1, "base");
    await expect(store.put(original)).resolves.toBe("created");
    (original.forecastProbabilities as { base: number }).base = 0;
    expect((await store.query({ family: "industrial", regime: "normal", horizonYears: 3, knownAt: "2026-07-12T00:00:00.000Z" }))[0]?.forecastProbabilities.base).toBe(0.8);
    await expect(store.put(observation(1, "base"))).resolves.toBe("exists");
    await expect(store.put(observation(1, "bull"))).rejects.toThrow(/immutable/i);
    expect(await store.query({ family: "industrial", regime: "normal", horizonYears: 3, knownAt: "2025-01-01T00:00:00.000Z" })).toEqual([]);
  });

  it("reports intervals around the same Dirichlet-smoothed estimate", () => {
    const observations = Array.from({ length: 5 }, (_, index) => observation(index, "base"));
    const report = calibrateScenarioProbabilities({ observations, policy: { family: "industrial", regime: "normal", horizonYears: 3, calibrationAsOf: "2026-07-12T00:00:00.000Z", minimumSampleSize: 5, dirichletPriorPerScenario: 100, minimumSkillVsBenchmark: 0 } });
    expect(report.probabilities!.base).toBeGreaterThanOrEqual(report.confidenceIntervals95!.base.low);
    expect(report.probabilities!.base).toBeLessThanOrEqual(report.confidenceIntervals95!.base.high);
  });
});
