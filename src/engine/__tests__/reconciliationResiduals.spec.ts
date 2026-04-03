import { describe, expect, it } from "vitest";
import { evaluateReconciliationResiduals } from "../reconciliationResiduals";
import { DEFAULT_CONFIG, RecastPeriod } from "../types";

function mkPeriod(period_end: string, overrides?: Partial<RecastPeriod>): RecastPeriod {
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
      DebtProceeds: 0,
      DebtRepayment: 0,
      FCF_accounting: 60,
      FCF_cash: 80,
      d_t: 20,
      d_t_formula: 20,
      d_t_discrepancy: 0,
      EBITDA: 140,
    },
    shareCountInput: {
      endPeriodShares: 60,
      endPeriodSharesSource: "Number of Equity Shares - Subscribed Fully Paid up",
      weightedAverageBasicShares: 59,
      weightedAverageBasicSource: "Weighted Average Number of Shares in Issue - Basic",
      weightedAverageDilutedShares: 59.5,
      weightedAverageDilutedSource: "Weighted Average Number of Shares in Issue - Diluted",
      faceValue: 10,
      shareCapital: 600,
    },
    trace: {
      "IS.TCI": [
        { statement: "ProfitLoss", key: "Total Comprehensive Income for the Year", value: 90, matchType: "exact_base" },
      ],
      "BS.FA.CashBank": [
        { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 100, matchType: "exact_base" },
      ],
      "CF.CFO": [
        { statement: "CashFlow", key: "Net Cash from Operating Activities", value: 120, matchType: "exact_base" },
      ],
      "CF.Capex": [
        { statement: "CashFlow", key: "Purchased of Fixed Assets", value: -40, matchType: "exact_base" },
      ],
      "CF.DividendPaid": [
        { statement: "CashFlow", key: "Dividend Paid", value: -20, matchType: "exact_base" },
      ],
      "BS.FO.LongBorrow": [
        { statement: "BalanceSheet", key: "Long Term Borrowings", value: 100, matchType: "exact_base" },
      ],
      "BS.FO.ShortBorrow": [
        { statement: "BalanceSheet", key: "Short Term Borrowings", value: 50, matchType: "exact_base" },
      ],
    },
    ...overrides,
  };
}

