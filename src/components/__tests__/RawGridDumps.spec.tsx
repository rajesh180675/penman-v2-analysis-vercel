/* ================================================================
   RawGridDumps: the column window, and the header row that was
   built from the wrong row.

   The `<th>`s came from `(gd.firstRows[0] ?? []).slice(0, 12)` while
   every `<td>` row sliced its own length. Row 0 of a Capitaline
   export is a one-cell title — measured across seven grids from two
   companies, `firstRows[0].length` was 1 every single time while the
   rows beneath ran 10 to 15 wide. So the table drew a single `C0`
   header over twelve columns of numbers, on the panel whose whole
   job is showing which column a value came from.

   The 12-column cap does bind: CashFlow_.xls was 13 wide for Bajaj
   Finance and 15 for Avenue Supermarts, with nothing on screen
   saying so. Neither the row window (30) nor the column window had
   a total next to it.

   The width is taken over the rendered rows, not from `gd.colCount`
   — that is a max over all `rowCount` rows, so it can name columns
   this 30-row window never shows.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RawGridDumps } from "../debug/RawGridDumps";
import type { CapitalineParseDebug } from "../../engine/capitalineParser";

type RawGrid = CapitalineParseDebug["rawGrids"][number];

const FILE = "CashFlow_.xls";

function row(width: number, tag: string): string[] {
  return Array.from({ length: width }, (_, index) => `${tag}c${index}`);
}

function grid(overrides: Partial<RawGrid> = {}): RawGrid {
  return {
    file: FILE,
    methods: ["xlsx"],
    bestMethod: "xlsx",
    rowCount: 84,
    colCount: 13,
    firstRows: [],
    headerDetected: true,
    headerRowIndex: 1,
    periodLabels: undefined,
    errors: [],
    ...overrides,
  };
}

function debug(grids: RawGrid[]): CapitalineParseDebug {
  return {
    companyId: "TEST",
    files: [{ name: FILE, statementGuess: "CashFlow" }],
    detectedPeriods: [],
    sourceArtifactHashes: [],
    rawGrids: grids,
    metrics: {
      totalCompositeKeys: 0,
      totalBaseKeys: 0,
      baseKeyCollisions: [],
      byStatement: { BalanceSheet: 0, ProfitLoss: 0, CashFlow: 0, Segment: 0, Unknown: 0 },
    },
    warnings: [],
    sample: { headerRow: undefined, firstRows: [] },
    rawMetricKeys: [],
  };
}

/** Expanded, since the preview only renders for the open grid. */
function render(grids: RawGrid[], expanded: string | null = FILE) {
  return renderToStaticMarkup(
    <RawGridDumps debugInfo={debug(grids)} expandedGrid={expanded} setExpandedGrid={() => {}} />,
  );
}

/** The real shape: a one-cell title row above wide data rows. */
function titleRowGrid(dataWidth: number) {
  return grid({
    firstRows: [["Cash Flow Statement"], row(dataWidth, "a"), row(dataWidth, "b")],
  });
}

function headerCells(html: string) {
  return html.match(/>C\d+<\/th>/g) ?? [];
}

describe("RawGridDumps column headers", () => {
  it("labels a column for every column the rows beneath actually have", () => {
    const html = render([titleRowGrid(5)]);
    // Row 0 is one cell wide. Sizing the header off it left C1..C4 unlabelled —
    // four columns of numbers under no heading at all.
    expect(headerCells(html)).toEqual([">C0</th>", ">C1</th>", ">C2</th>", ">C3</th>", ">C4</th>"]);
  });

  it("stops at the column window when the rows are wider than it", () => {
    const html = render([titleRowGrid(15)]);
    expect(headerCells(html)).toHaveLength(12);
    expect(html).toContain(">C11</th>");
    expect(html).not.toContain(">C12</th>");
  });

  it("does not label columns that only exist outside the row window", () => {
    // `colCount` is the max over all 84 rows; these 3 are 5 wide. Naming C0..C12
    // here would promise columns this preview cannot show.
    const html = render([grid({ colCount: 13, firstRows: [["Title"], row(5, "a"), row(5, "b")] })]);
    expect(headerCells(html)).toHaveLength(5);
  });
});

describe("RawGridDumps totals", () => {
  it("says how many columns it is showing out of how many there are", () => {
    expect(render([titleRowGrid(15)])).toContain("showing 12 of 15 columns");
  });

  it("says so plainly when no column was dropped", () => {
    const html = render([titleRowGrid(5)]);
    expect(html).toContain("all 5 columns");
    expect(html).not.toMatch(/showing \d+ of/);
  });

  it("counts the rendered rows against the grid's true row count", () => {
    // `First 3 rows:` was the old copy — a 30-row window over 84 rows, with 84
    // sitting in the collapsed header only.
    expect(render([titleRowGrid(5)])).toContain("First 3 of 84 rows");
  });
});

describe("RawGridDumps body cells", () => {
  it("renders every cell of a narrow row", () => {
    const html = render([titleRowGrid(5)]);
    expect(html).toContain("ac4");
    expect(html).toContain("bc4");
  });

  it("truncates wide rows at the same window as the headers", () => {
    const html = render([titleRowGrid(15)]);
    expect(html).toContain("ac11");
    expect(html).not.toContain("ac12");
  });
});

describe("RawGridDumps grid states", () => {
  it("keeps the empty-grid warning instead of drawing a headerless table", () => {
    const html = render([grid({ firstRows: [], rowCount: 0, colCount: 0 })]);
    expect(html).toContain("Grid is EMPTY");
    expect(html).not.toMatch(/<table/);
  });

  it("renders no preview for a collapsed grid", () => {
    const html = render([titleRowGrid(5)], null);
    expect(html).toContain(FILE);
    expect(html).not.toMatch(/First \d+ of/);
  });
});
