/* ================================================================
   StatementLineagePanel: which filings it shows, and whether it
   admits to the ones it doesn't.

   The panel rendered `lineage.versions.slice(0, 6)` with no total
   anywhere on the surface. Because `buildStatementLineage` keeps the
   parser's ascending period order, that head-slice was the *oldest*
   six of fifteen — Infosys showed 2012 to 2017 and hid 2018 to 2026,
   on the panel whose job is judging whether recent filings are clean
   or restated. HDFC Bank made it worse: two of its three restatement
   candidates were in the hidden range, so the panel named a filing as
   suspect while rendering no row for it.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StatementLineagePanel from "../StatementLineagePanel";
import { buildStatementLineage } from "../../engine/statementLineage";
import type { StatementLineageSummary } from "../../engine/statementLineage";
import type { RawPeriodData } from "../../engine/types";

/** Ascending annual filings, oldest first — the order the parser produces. */
function annualPeriods(startYear: number, count: number): RawPeriodData[] {
  return Array.from({ length: count }, (_, index) => ({
    company_id: "TESTCO",
    period_end: `${startYear + index}-03-31`,
    raw_metric_values: { "Revenue From Operations__ProfitLoss": 1000 + index },
  }));
}

function summary(overrides: Partial<StatementLineageSummary> = {}): StatementLineageSummary {
  return {
    versions: [],
    restatementCandidates: [],
    segmentHints: [],
    filingMix: { annual: 0, quarterly: 0, ttm: 0, unknown: 0 },
    ...overrides,
  };
}

function render(lineage: StatementLineageSummary) {
  return renderToStaticMarkup(<StatementLineagePanel lineage={lineage} />);
}

describe("StatementLineagePanel filings list", () => {
  it("shows the newest filings, not the oldest", () => {
    // 15 annual filings, 2012 through 2026 — the shape of every bundled company.
    const html = render(buildStatementLineage(annualPeriods(2012, 15)));
    expect(html).toContain("2026-03-31");
    expect(html).toContain("2025-03-31");
    expect(html).toContain("2021-03-31");
    // The six newest are 2021-2026, so the oldest must not be on screen.
    expect(html).not.toContain("2012-03-31");
    expect(html).not.toContain("2017-03-31");
  });

  it("orders the shown filings newest first", () => {
    const html = render(buildStatementLineage(annualPeriods(2012, 15)));
    expect(html.indexOf("2026-03-31")).toBeLessThan(html.indexOf("2025-03-31"));
    expect(html.indexOf("2025-03-31")).toBeLessThan(html.indexOf("2024-03-31"));
  });

  it("says how many filings there are and how many it left out", () => {
    const html = render(buildStatementLineage(annualPeriods(2012, 15)));
    expect(html).toContain("Filings (15)");
    expect(html).toContain("9 earlier filings are not shown");
  });

  it("claims nothing hidden when every filing fits", () => {
    const html = render(buildStatementLineage(annualPeriods(2024, 3)));
    expect(html).toContain("Filings (3)");
    expect(html).not.toContain("not shown");
  });

  it("words a single hidden filing in the singular", () => {
    const html = render(buildStatementLineage(annualPeriods(2020, 7)));
    expect(html).toContain("1 earlier filing is not shown");
  });
});

describe("StatementLineagePanel restatement candidates", () => {
  it("shows the newest candidates and counts the rest", () => {
    // Descending is the display order; the engine hands them over ascending.
    const html = render(
      summary({
        restatementCandidates: [
          "2012-03-31: a",
          "2019-03-31: b",
          "2021-03-31: c",
          "2024-03-31: d",
          "2026-03-31: e",
        ],
      }),
    );
    expect(html).toContain("Restatement candidates (5)");
    expect(html).toContain("2026-03-31: e");
    expect(html).toContain("2019-03-31: b");
    expect(html).not.toContain("2012-03-31: a");
    expect(html).toContain("+1 more not shown");
  });

  it("renders a candidate for a filing whose row is shown", () => {
    // The defect that made this more than a cosmetic truncation: HDFC Bank's
    // candidates included 2020 and 2024, both outside the oldest-six window, so
    // the panel flagged filings it had rendered no row for.
    const lineage = buildStatementLineage([
      ...annualPeriods(2012, 13),
      {
        company_id: "TESTCO",
        period_end: "2025-03-31",
        raw_metric_values: { "Revenue From Operations__ProfitLoss": 5000 },
      },
      {
        company_id: "TESTCO",
        period_end: "2026-03-31",
        raw_metric_values: { "Revenue From Operations__ProfitLoss": 5100 },
      },
    ]);
    const html = render(lineage);
    expect(lineage.restatementCandidates[0]).toContain("2025-03-31");
    expect(html).toContain("Restatement candidates (1)");
    // Both the candidate line and the filing row it refers to.
    expect(html).toContain("2025-03-31");
  });

  it("keeps its empty-state copy when nothing was flagged", () => {
    const html = render(summary());
    expect(html).toContain("No major restatement candidate was flagged");
    expect(html).not.toContain("more not shown");
  });
});

describe("StatementLineagePanel segment hints", () => {
  it("counts every hint and marks how many chips it dropped", () => {
    // 35 is Hindustan Unilever's count. It used to render as 12 chips with no
    // total, because the engine truncated before the panel could see the rest.
    const html = render(
      summary({
        segmentHints: Array.from({ length: 35 }, (_, index) => ({
          label: `segment revenue ${index}`,
          type: "operating-segment" as const,
        })),
      }),
    );
    expect(html).toContain("Segment hints (35)");
    expect(html).toContain("+23 more");
  });

  it("shows no remainder chip when every hint fits", () => {
    const html = render(
      summary({ segmentHints: [{ label: "export sales", type: "geography" }] }),
    );
    expect(html).toContain("Segment hints (1)");
    expect(html).toContain("geography");
    expect(html).not.toContain("more");
  });

  it("keeps its empty-state copy when nothing segment-like was disclosed", () => {
    const html = render(summary());
    expect(html).toContain("No segment-style disclosure labels were detected");
  });
});

describe("StatementLineagePanel filing mix", () => {
  it("shows unclassified filings, so the mix accounts for every filing", () => {
    const html = render(
      buildStatementLineage([
        { company_id: "T", period_end: "2025-03-31", raw_metric_values: {} },
        { company_id: "T", period_end: "2025-11-15", raw_metric_values: {} },
      ]),
    );
    expect(html).toContain("A 1");
    expect(html).toContain("? 1");
  });

  it("omits the unclassified chip when every filing was classified", () => {
    const html = render(buildStatementLineage(annualPeriods(2024, 2)));
    expect(html).toContain("A 2");
    expect(html).not.toContain("?");
  });
});
