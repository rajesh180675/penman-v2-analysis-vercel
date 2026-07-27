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

  /**
   * The wrapped rethrow used to discard the original error entirely: the message
   * was interpolated into a new Error and the stack that said which JSZip call
   * actually failed was dropped. Four of the six wrapping sites in the engine
   * `trace(...)` the original stack first, so it reached the trace channel — but
   * never the caller, who sees only the Error object.
   *
   * Asserting the chain rather than the message, because the message already had
   * coverage above and was never what broke.
   */
  it("preserves the underlying failure as the rethrow's cause", async () => {
    const invalidZip = new File(["not-a-zip"], "bad.zip", { type: "application/zip" });
    const error = await parseCapitalineZip(invalidZip, { companyId: "BAD" }).then(
      () => { throw new Error("expected the parse to reject"); },
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(Error);
    // The wrapper the caller sees.
    expect((error as Error).message).toContain("Failed to open ZIP");
    // The original, which is the part that was being thrown away.
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).stack).toBeTruthy();
    // Not the same object: this is a wrapped chain, not a bare rethrow.
    expect(cause).not.toBe(error);
  });
});
