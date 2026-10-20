import { describe, expect, it } from "vitest";
import { scoreFrozenForecasts, scoresBySet, summarizeBands, summarizeScores, type FiledScore, type FrozenScore, type FrozenToScore } from "..";

const score = (metric: FiledScore["metric"], model: number, randomWalk: number, extra: Partial<FiledScore> = {}): FiledScore =>
  ({ metric, periodEnd: "2026-03-31", horizon: 1, forecast: 0, actual: 0, model, randomWalk, ...extra });
const provisional = (months: number, periodEnd = "2027-03-31") => ({ periodEnd, provisional: { through: "2026-06-30", months } });

describe("frozen forecast scores", () => {
  it("counts a forecast as scored only on a filed year, and keeps the year in progress apart", () => {
    const results: FrozenScore[] = [
      { madeAt: "2026-10-19", ticker: "A", cutoff: "2025-03-31", skipped: null, scores: [score("sales-log-error", 0.1, 0.2), score("sales-log-error", 0.05, 0.1, provisional(3))] },
      { madeAt: "2026-10-19", ticker: "B", cutoff: "2026-03-31", skipped: null, scores: [score("sales-log-error", 0.02, 0.1, provisional(6))] },
      { madeAt: "2026-10-20", ticker: "A", cutoff: "2025-03-31", skipped: null, scores: [score("sales-log-error", 0.05, 0.1, provisional(3))] },
      { madeAt: "2026-10-20", ticker: "B", cutoff: "2026-03-31", skipped: "no as-filed ledger", scores: [] },
    ];
    const [first, second] = scoresBySet(results);
    expect(first).toMatchObject({ madeAt: "2026-10-19", forecasts: 2, scored: 1, provisionalMonths: null });
    expect(first!.final).toHaveLength(1);
    expect(first!.provisional).toHaveLength(2);
    expect(second).toMatchObject({ madeAt: "2026-10-20", forecasts: 2, scored: 0, provisionalMonths: 3 });
  });

  it("summarizes median errors, skill, bias and wins against the random walk", () => {
    const scores = [score("sales-log-error", 0.1, 0.2), score("sales-log-error", -0.3, 0.1), score("sales-log-error", 0.05, 0.4), score("cni-roe-point-error", 0.02, 0.01)];
    const [sales, margin, earnings] = summarizeScores(scores);
    expect(sales).toMatchObject({ n: 3, model: 0.1, randomWalk: 0.2, closer: 2 });
    expect(sales!.skill).toBeCloseTo(0.5);
    expect(sales!.bias).toBeCloseTo(-0.05);
    expect(margin!.n).toBe(0);
    expect(Number.isNaN(margin!.model)).toBe(true);
    expect(earnings).toMatchObject({ n: 1, closer: 0 });
  });

  it("shares out where filed figures fell against the frozen cases, and says nothing where none were frozen", () => {
    const band = (position: "below" | "within" | "above", actual: number) => ({ actual, band: { stress: 0, bull: 0, historicalPanic: 1, position } });
    const scores = [score("sales-log-error", 0, 0, band("below", 0.5)), score("sales-log-error", 0, 0, band("within", 2)), score("sales-log-error", 0, 0, band("within", 2)), score("sales-log-error", 0, 0, band("above", 3))];
    const [sales] = summarizeBands(scores)!;
    expect(sales).toMatchObject({ n: 4, below: 0.25, within: 0.5, above: 0.25, belowPanic: 0.25 });
    expect(summarizeBands([score("sales-log-error", 0, 0)])).toBeNull();
  });

  it("skips a company with no ledger, and a v1 forecast of a company whose later forecasts are standalone", () => {
    const snapshot = (ticker: string, madeAt: string, basis?: FrozenToScore["basis"]): FrozenToScore =>
      ({ ticker, madeAt, cutoffPeriod: "2025-03-31", years: [], ...(basis ? { basis } : {}) });
    const results = scoreFrozenForecasts(
      [
        snapshot("A", "2026-09-25"),
        snapshot("B", "2026-09-25"),
        snapshot("C", "2026-09-25"),
        snapshot("A", "2026-10-11", { accounts: "standalone", lendingArm: null }),
        snapshot("C", "2026-10-11", { accounts: "consolidated", lendingArm: null }),
      ],
      (ticker) => (ticker === "B" ? null : { years: [], yearsToDate: [] }),
    );
    const standalone = "a forecast on standalone accounts; the ledger is consolidated";
    // With no filed years, a forecast that reaches the scorer is skipped there.
    const scored = "no filing for the cutoff year 2025-03-31";
    expect(results.map((r) => [r.ticker, r.madeAt, r.skipped])).toEqual([
      ["A", "2026-09-25", standalone],
      ["B", "2026-09-25", "no as-filed ledger"],
      ["C", "2026-09-25", scored],
      ["A", "2026-10-11", standalone],
      ["C", "2026-10-11", scored],
    ]);
  });
});
