/* ================================================================
   MetricSearchPanel: values under the right period.

   The header row was built from `debugInfo.detectedPeriods`, which
   `capitalineParser` sorts date-ascending, while each body cell read
   `sample.firstRows[].values[pi]` — an array in source grid-column
   order, and every bundled Capitaline export writes its period
   columns newest-first. So index 0 meant FY2012 in the header and
   FY2026 in the body: the table was reversed against itself.

   Index arithmetic could not be repaired, only abandoned. `values`
   width varies row to row inside one table (measured: 1, 11 and 12
   on Bajaj Finance; 10 and 14 on Avenue Supermarts) because each
   source file contributes its own column count, so no single
   index-to-period mapping is right for every row. Lookups are now
   keyed by (metric key, period_end) off `rawData`.

   That also fixed coverage. `sample.firstRows` is a 40-row
   header-proximity dump, so only 37 of 235 searchable keys (Infosys)
   and 15 of 75 (Bajaj Finance) had a row at all; every other search
   drew a full line of dashes that read as "parsed, empty".
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricSearchPanel, SEARCH_ROWS_SHOWN } from "../debug/MetricSearchPanel";
import type { RawPeriodData } from "../../engine/types";

/** Ascending, as `capitalineParser` emits it. */
function periods(count: number, unit?: RawPeriodData["currency_unit"]): RawPeriodData[] {
  return Array.from({ length: count }, (_, index) => {
    const year = 2012 + index;
    return {
      company_id: "TEST",
      period_end: `${year}-03-31`,
      raw_metric_values: { Sales: (index + 1) * 100 },
      ...(unit ? { currency_unit: unit } : {}),
    };
  });
}

function render(options: {
  rawData?: RawPeriodData[] | null;
  shown?: string[];
  total?: number;
  query?: string;
}) {
  const shown = options.shown ?? ["Sales"];
  return renderToStaticMarkup(
    <MetricSearchPanel
      rawData={options.rawData === undefined ? periods(3) : options.rawData}
      metricSearch={options.query ?? "sales"}
      setMetricSearch={() => {}}
      searchResults={{ shown, total: options.total ?? shown.length }}
    />,
  );
}

/** Cell text in render order, header row excluded. */
function bodyCells(html: string) {
  const body = html.slice(html.indexOf("<tbody"));
  return [...body.matchAll(/<td[^>]*>(?:<span[^>]*>)?([^<]*)/g)].map((m) => m[1]);
}

describe("MetricSearchPanel period alignment", () => {
  it("puts each value under its own period", () => {
    // 2014 is the third ascending period and carries 300. Newest-first, it is
    // the first column — the old code put 100 there.
    const html = render({});
    expect(bodyCells(html)).toEqual(["Sales", "300", "200", "100"]);
  });

  it("orders the header newest first", () => {
    const html = render({});
    const header = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    // `<th\s`, not `<th`: the latter also matches the `<thead>` that opens the
    // slice, and an extra leading "" would shift every index in this assertion.
    expect([...header.matchAll(/<th\s[^>]*>([^<]*)/g)].map((m) => m[1])).toEqual([
      "Metric Key",
      "2014-03",
      "2013-03",
      "2012-03",
    ]);
  });

  it("keeps the newest periods when the column window binds", () => {
    const html = render({ rawData: periods(15) });
    expect(html).toContain("2026-03");
    expect(html).toContain("2017-03");
    // The five oldest are the ones dropped. Ascending order plus a head-slice
    // would have shown 2012-2021 and hidden the years being reconciled.
    expect(html).not.toContain("2016-03");
    expect(html).toContain("10 of 15 periods, newest first");
  });

  it("says so when every period fits", () => {
    const html = render({});
    expect(html).toContain("all 3 periods, newest first");
    expect(html).not.toMatch(/\d+ of \d+ periods/);
  });

  it("does not reorder the array it was given", () => {
    // `rawData` is the pipeline's own array, read by every other surface.
    const data = periods(3);
    render({ rawData: data });
    expect(data.map((p) => p.period_end)).toEqual(["2012-03-31", "2013-03-31", "2014-03-31"]);
  });
});

