import { describe, expect, it } from "vitest";
import {
  fadedMargin,
  marginReversionObservations,
  reversionShare,
  shareClosedAt,
  type MarginSeries,
} from "../marginReversion";

const series = (companyId: string, margins: Record<number, number>): MarginSeries => ({
  companyId,
  points: Object.entries(margins).map(([year, margin]) => ({ year: Number(year), margin })),
});

describe("marginReversionObservations", () => {
  it("takes the target as the median of the years before the origin, the origin's own left out", () => {
    const [observation] = marginReversionObservations(
      [series("A", { 2020: 0.1, 2021: 0.12, 2022: 0.2, 2023: 0.3, 2024: 0.25 })],
      { origins: [2023], horizon: 1, window: 3 },
    );
    expect(observation).toEqual({ companyId: "A", origin: 2023, horizon: 1, latest: 0.3, target: 0.12, outcome: 0.25 });
  });

  it("needs every year of the window unless fewer are allowed", () => {
    const gappy = [series("A", { 2020: 0.1, 2022: 0.2, 2023: 0.3, 2024: 0.25 })];
    expect(marginReversionObservations(gappy, { origins: [2023], horizon: 1, window: 3 })).toHaveLength(0);
    const [observation] = marginReversionObservations(gappy, { origins: [2023], horizon: 1, window: 3, minYears: 2 });
    expect(observation!.target).toBeCloseTo(0.15, 12);
  });

  it("drops an origin with no year filed at the horizon", () => {
    const stopped = [series("A", { 2021: 0.1, 2022: 0.1, 2023: 0.1 })];
    expect(marginReversionObservations(stopped, { origins: [2023], horizon: 1, window: 2 })).toHaveLength(0);
  });

  it("drops a margin outside the bounds, wherever it sits", () => {
    const options = { origins: [2023], horizon: 1, window: 2, bounds: [-0.5, 0.6] as const };
    const base = { 2021: 0.1, 2022: 0.1, 2023: 0.1, 2024: 0.1 };
    expect(marginReversionObservations([series("A", base)], options)).toHaveLength(1);
    expect(marginReversionObservations([series("A", { ...base, 2023: -0.9 })], options)).toHaveLength(0);
    expect(marginReversionObservations([series("A", { ...base, 2024: 4 })], options)).toHaveLength(0);
    expect(marginReversionObservations([series("A", { ...base, 2021: 2, 2022: 2 })], options)).toHaveLength(0);
  });
});

describe("reversionShare", () => {
  const observation = (latest: number, target: number, outcome: number) =>
    ({ companyId: "A", origin: 2023, horizon: 1, latest, target, outcome });

  it("recovers the share every observation closed", () => {
    const observations = [observation(0.2, 0.1, 0.17), observation(0.05, 0.15, 0.08), observation(0.3, 0.1, 0.24)];
    expect(reversionShare(observations)).toBeCloseTo(0.3, 12);
  });

  it("is not moved by one year's write-off", () => {
    const steady = Array.from({ length: 9 }, (_, i) => observation(0.2 + i * 0.01, 0.1, 0.2 + i * 0.01 - 0.3 * (0.1 + i * 0.01)));
    expect(reversionShare([...steady, observation(0.2, 0.1, -0.4)])).toBeCloseTo(0.3, 12);
  });

  it("weights a wide gap above a narrow one", () => {
    // Two observations: the wide gap closed 20%, the narrow one moved away by its whole gap.
    expect(reversionShare([observation(0.3, 0.1, 0.26), observation(0.1, 0.11, 0.09)])).toBeCloseTo(0.2, 12);
  });

  it("is null when no observation has a gap", () => {
    expect(reversionShare([observation(0.1, 0.1, 0.2)])).toBeNull();
    expect(reversionShare([])).toBeNull();
  });
});

describe("the fade", () => {
  it("closes 1 − α^h of the gap by year h, as the forecast's fade array does", () => {
    expect(shareClosedAt(0.8, 1)).toBeCloseTo(0.2, 12);
    expect(shareClosedAt(0.8, 3)).toBeCloseTo(0.488, 12);
    expect(fadedMargin({ companyId: "A", origin: 2023, horizon: 3, latest: 0.2, target: 0.1, outcome: 0 }, shareClosedAt(0.8, 3)))
      .toBeCloseTo(0.1512, 12);
  });
});
