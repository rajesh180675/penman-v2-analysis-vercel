import { describe, expect, it } from "vitest";
import { processBankData, computeBankRatios, extractBankMetrics } from "../bankPipeline";
import { assessAnalysisScope } from "../scopePolicy";

/**
 * Phase K — NBFC-specific metrics. Bajaj Finance-shaped fixture: high
 * leverage, no deposits (NBFC funds via NCDs + term loans), and the
 * NBFC framing (yield/cost/spread + leverage + debt mix) replaces the
 * bank framing (NIM-on-earning-assets including SLR + CASA).
 */

function nbfcRaw(period_end: string, vals: {
  totalAssets: number;
  totalEquity: number;
  advances: number;       // Loan Assets / Finance Receivables
  borrowings: number;
  ncd: number;
  termLoansBanks: number;
  termLoansInstitutions: number;
  termLoansOthers: number;
  interestEarned: number;
  interestExpended: number;
  pat: number;
  pbt: number;
  operatingExpenses: number;
  provisions: number;
  otherIncome: number;
}) {
  return {
    company_id: "BAJFINANCE",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": vals.totalAssets,
      "Total Equity__BalanceSheet": vals.totalEquity,
      // NBFC uses Finance Receivables / Loan Assets, not "Advances".
      // The mapping spec already aliases these to bs.advances.
      "Loan Assets__BalanceSheet": vals.advances,
      "Borrowings__BalanceSheet": vals.borrowings,
      "Non Convertible Debentures__BalanceSheet": vals.ncd,
      "Term Loans - Banks__BalanceSheet": vals.termLoansBanks,
      "Term Loans - Institutions__BalanceSheet": vals.termLoansInstitutions,
      "Term Loans - Others Parties__BalanceSheet": vals.termLoansOthers,
      // NBFC scope signals — at least one is required to flip to NBFC subtype.
      "Income from Financial Services__ProfitLoss": vals.interestEarned * 0.05,
      "Finance Receivables__BalanceSheet": vals.advances,
      // NBFC P&L
      "Interest Income__ProfitLoss": vals.interestEarned,
      "Interest Expended__ProfitLoss": vals.interestExpended,
      "Other Income__ProfitLoss": vals.otherIncome,
      "Operating Expenses__ProfitLoss": vals.operatingExpenses,
      "Provisions and Contingencies__ProfitLoss": vals.provisions,
      "Profit After Tax__ProfitLoss": vals.pat,
      "Profit Before Tax__ProfitLoss": vals.pbt,
    },
  };
}

