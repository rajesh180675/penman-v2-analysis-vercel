import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FinancialInstitutionReport from "../FinancialInstitutionReport";
import { DEFAULT_CONFIG } from "../../engine/types";
import type {
  FinancialInstitutionAnalysisResult,
  FinancialInstitutionSubtype,
} from "../../engine/analysisFamily";
import type { BankPeriodMetrics } from "../../engine/bankPipeline";
import type { BankValuationBundle } from "../../engine/bankValuation";

// Fixture builders adapted from src/engine/__tests__/bankExcelExport.spec.ts —
// the smallest realistic FinancialInstitutionAnalysisResult that exercises the
// period snapshots, NBFC metrics, asset-quality, and valuation surfaces.
function mkMetrics(period: string, overrides: Partial<BankPeriodMetrics> = {}): BankPeriodMetrics {
  return {
    period_end: period,
    totalAssets: 4_200_000,
    totalEquity: 430_000,
    advances: 2_800_000,
    deposits: 3_200_000,
    investments: 900_000,
    borrowings: 200_000,
    cashAndBalanceWithRBI: 250_000,
    interestEarned: 350_000,
    interestExpended: -182_000,
    nii: 168_000,
    otherIncome: 35_000,
    operatingExpenses: -90_000,
    provisions: -25_000,
    pat: 63_000,
    pbt: 84_000,
    dividendPaid: -12_000,
    nim: 0.0432,
    roa: 0.016,
    roe: 0.155,
    creditCost: 0.009,
    costToIncome: 0.443,
    casaRatio: 0.42,
    leverage: 4.6,
    nonConvertibleDebentures: 80_000,
    termLoansFromBanks: 60_000,
    termLoansFromInstitutions: 40_000,
    termLoansFromOthers: 20_000,
    costOfBorrowings: 0.07,
    yieldOnAdvances: 0.094,
    spread: 0.024,
    debtMix: { ncdShare: 0.4, bankLoanShare: 0.3, institutionLoanShare: 0.2, otherLoanShare: 0.1 },
    quality: null,
    ...overrides,
  };
}

function mkValuation(): BankValuationBundle {
  return {
    sustainableROE: 0.155,
    ke: 0.13,
    terminalGrowth: 0.045,
    latestBookValue: 430_000,
    usableHistory: 5,
    payoutRatio: 0.19,
    justifiedPB: {
      status: "computed",
      intrinsicValue: 580_000,
      premiumOverMarket: null,
      reason: "Justified P/B = (ROE - g) / (ke - g) = 1.30",
      diagnostics: { pb: 1.30 },
    },
    equityResidualIncome: {
      status: "computed",
      intrinsicValue: 595_000,
      premiumOverMarket: null,
      reason: "Equity RI: 5y forecast + terminal",
      diagnostics: {},
    },
    sustainableDDM: {
      status: "computed",
      intrinsicValue: 540_000,
      premiumOverMarket: null,
      reason: "DDM: D1 / (ke - g)",
      diagnostics: {},
    },
    triangulatedValue: 580_000,
    modelsContributing: ["justified_pb", "equity_ri", "ddm"],
  } as unknown as BankValuationBundle;
}

function mkSnapshot(period: string, m: BankPeriodMetrics) {
  return {
    period_end: period,
    bookValue: m.totalEquity,
    earnings: m.pat,
    deposits: m.deposits,
    borrowings: m.borrowings,
    advances: m.advances,
    premiumEarned: m.premiumEarned ?? null,
    claimsExpense: m.claimsExpense ?? null,
  };
}

function mkBankResult(
  subtype: FinancialInstitutionSubtype,
  overrides: Partial<FinancialInstitutionAnalysisResult> = {},
): FinancialInstitutionAnalysisResult {
  const metrics = [
    mkMetrics("2022-03-31"),
    mkMetrics("2023-03-31"),
    mkMetrics("2024-03-31"),
  ];
  return {
    family: "financial-institution",
    subtype,
    periods: metrics.map((m) => mkSnapshot(m.period_end, m)),
    traceability: null,
    bankMetrics: metrics,
    valuation: mkValuation(),
    assetQuality: undefined,
    ...overrides,
  } as FinancialInstitutionAnalysisResult;
}

describe("FinancialInstitutionReport", () => {
  it("renders the report shell, subtype, period snapshots and valuation for a bank", () => {
    const bankResult = mkBankResult("bank");
    const html = renderToStaticMarkup(
      <FinancialInstitutionReport
        bankResult={bankResult}
        marketCapCr={1_200_000}
        config={DEFAULT_CONFIG}
        companyId="HDFC Bank"
      />,
    );

    // Report shell + header.
    expect(html).toContain("Financial Institution Analysis");
    expect(html).toContain("bank");
    expect(html).toContain("Period Snapshots");

    // Valuation section + formatted capital-cost / ROE metrics.
    expect(html).toContain("Bank Valuation");
    expect(html).toContain("Sustainable ROE");
    expect(html).toContain("15.5%"); // sustainableROE 0.155
    expect(html).toContain("13.0%"); // ke 0.13
    expect(html).toContain("Triangulated Intrinsic Value");
    // ModelCard intrinsic value fmtCr(580000) → ₹5.80 L Cr.
    expect(html).toContain("₹5.80 L Cr");
  });

  it("renders the NBFC metrics surface with leverage / spread / NIM / ROE", () => {
    const nbfcResult = mkBankResult("nbfc");
    const html = renderToStaticMarkup(
      <FinancialInstitutionReport
        bankResult={nbfcResult}
        marketCapCr={500_000}
        config={DEFAULT_CONFIG}
        companyId="Bajaj Finance"
      />,
    );

    expect(html).toContain("NBFC Metrics");
    expect(html).toContain("Leverage");
    expect(html).toContain("Yield on Advances");
    expect(html).toContain("Cost of Borrowings");
    expect(html).toContain("Spread");
    expect(html).toContain("4.60x"); // leverage fmtMultiple
    expect(html).toContain("4.3%"); // NIM 0.0432
    expect(html).toContain("15.5%"); // ROE 0.155
  });

  it("renders without a valuation (skip banner) and without an export button when config is absent", () => {
    const bankResult = mkBankResult("bank", { valuation: null });
    const html = renderToStaticMarkup(
      <FinancialInstitutionReport bankResult={bankResult} />,
    );

    expect(html).toContain("Financial Institution Analysis");
    expect(html).toContain("Bank valuation not computed");
    expect(html).not.toContain("Export Excel Workbook");
  });
});
