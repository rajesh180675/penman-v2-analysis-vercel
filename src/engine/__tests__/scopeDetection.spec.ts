import { describe, expect, it } from "vitest";
import { detectReportingScope, detectFolderScope } from "../scopeDetection";
import { readFileSync } from "fs";
import { resolve } from "path";

const dataDir = resolve(__dirname, "../../../public/data/companies");

describe("scopeDetection", () => {
  describe("detectReportingScope", () => {
    it("detects ITC consolidated BS", () => {
      const html = readFileSync(resolve(dataDir, "ITC/BalanceSheetINDAS_.xls"), "utf-8");
      const result = detectReportingScope(html);
      expect(result.scope).toBe("consolidated");
      expect(result.companyName).toContain("ITC");
    });

    it("detects ITC standalone BS", () => {
      const html = readFileSync(resolve(dataDir, "ITC/standalone/BalanceSheetINDAS_.xls"), "utf-8");
      const result = detectReportingScope(html);
      expect(result.scope).toBe("standalone");
      expect(result.companyName).toContain("ITC");
    });

    it("detects HDFC Bank consolidated BS", () => {
      const html = readFileSync(resolve(dataDir, "HDFC bank/BalanceSheetINDAS_.xls"), "utf-8");
      const result = detectReportingScope(html);
      expect(result.scope).toBe("consolidated");
    });

    it("detects HDFC Bank standalone BS", () => {
      const html = readFileSync(resolve(dataDir, "HDFC bank/standalone/BalanceSheetINDAS_.xls"), "utf-8");
      const result = detectReportingScope(html);
      expect(result.scope).toBe("standalone");
    });

    it("returns unknown for empty HTML", () => {
      const result = detectReportingScope("");
      expect(result.scope).toBe("unknown");
      expect(result.companyName).toBeNull();
    });
  });

  describe("detectFolderScope", () => {
    it("returns consolidated when all files agree", () => {
      const files = [
        readFileSync(resolve(dataDir, "ITC/BalanceSheetINDAS_.xls"), "utf-8"),
        readFileSync(resolve(dataDir, "ITC/ProfitLossINDAS_.xls"), "utf-8"),
      ];
      expect(detectFolderScope(files)).toBe("consolidated");
    });

    it("returns standalone when all files agree", () => {
      const files = [
        readFileSync(resolve(dataDir, "ITC/standalone/BalanceSheetINDAS_.xls"), "utf-8"),
        readFileSync(resolve(dataDir, "ITC/standalone/ProfitLossINDAS_.xls"), "utf-8"),
      ];
      expect(detectFolderScope(files)).toBe("standalone");
    });
  });
});
