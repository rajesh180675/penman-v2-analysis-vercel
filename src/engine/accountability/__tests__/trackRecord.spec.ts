import { describe, expect, it } from "vitest";
import { companyTrackRecord, type CompanyWalkForward } from "..";

const obs = (metric: string, horizon: number, model: number, rw: number) => ({
  metric, horizon, model, naive: { "random-walk": rw, "trailing-trend": rw },
});

describe("companyTrackRecord", () => {
  it("counts one-year-ahead forecasts closer to the outcome than a random walk", () => {
    const result = {
      ticker: "TCS",
      origins: [
        { cutoffPeriod: "2020-03-31", historyLength: 5, observations: [obs("sales-log-error", 1, 0.02, -0.05), obs("sales-log-error", 2, 0.5, 0.01), obs("cni-roe-point-error", 1, 0.04, 0.01)] },
        { cutoffPeriod: "2021-03-31", historyLength: 6, observations: [obs("sales-log-error", 1, -0.10, 0.03)] },
      ],
    } as unknown as CompanyWalkForward;
    expect(companyTrackRecord(result)).toEqual({
      ticker: "TCS",
      oneYearAhead: {
        // |0.02| < |−0.05| beats; |−0.10| > |0.03| does not; the t+2 row is excluded.
        "sales-log-error": { scored: 2, beatRandomWalk: 1 },
        "cni-roe-point-error": { scored: 1, beatRandomWalk: 0 },
      },
    });
  });
});
