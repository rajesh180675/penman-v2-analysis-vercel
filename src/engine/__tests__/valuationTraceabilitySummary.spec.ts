import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { getAnalysisPolicyVersions } from "../policyVersions";
import { DEFAULT_CONFIG, RecastPeriod } from "../types";
import { buildValuationTraceabilitySurfaceSummary } from "../valuationTraceabilitySummary";

function mkBalancedPeriod(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000,
      CSE: 600,
      MI: 0,
      FA: 150,
      FO: 150,
      OA: 850,
      OL: 250,
      OL_TradePayables: 80,
      OL_OtherCurrentLiabilities: 50,
      OL_ProvisionsCurrent: 10,
      OL_ProvisionsLongTerm: 10,
      OL_CurrentTaxLiabilities: 10,
      OL_NonCurrentTaxLiabilities: 10,
      OL_DeferredTaxLiabilitiesNet: 5,
      OL_OtherNonCurrentLiabilities: 75,
      NOA: 600,
      NFO: 0,
      DTL: 5,
      PensionObl: 0,
      OL_ex_DTL: 245,
      Goodwill: 0,
      CurrentAssets: 400,
      CurrentLiabilities: 220,
      Inventory: 90,
      TradeReceivables: 110,
      TradePayables: 80,
      PPE: 320,
      LIFO_reserve: 0,
      separationScore: 90,
      OA_PPE: 320,
      OA_ROU: 0,
      OA_Goodwill: 0,
      OA_OtherIntangibles: 0,
      OA_Inventory: 90,
      OA_TradeReceivables: 110,
      OA_DTA: 0,
      OA_CWIP: 0,
      OA_Other: 330,
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
      OI_from_sales: 100,
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
  };
}

describe("buildValuationTraceabilitySurfaceSummary", () => {
  it("summarizes a fully cleared traceability envelope for the valuation surface", () => {
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-04-03T10:00:00.000Z",
      runId: "run-clean",
      companyId: "ITC",
      sourceMode: "json",
      recastData: [mkBalancedPeriod("2025-03-31")],
      config: DEFAULT_CONFIG,
      rawData: [
        {
          company_id: "ITC",
          period_end: "2025-03-31",
          raw_metric_values: {
            "Total Assets__BalanceSheet": 1000,
            "Total Equity__BalanceSheet": 600,
            "Revenue From Operations(Net)__ProfitLoss": 900,
            "Profit After Tax__ProfitLoss": 90,
          },
        },
      ],
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });

    const summary = buildValuationTraceabilitySurfaceSummary(traceability);

    expect(summary).not.toBeNull();
    expect(summary?.headline).toContain("Economically plausible");
    expect(summary?.parserLine).toBe("confirmed · 100/100");
    expect(summary?.reconciliationLine).toBe("confirmed · max residual 0.00%");
    expect(summary?.nextGateLine).toBe("Next unresolved gate: Valuation eligible.");
  });

  it("carries structural-reconciliation failure into the valuation disclosure", () => {
    const traceability = buildAnalysisTraceability({
      generatedAt: "2026-04-03T10:05:00.000Z",
      runId: "run-broken",
      companyId: "ITC",
      sourceMode: "json",
      recastData: [
        {
          ...mkBalancedPeriod("2025-03-31"),
          recastDebug: {
            rawTotalAssets: 1100,
            rawTotalLiabilitiesAndEquity: 1100,
            rawTotalEquity: null,
            // Reported asset subtotals sum to 1100, diverging from recast
            // bs.TA (1000) → recast-ta-vs-raw fails closed, driving the
            // structural-reconciliation failure this test asserts.
            rawCurrentAssets: 600,
            rawNonCurrentAssets: 500,
            explicitOL: 0,
          },
        },
      ],
      config: DEFAULT_CONFIG,
      rawData: [
        {
          company_id: "ITC",
          period_end: "2025-03-31",
          raw_metric_values: {
            "Total Assets__BalanceSheet": 1000,
            "Total Equity__BalanceSheet": 600,
            "Revenue From Operations(Net)__ProfitLoss": 900,
            "Profit After Tax__ProfitLoss": 90,
          },
        },
      ],
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });

    const summary = buildValuationTraceabilitySurfaceSummary(traceability);

    expect(summary).not.toBeNull();
    expect(summary?.headline).toContain("Syntactically valid");
    expect(summary?.nextGateLine).toBe("Next unresolved gate: Structurally reconciled.");
    expect(summary?.blockers.some((item) => item.includes("reconciliation residual check(s) breached the critical threshold"))).toBe(true);
    expect(summary?.confidenceLine).toContain("blocked");
    expect(summary?.confidenceLine).not.toContain("0 blocking / 0 diagnostic");
    expect(summary?.blockers.some((item) => item.includes("reconciliation"))).toBe(true);
  });

  // Phase 3.5 — analyticalDepth (schema v18) contract: depthLine is emitted
  // only when the envelope actually carries the block, so structural-only
  // envelopes (the 9 non-valuation surfaces, snapshot/publication) are unchanged.
  it("emits depthLine when the envelope carries an analyticalDepth block", () => {
    const base = buildAnalysisTraceability({
      generatedAt: "2026-04-03T10:10:00.000Z",
      runId: "run-depth",
      companyId: "ITC",
      sourceMode: "json",
      recastData: [mkBalancedPeriod("2025-03-31")],
      config: DEFAULT_CONFIG,
      rawData: [
        {
          company_id: "ITC",
          period_end: "2025-03-31",
          raw_metric_values: {
            "Total Assets__BalanceSheet": 1000,
            "Total Equity__BalanceSheet": 600,
            "Revenue From Operations(Net)__ProfitLoss": 900,
            "Profit After Tax__ProfitLoss": 90,
          },
        },
      ],
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });
    const enriched = {
      ...base,
      analyticalDepth: {
        status: "partial" as const,
        summary: "2/4 depth analytics ran, 1 flagged for review",
        presentCount: 2,
        watchCount: 1,
        checks: [],
      },
    };

    const summary = buildValuationTraceabilitySurfaceSummary(enriched);
    expect(summary?.depthLine).toBeDefined();
    expect(summary?.depthLine).toContain("partial");
    expect(summary?.depthLine).toContain("2/4 depth analytics");
    expect(summary?.depthLine).toContain("1 to review");
  });

  it("omits depthLine for a structural-only envelope (no analyticalDepth)", () => {
    const base = buildAnalysisTraceability({
      generatedAt: "2026-04-03T10:11:00.000Z",
      runId: "run-no-depth",
      companyId: "ITC",
      sourceMode: "json",
      recastData: [mkBalancedPeriod("2025-03-31")],
      config: DEFAULT_CONFIG,
      rawData: [
        {
          company_id: "ITC",
          period_end: "2025-03-31",
          raw_metric_values: {
            "Total Assets__BalanceSheet": 1000,
            "Total Equity__BalanceSheet": 600,
            "Revenue From Operations(Net)__ProfitLoss": 900,
            "Profit After Tax__ProfitLoss": 90,
          },
        },
      ],
      periodCount: 1,
      latestPeriod: "2025-03-31",
      policyVersions: getAnalysisPolicyVersions(),
    });
    // buildAnalysisTraceability does not set analyticalDepth — structural only.
    expect(base.analyticalDepth).toBeUndefined();
    const summary = buildValuationTraceabilitySurfaceSummary(base);
    expect(summary?.depthLine).toBeUndefined();
  });
});
