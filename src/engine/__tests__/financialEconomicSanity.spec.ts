/**
 * Economic sanity for banks, NBFCs and insurers. They never produce a
 * Penman-Nissim recast, so the industrial evaluator blocked every one of them
 * at "No recast periods available" and no financial could reach
 * economically-plausible, however clean its accounts.
 */
import { describe, expect, it } from "vitest";
import { evaluateFinancialEconomicSanity, type UnusualItemManifestLike } from "../economicSanityGates";
import { buildAnalysisTraceability } from "../analysisTraceability";
import type { BankPeriodMetrics } from "../bankPipeline";
import type { RawPeriodData } from "../types";

const year = (period_end: string, m: { pat?: number | null; equity?: number | null; roe?: number | null } = {}) =>
  ({
    period_end,
    pat: m.pat === undefined ? 14451 : m.pat,
    totalEquity: m.equity === undefined ? 76693 : m.equity,
    roe: m.roe === undefined ? 0.22 : m.roe,
  }) as unknown as BankPeriodMetrics;

const raw = (period_end: string, values: Record<string, number> = {}): RawPeriodData => ({
  company_id: "BAJFINANCE",
  period_end,
  raw_metric_values: values,
});

const YEARS = ["2022-03-31", "2023-03-31", "2024-03-31", "2025-03-31"];
const RAW = YEARS.map((y) => raw(y));

describe("evaluateFinancialEconomicSanity", () => {
  it("anchors on a clean latest year", () => {
    const s = evaluateFinancialEconomicSanity(YEARS.map((y) => year(y)), RAW);
    expect(s.status).toBe("passed");
    expect(s.anchorPeriod).toBe("2025-03-31");
  });

  it("blocks when there are no periods", () => {
    const s = evaluateFinancialEconomicSanity([], RAW);
    expect(s.status).toBe("blocked");
    expect(s.anchorPeriod).toBeNull();
  });

  it("walks past a year without positive equity", () => {
    const s = evaluateFinancialEconomicSanity([year("2023-03-31"), year("2024-03-31"), year("2025-03-31", { equity: -1200 })], RAW);
    expect(s.anchorPeriod).toBe("2024-03-31");
    expect(s.skippedPeriods).toEqual([{ period: "2025-03-31", reason: "financial-anchor-metrics" }]);
  });

  it("walks past a year with no profit filed", () => {
    const s = evaluateFinancialEconomicSanity([year("2024-03-31"), year("2025-03-31", { pat: null })], RAW);
    expect(s.anchorPeriod).toBe("2024-03-31");
  });

  it("keeps a loss year as an anchor: a loss is profit, not a missing line", () => {
    // SBI FY18 lost 4,556 Cr on positive equity.
    const s = evaluateFinancialEconomicSanity([year("2017-03-31"), year("2018-03-31", { pat: -4556, roe: -0.02 })], [raw("2018-03-31")]);
    expect(s.anchorPeriod).toBe("2018-03-31");
  });

  it("applies Check D: a discontinued-operations line read from the raw statements", () => {
    const s = evaluateFinancialEconomicSanity(
      [year("2024-03-31"), year("2025-03-31")],
      [raw("2024-03-31"), raw("2025-03-31", { "Profit / (Loss) From Discontinued Operations__ProfitLoss": -310 })],
    );
    expect(s.anchorPeriod).toBe("2024-03-31");
    expect(s.skippedPeriods[0]?.reason).toBe("demerger-discontinued-contamination");
  });

  it("applies Check A: a terminal-blocking unusual item", () => {
    const manifest: UnusualItemManifestLike[] = [{ period: "2025-03-31", affectsTerminalEligibility: true, category: "impairment" }];
    const s = evaluateFinancialEconomicSanity([year("2024-03-31"), year("2025-03-31")], RAW, undefined, manifest);
    expect(s.anchorPeriod).toBe("2024-03-31");
    expect(s.skippedPeriods[0]?.reason).toBe("terminal-period-contamination");
  });

  it("warns on an unexplained ROE jump of 30pp or more, and anchors anyway", () => {
    const s = evaluateFinancialEconomicSanity([year("2024-03-31", { roe: 0.18 }), year("2025-03-31", { roe: 0.5 })], RAW);
    expect(s.status).toBe("warned");
    expect(s.anchorPeriod).toBe("2025-03-31");
    expect(s.failedChecks.map((c) => c.checkId)).toEqual(["implausible-roe-jump"]);
  });

  it("does not warn when a capital event explains the ROE jump", () => {
    const s = evaluateFinancialEconomicSanity(
      [year("2024-03-31", { roe: 0.18 }), year("2025-03-31", { roe: 0.5 })],
      RAW,
      [{ periodEnd: "2025-03-31", kind: "capital-raise", detail: "QIP", confidence: "high" }],
    );
    expect(s.status).toBe("passed");
  });
});

describe("analysis traceability — economic sanity for a financial institution", () => {
  it("runs on the bank metrics instead of blocking on the empty recast", () => {
    const env = buildAnalysisTraceability({
      rawData: RAW,
      recastData: [],
      bankMetrics: YEARS.map((y) => year(y)),
      bankSubtype: "nbfc",
    } as never);
    expect(env.economicSanity?.status).toBe("passed");
    expect(env.economicSanity?.anchorPeriod).toBe("2025-03-31");
  });

  it("states the financial-institution cap on the valuation rungs", () => {
    // The audit harness marks a financial production-ready from history depth
    // alone; with no valuation evidence behind it, the ladder must not follow.
    // This fixture does not clear the lower rungs, so it pins the reason; the
    // cap itself is pinned on real data by auditCompanyRun.spec (HDFC Bank
    // reaches production-ready without it) and the Bajaj / HDFC Bank audits.
    const env = buildAnalysisTraceability({
      rawData: RAW,
      recastData: [],
      bankMetrics: YEARS.map((y) => year(y)),
      bankSubtype: "bank",
      analysisStatus: { status: "production-ready", valuationStatus: "production-ready" },
    } as never);
    const byLevel = Object.fromEntries(env.rigor.checkpoints.map((c) => [c.level, c]));
    expect(byLevel["valuation-eligible"]?.achieved).toBe(false);
    expect(byLevel["valuation-eligible"]?.detail).toMatch(/Financial institution/);
    expect(byLevel["production-ready"]?.achieved).toBe(false);
  });

  it("keeps the industrial evaluator when there are no bank metrics", () => {
    const env = buildAnalysisTraceability({ rawData: RAW, recastData: [] } as never);
    expect(env.economicSanity?.status).toBe("blocked");
    expect(env.economicSanity?.anchorReason).toMatch(/No recast periods/);
  });
});
