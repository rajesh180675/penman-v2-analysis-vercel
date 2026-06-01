import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import type { RecastPeriod } from "../types";

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

function mkTraceabilityRecastPeriod(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000,
      CSE: 600,
      MI: 0,
      FA: 200,
      FO: 150,
      OA: 800,
      OL: 250,
      NOA: 600,
      NFO: 0,
    },
    is: {
      Sales: 900,
      TaxExpense: 30,
      taxRate: 0.25,
      PAT: 90,
      OCI: 0,
      TCI: 90,
      TCI_NCI: 0,
      CNI: 90,
      FinanceCost: 12,
      FinanceIncome: 2,
      FinanceIncomeRung: 1,
      PreferredDividend: 0,
      NFE: 10,
      OI: 100,
      OtherItems: 0,
      MII: 0,
      COGS: 600,
    },
    cu: {
      UOI: 0,
      CoreOI: 100,
      UFE: 0,
      CoreNFE: 10,
      ExceptionalItemsAfterTax: 0,
      OCITotal: 0,
    },
    cf: {
      CFO: 120,
      Capex: 40,
      DividendPaid: 20,
      EquityIssued: 0,
      ShareBuybacks: 0,
      InterestReceived: 0,
      DividendReceived: 0,
      FCF_accounting: 60,
      FCF_cash: 80,
      d_t: 20,
      d_t_formula: 20,
      d_t_discrepancy: 0,
      EBITDA: 140,
    },
    trace: {},
  } as RecastPeriod;
}

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

  it("fails closed above structurally-reconciled when independent valuation paradigms diverge materially", () => {
    const rawData = Array.from({ length: 2 }, (_, i) => ({
      company_id: "DIVERGECO",
      period_end: `202${4 + i}-03-31`,
      raw_metric_values: {
        "Total Assets__BalanceSheet": 1000 + i * 100,
        "Total Equity__BalanceSheet": 600 + i * 60,
        "Revenue From Operations(Net)__ProfitLoss": 900 + i * 90,
        "Net Cash from Operating Activities__CashFlow": 120 + i * 12,
        "Purchased of Fixed Assets__CashFlow": -40 - i * 4,
      },
    }));
    const recastData = rawData.map((period) => mkTraceabilityRecastPeriod(period.period_end));

    const traceability = buildAnalysisTraceability({
      sourceMode: "manual",
      periodCount: 2,
      rawMetricKeyCount: 5,
      rawData,
      recastData,
      analysisStatus: productionReadyStatus,
      valuationTriangulation: {
        methods: [
          { key: "accrual-riv", label: "Accrual RIV", perShare: 100 },
          { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: 145 },
          { key: "relative-ev-ebitda", label: "Relative EV/EBITDA", perShare: 105 },
        ],
      },
    });

    expect(traceability.reconciliation.status).toBe("failed");
    expect(traceability.reconciliation.checks.some((check) => check.key === "valuation-triangulation")).toBe(true);
    expect(traceability.rigor.achievedLevels).not.toContain("valuation-eligible");
    expect(traceability.rigor.achievedLevels).not.toContain("production-ready");
  });
});
