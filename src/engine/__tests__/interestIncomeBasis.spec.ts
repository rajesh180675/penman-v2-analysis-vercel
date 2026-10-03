/**
 * Capitaline's condensed consolidated exports for Bajaj Finance, Muthoot
 * Finance and Shriram Finance file no interest-income line, so the pipeline
 * reads "Revenue From Operations(Net)". NII is then net total income (Bajaj
 * FY24: 36,249 against a published NII of 29,582 and net total income of
 * 36,258), and NIM, yield and spread include fee income. The basis is recorded
 * so the checks and the UI can say so.
 */
import { describe, expect, it } from "vitest";
import { evaluateBankReconciliationResiduals } from "../bankReconciliationResiduals";
import { extractBankMetrics, type BankPeriodMetrics } from "../bankPipeline";

const extract = (lines: Record<string, number>) =>
  extractBankMetrics({ company_id: "NBFC", period_end: "2024-03-31", raw_metric_values: lines });

describe("interest income basis", () => {
  it("marks a revenue total read in place of an interest line", () => {
    // Bajaj Finance FY24 consolidated as filed.
    const m = extract({ "Revenue From Operations(Net)__ProfitLoss": 54973.89, "Finance Cost__ProfitLoss": 18724.69 });
    expect(m.interestEarned).toBe(54973.89);
    expect(m.interestIncomeBasis).toBe("revenue-total");
  });

  it("marks an interest line, even where a revenue total is filed beside it", () => {
    // Cholamandalam FY24: interest 17,627.11 inside revenue of 19,139.62.
    const m = extract({
      "Interests Income (Operating)__ProfitLoss": 17627.11,
      "Revenue From Operations(Net)__ProfitLoss": 19139.62,
    });
    expect(m.interestEarned).toBe(17627.11);
    expect(m.interestIncomeBasis).toBe("interest-line");
  });

  it("follows the alias actually read, past a label filed as blank", () => {
    // Capitaline files unused alternative labels as "-" (null): the value comes
    // from the revenue total, and so must the basis.
    const m = extract({
      "Interest Income__ProfitLoss": null,
      "Revenue From Operations(Net)__ProfitLoss": 54973.89,
    } as unknown as Record<string, number>);
    expect(m.interestEarned).toBe(54973.89);
    expect(m.interestIncomeBasis).toBe("revenue-total");
  });

  it("has no basis when nothing is read", () => {
    expect(extract({ "Total Assets__BalanceSheet": 1000 }).interestIncomeBasis).toBeNull();
  });
});

describe("NIM plausibility names a revenue basis", () => {
  const nimCheck = (nim: number, interestIncomeBasis: BankPeriodMetrics["interestIncomeBasis"]) => {
    const metric = { period_end: "2024-03-31", nim, interestIncomeBasis } as unknown as BankPeriodMetrics;
    return evaluateBankReconciliationResiduals({ bankMetrics: [metric], subtype: "nbfc" }).checks.find((c) => c.key === "nim-plausibility");
  };

  it("explains an above-ceiling margin by the fee income inside it", () => {
    const check = nimCheck(0.1275, "revenue-total");
    expect(check?.status).toBe("degraded");
    expect(check?.detail).toMatch(/no interest-income line/);
    expect(check?.detail).not.toMatch(/leaked/);
  });

  it("keeps the leak diagnosis where an interest line was read", () => {
    expect(nimCheck(0.1275, "interest-line")?.detail).toMatch(/Other Income leaked into NII/);
  });

  it("notes the basis on a margin inside the band too", () => {
    expect(nimCheck(0.09, "revenue-total")?.detail).toMatch(/includes fee income/);
    expect(nimCheck(0.09, "interest-line")?.detail).not.toMatch(/fee income/);
  });
});
