import { describe, expect, it } from "vitest";
import { mergePeriodSpecFlags, processCompanyDataFull } from "../pipeline";
import { DEFAULT_CONFIG, Severity } from "../types";
import type { RawPeriodData, SpecFlag } from "../types";

const PERIOD = "2025-03-31";

function flag(overrides: Partial<SpecFlag> = {}): SpecFlag {
  return {
    spec_id: "MISSING_REQUIRED_IS_PBT",
    severity: Severity.WARNING,
    label: "MAPPING_MISS",
    message: "missing mapping",
    affects_terminal: false,
    period: PERIOD,
    ...overrides,
  };
}

function rawPeriod(period_end: string, equity: number): RawPeriodData {
  return {
    company_id: "FLAGCO",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1000,
      "Total Shareholders Funds__BalanceSheet": equity,
      "Long Term Borrowings__BalanceSheet": 200,
      "Other Non-Current Liabilities__BalanceSheet": 1000 - equity - 200,
      "Revenue From Operations__ProfitLoss": 500,
      "Total Expenses__ProfitLoss": 400,
      "Profit After Tax__ProfitLoss": 50,
      "Net Cash From Operating Activities__CashFlow": 80,
      "Dividends Paid__CashFlow": 0,
    },
  };
}

describe("period quality-signal merge", () => {
  it("deduplicates by period and spec id while retaining the strongest risk semantics", () => {
    const mapping = flag();
    const duplicate = flag({
      severity: Severity.CRITICAL,
      message: "duplicate producer message",
      affects_terminal: true,
    });
    const anomaly = flag({
      spec_id: "S-5.1",
      severity: Severity.CRITICAL,
      label: "STRUCTURAL_EVENT",
      message: "dirty surplus",
      affects_terminal: true,
    });
    const sameRuleFamilyDifferentSignal = flag({
      spec_id: "S-5.1",
      severity: Severity.WARNING,
      label: "CLEAN_SURPLUS_VIOLATED",
      message: "distinct signal in the same policy section",
    });

    const merged = mergePeriodSpecFlags(
      PERIOD,
      [mapping],
      [duplicate, anomaly, sameRuleFamilyDifferentSignal, flag({ period: "2024-03-31", spec_id: "WRONG_PERIOD" })],
    );

    expect(merged.map((entry) => entry.label)).toEqual([
      "MAPPING_MISS",
      "STRUCTURAL_EVENT",
      "CLEAN_SURPLUS_VIOLATED",
    ]);
    expect(merged[0]).toMatchObject({
      label: "MAPPING_MISS",
      severity: Severity.CRITICAL,
      affects_terminal: true,
    });
  });

  it("preserves recast mapping misses alongside anomaly flags in the full pipeline", () => {
    const result = processCompanyDataFull(
      [rawPeriod("2024-03-31", 300), rawPeriod(PERIOD, 50)],
      {
        ...DEFAULT_CONFIG,
        DS_warning_pct: 0.01,
        DS_critical_pct: 0.02,
      },
    );
    const latestFlags = result.periods.find((period) => period.period_end === PERIOD)?.spec_flags ?? [];

    expect(latestFlags.some((entry) => entry.label.startsWith("MAPPING_MISS"))).toBe(true);
    expect(latestFlags.some((entry) => entry.spec_id === "S-5.1")).toBe(true);
    expect(new Set(latestFlags.map((entry) => `${entry.period}:${entry.spec_id}:${entry.label}`)).size).toBe(latestFlags.length);
  });
});