describe("evaluateReconciliationResiduals", () => {
  it("includes cash-distribution and share-capital tie-out checks when data is available", () => {
    const current = mkPeriod("2025-03-31", {
      trace: {
        ...mkPeriod("2025-03-31").trace,
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
        ],
      },
    });
    const summary = evaluateReconciliationResiduals({
      recastData: [mkPeriod("2024-03-31"), current],
      config: DEFAULT_CONFIG,
    });

    expect(summary.status).toBe("confirmed");
    expect(summary.checks.some((check) => check.key === "cash-distribution-bridge")).toBe(true);
    expect(summary.checks.some((check) => check.key === "gross-debt-flow-bridge")).toBe(true);
    expect(summary.checks.some((check) => check.key === "ending-cash-bridge")).toBe(true);
    expect(summary.checks.some((check) => check.key === "comprehensive-income-bridge")).toBe(true);
    expect(summary.checks.some((check) => check.key === "cni-operating-financing-bridge")).toBe(true);
    expect(summary.checks.some((check) => check.key === "core-oi-unusual-bridge")).toBe(true);
    expect(summary.checks.some((check) => check.key === "core-nfe-unusual-bridge")).toBe(true);
    expect(summary.checks.some((check) => check.key === "share-capital-face-value")).toBe(true);
  });

  it("degrades when the comprehensive-income bridge breaches the warning threshold", () => {
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          is: {
            ...mkPeriod("2025-03-31").is,
            TCI: 90.6,
          },
          trace: {
            ...mkPeriod("2025-03-31").trace,
            "IS.TCI": [
              { statement: "ProfitLoss", key: "Total Comprehensive Income for the Year", value: 90.6, matchType: "exact_base" },
            ],
            "BS.FA.CashBank": [
              { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
            ],
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    const check = summary.checks.find((item) => item.key === "comprehensive-income-bridge" && item.periodEnd === "2025-03-31");
    expect(check?.status).toBe("degraded");
    expect(summary.status).toBe("degraded");
  });

  it("fails when the CNI operating/financing bridge breaches the critical threshold", () => {
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          is: {
            ...mkPeriod("2025-03-31").is,
            CNI: 80,
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    const check = summary.checks.find((item) => item.key === "cni-operating-financing-bridge" && item.periodEnd === "2025-03-31");
    expect(check?.status).toBe("failed");
    expect(summary.status).toBe("failed");
  });

  it("degrades when the gross-debt-flow bridge breaches the warning threshold", () => {
    const current = mkPeriod("2025-03-31", {
      trace: {
        ...mkPeriod("2025-03-31").trace,
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 260.6, matchType: "exact_base" },
        ],
      },
    });
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        {
          ...current,
          cf: {
            ...current.cf,
            DebtProceeds: 100,
            DebtRepayment: 0,
          },
          trace: {
            ...current.trace,
            "BS.FO.LongBorrow": [
              { statement: "BalanceSheet", key: "Long Term Borrowings", value: 200.6, matchType: "exact_base" },
            ],
            "BS.FO.ShortBorrow": [
              { statement: "BalanceSheet", key: "Short Term Borrowings", value: 50, matchType: "exact_base" },
            ],
          },
        },
      ],
      config: DEFAULT_CONFIG,
    });

    const debtCheck = summary.checks.find((check) => check.key === "gross-debt-flow-bridge" && check.periodEnd === "2025-03-31");
    expect(debtCheck?.status).toBe("degraded");
    expect(summary.status).toBe("degraded");
  });

  it("fails when the gross-debt-flow bridge breaches the critical threshold", () => {
    const current = mkPeriod("2025-03-31", {
      trace: {
        ...mkPeriod("2025-03-31").trace,
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 190, matchType: "exact_base" },
        ],
      },
    });
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        {
          ...current,
          cf: {
            ...current.cf,
            DebtProceeds: 30,
            DebtRepayment: 0,
          },
          trace: {
            ...current.trace,
            "BS.FO.LongBorrow": [
              { statement: "BalanceSheet", key: "Long Term Borrowings", value: 100, matchType: "exact_base" },
            ],
            "BS.FO.ShortBorrow": [
              { statement: "BalanceSheet", key: "Short Term Borrowings", value: 50, matchType: "exact_base" },
            ],
          },
        },
      ],
      config: DEFAULT_CONFIG,
    });

    const debtCheck = summary.checks.find((check) => check.key === "gross-debt-flow-bridge" && check.periodEnd === "2025-03-31");
    expect(debtCheck?.status).toBe("failed");
    expect(summary.status).toBe("failed");
  });

  it("degrades when the share-capital tie-out breaches the warning threshold", () => {
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          trace: {
            ...mkPeriod("2025-03-31").trace,
            "BS.FA.CashBank": [
              { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
            ],
          },
          shareCountInput: {
            endPeriodShares: 59,
            endPeriodSharesSource: "Number of Equity Shares - Subscribed Fully Paid up",
            weightedAverageBasicShares: 58,
            weightedAverageBasicSource: "Weighted Average Number of Shares in Issue - Basic",
            weightedAverageDilutedShares: 58.5,
            weightedAverageDilutedSource: "Weighted Average Number of Shares in Issue - Diluted",
            faceValue: 10,
            shareCapital: 600,
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    const shareCheck = summary.checks.find((check) => check.key === "share-capital-face-value" && check.periodEnd === "2025-03-31");
    expect(shareCheck?.status).toBe("degraded");
    expect(summary.status).toBe("degraded");
  });

  it("degrades when the ending-cash bridge breaches the warning threshold", () => {
    const current = mkPeriod("2025-03-31", {
      trace: {
        ...mkPeriod("2025-03-31").trace,
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160.6, matchType: "exact_base" },
        ],
      },
    });
    const summary = evaluateReconciliationResiduals({
      recastData: [mkPeriod("2024-03-31"), current],
      config: DEFAULT_CONFIG,
    });

    const endingCashCheck = summary.checks.find((check) => check.key === "ending-cash-bridge" && check.periodEnd === "2025-03-31");
    expect(endingCashCheck?.status).toBe("degraded");
    expect(summary.status).toBe("degraded");
  });

  it("fails when the ending-cash bridge breaches the critical threshold", () => {
    const current = mkPeriod("2025-03-31", {
      trace: {
        ...mkPeriod("2025-03-31").trace,
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 170, matchType: "exact_base" },
        ],
      },
    });
    const summary = evaluateReconciliationResiduals({
      recastData: [mkPeriod("2024-03-31"), current],
      config: DEFAULT_CONFIG,
    });

    const endingCashCheck = summary.checks.find((check) => check.key === "ending-cash-bridge" && check.periodEnd === "2025-03-31");
    expect(endingCashCheck?.status).toBe("failed");
    expect(summary.status).toBe("failed");
  });

  it("fails when the cash-distribution bridge breaches the critical threshold", () => {
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          cf: {
            ...mkPeriod("2025-03-31").cf,
            d_t: 30,
            d_t_formula: 20,
            d_t_discrepancy: 10,
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    const cashCheck = summary.checks.find((check) => check.key === "cash-distribution-bridge" && check.periodEnd === "2025-03-31");
    expect(cashCheck?.status).toBe("failed");
    expect(summary.status).toBe("failed");
    expect(summary.summary).toContain("breached the critical threshold");
  });
});
