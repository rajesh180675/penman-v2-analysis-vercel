import { describe, expect, it } from "vitest";
import {
  AccountingStandard,
  STANDARD_ALIASES,
  STANDARD_PRECEDENCE,
  buildAliasMap,
  confidenceForStandard,
  standardFromFilename,
} from "../standardAliases";

describe("standardAliases — Phase A multi-standard ingestion", () => {
  describe("standardFromFilename", () => {
    it.each<[string, AccountingStandard]>([
      ["BalanceSheetINDAS_.xls", "ind-as"],
      ["ProfitLossINDAS_.xls", "ind-as"],
      ["BalanceSheetREV_.xls", "revised-sch-vi"],
      ["ProfitLossREV.xls", "revised-sch-vi"],
      ["RevisedScheduleVI.xls", "revised-sch-vi"],
      ["BalanceSheetSTD_.xls", "standard"],
      ["ProfitLoss_STD.xls", "standard"],
      ["StandardBalanceSheet.xls", "standard"],
      ["GAAPBalanceSheet.xls", "standard"],
      // Cash flow files often lack a suffix — should be unknown so the
      // standard is inferred from co-located BS/PL files at parse time.
      ["CashFlow_.xls", "unknown"],
      ["BalanceSheet_.xls", "unknown"],
      ["nonsense.xls", "unknown"],
    ])("detects %s as %s", (name, expected) => {
      expect(standardFromFilename(name)).toBe(expected);
    });
  });

  describe("STANDARD_PRECEDENCE", () => {
    it("orders Ind-AS > REV > Standard > Unknown", () => {
      expect(STANDARD_PRECEDENCE["ind-as"]).toBeGreaterThan(STANDARD_PRECEDENCE["revised-sch-vi"]);
      expect(STANDARD_PRECEDENCE["revised-sch-vi"]).toBeGreaterThan(STANDARD_PRECEDENCE["standard"]);
      expect(STANDARD_PRECEDENCE["standard"]).toBeGreaterThan(STANDARD_PRECEDENCE["unknown"]);
    });
  });

  describe("buildAliasMap", () => {
    it("returns empty map for ind-as (no aliasing needed)", () => {
      expect(buildAliasMap("ind-as").size).toBe(0);
    });

    it("contains key Revised Sch-VI to Ind-AS aliases", () => {
      const m = buildAliasMap("revised-sch-vi");
      expect(m.get("Sundry Debtors")).toBe("Trade Receivables");
      expect(m.get("Sundry Creditors")).toBe("Trade Payables");
      expect(m.get("Reserves and Surplus")).toBe("Other Equity");
      expect(m.get("Net Block")).toBe("Net Property, plant and equipment");
    });

    it("contains Standard / Old GAAP aliases", () => {
      const m = buildAliasMap("standard");
      expect(m.get("Secured Loans")).toBe("Long Term Borrowings");
      expect(m.get("Reserves and Surplus")).toBe("Other Equity");
      expect(m.get("Sales")).toBe("Total Revenue");
    });

    it("respects appliesTo so REV-only labels don't leak into Standard map", () => {
      // Sanity: every alias appears in at least one map it claims to apply to.
      for (const a of STANDARD_ALIASES) {
        for (const std of a.appliesTo) {
          expect(buildAliasMap(std).get(a.source)).toBe(a.canonical);
        }
      }
    });

    it("aliases never map a label to itself (would be a no-op)", () => {
      for (const a of STANDARD_ALIASES) {
        if (a.notes?.includes("no rename needed")) continue;
        expect(a.source).not.toBe(a.canonical);
      }
    });
  });

  describe("confidenceForStandard", () => {
    it.each<[AccountingStandard, "high" | "medium" | "low"]>([
      ["ind-as", "high"],
      ["revised-sch-vi", "medium"],
      ["standard", "low"],
      ["unknown", "low"],
    ])("%s → %s", (std, conf) => {
      expect(confidenceForStandard(std)).toBe(conf);
    });
  });
});
