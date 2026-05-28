import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";

const productionReadyStatus = {
  status: "production-ready" as const,
  label: "Production-ready",
  headline: "Analysis cleared current release checks",
  summary: "No blocking scope or valuation issues were detected for the loaded dataset.",
  reasons: [],
  tone: "emerald" as const,
  qualityTier: "Tier 1" as const,
  valuationStatus: "production-ready" as const,
  scopeBlocked: false,
  valuationBlocked: false,
  blockingCount: 0,
  diagnosticCount: 0,
  optionalCount: 0,
};

describe("analysis traceability confidence gates", () => {
  it("blocks confidence when parser fidelity fails even if mapping status is otherwise production-ready", () => {
    const traceability = buildAnalysisTraceability({
      sourceMode: "manual",
      periodCount: 0,
      rawMetricKeyCount: 0,
      analysisStatus: productionReadyStatus,
    });

    expect(traceability.parserFidelity.status).toBe("failed");
    expect(traceability.confidence.status).toBe("blocked");
    expect(traceability.confidence.tone).toBe("red");
    expect(traceability.confidence.headline).toContain("Parser fidelity failed");
  });

  it("passes confidence through when parser fidelity is confirmed", () => {
    const rawData = Array.from({ length: 3 }, (_, i) => ({
      company_id: "FIXCO",
      period_end: `202${3 + i}-03-31`,
      raw_metric_values: Object.fromEntries(
        Array.from({ length: 20 }, (_, j) => [`metric_${j}__BalanceSheet`, 100 + j]),
      ),
    }));
    const traceability = buildAnalysisTraceability({
      sourceMode: "manual",
      periodCount: 3,
      rawMetricKeyCount: 20,
      rawData,
      analysisStatus: productionReadyStatus,
    });

    expect(traceability.parserFidelity.status).not.toBe("failed");
    expect(traceability.confidence.status).toBe("production-ready");
    expect(traceability.confidence.tone).toBe("emerald");
  });

  it("passes confidence through when parser fidelity is degraded (not failed)", () => {
    const guardedStatus = {
      ...productionReadyStatus,
      status: "guarded" as const,
      tone: "amber" as const,
      headline: "Review diagnostics before relying on output",
    };
    // Provide rawData with enough density (>=4 per period for manual=2 threshold)
    // but add a parserDiagnostics warning to force degraded (not confirmed)
    const rawData = [
      {
        company_id: "DEGCO",
        period_end: "2024-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 100,
          "Total Equity__BalanceSheet": 60,
          "Revenue From Operations(Net)__ProfitLoss": 90,
          "Net Cash from Operating Activities__CashFlow": 20,
          "Finance Cost__ProfitLoss": 5,
          "Depreciation And Amortization Expenses__ProfitLoss": 8,
        },
      },
      {
        company_id: "DEGCO",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 120,
          "Total Equity__BalanceSheet": 70,
          "Revenue From Operations(Net)__ProfitLoss": 95,
          "Net Cash from Operating Activities__CashFlow": 22,
          "Finance Cost__ProfitLoss": 6,
          "Depreciation And Amortization Expenses__ProfitLoss": 9,
        },
      },
    ];
    const parserDiagnostics = {
      sourceMode: "manual",
      warningCount: 1,
      errorCount: 0,
      checks: [],
    };
    const traceability = buildAnalysisTraceability({
      sourceMode: "manual",
      periodCount: 2,
      rawMetricKeyCount: 6,
      rawData,
      parserDiagnostics,
      analysisStatus: guardedStatus,
    });

    // degraded is not failed, so confidence is not overridden to blocked
    expect(traceability.parserFidelity.status).not.toBe("failed");
    expect(traceability.confidence.status).toBe("guarded");
    expect(traceability.confidence.tone).toBe("amber");
  });
});
