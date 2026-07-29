/* ================================================================
   NbfcRegulatoryPanel: the RBI/NHB period table.

   Twelve rows were rendered from a list whose length appeared only
   in the heading as "(N periods)" — a count of what exists, with
   nothing saying the table showed fewer. All four bundled NBFC
   sidecars carry fifteen periods with data, and all eight RBI/NHB
   exports expose fifteen `<th>` period codes, so the cap bound on
   every company that has this panel at all.

   The head is the right end to keep. `parseRbiNhbFile` walks the
   export's period codes in source order, and every bundled export
   runs 202503 down to 201103 — newest first. So the three dropped
   rows were FY2013, FY2012 and FY2011.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NbfcRegulatoryPanel } from "../financial-institution/NbfcRegulatoryPanel";
import type { NbfcSidecarData } from "../../engine/nbfcSidecarLoader";
import type { RbiNhbPeriod } from "../../engine/nbfcSidecarParser";

/** One period with enough signal to pass the panel's has-data filter. */
function period(fy: number): RbiNhbPeriod {
  return {
    fiscal_label: `FY${fy}`,
    period_code: `${fy}03`,
    gnpa_cr: 100 + fy,
    nnpa_cr: 50,
    nnpa_pct: 1.25,
    crar_pct: 22.5,
    tier1_pct: 20,
    tier2_pct: 2.5,
    advance_capital_market_cr: null,
    advance_real_estate_cr: null,
    gnpa_opening_cr: null,
    gnpa_additions_cr: 10,
    gnpa_closing_cr: null,
    nnpa_opening_cr: null,
    nnpa_additions_cr: null,
    nnpa_closing_cr: null,
    provisions_opening_cr: null,
    provisions_made_cr: null,
    provisions_closing_cr: 40,
  };
}

/** A period the filter drops: no GNPA and no CRAR. */
function emptyPeriod(fy: number): RbiNhbPeriod {
  return { ...period(fy), gnpa_cr: null, crar_pct: null };
}

/** Newest-first, as the parser emits it. */
function fifteenPeriods(): RbiNhbPeriod[] {
  return Array.from({ length: 15 }, (_, index) => period(2025 - index));
}

function render(rbiNhb: RbiNhbPeriod[]) {
  const sidecar: NbfcSidecarData = { lgd: [], rbiNhb };
  return renderToStaticMarkup(<NbfcRegulatoryPanel sidecar={sidecar} />);
}

describe("NbfcRegulatoryPanel RBI/NHB table", () => {
  it("says how many periods it left out", () => {
    const html = render(fifteenPeriods());
    expect(html).toContain("RBI/NHB Regulatory Metrics (15 periods · newest first)");
    expect(html).toContain("3 older periods are not shown");
  });

  it("reports the same post-filter count in the section blurb as in the heading", () => {
    // Two counts on one panel, and both must be measured after the has-data
    // filter. The fixture has to carry periods the filter drops, or the two
    // numbers coincide and the assertion pins nothing.
    const html = render([...fifteenPeriods().slice(0, 13), emptyPeriod(2011), emptyPeriod(2010)]);
    expect(html).toContain("(13 periods with data)");
    expect(html).toContain("(13 periods · newest first)");
  });

  it("keeps the newest twelve, not the oldest", () => {
    const html = render(fifteenPeriods());
    expect(html).toContain("FY2025");
    expect(html).toContain("FY2014");
    expect(html).not.toContain("FY2013");
  });

  it("words a single hidden period in the singular", () => {
    const html = render(fifteenPeriods().slice(0, 13));
    expect(html).toContain("1 older period is not shown");
  });

  it("claims nothing hidden when every period fits", () => {
    const html = render(fifteenPeriods().slice(0, 12));
    expect(html).toContain("(12 periods");
    expect(html).not.toMatch(/not shown/);
  });

  it("counts only the periods that survived the has-data filter", () => {
    // Four blank periods sit between the real ones. The heading total and the
    // remainder line both have to be measured after filtering, or the panel
    // would claim a period it never had a row for.
    const html = render([
      ...fifteenPeriods().slice(0, 13),
      emptyPeriod(2011),
      emptyPeriod(2010),
    ]);
    expect(html).toContain("(13 periods");
    expect(html).toContain("1 older period is not shown");
  });

  it("renders nothing when neither sidecar has any data", () => {
    expect(render([])).toBe("");
  });

  it("renders no table when every period was filtered out", () => {
    const html = render([emptyPeriod(2025), emptyPeriod(2024)]);
    expect(html).not.toMatch(/RBI\/NHB Regulatory Metrics/);
  });
});
