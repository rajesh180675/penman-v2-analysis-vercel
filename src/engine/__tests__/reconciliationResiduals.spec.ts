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
      BridgeDebtLongTerm: 100,
      BridgeDebtShortTerm: 50,
      BridgeDebtDebentures: 0,
      BridgeDebtCurrentMaturities: 0,
      BridgeDebtTotal: 150,
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
      BridgeDebtProceeds: 0,
      BridgeDebtRepayment: 0,
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
      "BS.BridgeDebt.Total": [
        { statement: "Derived", key: "long+short+debentures+currentMaturities", value: 150, matchType: "derived" },
      ],
      "CF.BridgeDebtProceeds": [
        { statement: "Derived", key: "SUM", value: 0, matchType: "derived" },
      ],
      "CF.BridgeDebtRepayment": [
        { statement: "Derived", key: "SUM", value: 0, matchType: "derived" },
      ],
    },
    ...overrides,
  };
}

describe("evaluateReconciliationResiduals", () => {
  it("includes cash-distribution and share-capital tie-out checks when data is available", () => {
    const current = mkPeriod("2025-03-31", {
      is: {
        ...mkPeriod("2025-03-31").is,
        operatingCostBridge: {
          materialCost: 600,
          employeeCost: 100,
          depreciation: 20,
          sgaAdvertising: 5,
          sgaLegalProfessional: 5,
          sgaRent: 5,
          sgaFreight: 5,
          sgaRepairs: 5,
          sgaPowerFuel: 5,
          sgaDetailed: 30,
          sgaResidual: 0,
          sgaTotal: 30,
          otherOperatingExpense: 50,
          otherOperatingIncome: 0,
          grossProfit: 300,
          operatingCosts: 200,
          bridgeCoreOI: 100,
          bridgeGapToReportedCoreOI: 0,
          coverageRatio: 0.8,
          driverRatios: {
            materialCostPct: 600 / 900,
            employeeCostPct: 100 / 900,
            depreciationPct: 20 / 900,
            sgaPct: 30 / 900,
            otherOperatingExpensePct: 50 / 900,
            otherOperatingIncomePct: 0,
            bridgeCoreSalesPm: 100 / 900,
          },
        },
      },
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
    expect(summary.checks.some((check) => check.key === "operating-cost-bridge")).toBe(true);
    expect(summary.checks.some((check) => check.key === "share-capital-face-value")).toBe(true);
    // Phase 1.1 — formerly tautological residuals were removed. Confirm
    // they no longer surface so a future regression that re-adds them
    // breaks the suite.
    expect(summary.checks.some((check) => check.key === "balance-sheet-assets")).toBe(false);
    expect(summary.checks.some((check) => check.key === "balance-sheet-capital")).toBe(false);
    expect(summary.checks.some((check) => check.key === "noa-financing-identity")).toBe(false);
    expect(summary.checks.some((check) => check.key === "cni-operating-financing-bridge")).toBe(false);
    expect(summary.checks.some((check) => check.key === "core-oi-unusual-bridge")).toBe(false);
    expect(summary.checks.some((check) => check.key === "core-nfe-unusual-bridge")).toBe(false);
  });

  it("skips the operating-cost bridge when coverage is below the structural threshold", () => {
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          is: {
            ...mkPeriod("2025-03-31").is,
            operatingCostBridge: {
              materialCost: 600,
              employeeCost: 100,
              depreciation: 20,
              sgaAdvertising: 5,
              sgaLegalProfessional: 5,
              sgaRent: 5,
              sgaFreight: 5,
              sgaRepairs: 5,
              sgaPowerFuel: 5,
              sgaDetailed: 30,
              sgaResidual: 0,
              sgaTotal: 30,
              otherOperatingExpense: 50,
              otherOperatingIncome: 0,
              grossProfit: 300,
              operatingCosts: 200,
              bridgeCoreOI: 110,
              bridgeGapToReportedCoreOI: 10,
              coverageRatio: 0.4,
              driverRatios: {
                materialCostPct: 600 / 900,
                employeeCostPct: 100 / 900,
                depreciationPct: 20 / 900,
                sgaPct: 30 / 900,
                otherOperatingExpensePct: 50 / 900,
                otherOperatingIncomePct: 0,
                bridgeCoreSalesPm: 110 / 900,
              },
            },
          },
          trace: {
            ...mkPeriod("2025-03-31").trace,
            "BS.FA.CashBank": [
              { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
            ],
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    expect(summary.checks.some((check) => check.key === "operating-cost-bridge")).toBe(false);
    expect(summary.status).toBe("confirmed");
  });

  it("degrades when a high-coverage operating-cost bridge breaches the warning threshold", () => {
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          is: {
            ...mkPeriod("2025-03-31").is,
            operatingCostBridge: {
              materialCost: 600,
              employeeCost: 100,
              depreciation: 20,
              sgaAdvertising: 5,
              sgaLegalProfessional: 5,
              sgaRent: 5,
              sgaFreight: 5,
              sgaRepairs: 5,
              sgaPowerFuel: 5,
              sgaDetailed: 30,
              sgaResidual: 0,
              sgaTotal: 30,
              otherOperatingExpense: 50,
              otherOperatingIncome: 0,
              grossProfit: 300,
              operatingCosts: 200,
              bridgeCoreOI: 100.6,
              bridgeGapToReportedCoreOI: 0.6,
              coverageRatio: 0.8,
              driverRatios: {
                materialCostPct: 600 / 900,
                employeeCostPct: 100 / 900,
                depreciationPct: 20 / 900,
                sgaPct: 30 / 900,
                otherOperatingExpensePct: 50 / 900,
                otherOperatingIncomePct: 0,
                bridgeCoreSalesPm: 100.6 / 900,
              },
            },
          },
          trace: {
            ...mkPeriod("2025-03-31").trace,
            "BS.FA.CashBank": [
              { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
            ],
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    const bridgeCheck = summary.checks.find((check) => check.key === "operating-cost-bridge" && check.periodEnd === "2025-03-31");
    expect(bridgeCheck?.status).toBe("degraded");
    expect(summary.status).toBe("degraded");
  });

  it("fails when a high-coverage operating-cost bridge breaches the critical threshold", () => {
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          is: {
            ...mkPeriod("2025-03-31").is,
            operatingCostBridge: {
              materialCost: 600,
              employeeCost: 100,
              depreciation: 20,
              sgaAdvertising: 5,
              sgaLegalProfessional: 5,
              sgaRent: 5,
              sgaFreight: 5,
              sgaRepairs: 5,
              sgaPowerFuel: 5,
              sgaDetailed: 30,
              sgaResidual: 0,
              sgaTotal: 30,
              otherOperatingExpense: 50,
              otherOperatingIncome: 0,
              grossProfit: 300,
              operatingCosts: 200,
              bridgeCoreOI: 110,
              bridgeGapToReportedCoreOI: 10,
              coverageRatio: 0.8,
              driverRatios: {
                materialCostPct: 600 / 900,
                employeeCostPct: 100 / 900,
                depreciationPct: 20 / 900,
                sgaPct: 30 / 900,
                otherOperatingExpensePct: 50 / 900,
                otherOperatingIncomePct: 0,
                bridgeCoreSalesPm: 110 / 900,
              },
            },
          },
          trace: {
            ...mkPeriod("2025-03-31").trace,
            "BS.FA.CashBank": [
              { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
            ],
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    const bridgeCheck = summary.checks.find((check) => check.key === "operating-cost-bridge" && check.periodEnd === "2025-03-31");
    expect(bridgeCheck?.status).toBe("failed");
    expect(summary.status).toBe("failed");
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

  it("no longer surfaces the (tautological) CNI operating/financing bridge as a residual check", () => {
    // Phase 1.1 — CNI ≡ OI - NFE - MII by algebraic construction in
    // PenmanNissimEngine. Forcing CNI to a non-identity value via test
    // overrides used to fire the residual at `failed`; that's now an
    // engine-invariant assertion rather than a residual check.
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

    expect(summary.checks.some((item) => item.key === "cni-operating-financing-bridge")).toBe(false);
  });

  it("degrades when the gross-debt-flow bridge breaches the warning threshold", () => {
    const current = mkPeriod("2025-03-31", {
      trace: {
        ...mkPeriod("2025-03-31").trace,
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
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
            BridgeDebtProceeds: 100,
            BridgeDebtRepayment: 0,
          },
          trace: {
            ...current.trace,
            "BS.BridgeDebt.Total": [
              { statement: "Derived", key: "long+short+debentures+currentMaturities", value: 250.6, matchType: "derived" },
            ],
            "CF.BridgeDebtProceeds": [
              { statement: "Derived", key: "SUM", value: 100, matchType: "derived" },
            ],
            "CF.BridgeDebtRepayment": [
              { statement: "Derived", key: "SUM", value: 0, matchType: "derived" },
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
            BridgeDebtProceeds: 30,
            BridgeDebtRepayment: 0,
          },
          trace: {
            ...current.trace,
            "BS.BridgeDebt.Total": [
              { statement: "Derived", key: "long+short+debentures+currentMaturities", value: 150, matchType: "derived" },
            ],
            "CF.BridgeDebtProceeds": [
              { statement: "Derived", key: "SUM", value: 30, matchType: "derived" },
            ],
            "CF.BridgeDebtRepayment": [
              { statement: "Derived", key: "SUM", value: 0, matchType: "derived" },
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

  it("does not fail the ending-cash bridge for investment-heavy liquid-asset rotation", () => {
    const previous = mkPeriod("2024-03-31", {
      bs: {
        ...mkPeriod("2024-03-31").bs,
        FA: 500,
      },
      trace: {
        ...mkPeriod("2024-03-31").trace,
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 32.8, matchType: "exact_base" },
        ],
        "BS.FA.CurrentInvestmentsTop": [
          { statement: "BalanceSheet", key: "Current Investments", value: 467.2, matchType: "exact_base" },
        ],
      },
    });
    const current = mkPeriod("2025-03-31", {
      bs: {
        ...mkPeriod("2025-03-31").bs,
        FA: 496,
      },
      cf: {
        ...mkPeriod("2025-03-31").cf,
        CFO: 277,
        Capex: 49,
        DividendPaid: 176,
        PurchaseInvestments: -2836,
        SaleInvestments: 2780,
        EquityIssued: 0,
        ShareBuybacks: 0,
        InterestReceived: 0,
        DividendReceived: 0,
        DebtProceeds: 0,
        DebtRepayment: 0,
        SaleFixedAssets: 0,
      },
      trace: {
        ...mkPeriod("2025-03-31").trace,
        "BS.FA.CashBank": [
          { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 26.3, matchType: "exact_base" },
        ],
        "BS.FA.CurrentInvestmentsTop": [
          { statement: "BalanceSheet", key: "Current Investments", value: 469.7, matchType: "exact_base" },
        ],
      },
    });

    const summary = evaluateReconciliationResiduals({
      recastData: [previous, current],
      config: DEFAULT_CONFIG,
    });

    const endingCashCheck = summary.checks.find((check) => check.key === "ending-cash-bridge" && check.periodEnd === "2025-03-31");
    expect(endingCashCheck?.residual).not.toBeNull();
    expect(endingCashCheck?.status).not.toBe("failed");
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

  it("ignores broad financial-liability cash-flow lines in the borrowings bridge", () => {
    const previous = mkPeriod("2024-03-31", {
      bs: {
        ...mkPeriod("2024-03-31").bs,
        BridgeDebtLongTerm: 100,
        BridgeDebtShortTerm: 50,
        BridgeDebtDebentures: 0,
        BridgeDebtCurrentMaturities: 0,
        BridgeDebtTotal: 150,
      },
      cf: {
        ...mkPeriod("2024-03-31").cf,
        BridgeDebtProceeds: 0,
        BridgeDebtRepayment: 0,
      },
      trace: {
        ...mkPeriod("2024-03-31").trace,
        "BS.BridgeDebt.Total": [
          { statement: "Derived", key: "long+short+debentures+currentMaturities", value: 150, matchType: "derived" },
        ],
        "CF.BridgeDebtProceeds": [
          { statement: "Derived", key: "SUM", value: 0, matchType: "derived" },
        ],
        "CF.BridgeDebtRepayment": [
          { statement: "Derived", key: "SUM", value: 0, matchType: "derived" },
        ],
      },
    });

    const current = mkPeriod("2025-03-31", {
      bs: {
        ...mkPeriod("2025-03-31").bs,
        BridgeDebtLongTerm: 100,
        BridgeDebtShortTerm: 50,
        BridgeDebtDebentures: 0,
        BridgeDebtCurrentMaturities: 0,
        BridgeDebtTotal: 150,
      },
      cf: {
        ...mkPeriod("2025-03-31").cf,
        DebtRepayment: -80,
        BridgeDebtProceeds: 0,
        BridgeDebtRepayment: 0,
      },
      trace: {
        ...mkPeriod("2025-03-31").trace,
        "BS.BridgeDebt.Total": [
          { statement: "Derived", key: "long+short+debentures+currentMaturities", value: 150, matchType: "derived" },
        ],
        "CF.BridgeDebtProceeds": [
          { statement: "Derived", key: "SUM", value: 0, matchType: "derived" },
        ],
        "CF.BridgeDebtRepayment": [
          { statement: "Derived", key: "SUM", value: 0, matchType: "derived" },
        ],
      },
    });

    const summary = evaluateReconciliationResiduals({
      recastData: [previous, current],
      config: DEFAULT_CONFIG,
    });

    const debtCheck = summary.checks.find((check) => check.key === "gross-debt-flow-bridge");
    expect(debtCheck?.status).toBe("confirmed");
    expect(debtCheck?.residual).toBe(0);
  });

  // ── Phase 1.1 (d) — recast-vs-raw mutation regression guard ────────────────
  // The de-tautologization is only defensible if a corrupted as-reported value
  // actually fails the gate. Before Phase 1.1 the asset residual was 0 by
  // construction (OA ≡ TA − FA), so ANY input cleared "reconciled". These two
  // tests pin the LIVE behaviour: a clean raw read confirms; a divergent one
  // fails closed. The fixture's base mkPeriod omits recastDebug, so supplying it
  // here is what activates the independent recast-ta-vs-raw comparison — proving
  // the check is wired, not dormant.
  it("surfaces recast-ta-vs-raw as a live, confirmed residual when raw Total Assets matches recast TA", () => {
    const recastDebug = {
      rawTotalAssets: 1000, // matches mkPeriod bs.TA
      rawTotalLiabilitiesAndEquity: 1000, // matches CSE+MI+FO+OL = 600+0+150+250
      rawTotalEquity: 600, // matches CSE+MI = 600+0
      explicitOL: 250, // matches bs.OL = 250 → coverage ratio 1.0
    };
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          recastDebug,
          // CashBank 100→160 balances the ending-cash bridge (ΔCash 60 = CFO 120
          // − Capex 40 − Dividend 20), isolating the recast-vs-raw residuals.
          trace: {
            ...mkPeriod("2025-03-31").trace,
            "BS.FA.CashBank": [
              { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
            ],
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    const check = summary.checks.find(
      (c) => c.key === "recast-ta-vs-raw" && c.periodEnd === "2025-03-31",
    );
    expect(check).toBeDefined();
    expect(check?.residual).toBe(0);
    expect(check?.status).toBe("confirmed");
    expect(summary.status).toBe("confirmed");
  });

  it("fails reconciliation when an as-reported Total Assets value diverges from recast TA", () => {
    // Corrupt ONLY the independently-read raw Total Assets by +10% while leaving
    // every recast-derived field intact. Pre-Phase-1.1 this could not be caught
    // (the asset identity was algebraically zero); the recast-ta-vs-raw residual
    // must now fail closed. Everything else (incl. the ending-cash bridge) is
    // kept clean so recast-ta-vs-raw is the SOLE driver of the failed status.
    const recastDebug = {
      rawTotalAssets: 1100, // +10% vs recast bs.TA = 1000
      rawTotalLiabilitiesAndEquity: 1000, // left clean to isolate the TA residual
      rawTotalEquity: 600,
      explicitOL: 250,
    };
    const summary = evaluateReconciliationResiduals({
      recastData: [
        mkPeriod("2024-03-31"),
        mkPeriod("2025-03-31", {
          recastDebug,
          trace: {
            ...mkPeriod("2025-03-31").trace,
            "BS.FA.CashBank": [
              { statement: "BalanceSheet", key: "Cash and Cash Equivalents", value: 160, matchType: "exact_base" },
            ],
          },
        }),
      ],
      config: DEFAULT_CONFIG,
    });

    const check = summary.checks.find(
      (c) => c.key === "recast-ta-vs-raw" && c.periodEnd === "2025-03-31",
    );
    // ratio = |1000 − 1100| / max(1000, 1100, 1) = 100/1100 ≈ 0.0909 > 5% critical.
    expect(check?.ratio).toBeCloseTo(100 / 1100, 4);
    expect(check?.ratio).toBeGreaterThan(0.05);
    expect(check?.status).toBe("failed");
    // recast-ta-vs-raw is the only breached check, so it alone drives the summary.
    const failedKeys = summary.checks.filter((c) => c.status === "failed").map((c) => c.key);
    expect(failedKeys).toEqual(["recast-ta-vs-raw"]);
    expect(summary.status).toBe("failed");
  });
});
