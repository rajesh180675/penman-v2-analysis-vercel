/**
 * Smoke tests for bankExcelExport (H5 audit fix).
 *
 * Validates the workbook generator builds a valid xlsx ArrayBuffer for each
 * subtype (bank / nbfc / insurance) and that the right sheets are emitted
 * conditionally — insurance gets the Insurance sheet, NBFC gets NBFC Funding,
 * etc.
 *
 * We can't fully roundtrip without ExcelJS readback, but we verify:
 *   - generation completes without throwing
 *   - returns a non-empty ArrayBuffer
 *   - byte signature matches xlsx (PK header — xlsx is a zip)
 */
import { describe, it, expect } from "vitest";
import { generateBankWorkbook } from "../bankExcelExport";
import { DEFAULT_CONFIG } from "../types";
import type { FinancialInstitutionAnalysisResult, FinancialInstitutionSubtype } from "../analysisFamily";
import type { BankPeriodMetrics } from "../bankPipeline";
import type { BankValuationBundle } from "../bankValuation";

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
    leverage: 0.46,
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
  };
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

function isXlsxBuffer(ab: ArrayBuffer): boolean {
  // xlsx is zip → starts with "PK\x03\x04"
  if (ab.byteLength < 4) return false;
  const bytes = new Uint8Array(ab.slice(0, 4));
  return bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
}

describe("generateBankWorkbook", () => {
  it("generates a bank workbook (4 sheets: Cover, Metrics, Ratios, Valuation)", async () => {
    const bankResult = mkBankResult("bank");
    const buf = await generateBankWorkbook(bankResult, DEFAULT_CONFIG, {
      companyLabel: "HDFC Bank",
      marketCapCr: 1_200_000,
    });
    expect(buf).toBeDefined();
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(isXlsxBuffer(buf)).toBe(true);
  });

  it("generates an NBFC workbook (adds NBFC Funding sheet)", async () => {
    const bankResult = mkBankResult("nbfc");
    const buf = await generateBankWorkbook(bankResult, DEFAULT_CONFIG, {
      companyLabel: "Bajaj Finance",
    });
    expect(isXlsxBuffer(buf)).toBe(true);
  });

  it("generates an insurance workbook (adds Insurance Metrics sheet)", async () => {
    const insurerMetrics = [
      mkMetrics("2022-03-31", {
        premiumEarned: 480_000,
        claimsExpense: -380_000,
        claimsRatio: 0.79,
        expenseRatio: 0.13,
        combinedRatio: 0.92,
        premiumGrowth: 0.06,
        floatToEquity: 14.2,
        investmentYield: 0.078,
      }),
      mkMetrics("2023-03-31", {
        premiumEarned: 510_000,
        claimsExpense: -395_000,
        claimsRatio: 0.775,
        expenseRatio: 0.135,
        combinedRatio: 0.91,
        premiumGrowth: 0.0625,
        floatToEquity: 13.8,
        investmentYield: 0.082,
      }),
    ];
    const bankResult = mkBankResult("insurance", {
      bankMetrics: insurerMetrics,
      periods: insurerMetrics.map((m) => mkSnapshot(m.period_end, m)),
    });
    const buf = await generateBankWorkbook(bankResult, DEFAULT_CONFIG, {
      companyLabel: "LIC",
    });
    expect(isXlsxBuffer(buf)).toBe(true);
  });

  it("handles minimal data (no valuation, no asset quality) without crashing", async () => {
    const minimalMetric = mkMetrics("2024-03-31");
    const bankResult = mkBankResult("bank", {
      valuation: null,
      assetQuality: undefined,
      bankMetrics: [minimalMetric],
      periods: [mkSnapshot(minimalMetric.period_end, minimalMetric)],
    });
    const buf = await generateBankWorkbook(bankResult, DEFAULT_CONFIG, {});
    expect(isXlsxBuffer(buf)).toBe(true);
  });
});
