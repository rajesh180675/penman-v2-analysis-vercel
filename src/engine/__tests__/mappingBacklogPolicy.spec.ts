import { describe, expect, it } from "vitest";
import { summarizeMappingBacklog, triageOutOfSpecLabel } from "../mappingBacklogPolicy";

describe("mapping backlog triage policy", () => {
  it("marks clear aliases for direct spec addition", () => {
    const triage = triageOutOfSpecLabel({
      statement: "ProfitLoss",
      key: "Total Revenue from Operations",
      periodsObserved: 5,
      nonZeroPeriods: 5,
      latestValue: 81612.78,
      maxAbsValue: 81612.78,
    });

    expect(triage.action).toBe("add-to-spec");
    expect(triage.targetGroupId).toBe("is-sales");
    expect(triage.suggestedSpecPath).toBe("profitLoss.sales");
  });

  it("groups detail components into existing buckets instead of unsafe alias expansion", () => {
    const triage = triageOutOfSpecLabel({
      statement: "BalanceSheet",
      key: "Balances with Banks",
      periodsObserved: 15,
      nonZeroPeriods: 15,
      latestValue: 617.59,
      maxAbsValue: 1531.47,
    });

    expect(triage.action).toBe("group-to-existing");
    expect(triage.targetLine).toBe("BS.FA.CashBank");
    expect(triage.suggestedSpecPath).toBeNull();
  });

  it("ignores unsupported and disclosure-only noise", () => {
    const insurance = triageOutOfSpecLabel({
      statement: "BalanceSheet",
      key: "Policy Holder's Investments (Insurance Business)",
      periodsObserved: 15,
      nonZeroPeriods: 0,
      latestValue: 0,
      maxAbsValue: 0,
    });
    const shareCount = triageOutOfSpecLabel({
      statement: "BalanceSheet",
      key: "Number of Equity Shares - Issued",
      periodsObserved: 15,
      nonZeroPeriods: 15,
      latestValue: 12514119781,
      maxAbsValue: 12514119781,
    });

    expect(insurance.action).toBe("ignore-non-core");
    expect(shareCount.action).toBe("ignore-non-core");
  });

  it("summarizes actionable backlog separately from ignored noise", () => {
    const summary = summarizeMappingBacklog([
      {
        statement: "ProfitLoss",
        key: "Total Interest Expenses",
        periodsObserved: 5,
        nonZeroPeriods: 5,
        latestValue: 45.06,
        maxAbsValue: 45.06,
        triage: triageOutOfSpecLabel({
          statement: "ProfitLoss",
          key: "Total Interest Expenses",
          periodsObserved: 5,
          nonZeroPeriods: 5,
          latestValue: 45.06,
          maxAbsValue: 45.06,
        }),
      },
      {
        statement: "BalanceSheet",
        key: "Number of Equity Shares - Issued",
        periodsObserved: 5,
        nonZeroPeriods: 5,
        latestValue: 100,
        maxAbsValue: 100,
        triage: triageOutOfSpecLabel({
          statement: "BalanceSheet",
          key: "Number of Equity Shares - Issued",
          periodsObserved: 5,
          nonZeroPeriods: 5,
          latestValue: 100,
          maxAbsValue: 100,
        }),
      },
    ]);

    expect(summary.totalsByAction["add-to-spec"]).toBe(1);
    expect(summary.totalsByAction["ignore-non-core"]).toBe(1);
    expect(summary.actionableCount).toBe(1);
    expect(summary.ignoredCount).toBe(1);
    expect(summary.topActionable).toHaveLength(1);
  });
});
