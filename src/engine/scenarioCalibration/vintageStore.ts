import type { ScenarioCalibrationObservation } from "./contracts";

export interface ScenarioVintageQuery {
  readonly family: string;
  readonly regime: string;
  readonly horizonYears: number;
  readonly knownAt: string;
}

export interface PointInTimeScenarioVintageStore {
  put(observation: ScenarioCalibrationObservation): Promise<"created" | "exists">;
  query(query: ScenarioVintageQuery): Promise<readonly ScenarioCalibrationObservation[]>;
}

export class InMemoryPointInTimeScenarioVintageStore implements PointInTimeScenarioVintageStore {
  readonly #observations = new Map<string, ScenarioCalibrationObservation>();

  async put(observation: ScenarioCalibrationObservation): Promise<"created" | "exists"> {
    const existing = this.#observations.get(observation.observationId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(observation)) throw new Error("Vintage observation IDs are immutable and cannot be overwritten.");
      return "exists";
    }
    this.#observations.set(observation.observationId, Object.freeze({
      ...observation,
      forecastProbabilities: Object.freeze({ ...observation.forecastProbabilities }),
      benchmarkProbabilities: Object.freeze({ ...observation.benchmarkProbabilities }),
      sourceRefs: Object.freeze([...observation.sourceRefs]),
    }));
    return "created";
  }

  async query(query: ScenarioVintageQuery): Promise<readonly ScenarioCalibrationObservation[]> {
    return Object.freeze([...this.#observations.values()]
      .filter((observation) => observation.family === query.family)
      .filter((observation) => observation.regime === query.regime)
      .filter((observation) => observation.horizonYears === query.horizonYears)
      .filter((observation) => Number.isFinite(Date.parse(observation.availableAt)) && Date.parse(observation.availableAt) <= Date.parse(query.knownAt))
      .sort((left, right) => left.forecastAsOf.localeCompare(right.forecastAsOf) || left.observationId.localeCompare(right.observationId))
      .map((observation) => ({
        ...observation,
        forecastProbabilities: { ...observation.forecastProbabilities },
        benchmarkProbabilities: { ...observation.benchmarkProbabilities },
        sourceRefs: [...observation.sourceRefs],
      })));
  }
}
