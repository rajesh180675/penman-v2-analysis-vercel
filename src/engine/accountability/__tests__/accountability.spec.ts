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

  it("counts a firm that stopped filing after one year-pair in the pooled slope", () => {
    const survivors = panel(0.6, "consumer", [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
    // Three firms filed 2010 and 2011 only; symmetric, so no year's median moves.
    const exits: RnoaSeries[] = [-0.05, 0, 0.05].map((s0, i) => ({
      companyId: `exit-${i}`,
      group: "consumer",
      points: [{ year: 2010, rnoa: 0.12 + s0 }, { year: 2011, rnoa: 0.12 + s0 * 0.6 }],
    }));
    const without = priorFor(estimatePanelPersistence(survivors), "all")!;
    const withExits = priorFor(estimatePanelPersistence([...survivors, ...exits]), "all")!;
    expect(withExits.companies).toBe(without.companies + 3);
    expect(withExits.pairs).toBe(without.pairs + 3);
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
      basis: { accounts: "consolidated", lendingArm: "X Finance" },
      forecast: [forecastYear({ Sales_f: 1500, OI_f: 292.82, NOA_f: 1600, CNI_f: 220 })],
      scenarios: {
        stress: [forecastYear({ Sales_f: 1300, OI_f: 200, NOA_f: 1550, CNI_f: 150 })],
        bull: [forecastYear({ Sales_f: 1700, OI_f: 380, NOA_f: 1650, CNI_f: 290 })],
        historicalPanic: [forecastYear({ Sales_f: 1200, OI_f: 150, NOA_f: 1500, CNI_f: 100 })],
      },
      assumptions: { ke: 0.12, kw: 0.1, g: 0.04 },
      intrinsicPerShare: null,
    });
    expect(snapshot.years[0]!.periodEnd).toBe("2024-03-31");
    // The record says what it forecasts, so it is scored against the same business.
    expect(snapshot.basis).toEqual({ accounts: "consolidated", lendingArm: "X Finance" });
    // And the year it started from, so its margin can be scored as a move from there.
    expect(snapshot.anchor).toEqual({
      periodEnd: history[4]!.period_end, sales: history[4]!.is.Sales, operatingIncome: history[4]!.cu.CoreOI,
      noa: history[4]!.bs.NOA, cni: history[4]!.is.CNI, cse: history[4]!.bs.CSE,
    });
    // And the other cases, dated as the base is, so the band a filed year lands in can be scored.
    expect(snapshot.scenarios.stress.map((y) => [y.periodEnd, y.sales, y.cni])).toEqual([["2024-03-31", 1300, 150]]);
    expect(snapshot.scenarios.bull[0]!.operatingIncome).toBe(380);
    expect(snapshot.scenarios.historicalPanic[0]!.sales).toBe(1200);

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

describe("frozen forecasts scored against filings", () => {
  const snapshot = (over: Record<string, unknown> = {}) => ({
    schemaVersion: "2026-10-forecast-snapshot-v2",
    ticker: "X", companyType: "consumer", madeAt: "2026-10-11", cutoffPeriod: "2025-03-31", model: "command-center-base",
    basis: { accounts: "consolidated", lendingArm: null },
    assumptions: { ke: 0.12, kw: 0.1, g: 0.04 },
    years: [
      { periodEnd: "2026-03-31", sales: 1100, operatingIncome: 110, noa: 900, cni: 105, cse: 1050 },
      { periodEnd: "2027-03-31", sales: 1200, operatingIncome: 120, noa: 950, cni: 110, cse: 1100 },
    ],
    intrinsicPerShare: null,
    latestReportedPeriod: "2025-03-31",
    ...over,
  });
  const filings = [
    { fiscalYearEnd: "2025-03-31", revenue: 1040, exciseDuty: 40, profitAttributableToOwners: 100, equityAttributableToOwners: 1000 },
    { fiscalYearEnd: "2026-03-31", revenue: 1100, exciseDuty: 0, profitAttributableToOwners: 120, equityAttributableToOwners: 1080 },
  ];

  it("scores the years the forecast's data never reached, against first filings, on one basis", async () => {
    const { scoreSnapshotAgainstFilings } = await import("..");
    const { scores, skipped } = scoreSnapshotAgainstFilings(snapshot() as never, filings);
    expect(skipped).toBeNull();
    // FY2027 is not filed yet: only FY2026 is scored.
    expect(scores.map((s) => `${s.metric}@${s.periodEnd}`)).toEqual(["sales-log-error@2026-03-31", "cni-roe-point-error@2026-03-31"]);
    const sales = scores.find((s) => s.metric === "sales-log-error")!;
    expect(sales.model).toBeCloseTo(0, 12); // 1,100 against 1,100
    // The cutoff year's revenue net of its 40 excise: 1,000.
    expect(sales.randomWalk).toBeCloseTo(Math.log(1000 / 1100), 12);
    const cni = scores.find((s) => s.metric === "cni-roe-point-error")!;
    expect(cni.model).toBeCloseTo((105 - 120) / 1000, 12);
    expect(cni.randomWalk).toBeCloseTo((100 - 120) / 1000, 12);
    // The figures behind each error, for a reader to see: net sales, owners' profit.
    expect([sales.forecast, sales.actual, cni.forecast, cni.actual]).toEqual([1100, 1100, 105, 120]);
  });

  it("reads each fiscal year as first filed, not as revised later", async () => {
    const { firstFiledYears } = await import("..");
    const record = (fiscalYearEnd: string, filingDate: string, revenue: number) => ({
      fiscalYearEnd, filingDate,
      headline: { revenue, exciseDuty: null, profitAttributableToOwners: 10, equityAttributableToOwners: 100 },
    });
    const years = firstFiledYears([
      record("2026-03-31", "2026-07-30T10:00", 999), // a revision, filed after the first
      record("2026-03-31", "2026-05-02T18:00", 1100),
      record("2025-03-31", "2025-05-03T18:00", 1000),
    ]);
    expect(years.map((y) => `${y.fiscalYearEnd}:${y.revenue}`)).toEqual(["2025-03-31:1000", "2026-03-31:1100"]);
  });

  it("does not measure core operating income from a filing that contradicts itself on profit", async () => {
    const { firstFiledYears } = await import("..");
    const headline = { revenue: 1000, expenses: 850, financeCosts: 50, profitBeforeTax: 240, taxExpense: 60, profitAttributableToOwners: 180, equityAttributableToOwners: 900 };
    const [sound, contradicted] = firstFiledYears([
      { fiscalYearEnd: "2021-03-31", filingDate: "2021-05-01", headline: { ...headline, profitAfterTax: 180, profitAttributableToNonControllingInterests: 0 } },
      // Asian Paints FY2022-shaped: owners' 180 + minority 0 against a filed PAT of 540.
      { fiscalYearEnd: "2022-03-31", filingDate: "2022-05-01", headline: { ...headline, profitAfterTax: 540, profitAttributableToNonControllingInterests: 0 } },
    ]);
    expect(sound!.coreOperatingIncome).toBeCloseTo(150, 9);
    expect(contradicted!.coreOperatingIncome).toBeNull();
  });

  it("does not score a year the forecast's data covered: an anchor that walked back saw it", async () => {
    const { scoreSnapshotAgainstFilings } = await import("..");
    const walkedBack = snapshot({ cutoffPeriod: "2025-03-31", latestReportedPeriod: "2026-03-31" });
    expect(scoreSnapshotAgainstFilings(walkedBack as never, filings).scores).toEqual([]);
  });

  it("scores the core margin as a move from the cutoff year, so a gap in how the level is measured cancels", async () => {
    const { scoreSnapshotAgainstFilings } = await import("..");
    // The forecast starts from a 12% margin (120 / 1,000) and assumes 10% (110 / 1,100) a year out.
    const withAnchor = snapshot({ schemaVersion: "2026-10-forecast-snapshot-v3", anchor: { sales: 1000, operatingIncome: 120 } });
    // Filed at 11% in the cutoff year (110 on net revenue of 1,000) and 9% (99 / 1,100) since.
    const filed = [{ ...filings[0]!, coreOperatingIncome: 110 }, { ...filings[1]!, coreOperatingIncome: 99 }];
    const margin = scoreSnapshotAgainstFilings(withAnchor as never, filed).scores.find((s) => s.metric === "core-margin-point-error")!;
    // The forecast moved 2 points down and the filings did too: no error, though its 10% sits a point above the filed 9%.
    expect(margin.forecast).toBeCloseTo(0.09, 12);
    expect(margin.actual).toBeCloseTo(0.09, 12);
    expect(margin.model).toBeCloseTo(0, 12);
    expect(margin.randomWalk).toBeCloseTo(0.02, 12);
    expect(scoreSnapshotAgainstFilings(withAnchor as never, filed).scores.map((s) => s.metric)).toEqual(["sales-log-error", "core-margin-point-error", "cni-roe-point-error"]);
    // A v2 snapshot does not record where it started: its margin is not scored.
    expect(scoreSnapshotAgainstFilings(snapshot() as never, filed).scores.some((s) => s.metric === "core-margin-point-error")).toBe(false);
    // Nor is a year whose filing lacks the lines core operating income is built from.
    expect(scoreSnapshotAgainstFilings(withAnchor as never, filings).scores.some((s) => s.metric === "core-margin-point-error")).toBe(false);
  });

  it("places each filed figure against the frozen stress and bull cases, compared as the base case is", async () => {
    const { scoreSnapshotAgainstFilings } = await import("..");
    const year = (periodEnd: string, sales: number, operatingIncome: number, cni: number) => ({ periodEnd, sales, operatingIncome, noa: 900, cni, cse: 1000 });
    const withScenarios = snapshot({
      schemaVersion: "2026-10-forecast-snapshot-v4",
      anchor: { sales: 1000, operatingIncome: 120 },
      scenarios: {
        // Matched by fiscal year, never by position.
        stress: [year("2027-03-31", 1000, 80, 85), year("2026-03-31", 950, 76, 80)],
        bull: [year("2026-03-31", 1050, 136.5, 125)],
        historicalPanic: [year("2026-03-31", 900, 63, 60)],
      },
    });
    // Filed: net sales 1,100, a 9% core margin (11% in the cutoff year), owners' profit 70.
    const filed = [{ ...filings[0]!, coreOperatingIncome: 110 }, { ...filings[1]!, coreOperatingIncome: 99, profitAttributableToOwners: 70 }];
    const scores = scoreSnapshotAgainstFilings(withScenarios as never, filed).scores;
    const at = (metric: string) => scores.find((s) => s.metric === metric)!.band!;
    expect(at("sales-log-error")).toEqual({ stress: 950, bull: 1050, historicalPanic: 900, position: "above" });
    // The cases' margins move from the cutoff year's filed 11% as the base's does: 8% → 7%, 13% → 12%, 7% → 6%.
    const margin = at("core-margin-point-error");
    expect([margin.stress, margin.bull, margin.historicalPanic].map((x) => x.toFixed(12))).toEqual([0.07, 0.12, 0.06].map((x) => x.toFixed(12)));
    expect(margin.position).toBe("within");
    expect(at("cni-roe-point-error")).toEqual({ stress: 80, bull: 125, historicalPanic: 60, position: "below" });
    // A snapshot that records no other cases places nothing.
    expect(scoreSnapshotAgainstFilings(snapshot({ anchor: { sales: 1000, operatingIncome: 120 } }) as never, filed).scores.every((s) => !("band" in s))).toBe(true);
  });

  it("projects the year in progress from the months filed so far, against the same months a year before", async () => {
    const { scoreSnapshotAgainstFilings } = await import("..");
    const withAnchor = snapshot({ schemaVersion: "2026-10-forecast-snapshot-v3", anchor: { sales: 1000, operatingIncome: 120 } });
    // Filed at 11% in the cutoff year (110 on net revenue of 1,000) and 9% (99 / 1,100) in FY2026.
    const filed = [{ ...filings[0]!, coreOperatingIncome: 110 }, { ...filings[1]!, coreOperatingIncome: 99 }];
    const ytd = (fiscalYearEnd: string, periodEnd: string, months: number, revenue: number, coreOperatingIncome: number) =>
      ({ fiscalYearEnd, periodEnd, months, revenue, exciseDuty: null, coreOperatingIncome });
    const yearsToDate = [
      ytd("2026-03-31", "2025-06-30", 3, 260, 26),
      ytd("2026-03-31", "2025-09-30", 6, 520, 52), // 10%
      ytd("2027-03-31", "2026-06-30", 3, 280, 28),
      ytd("2027-03-31", "2026-09-30", 6, 572, 62.92), // 10% more sales, at 11%
      ytd("2027-03-31", "2026-12-31", 9, 900, 99), // no nine months a year before: not used
    ];
    const scores = scoreSnapshotAgainstFilings(withAnchor as never, filed, yearsToDate).scores.filter((s) => s.periodEnd === "2027-03-31");
    // FY2027 sales projected at FY2026's 1,100 grown as the half year grew: 1,210. No earnings for a part year.
    expect(scores.map((s) => s.metric)).toEqual(["sales-log-error", "core-margin-point-error"]);
    const [sales, margin] = scores as [typeof scores[number], typeof scores[number]];
    expect(sales.provisional).toEqual({ through: "2026-09-30", months: 6 });
    expect(sales.actual).toBeCloseTo(1210, 9);
    expect(sales.model).toBeCloseTo(Math.log(1200 / 1210), 12);
    expect(sales.randomWalk).toBeCloseTo(Math.log(1000 / 1210), 12);
    // Its margin is FY2026's 9% moved a point, as the half year's moved: 10%. The forecast's, on the filed basis, is 9%.
    expect(margin.actual).toBeCloseTo(0.1, 12);
    expect(margin.model).toBeCloseTo(-0.01, 12);
    expect(margin.randomWalk).toBeCloseTo(0.01, 12);
    // Filed, the year is scored on its filing, and nothing is provisional.
    const filedYear = { fiscalYearEnd: "2027-03-31", revenue: 1180, exciseDuty: 0, profitAttributableToOwners: 125, equityAttributableToOwners: 1150, coreOperatingIncome: 118 };
    const final = scoreSnapshotAgainstFilings(withAnchor as never, [...filed, filedYear], yearsToDate).scores.filter((s) => s.periodEnd === "2027-03-31");
    expect(final.map((s) => s.metric)).toEqual(["sales-log-error", "core-margin-point-error", "cni-roe-point-error"]);
    expect(final.every((s) => !s.provisional)).toBe(true);
    expect(final[0]!.actual).toBe(1180);
  });

  it("reads each year to date as first filed, its tax judged against the full years before it", async () => {
    const { firstFiledYearsToDate } = await import("..");
    const year = (fiscalYearEnd: string) => ({
      fiscalYearEnd, filingDate: `${fiscalYearEnd.slice(0, 4)}-05-01`,
      headline: { revenue: 1000, expenses: 850, financeCosts: 50, profitBeforeTax: 200, taxExpense: 50, profitAttributableToOwners: 150, equityAttributableToOwners: 900 },
    });
    const half = (filingDate: string, taxExpense: number) => ({
      periodEnd: "2026-09-30", fiscalYearEnd: "2027-03-31", months: 6, filingDate,
      headline: { revenue: 500, expenses: 425, financeCosts: 25, profitBeforeTax: 100, taxExpense, profitAttributableToOwners: 75, equityAttributableToOwners: 950 },
    });
    const annual = ["2024-03-31", "2025-03-31", "2026-03-31"].map(year);
    // A revision filed later is not the half year as first filed.
    const [first] = firstFiledYearsToDate([half("2026-12-01", 99), half("2026-10-20", 25)], annual);
    expect(first).toMatchObject({ periodEnd: "2026-09-30", fiscalYearEnd: "2027-03-31", months: 6, revenue: 500 });
    // Operating profit before tax 100 at the half year's 25%.
    expect(first!.coreOperatingIncome).toBeCloseTo(75, 9);
    // At 5%, more than 10 points under the three years before (25% each), it is taxed at their 25%.
    expect(firstFiledYearsToDate([half("2026-10-20", 5)], annual)[0]!.coreOperatingIncome).toBeCloseTo(75, 9);
    // Without those years there is no normal rate to judge it by.
    expect(firstFiledYearsToDate([half("2026-10-20", 5)], [])[0]!.coreOperatingIncome).toBeCloseTo(95, 9);
  });

  it("does not score a forecast of a business the consolidated filings do not describe", async () => {
    const { scoreSnapshotAgainstFilings } = await import("..");
    expect(scoreSnapshotAgainstFilings(snapshot({ basis: { accounts: "consolidated", lendingArm: "X Finance" } }) as never, filings).skipped).toMatch(/without X Finance/);
    expect(scoreSnapshotAgainstFilings(snapshot({ basis: { accounts: "standalone", lendingArm: null } }) as never, filings).skipped).toMatch(/standalone/);
  });

  it("stops at a business sold or demerged after the cutoff: that year and later ones describe another business", async () => {
    const { businessChangeNote, scoreSnapshotAgainstFilings } = await import("..");
    const fy2027 = { fiscalYearEnd: "2027-03-31", revenue: 1180, exciseDuty: 0, profitAttributableToOwners: 125, equityAttributableToOwners: 1150 };
    const years = (result: { scores: readonly { periodEnd: string }[] }) => [...new Set(result.scores.map((s) => s.periodEnd))];
    // FY2027 files 30 of discontinued operations on 1,180 of revenue (2.5%): FY2026 is still scored, FY2027 is not.
    const later = scoreSnapshotAgainstFilings(snapshot() as never, [...filings, { ...fy2027, discontinuedOperations: 30 }]);
    expect(years(later)).toEqual(["2026-03-31"]);
    expect(later.businessChange).toEqual({ fiscalYearEnd: "2027-03-31", discontinuedOperations: 30 });
    expect(later.skipped).toBeNull();
    // Two disposals: the comparison ends at the first.
    const twice = scoreSnapshotAgainstFilings(snapshot() as never, [filings[0]!, { ...filings[1]!, discontinuedOperations: 20 }, { ...fy2027, discontinuedOperations: 30 }]);
    expect([twice.scores, twice.businessChange]).toEqual([[], { fiscalYearEnd: "2026-03-31", discontinuedOperations: 20 }]);
    // A loss on the business sold counts as a gain does.
    expect(years(scoreSnapshotAgainstFilings(snapshot() as never, [...filings, { ...fy2027, discontinuedOperations: -30 }]))).toEqual(["2026-03-31"]);
    // In the first forecast year, nothing is scored, the year in progress after it included (HUL FY2026-shaped):
    // its months a year before were first filed with the business.
    const ytd = (fiscalYearEnd: string, periodEnd: string, revenue: number) => ({ fiscalYearEnd, periodEnd, months: 3, revenue, exciseDuty: null, coreOperatingIncome: null });
    const first = scoreSnapshotAgainstFilings(
      snapshot() as never,
      [filings[0]!, { ...filings[1]!, discontinuedOperations: 20 }],
      [ytd("2026-03-31", "2025-06-30", 260), ytd("2027-03-31", "2026-06-30", 280)],
    );
    expect(first.scores).toEqual([]);
    expect(first.skipped).toBe(businessChangeNote({ fiscalYearEnd: "2026-03-31", discontinuedOperations: 20 }));
    expect(first.skipped).toBe("the 2026-03-31 filing reports ₹20 Cr of discontinued operations, a business sold or demerged since, so it and later years describe another business");
    // Under 0.5% of revenue (4 on 1,100), or in the cutoff year the forecast was built on, it changes nothing.
    expect(years(scoreSnapshotAgainstFilings(snapshot() as never, [filings[0]!, { ...filings[1]!, discontinuedOperations: 4 }, fy2027]))).toEqual(["2026-03-31", "2027-03-31"]);
    const atCutoff = scoreSnapshotAgainstFilings(snapshot() as never, [{ ...filings[0]!, discontinuedOperations: 40 }, filings[1]!, fy2027]);
    expect([years(atCutoff), atCutoff.businessChange]).toEqual([["2026-03-31", "2027-03-31"], null]);
  });
});
