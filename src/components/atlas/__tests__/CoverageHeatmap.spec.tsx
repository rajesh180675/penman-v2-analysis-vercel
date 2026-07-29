/**
 * First spec for `src/components/atlas/` — the directory carried none.
 *
 * What it pins is the basis of each rendered aggregate. The panel puts five
 * CELL counts (metric × period) directly above five METRIC counts in an
 * identical five-column grid, and the second strip renders a bare number under
 * a statement name with no unit of its own. Both numbers are correct; only the
 * comparison a reader draws between the strips was wrong (#69).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CoverageHeatmap from "../CoverageHeatmap";
import type { RawPeriodData } from "../../../engine/types";

const PERIODS = ["2023-03-31", "2024-03-31", "2025-03-31"] as const;

/* Nine metrics spanning all five statement classes over three periods, so the
   cell count (27) and the metric count (9) are far apart and neither equals the
   period count.
   `null` means the key is absent from that period's `raw_metric_values`, which
   is how a "Missing" cell arises — the union of keys is what the panel is given.
   Sign classes are deliberately unequal too (14 positive, 5 negative, 6 zero,
   2 missing): were two of them equal, swapping their two render expressions
   would produce identical output and no assertion here would notice. */
const VALUES: Record<string, readonly (number | null)[]> = {
  // Balance Sheet ×3 — "asset" / "liabilit" reach the BS branch.
  "Gross Block Assets": [100, 110, 120],
  "Sundry Liabilities": [-50, -55, null],
  "Capital Work in Progress Assets": [0, 0, 5],
  // Profit & Loss ×2 — "revenue" / "sales".
  "Segment Revenue Note": [900, 950, 1000],
  "Deferred Sales Charge": [-10, 0, null],
  // Cash Flow ×2 — "cash from" / "cash used".
  "Net Cash from Financing Note": [20, 0, 40],
  "Net Cash used in Investing Note": [0, -5, -6],
  // Ratio ×1 — "ratio".
  "Custom Coverage Ratio": [1.5, 1.6, 0],
  // Other ×1 — matches no needle in any branch. Not "Auditor Remuneration":
  // `classifyStatement` substring-matches, and "remuneration" contains "ratio".
  "Custom Vendor Headcount": [7, 8, 9],
};

const ALL_METRICS = Object.keys(VALUES).sort();

function mkRaw(): RawPeriodData[] {
  return PERIODS.map((period_end, i) => ({
    company_id: "ACME",
    period_end,
    raw_metric_values: Object.fromEntries(
      Object.entries(VALUES)
        .filter(([, vs]) => vs[i] != null)
        .map(([k, vs]) => [k, vs[i] as number]),
    ),
  }));
}

describe("CoverageHeatmap stat strips", () => {
  const html = renderToStaticMarkup(
    <CoverageHeatmap rawData={mkRaw()} allMetrics={ALL_METRICS} />,
  );

  /* A run of `{expr} literal {expr}` renders as separate text nodes joined by
     `<!-- -->`, so anything pinning a number beside its words reads this. */
  const text = html.replace(/<!-- -->/g, "");

  /** The number a StatCell renders under `label`. */
  function cellValue(label: string): number | null {
    const m = text.match(
      new RegExp(`${label}</span></div><div class="[^"]*">([\\d,]+)</div>`),
    );
    return m ? Number(m[1]!.replace(/,/g, "")) : null;
  }

  /** The number a statement chip renders above `statementLabel`. */
  function chipValue(statementLabel: string): number | null {
    const m = text.match(
      new RegExp(`>(\\d+)</div><div class="[^"]*">${statementLabel}</div>`),
    );
    return m ? Number(m[1]!) : null;
  }

  // React escapes `&`, so "Profit & Loss" reaches the markup as "Profit &amp; Loss".
  const CHIP_LABELS = [
    "Balance Sheet",
    "Profit &amp; Loss",
    "Cash Flow",
    "Ratios / Per-share",
    "Other / Unmapped",
  ] as const;

  it("counts cells, not metrics, in the top strip", () => {
    expect(cellValue("Cells")).toBe(ALL_METRICS.length * PERIODS.length);
    expect(cellValue("Cells")).toBe(27);
  });

  it("splits the cell total across the four sign classes exactly", () => {
    expect(cellValue("Positive")).toBe(14);
    expect(cellValue("Negative")).toBe(5);
    expect(cellValue("Zero / dash")).toBe(6);
    expect(cellValue("Missing")).toBe(2);
    const parts =
      cellValue("Positive")! +
      cellValue("Negative")! +
      cellValue("Zero / dash")! +
      cellValue("Missing")!;
    expect(parts).toBe(cellValue("Cells"));
  });

  it("names the arithmetic behind the cell count", () => {
    // Without this, "Cells: 27" sits above five numbers summing to 9 with
    // nothing on screen relating the two.
    expect(text).toContain("9 metrics × 3 periods");
    // Pins the operands to their own units: the swap still multiplies to 27.
    expect(text).not.toContain("3 metrics × 9 periods");
  });

  it("labels the statement chips as metric counts and states their total", () => {
    expect(text).toContain("Metrics by statement · 9 total");
  });

  it("chips are per-metric, so they sum to the metric count and not the cell count", () => {
    const chips = CHIP_LABELS.map(chipValue);
    expect(chips).toEqual([3, 2, 2, 1, 1]);
    const sum = chips.reduce((a, b) => a! + b!, 0)!;
    expect(sum).toBe(ALL_METRICS.length);
    // `byStmt[…]++` sits outside the period loop. Moved inside it, each chip
    // would multiply by 3 and the strip would sum to the cell count instead.
    expect(sum).not.toBe(cellValue("Cells"));
  });

  it("puts the caption between the two strips, attached to the chips", () => {
    const cells = text.indexOf("Cells");
    const caption = text.indexOf("Metrics by statement");
    const firstChip = text.indexOf("Balance Sheet");
    expect(cells).toBeGreaterThan(-1);
    expect(cells).toBeLessThan(caption);
    expect(caption).toBeLessThan(firstChip);
  });
});
