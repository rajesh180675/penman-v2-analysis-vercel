import { describe, it, expect } from "vitest";
import { computeAccountingStandardCoverage } from "../analysisTraceability";
import type { RawPeriodData } from "../types";

function mkPeriod(
  period_end: string,
  std?: "ind-as" | "revised-sch-vi" | "standard" | "unknown",
): RawPeriodData {
  const p: RawPeriodData = {
    company_id: "X",
    period_end,
    raw_metric_values: {},
  };
  if (std !== undefined) p.accounting_standard = std;
  return p;
}

describe("computeAccountingStandardCoverage — Phase A6", () => {
  it("returns unknown confidence when no period carries a tag", () => {
    const result = computeAccountingStandardCoverage([
      mkPeriod("2025-03-31"),
      mkPeriod("2024-03-31"),
    ]);
    expect(result.confidence).toBe("unknown");
    expect(result.dominantStandard).toBe("unknown");
    // Untagged-everywhere periods count as pre-Ind-AS for confidence math.
    expect(result.preIndASPeriods).toBe(2);
    expect(result.hasMultiStandardData).toBe(false);
  });

  it("handles empty / null input without throwing", () => {
    const empty = computeAccountingStandardCoverage([]);
    expect(empty.confidence).toBe("unknown");
    expect(empty.preIndASPeriods).toBe(0);
    const nul = computeAccountingStandardCoverage(null);
    expect(nul.confidence).toBe("unknown");
    const undef = computeAccountingStandardCoverage(undefined);
    expect(undef.confidence).toBe("unknown");
  });

  it("returns high confidence when all periods are Ind-AS", () => {
    const result = computeAccountingStandardCoverage([
      mkPeriod("2025-03-31", "ind-as"),
      mkPeriod("2024-03-31", "ind-as"),
      mkPeriod("2023-03-31", "ind-as"),
    ]);
    expect(result.confidence).toBe("high");
    expect(result.dominantStandard).toBe("ind-as");
    expect(result.preIndASPeriods).toBe(0);
    expect(result.periodsByStandard["ind-as"]).toBe(3);
    expect(result.hasMultiStandardData).toBe(false);
  });

  it("returns medium confidence when REV mixes with Ind-AS", () => {
    const result = computeAccountingStandardCoverage([
      mkPeriod("2025-03-31", "ind-as"),
      mkPeriod("2024-03-31", "ind-as"),
      mkPeriod("2016-03-31", "revised-sch-vi"),
      mkPeriod("2015-03-31", "revised-sch-vi"),
    ]);
    expect(result.confidence).toBe("medium");
    expect(result.preIndASPeriods).toBe(2);
    expect(result.hasMultiStandardData).toBe(true);
    // Tied 2-2: precedence breaks tie toward Ind-AS.
    expect(result.dominantStandard).toBe("ind-as");
  });

  it("returns low confidence when Standard / Old-GAAP periods contribute", () => {
    const result = computeAccountingStandardCoverage([
      mkPeriod("2025-03-31", "ind-as"),
      mkPeriod("2024-03-31", "ind-as"),
      mkPeriod("2016-03-31", "revised-sch-vi"),
      mkPeriod("2010-03-31", "standard"),
    ]);
    expect(result.confidence).toBe("low");
    expect(result.preIndASPeriods).toBe(2);
    expect(result.hasMultiStandardData).toBe(true);
  });

  it("returns low confidence when tagged-unknown periods exist alongside ind-as", () => {
    // A single tagged "unknown" means the parser saw the file but couldn't
    // classify the standard — treat as low confidence not unknown, because
    // we know there IS provenance information, just not enough.
    const result = computeAccountingStandardCoverage([
      mkPeriod("2025-03-31", "ind-as"),
      mkPeriod("2024-03-31", "unknown"),
    ]);
    expect(result.confidence).toBe("low");
  });

  it("uses period count to pick dominant standard when no tie", () => {
    const result = computeAccountingStandardCoverage([
      mkPeriod("2025-03-31", "ind-as"),
      mkPeriod("2016-03-31", "revised-sch-vi"),
      mkPeriod("2015-03-31", "revised-sch-vi"),
      mkPeriod("2014-03-31", "revised-sch-vi"),
    ]);
    expect(result.dominantStandard).toBe("revised-sch-vi");
    expect(result.confidence).toBe("medium");
  });

  it("breaks dominant-standard ties using precedence (Ind-AS wins)", () => {
    const result = computeAccountingStandardCoverage([
      mkPeriod("2025-03-31", "ind-as"),
      mkPeriod("2024-03-31", "ind-as"),
      mkPeriod("2016-03-31", "revised-sch-vi"),
      mkPeriod("2015-03-31", "revised-sch-vi"),
      mkPeriod("2014-03-31", "standard"),
      mkPeriod("2013-03-31", "standard"),
    ]);
    // 2-2-2 across three standards; Ind-AS has highest precedence.
    expect(result.dominantStandard).toBe("ind-as");
    expect(result.hasMultiStandardData).toBe(true);
  });

  it("counts each distinct standard only when it has at least one period", () => {
    const result = computeAccountingStandardCoverage([
      mkPeriod("2025-03-31", "ind-as"),
    ]);
    expect(result.hasMultiStandardData).toBe(false);
    expect(result.periodsByStandard).toEqual({
      "ind-as": 1,
      "revised-sch-vi": 0,
      standard: 0,
      unknown: 0,
    });
  });

  it("treats the ITC-like 15Y series correctly (all tagged Ind-AS via merge precedence)", () => {
    // After Phase A precedence merge, every period with Ind-AS data gets
    // tagged "ind-as" — so even a 15-year ITC series with REV+Standard
    // files contributing should resolve to high confidence.
    const periods: RawPeriodData[] = [];
    for (let y = 2011; y <= 2025; y++) {
      periods.push(mkPeriod(`${y}-03-31`, "ind-as"));
    }
    const result = computeAccountingStandardCoverage(periods);
    expect(result.confidence).toBe("high");
    expect(result.preIndASPeriods).toBe(0);
    expect(result.periodsByStandard["ind-as"]).toBe(15);
  });
});
