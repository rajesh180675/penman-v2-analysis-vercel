/* ================================================================
   DiagnosticsSection: which entries it shows, and whether it admits
   to the ones it doesn't.

   Both lists were `.slice(0, N)`d with no total on the surface, and
   both producers walk the ascending period array upward pushing as
   they go (`buildStatementDiagnostics` and `detectCorporateActions`
   each loop from index 1). So the head-slice kept the earliest years:
   a share-count shift in 2013 displaced a capital raise in 2026, on
   the panel a reviewer reads to judge whether recent history is
   trustworthy.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DiagnosticsSection from "../company-workspace/DiagnosticsSection";

const COVERAGE = {
  coveragePct: 0.75,
  coreMatchedCount: 9,
  coreTotalCount: 12,
  unresolvedCore: [],
};

/** Ascending by period, the order both producers emit. */
function diagnostics(years: number[]) {
  return years.map((year) => ({
    label: `Revenue discontinuity ${year}`,
    periodEnd: `${year}-03-31`,
    detail: `Revenue moved sharply in FY${year}.`,
  }));
}

/**
 * Ascending by period. Deliberately uses a year range disjoint from the
 * diagnostics fixtures above, so an assertion about one list cannot be satisfied
 * by a date the other list happens to render.
 */
function actions(years: number[]) {
  return years.map((year) => ({
    kind: `capital-raise-${year}`,
    periodEnd: `${year}-03-31`,
    confidence: "high",
    detail: `Share count rose in FY${year}.`,
  }));
}

function render(props: {
  diagnostics?: ReturnType<typeof diagnostics>;
  actions?: ReturnType<typeof actions>;
}) {
  return renderToStaticMarkup(
    <DiagnosticsSection
      rawData={null}
      conceptCoverage={COVERAGE}
      statementDiagnostics={{ diagnostics: props.diagnostics ?? [] }}
      corporateActions={props.actions ?? []}
    />,
  );
}

describe("DiagnosticsSection statement diagnostics", () => {
  it("shows the newest diagnostics, not the oldest", () => {
    // Eight findings across 2019-2026; six fit.
    const html = render({ diagnostics: diagnostics([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]) });
    expect(html).toContain("Revenue discontinuity 2026");
    expect(html).toContain("Revenue discontinuity 2021");
    expect(html).not.toContain("Revenue discontinuity 2019");
    expect(html).not.toContain("Revenue discontinuity 2020");
  });

  it("orders the shown diagnostics newest first", () => {
    const html = render({ diagnostics: diagnostics([2022, 2023, 2024, 2025, 2026]) });
    expect(html.indexOf("Revenue discontinuity 2026")).toBeLessThan(
      html.indexOf("Revenue discontinuity 2025"),
    );
  });

  it("says how many diagnostics there are and how many it left out", () => {
    const html = render({ diagnostics: diagnostics([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]) });
    expect(html).toContain("Diagnostics (8)");
    expect(html).toContain("2 earlier diagnostics are not shown");
  });

  it("words a single hidden diagnostic in the singular", () => {
    const html = render({ diagnostics: diagnostics([2020, 2021, 2022, 2023, 2024, 2025, 2026]) });
    expect(html).toContain("1 earlier diagnostic is not shown");
  });

  it("claims nothing hidden when every diagnostic fits", () => {
    const html = render({ diagnostics: diagnostics([2025, 2026]) });
    expect(html).toContain("Diagnostics (2)");
    expect(html).not.toMatch(/not shown/);
  });

  it("keeps the clean-history copy when nothing was flagged", () => {
    const html = render({});
    expect(html).toContain("No major presentation or scale discontinuities were detected");
    // No count header over an empty list.
    expect(html).not.toContain("Diagnostics (0)");
  });

  it("does not mutate the array it was given", () => {
    // Both lists arrive from a `useMemo` in `CompanyWorkspace`, so an in-place
    // `reverse()` would render correctly once and flip on the next render of the
    // same array. Asserted after ONE render: two in-place reversals cancel, so an
    // even render count cannot tell the implementations apart.
    const list = diagnostics([2024, 2025, 2026]);
    const before = list.map((item) => item.periodEnd);
    renderToStaticMarkup(
      <DiagnosticsSection
        rawData={null}
        conceptCoverage={COVERAGE}
        statementDiagnostics={{ diagnostics: list }}
        corporateActions={[]}
      />,
    );
    expect(list.map((item) => item.periodEnd)).toEqual(before);
  });
});

describe("DiagnosticsSection corporate actions", () => {
  it("shows the newest actions, not the oldest", () => {
    // Six actions across 2011-2016; four fit.
    const html = render({ actions: actions([2011, 2012, 2013, 2014, 2015, 2016]) });
    expect(html).toContain("capital-raise-2016");
    expect(html).toContain("capital-raise-2013");
    expect(html).not.toContain("capital-raise-2011");
    expect(html).not.toContain("capital-raise-2012");
  });

  it("says how many actions there are and how many it left out", () => {
    const html = render({ actions: actions([2011, 2012, 2013, 2014, 2015, 2016]) });
    expect(html).toContain("Corporate actions (6)");
    expect(html).toContain("2 earlier actions are not shown");
  });

  it("words a single hidden action in the singular", () => {
    const html = render({ actions: actions([2012, 2013, 2014, 2015, 2016]) });
    expect(html).toContain("1 earlier action is not shown");
  });

  it("renders no action header or remainder when there are none", () => {
    const html = render({ diagnostics: diagnostics([2026]) });
    // Matched on the header's count shape, because the section's own h3 reads
    // "Statement Diagnostics And Corporate Actions" and would satisfy a looser
    // substring check.
    expect(html).not.toMatch(/Corporate actions \(/);
    expect(html).not.toMatch(/not shown/);
  });

  it("does not mutate the array it was given", () => {
    const list = actions([2014, 2015, 2016]);
    const before = list.map((item) => item.periodEnd);
    renderToStaticMarkup(
      <DiagnosticsSection
        rawData={null}
        conceptCoverage={COVERAGE}
        statementDiagnostics={{ diagnostics: [] }}
        corporateActions={list}
      />,
    );
    expect(list.map((item) => item.periodEnd)).toEqual(before);
  });
});

describe("DiagnosticsSection counts both lists independently", () => {
  it("reports each list's own total, not a combined one", () => {
    const html = render({
      diagnostics: diagnostics([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]),
      actions: actions([2011, 2012, 2013, 2014, 2015, 2016]),
    });
    expect(html).toContain("Diagnostics (8)");
    expect(html).toContain("Corporate actions (6)");
    expect(html).toContain("2 earlier diagnostics are not shown");
    expect(html).toContain("2 earlier actions are not shown");
  });
});
