import { describe, expect, it } from "vitest";
import type { ForecastPeriod, RecastPeriod } from "../../types";
import {
  estimatePanelPersistence,
  priorFor,
  scoreForecast,
  summarizeWalkForward,
  type CompanyWalkForward,
  type RnoaSeries,
} from "..";

function period(year: number, v: { Sales: number; CoreOI: number; NOA: number; CNI: number; CSE: number }): RecastPeriod {
  return {
    period_end: `${year}-03-31`,
    bs: { NOA: v.NOA, CSE: v.CSE },
    is: { Sales: v.Sales, OI: v.CoreOI, CNI: v.CNI },
    cu: { CoreOI: v.CoreOI },
  } as unknown as RecastPeriod;
}

function forecastYear(v: { Sales_f: number; OI_f: number; NOA_f: number; CNI_f: number }): ForecastPeriod {
  return v as unknown as ForecastPeriod;
}

// Sales grow 10% a year; RNOA on opening NOA is 20%.
const history = [2019, 2020, 2021, 2022, 2023].map((year, i) =>
  period(year, { Sales: 1000 * 1.1 ** i, CoreOI: 200 * 1.1 ** (i - 1), NOA: 1000 * 1.1 ** i, CNI: 150 * 1.1 ** i, CSE: 900 * 1.1 ** i }),
);

describe("scoreForecast", () => {
  it("scores each metric against the actual and both naive benchmarks", () => {
    const actual2024 = period(2024, { Sales: 1400, CoreOI: 300, NOA: 1500, CNI: 200, CSE: 1400 });
    const forecast = [forecastYear({ Sales_f: 1500, OI_f: 292.82, NOA_f: 1600, CNI_f: 220 })];
    const observations = scoreForecast(history, forecast, [actual2024], 1);
    const byMetric = (metric: string) => observations.find((o) => o.metric === metric)!;
    const [sales, margin, rnoa, cni] = ["sales-log-error", "core-oi-margin-error", "core-rnoa-error", "cni-roe-point-error"].map(byMetric);
    const cutoff = history[4]!;

    // Operating margin error: OI error over ACTUAL sales.
    expect(margin!.model).toBeCloseTo((292.82 - 300) / 1400, 12);

    expect(sales!.metric).toBe("sales-log-error");
    expect(sales!.model).toBeCloseTo(Math.log(1500 / 1400), 12);
    expect(sales!.naive["random-walk"]).toBeCloseTo(Math.log(cutoff.is.Sales / 1400), 12);
    // Trailing 3-year CAGR is 10%: the trend benchmark projects one more year of it.
    expect(sales!.naive["trailing-trend"]).toBeCloseTo(Math.log((cutoff.is.Sales * 1.1) / 1400), 10);

    // RNOA on OPENING NOA for both sides: forecast OI / cutoff NOA, actual OI / cutoff NOA.
    expect(rnoa!.model).toBeCloseTo(292.82 / cutoff.bs.NOA - 300 / cutoff.bs.NOA, 12);

    // CNI error in ROE points on the actual opening equity.
    expect(cni!.model).toBeCloseTo((220 - 200) / cutoff.bs.CSE, 12);
    expect(cni!.naive["random-walk"]).toBeCloseTo((cutoff.is.CNI - 200) / cutoff.bs.CSE, 12);
  });

  it("skips RNOA on a near-zero NOA base but still scores the margin", () => {
    // Negative-working-capital company: opening NOA is 2% of sales.
    const tinyBase = history.map((p) => ({ ...p, bs: { ...p.bs, NOA: p.is.Sales * 0.02 } }));
    const actual2024 = period(2024, { Sales: 1400, CoreOI: 300, NOA: 30, CNI: 200, CSE: 1400 });
    const forecast = [forecastYear({ Sales_f: 1500, OI_f: 292.82, NOA_f: 30, CNI_f: 220 })];
    const metrics = scoreForecast(tinyBase, forecast, [actual2024], 1).map((o) => o.metric);
    expect(metrics).not.toContain("core-rnoa-error");
    expect(metrics).toContain("core-oi-margin-error");
  });

  it("matches forecasts to actuals by fiscal year, never by position", () => {
    // 2024 is missing from the data; the 2025 actual must pair with horizon 2.
    const actual2025 = period(2025, { Sales: 1600, CoreOI: 330, NOA: 1700, CNI: 230, CSE: 1600 });
    const forecast = [
      forecastYear({ Sales_f: 1500, OI_f: 290, NOA_f: 1600, CNI_f: 220 }),
      forecastYear({ Sales_f: 1650, OI_f: 320, NOA_f: 1760, CNI_f: 240 }),
    ];
    const observations = scoreForecast(history, forecast, [actual2025], 2);
    // Horizon 1 has no actual; horizon 2 has no actual OPENING balance (2024
    // missing), so nothing is scored rather than something mis-paired.
    expect(observations).toEqual([]);
  });
});

