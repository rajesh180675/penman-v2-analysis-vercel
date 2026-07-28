import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function doc(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

/** `| Label | Weight | Score | Status | Evidence | Blockers |` from the Family Scores table. */
interface DocFamilyRow {
  label: string;
  weight: number;
  score: number;
  status: string;
  blockers: string;
}

function familyRows(scorecard: string): DocFamilyRow[] {
  return scorecard
    .split(/\r?\n/)
    .filter((line) => /^\|\s*[^|]+\|\s*\d+\s*\|\s*\d/.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return {
        label: cells[1] ?? "",
        weight: Number(cells[2]),
        score: Number(cells[3]),
        status: cells[4] ?? "",
        blockers: cells[6] ?? "",
      };
    });
}

/**
 * What `markdownCell` renders for a family with nothing in its blockers list.
 *
 * The generator writes only gaps into that list, so "is this family reporting
 * something missing?" is answerable structurally — no reading of the prose.
 *
 * This check used to be a regex over gap phrasings
 * (`/\blacks?\b|incomplete|remains blocked/`) applied to every `strong` family,
 * and two things were wrong with it. A blacklist over generated prose fails open
 * on the first phrasing nobody thought of: review found "still rely on a single
 * valuation spine" within a day, and a guard that silently passes an unanticipated
 * wording is worse than no guard because it reads like coverage. And `strong` is a
 * band (>= 8.5), not a claim of completeness — a family at 9.0 that prints one gap
 * row with a count is being accurate, and failing it would reward deleting the
 * blocker rather than fixing it.
 *
 * A 10.0 is the case with no such defence. It is the top of the scale and leaves
 * no remainder to describe, so a blocker printed beside it contradicts the score
 * in the same row of the same table. That is the defect this artifact shipped
 * with, and it does not depend on how the blocker happens to be worded.
 */
const NO_BLOCKERS = "—";

describe("Plan 0 PR-0.4 valuation maturity documentation", () => {
  it("records a target and a parseable current score in the scorecard artifact", () => {
    const scorecard = doc("docs/valuation-maturity-scorecard.md");

    expect(scorecard).toContain("## Current Baseline and Target");
    expect(scorecard).toContain("Target score: **10.0/10**");
    expect(scorecard).toContain("Target state: no supported company type is silently routed through the wrong valuation family");
    // The current score is read, not pinned. This assertion used to be
    // `toContain("Current score: **8.5/10**")`, which made the only way to keep
    // CI green never regenerating a generated artifact: improve the corpus, run
    // the generator, and the test fails for the improvement. A doc guard that
    // rewards staleness is worse than no guard, because it reads like coverage.
    expect(scorecard).toMatch(/Current score: \*\*\d+\.\d\/10\*\*/);
  });

  it("keeps the scorecard headline consistent with the family table it ships with", () => {
    const scorecard = doc("docs/valuation-maturity-scorecard.md");
    const rows = familyRows(scorecard);
    expect(rows.length).toBe(8);

    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    expect(totalWeight).toBe(100);
    const weighted = rows.reduce((sum, row) => sum + row.score * row.weight, 0) / totalWeight;

    const headline = scorecard.match(/Current score: \*\*(\d+\.\d)\/10\*\*/)?.[1];
    // Catches a hand-edited headline. The number is generated from this exact
    // table, so the two can only disagree if someone typed one of them —
    // which is the failure mode a "living artifact" doc actually has.
    expect(Number(headline)).toBe(Number(weighted.toFixed(1)));
  });

  it("does not let a family score a perfect 10 while printing its own gaps", () => {
    const scorecard = doc("docs/valuation-maturity-scorecard.md");

    // This is the check that would have caught the real defect. "Data
    // freshness/source tieout" shipped at 10.0 while its own blockers cell read
    // "10 rows lack first-class source lineage evidence; 1 row lacks fresh
    // timestamped market evidence" — because its score was
    // `8.5 + parsedPeriodShare + latestPeriodShare`, whose entire range was 8.5
    // to 10.0. The two things the family is named after were the two it did not
    // price, and no test looked at the score at all.
    const dishonest = familyRows(scorecard)
      .filter((row) => row.score === 10 && row.blockers !== NO_BLOCKERS)
      .map((row) => `${row.label} scored ${row.score} (${row.status}) with blockers: ${row.blockers}`);

    expect(dishonest).toEqual([]);
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
