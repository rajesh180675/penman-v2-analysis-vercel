import { describe, expect, it } from "vitest";
import { evaluateParserFidelity } from "../parserFidelity";
import { parseScreenerTabDelimitedDetailed } from "../screenerParser";
import { parseRawPeriodsJsonDetailed } from "../jsonIngestion";
import { diagnoseManualRawPeriods } from "../manualEntryParser";
import { RawPeriodData } from "../types";

describe("parser fidelity diagnostics", () => {
  it("fails screener fidelity when source rows contain native parse anomalies", () => {
    const screener = [
      "Metric\t2024\tTTM",
      "Revenue\tabc\t110",
      "Revenue\t120\t130",
    ].join("\n");
    const { periods, diagnostics } = parseScreenerTabDelimitedDetailed(screener, { companyId: "SCR" });
    const fidelity = evaluateParserFidelity({
      sourceMode: "screener",
      rawData: periods,
      parserDiagnostics: diagnostics,
    });

    expect(diagnostics.errorCount).toBeGreaterThan(0);
    expect(diagnostics.warningCount).toBeGreaterThan(0);
    expect(fidelity.status).toBe("failed");
    expect(fidelity.summary).toContain("Parser fidelity failed");
  });

  it("degrades json fidelity when the payload has duplicate periods", () => {
    const json = JSON.stringify([
      {
        company_id: "JSONCO",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 100,
          "Total Equity__BalanceSheet": 60,
          "Revenue From Operations(Net)__ProfitLoss": 90,
          "Net Cash from Operating Activities__CashFlow": 20,
        },
      },
      {
        company_id: "JSONCO",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 120,
          "Total Equity__BalanceSheet": 70,
          "Revenue From Operations(Net)__ProfitLoss": 95,
          "Net Cash from Operating Activities__CashFlow": 22,
        },
      },
    ]);
    const { periods, diagnostics } = parseRawPeriodsJsonDetailed(json);
    const fidelity = evaluateParserFidelity({
      sourceMode: "json",
      rawData: periods,
      parserDiagnostics: diagnostics,
    });

    expect(diagnostics.warningCount).toBeGreaterThan(0);
    expect(fidelity.status).toBe("degraded");
    expect(fidelity.checks.some((check) => check.id === "json-duplicate-periods" && !check.passed)).toBe(true);
  });

  it("fails loud on invalid json metric types", () => {
    const invalidJson = JSON.stringify([
      {
        company_id: "JSONCO",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": "oops",
        },
      },
    ]);

    expect(() => parseRawPeriodsJsonDetailed(invalidJson)).toThrow("finite numbers or null");
  });

  it("degrades manual fidelity when periods are incomplete", () => {
    const rawData: RawPeriodData[] = [
      {
        company_id: "MANUALCO",
        period_end: "2024-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 100,
          "Total Equity__BalanceSheet": 60,
          "Revenue From Operations(Net)__ProfitLoss": 90,
          "Net Cash from Operating Activities__CashFlow": 20,
        },
      },
      {
        company_id: "MANUALCO",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 120,
          "Total Equity__BalanceSheet": 70,
          "Revenue From Operations(Net)__ProfitLoss": 0,
          "Net Cash from Operating Activities__CashFlow": 22,
        },
      },
    ];
    const diagnostics = diagnoseManualRawPeriods(rawData);
    const fidelity = evaluateParserFidelity({
      sourceMode: "manual",
      rawData,
      parserDiagnostics: diagnostics,
    });

    expect(diagnostics.warningCount).toBeGreaterThan(0);
    expect(fidelity.status).toBe("degraded");
    expect(fidelity.checks.some((check) => check.id === "manual-operating-core" && !check.passed)).toBe(true);
  });
});