describe("NBFC pipeline — Phase K", () => {
  // Bajaj Finance FY24-FY25 silhouette (heavily simplified, in ₹ Cr)
  const periods = [
    nbfcRaw("2023-03-31", {
      totalAssets: 270000, totalEquity: 49000,
      advances: 245000, borrowings: 195000,
      ncd: 80000, termLoansBanks: 60000,
      termLoansInstitutions: 25000, termLoansOthers: 10000,
      interestEarned: 32000, interestExpended: -16000,
      pat: 11500, pbt: 15500, operatingExpenses: -8500, provisions: -3500,
      otherIncome: 1200,
    }),
    nbfcRaw("2024-03-31", {
      totalAssets: 330000, totalEquity: 60000,
      advances: 305000, borrowings: 240000,
      ncd: 100000, termLoansBanks: 75000,
      termLoansInstitutions: 30000, termLoansOthers: 12000,
      interestEarned: 41000, interestExpended: -21000,
      pat: 14400, pbt: 19200, operatingExpenses: -10500, provisions: -4500,
      otherIncome: 1500,
    }),
    nbfcRaw("2025-03-31", {
      totalAssets: 400000, totalEquity: 73000,
      advances: 372000, borrowings: 295000,
      ncd: 125000, termLoansBanks: 92000,
      termLoansInstitutions: 35000, termLoansOthers: 15000,
      interestEarned: 50000, interestExpended: -26000,
      pat: 17200, pbt: 23000, operatingExpenses: -12500, provisions: -5500,
      otherIncome: 1800,
    }),
  ];

  it("detects NBFC subtype from scope signals", () => {
    const scope = assessAnalysisScope(periods);
    expect(scope.classification).toBe("supported-financial");
    expect(scope.blocked).toBe(false);
    // Should have NBFC signals (Finance Receivables, Loan Assets, Income from Financial Services)
    const nbfcSignals = scope.signals.filter((s) => s.kind === "nbfc");
    expect(nbfcSignals.length).toBeGreaterThan(0);
  });

  it("processBankData routes to NBFC subtype", () => {
    const scope = assessAnalysisScope(periods);
    const result = processBankData(periods, scope);
    expect(result.family).toBe("financial-institution");
    expect(result.subtype).toBe("nbfc");
    expect(result.periods).toHaveLength(3);
    expect(result.bankMetrics).toHaveLength(3);
  });

  it("extracts NBFC funding mix breakdown", () => {
    const metrics = extractBankMetrics(periods[2]!);
    expect(metrics.borrowings).toBe(295000);
    expect(metrics.nonConvertibleDebentures).toBe(125000);
    expect(metrics.termLoansFromBanks).toBe(92000);
    expect(metrics.termLoansFromInstitutions).toBe(35000);
    expect(metrics.termLoansFromOthers).toBe(15000);
  });

  it("computes leverage = borrowings / totalEquity for NBFC subtype", () => {
    const scope = assessAnalysisScope(periods);
    const result = processBankData(periods, scope);
    const latest = result.bankMetrics![2]!;
    // 295000 / 73000 = ~4.04x
    expect(latest.leverage).not.toBeNull();
    expect(latest.leverage!).toBeCloseTo(295000 / 73000, 3);
  });

  it("computes debt mix as fractions of total borrowings", () => {
    const scope = assessAnalysisScope(periods);
    const result = processBankData(periods, scope);
    const latest = result.bankMetrics![2]!;
    expect(latest.debtMix).not.toBeNull();
    expect(latest.debtMix!.ncdShare).toBeCloseTo(125000 / 295000, 3);
    expect(latest.debtMix!.bankLoanShare).toBeCloseTo(92000 / 295000, 3);
    expect(latest.debtMix!.institutionLoanShare).toBeCloseTo(35000 / 295000, 3);
    expect(latest.debtMix!.otherLoanShare).toBeCloseTo(15000 / 295000, 3);
    // Sum may be < 1 because Capitaline doesn't break out commercial paper separately.
    const sum =
      latest.debtMix!.ncdShare! +
      latest.debtMix!.bankLoanShare! +
      latest.debtMix!.institutionLoanShare! +
      latest.debtMix!.otherLoanShare!;
    expect(sum).toBeLessThanOrEqual(1.0);
  });

  it("computes yield-on-advances, cost-of-borrowings, and spread for NBFC", () => {
    const scope = assessAnalysisScope(periods);
    const result = processBankData(periods, scope);
    const latest = result.bankMetrics![2]!;

    // yieldOnAdvances = interestEarned / avgAdvances
    // avgAdvances = (305000 + 372000) / 2 = 338500
    // yield = 50000 / 338500 ≈ 0.1477
    expect(latest.yieldOnAdvances).not.toBeNull();
    expect(latest.yieldOnAdvances!).toBeCloseTo(50000 / ((305000 + 372000) / 2), 3);

    // costOfBorrowings = |interestExpended| / avgBorrowings
    // avgBorrowings = (240000 + 295000) / 2 = 267500
    // cost = 26000 / 267500 ≈ 0.0972
    expect(latest.costOfBorrowings).not.toBeNull();
    expect(latest.costOfBorrowings!).toBeCloseTo(26000 / ((240000 + 295000) / 2), 3);

    // spread = yield - cost ≈ 0.0505
    expect(latest.spread).not.toBeNull();
    expect(latest.spread!).toBeCloseTo(latest.yieldOnAdvances! - latest.costOfBorrowings!, 4);
    expect(latest.spread!).toBeGreaterThan(0); // healthy NBFC spread is positive
  });

  it("uses advances-only NIM denominator for NBFCs (not advances + investments)", () => {
    const scope = assessAnalysisScope(periods);
    const result = processBankData(periods, scope);
    const latest = result.bankMetrics![2]!;

    // For an NBFC, NIM denominator should be avgAdvances only.
    // NII = 50000 - 26000 = 24000
    // avgAdvances = (305000 + 372000) / 2 = 338500
    // NIM = 24000 / 338500 ≈ 0.0709
    expect(latest.nim).not.toBeNull();
    expect(latest.nim!).toBeCloseTo(24000 / 338500, 3);
  });

  it("does NOT compute NBFC-specific metrics for bank subtype (no regression)", () => {
    // Same shape, but with banking signals so subtype flips to bank
    const bankPeriods = [
      {
        company_id: "HDFC_BANK",
        period_end: "2024-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 3000000,
          "Total Shareholders Funds__BalanceSheet": 350000,
          "Advances__BalanceSheet": 2200000,
          "Deposits__BalanceSheet": 2400000,
          "Investments__BalanceSheet": 600000,
          "Borrowings__BalanceSheet": 100000,
          "Non Convertible Debentures__BalanceSheet": 40000,
          "Term Loans - Banks__BalanceSheet": 0,
          // Banking signal — flips subtype to bank
          "Cash and Balance with RBI__BalanceSheet": 120000,
          "Money at Call and Short Notice__BalanceSheet": 50000,
          "Investments of Banking Business__BalanceSheet": 600000,
          "Interest Earned__ProfitLoss": 220000,
          "Interest Expended__ProfitLoss": -120000,
          "Profit After Tax__ProfitLoss": 45000,
          "Profit Before Tax__ProfitLoss": 60000,
          "Operating Expenses__ProfitLoss": -50000,
        },
      },
      {
        company_id: "HDFC_BANK",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Assets__BalanceSheet": 3500000,
          "Total Shareholders Funds__BalanceSheet": 400000,
          "Advances__BalanceSheet": 2500000,
          "Deposits__BalanceSheet": 2700000,
          "Investments__BalanceSheet": 700000,
          "Borrowings__BalanceSheet": 120000,
          "Non Convertible Debentures__BalanceSheet": 50000,
          "Term Loans - Banks__BalanceSheet": 0,
          "Cash and Balance with RBI__BalanceSheet": 130000,
          "Money at Call and Short Notice__BalanceSheet": 55000,
          "Investments of Banking Business__BalanceSheet": 700000,
          "Interest Earned__ProfitLoss": 260000,
          "Interest Expended__ProfitLoss": -140000,
          "Profit After Tax__ProfitLoss": 55000,
          "Profit Before Tax__ProfitLoss": 72000,
          "Operating Expenses__ProfitLoss": -58000,
        },
      },
    ];
    const scope = assessAnalysisScope(bankPeriods);
    const result = processBankData(bankPeriods, scope);
    expect(result.subtype).toBe("bank");
    const latest = result.bankMetrics![1]!;
    // NBFC-specific metrics should be null for banks
    expect(latest.leverage).toBeNull();
    expect(latest.costOfBorrowings).toBeNull();
    expect(latest.yieldOnAdvances).toBeNull();
    expect(latest.spread).toBeNull();
    expect(latest.debtMix).toBeNull();
    // But common bank ratios (NIM, ROA, ROE) should still be computed
    expect(latest.nim).not.toBeNull();
    expect(latest.roa).not.toBeNull();
    expect(latest.roe).not.toBeNull();
  });

  it("computeBankRatios with explicit subtype produces NBFC framing", () => {
    // Direct unit test of the pure function — no scope detection involved
    const m1 = extractBankMetrics(periods[1]!);
    const m2 = extractBankMetrics(periods[2]!);
    const result = computeBankRatios(m2, m1, "nbfc");
    expect(result.leverage).toBeCloseTo(295000 / 73000, 3);
    expect(result.spread).not.toBeNull();
    expect(result.debtMix).not.toBeNull();
  });

  it("computeBankRatios with bank subtype default keeps NBFC fields null", () => {
    // Same fixture but route through bank framing — NBFC fields stay null
    // even though the raw debt-component fields are populated.
    const m1 = extractBankMetrics(periods[1]!);
    const m2 = extractBankMetrics(periods[2]!);
    const result = computeBankRatios(m2, m1, "bank");
    expect(result.leverage).toBeNull();
    expect(result.spread).toBeNull();
    expect(result.debtMix).toBeNull();
    // Raw debt-component fields ARE preserved (extraction is shared)
    expect(result.nonConvertibleDebentures).toBe(125000);
  });
});
