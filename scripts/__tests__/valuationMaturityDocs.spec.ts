import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function doc(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("Plan 0 PR-0.4 valuation maturity documentation", () => {
  it("records current and target valuation maturity scores in the scorecard artifact", () => {
    const scorecard = doc("docs/valuation-maturity-scorecard.md");

    expect(scorecard).toContain("## Current Baseline and Target");
    expect(scorecard).toContain("Current score: **7.3/10**");
    expect(scorecard).toContain("Target score: **10.0/10**");
    expect(scorecard).toContain("Target state: no supported company type is silently routed through the wrong valuation family");
  });

  it("explains why expected skips are not bugs across scorecard and rigor docs", () => {
    const scorecard = doc("docs/valuation-maturity-scorecard.md");
    const ladder = doc("docs/analysis-rigor-ladder.md");

    for (const text of [scorecard, ladder]) {
      expect(text).toContain("Expected skips are not bugs");
      expect(text).toContain("EXPECTED_SKIP_MISSING_SIDECAR");
      expect(text).toContain("EXPECTED_SKIP_INSUFFICIENT_HISTORY");
      expect(text).toContain("EXPECTED_SKIP_UNSUPPORTED_SOURCE");
    }
  });

  it("adds an operational handoff pointer and accepted ADR for the scorecard decision", () => {
    const handoff = doc("docs/operational-handoff.md");
    const adr = doc("docs/adr/008-valuation-maturity-scorecard.md");

    expect(handoff).toContain("## Valuation maturity baseline");
    expect(handoff).toContain("docs/valuation-maturity-scorecard.md");
    expect(handoff).toContain("npx tsx scripts/valuation-scorecard.ts --format json");

    expect(adr).toContain("# ADR-008: Valuation maturity scorecard");
    expect(adr).toContain("- **Status:** Accepted");
    expect(adr).toContain("weighted score families");
    expect(adr).toContain("expected skips are explicit source/data-contract gaps, not calculation failures");
  });
});
