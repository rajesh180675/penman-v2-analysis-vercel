/* ================================================================
   Greenfield chart library — contract spec.
   Locks rendering contracts of the pure-SVG micro charts and the
   Recharts-based full charts introduced in the 2026-08-30 greenfield
   visualization increment. SSR markup only (no DOM environment).
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline, trendTone } from "../charts/Sparkline";
import { SparkBars } from "../charts/SparkBars";
import { RadialProgress, radialToneForScore } from "../charts/RadialProgress";
import { GaugeChart } from "../charts/GaugeChart";
import { BulletChart } from "../charts/BulletChart";
import { ChartCard } from "../charts/ChartCard";
import { StackedAreaChart } from "../charts/StackedAreaChart";
import { MultiLineChart } from "../charts/MultiLineChart";
import { TreemapChart } from "../charts/TreemapChart";
import { DivergingBarChart } from "../charts/DivergingBarChart";

import { QuantileFanChart } from "../charts/QuantileFanChart";
import { CorrelationMatrix } from "../charts/CorrelationMatrix";
import KPITile from "../dashboard/KPITile";

// ── Sparkline ────────────────────────────────────────────────────
describe("Sparkline", () => {
  it("renders an SVG path for >= 2 points", () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 3, 2, 5]} />);
    expect(html).toContain("<svg");
    expect(html).toContain("wb-spark-line");
    expect(html).toContain("wb-spark-area");
  });

  it("renders an empty SVG for insufficient points (no crash)", () => {
    const html = renderToStaticMarkup(<Sparkline values={[1]} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("wb-spark-line");
  });

  it("filters null/undefined/NaN before plotting", () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, null, 3, undefined, NaN, 5]} />);
    expect(html).toContain("wb-spark-line");
  });

  it("applies tone modifier class", () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} tone="positive" />);
    expect(html).toContain("wb-spark-positive");
  });
});

describe("trendTone", () => {
  it("maps sign to tone with higherIsBetter convention", () => {
    expect(trendTone(0.02)).toBe("positive");
    expect(trendTone(-0.02)).toBe("negative");
    expect(trendTone(-0.02, false)).toBe("positive");
    expect(trendTone(0)).toBe("default");
    expect(trendTone(null)).toBe("default");
  });
});

// ── SparkBars ────────────────────────────────────────────────────
describe("SparkBars", () => {
  it("renders one column per value, sign-colored", () => {
    const html = renderToStaticMarkup(<SparkBars values={[1, -2, 3]} />);
    expect(html).toContain("wb-sparkbar-col-positive");
    expect(html).toContain("wb-sparkbar-col-negative");
  });

  it("renders baseline-aligned bars when all positive", () => {
    const html = renderToStaticMarkup(<SparkBars values={[1, 2, 3]} />);
    expect(html).toContain("wb-sparkbar");
  });

  it("handles empty input without crashing", () => {
    const html = renderToStaticMarkup(<SparkBars values={[]} />);
    expect(html).toContain("<div");
  });
});

// ── RadialProgress ───────────────────────────────────────────────
describe("RadialProgress", () => {
  it("renders track + fill circles with clamped value", () => {
    const html = renderToStaticMarkup(<RadialProgress value={1.4} label="100" />);
    expect(html).toContain("wb-radial-track");
    expect(html).toContain("wb-radial-fill");
    expect(html).toContain("100");
  });

  it("renders default percentage label when no label given", () => {
    const html = renderToStaticMarkup(<RadialProgress value={0.84} />);
    expect(html).toContain("84");
  });
});

describe("radialToneForScore", () => {
  it("thresholds: >=0.75 positive, >=0.5 accent, >=0.35 caution, else negative", () => {
    expect(radialToneForScore(0.8)).toBe("positive");
    expect(radialToneForScore(0.5)).toBe("accent");
    expect(radialToneForScore(0.4)).toBe("caution");
    expect(radialToneForScore(0.1)).toBe("negative");
  });
});

// ── GaugeChart ───────────────────────────────────────────────────
describe("GaugeChart", () => {
  it("renders zone arcs and a needle", () => {
    const html = renderToStaticMarkup(<GaugeChart value={0.62} valueText="₹1,240" label="fair" />);
    expect(html).toContain("<svg");
    expect(html).toContain("wb-gauge-needle");
    expect(html).toContain("₹1,240");
    expect(html).toContain("fair");
  });

  it("clamps out-of-range values", () => {
    const html = renderToStaticMarkup(<GaugeChart value={2.5} />);
    expect(html).toContain("<svg");
  });
});

// ── BulletChart ──────────────────────────────────────────────────
describe("BulletChart", () => {
  it("renders bands, measure bar, and target marker", () => {
    const html = renderToStaticMarkup(
      <BulletChart label="ROCE" value={18} target={16} ranges={[12, 16, 22]} />,
    );
    expect(html).toContain("wb-bullet-band");
    expect(html).toContain("wb-bullet-measure");
    expect(html).toContain("wb-bullet-marker");
    expect(html).toContain("ROCE");
  });

  it("omits marker when no target given", () => {
    const html = renderToStaticMarkup(<BulletChart value={5} ranges={[3, 6, 9]} />);
    expect(html).not.toContain("wb-bullet-marker");
  });
});

// ── ChartCard ────────────────────────────────────────────────────
describe("ChartCard", () => {
  it("renders title, status dot, footnote, and children", () => {
    const html = renderToStaticMarkup(
      <ChartCard title="Margin cascade" status="production" footnote="Source: recast engine">
        <div>chart-body</div>
      </ChartCard>,
    );
    expect(html).toContain("Margin cascade");
    expect(html).toContain("wb-status-dot-production");
    expect(html).toContain("chart-body");
    expect(html).toContain("Source: recast engine");
  });
});

// ── Recharts wrappers: empty-state contracts ─────────────────────
// Full Recharts renders need a sized DOM container; under SSR they either
// render the empty placeholder or throw on zero-size — we pin the empty
// placeholder path which is the user-facing contract for missing data.
describe("Recharts wrappers — empty state", () => {
  it("StackedAreaChart shows wb-chart-empty on no data", () => {
    const html = renderToStaticMarkup(<StackedAreaChart data={[]} series={[{ key: "a", label: "A" }]} />);
    expect(html).toContain("wb-chart-empty");
  });

  it("MultiLineChart shows wb-chart-empty on no series", () => {
    const html = renderToStaticMarkup(<MultiLineChart data={[{ period: "FY24" }]} series={[]} />);
    expect(html).toContain("wb-chart-empty");
  });

  it("TreemapChart shows wb-chart-empty when all sizes are zero", () => {
    const html = renderToStaticMarkup(<TreemapChart entries={[{ name: "X", size: 0 }]} />);
    expect(html).toContain("wb-chart-empty");
  });

  it("DivergingBarChart shows wb-chart-empty on no entries", () => {
    const html = renderToStaticMarkup(<DivergingBarChart entries={[]} />);
    expect(html).toContain("wb-chart-empty");
  });
});

// ── QuantileFanChart ─────────────────────────────────────────────
describe("QuantileFanChart", () => {
  const band = { label: "test", q05: 100, q25: 120, q50: 140, q75: 160, q95: 180 };

  it("renders bands, median line, whiskers, and quantile labels", () => {
    const html = renderToStaticMarkup(<QuantileFanChart band={band} />);
    expect(html).toContain("<svg");
    expect(html).toContain("P50");
    expect(html).toContain("P95");
    expect(html).toContain("₹140");
  });

  it("renders market price reference and undervaluation badge", () => {
    const html = renderToStaticMarkup(
      <QuantileFanChart band={band} referencePrice={110} probabilityUndervalued={0.72} />,
    );
    expect(html).toContain("MKT");
    expect(html).toContain("72% undervalued");
    expect(html).toContain("badge-positive");
  });

  it("caution badge tone for mid-range probability", () => {
    const html = renderToStaticMarkup(<QuantileFanChart band={band} probabilityUndervalued={0.5} />);
    expect(html).toContain("badge-caution");
  });

  it("empty state when band has non-finite values", () => {
    const html = renderToStaticMarkup(
      <QuantileFanChart band={{ label: "x", q05: NaN, q25: NaN, q50: NaN, q75: NaN, q95: NaN }} />,
    );
    expect(html).toContain("wb-chart-empty");
  });
});

// ── CorrelationMatrix ────────────────────────────────────────────
describe("CorrelationMatrix", () => {
  it("renders N×N cells with header labels", () => {
    const html = renderToStaticMarkup(
      <CorrelationMatrix labels={["ROCE", "PM"]} values={[[1, 0.6], [0.6, 1]]} />,
    );
    expect(html).toContain("ROCE");
    expect(html).toContain("PM");
    expect(html).toContain("1.00");
    expect(html).toContain("0.60");
  });

  it("renders dash for null cells", () => {
    const html = renderToStaticMarkup(
      <CorrelationMatrix labels={["A", "B"]} values={[[1, null], [null, 1]]} />,
    );
    expect(html).toContain("—");
  });

  it("empty state on no labels", () => {
    const html = renderToStaticMarkup(<CorrelationMatrix labels={[]} values={[]} />);
    expect(html).toContain("wb-chart-empty");
  });
});

// ── KPITile (rewritten on primitives) ────────────────────────────
describe("KPITile", () => {
  const history = [
    { period: "2021", value: 0.14 },
    { period: "2022", value: 0.16 },
    { period: "2023", value: 0.15 },
    { period: "2024", value: 0.18 },
  ];

  it("renders wb-metric surface, label, formatted value", () => {
    const html = renderToStaticMarkup(<KPITile label="ROCE" value={0.184} format="pct" />);
    expect(html).toContain("wb-metric");
    expect(html).toContain("ROCE");
    expect(html).toContain("18.4%");
  });

  it("embeds the pure-SVG sparkline (no recharts) with trend tone", () => {
    const html = renderToStaticMarkup(<KPITile label="ROCE" value={0.184} format="pct" history={history} trend={0.02} />);
    expect(html).toContain("wb-spark-line");
    expect(html).toContain("wb-spark-positive");
    expect(html).not.toContain("recharts");
  });

  it("negative trend flips tone and shows SVG trend icon", () => {
    const html = renderToStaticMarkup(<KPITile label="FLEV" value={1.2} format="mult" history={history} trend={-0.03} />);
    expect(html).toContain("wb-spark-negative");
  });

  it("no sparkline under 3 points", () => {
    const html = renderToStaticMarkup(
      <KPITile label="ROCE" value={0.1} format="pct" history={history.slice(0, 2)} />,
    );
    expect(html).not.toContain("wb-spark-line");
  });
});