describe("MetricSearchPanel row totals", () => {
  it("says how many keys matched when the row window binds", () => {
    const shown = Array.from({ length: SEARCH_ROWS_SHOWN }, (_, i) => `Key${i}`);
    const html = render({ shown, total: 489 });
    expect(html).toContain(`Showing ${SEARCH_ROWS_SHOWN} of 489 matching keys`);
  });

  it("reports a plain count when nothing was cut", () => {
    const html = render({ shown: ["Sales", "Other"], total: 2 });
    expect(html).toContain("2 matching keys");
    expect(html).not.toMatch(/Showing \d+ of/);
  });

  it("words a single match in the singular", () => {
    expect(render({})).toContain("1 matching key");
  });
});

describe("MetricSearchPanel missing values", () => {
  it("distinguishes a null value from a key absent that period", () => {
    const data: RawPeriodData[] = [
      { company_id: "T", period_end: "2013-03-31", raw_metric_values: { Sales: null } },
      { company_id: "T", period_end: "2014-03-31", raw_metric_values: {} },
    ];
    const html = render({ rawData: data });
    // A renamed source label and a label that parsed empty are different
    // findings for someone reconciling a line item, so they get different
    // glyphs and different tooltips.
    expect(html).toContain("Parsed as null");
    expect(html).toContain("Key not present in this period");
  });

  it("renders a zero rather than treating it as missing", () => {
    const data: RawPeriodData[] = [
      { company_id: "T", period_end: "2014-03-31", raw_metric_values: { Sales: 0 } },
    ];
    expect(bodyCells(render({ rawData: data }))).toEqual(["Sales", "0"]);
  });
});

describe("MetricSearchPanel value basis", () => {
  // The basis changed with the source. The old cells were raw grid text; these
  // are `raw_metric_values`, already scaled to ₹ Crores. A reviewer holding the
  // .xls next to this panel has to be told when the two differ by a multiplier,
  // so the old "raw parsed values" blurb would now be a false claim.
  it("says the values are in crores", () => {
    expect(render({})).toContain("Values are ₹ Crores.");
  });

  it("does not claim a scaling step when the source was already in crores", () => {
    // Explicit "Crores", not the absent-unit fixture above. Those two take
    // different branches, and only this one catches a predicate that treats any
    // present unit as one the parser had to convert from.
    const html = render({ rawData: periods(3, "Crores") });
    expect(html).toContain("Values are ₹ Crores.");
    expect(html).not.toContain("scaled by the parser");
  });

  it("names the source unit when the parser had to scale", () => {
    const html = render({ rawData: periods(3, "Lakhs") });
    expect(html).toContain("scaled by the parser from Lakhs");
  });

  it("does not claim crores when the source unit was not recognised", () => {
    // `capitalineParser` passes values through unscaled on "Unknown" and raises
    // its own warning. Claiming crores here would be wrong in exactly the case
    // a reviewer most needs to catch.
    const html = render({ rawData: periods(3, "Unknown") });
    expect(html).toContain("unscaled");
    expect(html).not.toContain("Values are ₹ Crores.");
  });

  it("makes no unit claim when there is nothing to show", () => {
    const html = render({ rawData: [], shown: ["Sales"], total: 1 });
    expect(html).not.toMatch(/Crores|unscaled/);
  });
});

describe("MetricSearchPanel empty states", () => {
  it("says the query matched nothing", () => {
    const html = render({ shown: [], total: 0, query: "zzz" });
    expect(html).toContain("No metric keys match");
    expect(html).not.toMatch(/<table/);
  });

  it("does not claim a no-match when there are matches but no periods loaded", () => {
    const html = render({ rawData: [], shown: ["Sales"], total: 1 });
    expect(html).toContain("no parsed");
    expect(html).not.toContain("No metric keys match");
    expect(html).not.toMatch(/<table/);
  });
});
