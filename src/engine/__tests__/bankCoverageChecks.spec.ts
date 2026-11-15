/**
 * The bank reconciliation's coverage, sign and subset checks, each pinned on
 * its own. Switching any of them off (coverage gaps never breached, a
 * non-positive interest income confirmed, a subset larger than its total
 * confirmed) left every spec green: they were exercised only through the
 * library's exports, where none fires.
 */
import { describe, expect, it } from "vitest";
import { evaluateBankReconciliationResiduals } from "../bankReconciliationResiduals";
import type { BankPeriodMetrics } from "../bankPipeline";

const metric = (overrides: Partial<BankPeriodMetrics>) =>
  ({ period_end: "2025-03-31", ...overrides }) as unknown as BankPeriodMetrics;
const check = (key: string, m: BankPeriodMetrics, subtype: "bank" | "nbfc" = "bank") =>
  evaluateBankReconciliationResiduals({ bankMetrics: [m], subtype }).checks.find((c) => c.key === key);

describe("bank asset coverage", () => {
  it("confirms advances + investments + cash with the RBI that make up total assets", () => {
    const m = metric({ advances: 600, investments: 300, cashAndBalanceWithRBI: 80, totalAssets: 1000 });
    expect(check("bank-asset-coverage", m)?.status).toBe("confirmed");
  });

  it("fails when they cover under 80% of total assets", () => {
    const m = metric({ advances: 400, investments: 200, cashAndBalanceWithRBI: 50, totalAssets: 1000 });
    expect(check("bank-asset-coverage", m)?.status).toBe("failed");
  });

  it("fails when they exceed total assets", () => {
    const m = metric({ advances: 700, investments: 350, cashAndBalanceWithRBI: 80, totalAssets: 1000 });
    expect(check("bank-asset-coverage", m)?.status).toBe("failed");
  });
});

describe("bank liability coverage", () => {
  it("fails when deposits + borrowings + equity cover under 80% of total assets", () => {
    const m = metric({ deposits: 500, borrowings: 100, totalEquity: 100, totalAssets: 1000 });
    expect(check("bank-liability-coverage", m)?.status).toBe("failed");
  });

  it("confirms funding that makes up total assets", () => {
    const m = metric({ deposits: 780, borrowings: 100, totalEquity: 100, totalAssets: 1000 });
    expect(check("bank-liability-coverage", m)?.status).toBe("confirmed");
  });
});

describe("the NII sign bridge", () => {
  it("fails a non-positive interest income", () => {
    expect(check("nii-sign-bridge", metric({ interestEarned: -5, interestExpended: -3 }))?.status).toBe("failed");
  });

  it("fails interest paid well beyond interest earned", () => {
    expect(check("nii-sign-bridge", metric({ interestEarned: 100, interestExpended: -120 }))?.status).toBe("failed");
  });

  it("confirms interest paid within interest earned", () => {
    expect(check("nii-sign-bridge", metric({ interestEarned: 100, interestExpended: -60 }))?.status).toBe("confirmed");
  });
});

describe("subsets that cannot exceed their total", () => {
  it("fails CASA above 120% of deposits", () => {
    expect(check("casa-deposits-sanity", metric({ casaRatio: 1.3, deposits: 1000 }))?.status).toBe("failed");
  });

  it("confirms CASA within deposits", () => {
    expect(check("casa-deposits-sanity", metric({ casaRatio: 0.42, deposits: 1000 }))?.status).toBe("confirmed");
  });

  it("fails an NBFC debt mix whose components exceed total borrowings by over 20%", () => {
    const m = metric({ borrowings: 1000, nonConvertibleDebentures: 700, termLoansFromBanks: 600 });
    expect(check("debt-mix-coverage", m, "nbfc")?.status).toBe("failed");
  });

  it("confirms an NBFC debt mix within total borrowings", () => {
    const m = metric({ borrowings: 1000, nonConvertibleDebentures: 500, termLoansFromBanks: 300 });
    expect(check("debt-mix-coverage", m, "nbfc")?.status).toBe("confirmed");
  });
});

describe("an insurer's combined ratio", () => {
  const combined = (combinedRatio: number) =>
    evaluateBankReconciliationResiduals({ bankMetrics: [metric({ combinedRatio })], subtype: "insurance" })
      .checks.find((c) => c.key === "insurance-combined-ratio")?.status;

  it("fails above 150%, degrades above 120%, and confirms below", () => {
    expect(combined(1.6)).toBe("failed");
    expect(combined(1.3)).toBe("degraded");
    expect(combined(0.95)).toBe("confirmed");
  });
});
