import { describe, expect, it } from "vitest";
import { parseCapitalineZip } from "../capitalineParser";
import { parseScreenerTabDelimited } from "../screenerParser";
import { parseRawPeriodsJson } from "../jsonIngestion";

describe("parser robustness", () => {
  it("handles malformed screener text without throwing and returns empty or partial periods", () => {
    const malformed = "bad\tdata\nno years\tfoo\tbar";
    const out = parseScreenerTabDelimited(malformed, { companyId: "TEST" });
    expect(Array.isArray(out)).toBe(true);
  });

  it("parses valid screener tab text", () => {
    const txt = [
      "Metric\t2023\t2024",
      "Revenue\t100\t120",
      "Profit After Tax\t10\t12",
    ].join("\n");
    const out = parseScreenerTabDelimited(txt, { companyId: "ABC" });
    expect(out.length).toBe(2);
    expect(out[0]!.company_id).toBe("ABC");
  });

  it("throws on invalid raw json", () => {
    expect(() => parseRawPeriodsJson("{}")) .toThrow();
  });

  it("parses valid raw period json", () => {
    const json = JSON.stringify([
      {
        company_id: "X",
        period_end: "2025-03-31",
        raw_metric_values: { "Total Assets__BalanceSheet": 100 },
      },
    ]);
    const out = parseRawPeriodsJson(json);
    expect(out.length).toBe(1);
    expect(out[0]!.period_end).toBe("2025-03-31");
  });

  it("fails loud on invalid Capitaline zip payload", async () => {
    const invalidZip = new File(["not-a-zip"], "bad.zip", { type: "application/zip" });
    await expect(parseCapitalineZip(invalidZip, { companyId: "BAD" })).rejects.toThrow("Failed to open ZIP");
  });
});