describe("summarizeWalkForward", () => {
  it("computes skill as 1 − MAE_model / MAE_naive", () => {
    const result: CompanyWalkForward = {
      schemaVersion: "2026-09-forecast-accountability-v1",
      ticker: "X",
      companyType: "consumer",
      skipped: [],
      origins: [{
        cutoffPeriod: "2023-03-31",
        historyLength: 5,
        observations: [
          { metric: "sales-log-error", horizon: 1, model: 0.1, naive: { "random-walk": -0.2, "trailing-trend": 0.05 } },
          { metric: "sales-log-error", horizon: 1, model: -0.1, naive: { "random-walk": 0.2, "trailing-trend": -0.05 } },
        ],
      }],
    };
    const [row] = summarizeWalkForward([result]).rows;
    expect(row!.modelMae).toBeCloseTo(0.1, 12);
    expect(row!.modelBias).toBeCloseTo(0, 12);
    expect(row!.skill["random-walk"]).toBeCloseTo(0.5, 12);
    expect(row!.skill["trailing-trend"]).toBeCloseTo(-1, 12);
    expect(row!.modelMdae).toBeCloseTo(0.1, 12);
    expect(row!.medianSkill["random-walk"]).toBeCloseTo(0.5, 12);
    expect(row!.winRateVsRandomWalk).toBe(1);
  });
});

describe("estimatePanelPersistence", () => {
  /** Deviations from a common 12% level follow s(t+1) = φ·s(t) exactly. */
  function panel(phi: number, group: string, starts: readonly number[]): RnoaSeries[] {
    return starts.map((s0, i) => ({
      companyId: `${group}-${i}`,
      group,
      points: Array.from({ length: 12 }, (_, t) => ({ year: 2010 + t, rnoa: 0.12 + s0 * phi ** t })),
    }));
  }

  it("recovers the fade rate of a known panel", () => {
    // Symmetric starts keep the cross-sectional median at exactly 12%.
    const series = panel(0.6, "consumer", [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
    const all = priorFor(estimatePanelPersistence(series), "consumer")!;
    expect(all.phi).toBeGreaterThan(0.5);
    expect(all.phi).toBeLessThan(0.7);
  });

  it("falls back to the pooled estimate for a group too small for its own prior", () => {
    const series = [
      ...panel(0.6, "consumer", [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]),
      ...panel(0.6, "telecom", [0.25]),
    ];
    const estimates = estimatePanelPersistence(series);
    expect(estimates.find((e) => e.group === "telecom")).toBeUndefined();
    expect(priorFor(estimates, "telecom")!.group).toBe("all");
  });
});

describe("forecast snapshot ledger", () => {
  it("is scored later against actuals reported after its cutoff, and only those", async () => {
    const { buildForecastSnapshot, scoreSnapshot } = await import("..");
    const snapshot = buildForecastSnapshot({
      ticker: "X",
      companyType: "consumer",
      madeAt: "2026-09-25",
      cutoff: history[4]!,
      forecast: [forecastYear({ Sales_f: 1500, OI_f: 292.82, NOA_f: 1600, CNI_f: 220 })],
      assumptions: { ke: 0.12, kw: 0.1, g: 0.04 },
      intrinsicPerShare: null,
    });
    expect(snapshot.years[0]!.periodEnd).toBe("2024-03-31");

    // Nothing reported yet: nothing to score.
    expect(scoreSnapshot(snapshot, history).observations).toEqual([]);

    // FY2024 arrives: the frozen forecast is scored exactly as the backtest scores.
    const actual2024 = period(2024, { Sales: 1400, CoreOI: 300, NOA: 1500, CNI: 200, CSE: 1400 });
    const scored = scoreSnapshot(snapshot, [...history, actual2024]);
    expect(scored.reportedYears).toBe(1);
    const direct = scoreForecast(history, [forecastYear({ Sales_f: 1500, OI_f: 292.82, NOA_f: 1600, CNI_f: 220 })], [actual2024], 1);
    expect(scored.observations.map((o) => o.model)).toEqual(direct.map((o) => o.model));
  });
});
