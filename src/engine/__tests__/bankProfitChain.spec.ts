import { describe, expect, it } from "vitest";
import { evaluateBankReconciliationResiduals } from "../bankReconciliationResiduals";
import type { BankPeriodMetrics } from "../bankPipeline";
import type { FinancialInstitutionSubtype } from "../analysisFamily";

const chainCheck = (subtype: FinancialInstitutionSubtype, profit: { pbt: number; pat: number; taxExpense?: number }) => {
  const metric = { period_end: "2017-03-31", ...profit } as unknown as BankPeriodMetrics;
  const summary = evaluateBankReconciliationResiduals({ bankMetrics: [metric], subtype });
  return summary.checks.find((c) => c.key === "profit-chain-sanity");
};

describe("bank profit chain — PBT − tax = PAT where the tax charge is filed", () => {
  it("confirms a real loss whose effective rate is meaningless on a small PBT", () => {
    // SBI FY17 consolidated as filed: 944.83 − 1,335.50 = −390.67. The 141%
    // rate failed the old [0, 60%] band.
    const check = chainCheck("bank", { pbt: 944.83, taxExpense: 1335.5, pat: -390.67 });
    expect(check?.status).toBe("confirmed");
    expect(check?.ratio).toBeCloseTo(0, 9);
  });

  it("fails a PAT/PBT label swap, which is what the check exists to catch", () => {
    // PBT 1,000, tax 300, PAT 700 — read with the two profit lines swapped.
    const check = chainCheck("nbfc", { pbt: 700, taxExpense: 300, pat: 1000 });
    expect(check?.status).toBe("failed");
  });

  it("keeps the rate band for insurers, whose tax sits outside the shareholders' account", () => {
    // HDFC Life FY19: PBT 1,291.02 and PAT 1,277.93 against a 239.88 tax line.
    const check = chainCheck("insurance", { pbt: 1291.02, taxExpense: 239.88, pat: 1277.93 });
    expect(check?.label).toMatch(/effective tax/);
    expect(check?.status).toBe("confirmed");
  });

  it("keeps the rate band when no tax line is filed", () => {
    const check = chainCheck("bank", { pbt: 944.83, pat: -390.67 });
    expect(check?.label).toMatch(/effective tax/);
    expect(check?.status).toBe("failed");
  });
});
