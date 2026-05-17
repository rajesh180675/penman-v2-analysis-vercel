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
      // Filename suffix (Ind-AS exports always tagged)
      ["BalanceSheetINDAS_.xls", "ind-as"],
      ["ProfitLossINDAS_.xls", "ind-as"],
      // Filename suffix — REV variants
      ["BalanceSheetREV_.xls", "revised-sch-vi"],
      ["ProfitLossREV.xls", "revised-sch-vi"],
      ["BalanceSheetRevised_.xls", "revised-sch-vi"],
      ["RevisedScheduleVI.xls", "revised-sch-vi"],
      // Filename suffix — Standard variants
      ["BalanceSheetSTD_.xls", "standard"],
      ["ProfitLoss_STD.xls", "standard"],
      ["StandardBalanceSheet.xls", "standard"],
      ["GAAPBalanceSheet.xls", "standard"],
      // Folder-name detection (real Capitaline export layout — Standard
      // and Revised files often carry NO filename suffix; the folder is
      // the only signal):
      ["ITC/revised schd/CashFlow_.xls", "revised-sch-vi"],
      ["ITC/revised schd/standalone/BalanceSheetRevised_.xls", "revised-sch-vi"],
      ["ITC/standard/BalanceSheet_.xls", "standard"],
      ["ITC/standard/standalone/ProfitLoss_.xls", "standard"],
      ["ITC/standard/CashFlow_.xls", "standard"],
      // Windows-style backslash paths
      ["ITC\\standard\\BalanceSheet_.xls", "standard"],
      ["ITC\\revised schd\\BalanceSheet_.xls", "revised-sch-vi"],
      // Top-level Ind-AS files (no folder marker, just filename suffix)
      ["ITC/BalanceSheetINDAS_.xls", "ind-as"],
      // Truly ambiguous — top-level CashFlow with no parent folder hint
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
