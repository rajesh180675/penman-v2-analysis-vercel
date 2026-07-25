/* ================================================================
   Workbench shared primitives — contract spec.
   Locks the rendering contract of the Phase 0/1 components:
   Panel, Metric, RigorStepper, EmptyState, Icon.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Panel, StatusDot } from "../shared/Panel";
import { Metric, formatMetricValue, MetricTrend } from "../shared/Metric";
import { RigorStepper, type RigorCheckpointLike } from "../shared/RigorStepper";
import { EmptyState } from "../shared/EmptyState";
import { Icon } from "../shared/Icon";

// ── Panel ────────────────────────────────────────────────────────
describe("Panel", () => {
  it("renders title, status dot, and children", () => {
    const html = renderToStaticMarkup(
      <Panel title="Moat Analysis" status="production">
        <p>content</p>
      </Panel>,
    );
    expect(html).toContain("Moat Analysis");
    expect(html).toContain("wb-status-dot-production");
    expect(html).toContain("content");
    expect(html).toContain("wb-surface");
  });

  it("advanced variant uses the teal token class", () => {
    const html = renderToStaticMarkup(<Panel variant="advanced">x</Panel>);
    expect(html).toContain("wb-panel-advanced");
    expect(html).not.toContain("wb-surface");
  });

  it("collapsible + defaultCollapsed hides children but shows summary", () => {
    const html = renderToStaticMarkup(
      <Panel title="Moat" collapsible defaultCollapsed summary="72/100 — Wide">
        <p>hidden-body</p>
      </Panel>,
    );
    expect(html).not.toContain("hidden-body");
    expect(html).toContain("72/100 — Wide");
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders without header when no title/actions/collapsible", () => {
    const html = renderToStaticMarkup(<Panel>bare</Panel>);
    expect(html).toContain("bare");
    expect(html).not.toContain("aria-expanded");
  });
});

describe("StatusDot", () => {
  it("maps each status to its dot class", () => {
    for (const s of ["production", "guarded", "blocked", "research", "idle"] as const) {
      expect(renderToStaticMarkup(<StatusDot status={s} />)).toContain(`wb-status-dot-${s}`);
    }
  });
});

// ── Metric ───────────────────────────────────────────────────────
describe("formatMetricValue", () => {
  it("handles null/NaN as em-dash", () => {
    expect(formatMetricValue(null, "pct")).toBe("—");
    expect(formatMetricValue(Number.NaN, "number")).toBe("—");
  });
  it("formats pct, mult, currency, days, ratio", () => {
    expect(formatMetricValue(0.123, "pct")).toBe("12.3%");
    expect(formatMetricValue(2.5, "mult")).toBe("2.50×");
    expect(formatMetricValue(1234, "currency")).toContain("₹");
    expect(formatMetricValue(45.6, "days")).toBe("46d");
    expect(formatMetricValue(1.23456, "ratio")).toBe("1.235");
  });
});

describe("MetricTrend", () => {
  it("renders nothing for null trend", () => {
    expect(renderToStaticMarkup(<MetricTrend value={null} />)).toBe("");
  });
  it("positive trend uses up icon and pp for pct format", () => {
    const html = renderToStaticMarkup(<MetricTrend value={0.021} format="pct" />);
    expect(html).toContain("2.1pp");
    expect(html).toContain("text-emerald-600");
  });
  it("negative trend uses rose", () => {
    const html = renderToStaticMarkup(<MetricTrend value={-0.01} format="pct" />);
    expect(html).toContain("text-rose-600");
  });
});

describe("Metric", () => {
  it("renders label, formatted value, subtitle", () => {
    const html = renderToStaticMarkup(
      <Metric label="ROCE" value={0.185} format="pct" subtitle="5Y avg" />,
    );
    expect(html).toContain("ROCE");
    expect(html).toContain("18.5%");
    expect(html).toContain("5Y avg");
    expect(html).toContain("wb-surface");
  });
  it("renders sparkline only with ≥3 valid points", () => {
    const two = renderToStaticMarkup(
      <Metric label="X" value={1} history={[{ period: "a", value: 1 }, { period: "b", value: 2 }]} />,
    );
    expect(two).not.toContain("recharts");
    const three = renderToStaticMarkup(
      <Metric label="X" value={1} history={[{ period: "a", value: 1 }, { period: "b", value: 2 }, { period: "c", value: 3 }]} />,
    );
    expect(three).toContain("recharts-wrapper");
  });
});

// ── RigorStepper ─────────────────────────────────────────────────
const CP: RigorCheckpointLike[] = [
  { level: "syntactically-valid", label: "Syntactically valid", achieved: true },
  { level: "structurally-reconciled", label: "Structurally reconciled", achieved: true },
  { level: "economically-plausible", label: "Economically plausible", achieved: false, detail: "Anchor missing" },
  { level: "valuation-eligible", label: "Valuation eligible", achieved: false },
  { level: "production-ready", label: "Production-ready", achieved: false },
];

describe("RigorStepper", () => {
  it("renders all 5 nodes with short labels", () => {
    const html = renderToStaticMarkup(<RigorStepper checkpoints={CP} />);
    for (const label of ["Valid", "Reconciled", "Plausible", "Eligible", "Production"]) {
      expect(html).toContain(label);
    }
  });
  it("first unachieved node gets the pulse class", () => {
    const html = renderToStaticMarkup(<RigorStepper checkpoints={CP} />);
    expect(html).toContain("wb-node-pulse");
    // Exactly one pulsing node
    expect(html.match(/wb-node-pulse/g)).toHaveLength(1);
  });
  it("all-achieved renders no pulse", () => {
    const all = CP.map((c) => ({ ...c, achieved: true }));
    const html = renderToStaticMarkup(<RigorStepper checkpoints={all} />);
    expect(html).not.toContain("wb-node-pulse");
  });
  it("compact mode hides labels", () => {
    const html = renderToStaticMarkup(<RigorStepper checkpoints={CP} compact />);
    expect(html).not.toContain(">Valid<");
  });
});

// ── EmptyState ───────────────────────────────────────────────────
describe("EmptyState", () => {
  it("renders icon, title, body", () => {
    const html = renderToStaticMarkup(
      <EmptyState icon="chart" title="No data" body="Upload a Capitaline ZIP" />,
    );
    expect(html).toContain("No data");
    expect(html).toContain("Upload a Capitaline ZIP");
    expect(html).toContain("wb-surface");
  });
  it("renders action button when provided", () => {
    const html = renderToStaticMarkup(
      <EmptyState icon="folder" title="Empty" action={{ label: "Load", onClick: () => {} }} />,
    );
    expect(html).toContain("Load");
  });
});

// ── Icon ─────────────────────────────────────────────────────────
describe("Icon", () => {
  it("renders an svg path for a known name", () => {
    const html = renderToStaticMarkup(<Icon name="shield-check" size={16} />);
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
  });
  it("decorative icons are aria-hidden; titled icons get role=img", () => {
    expect(renderToStaticMarkup(<Icon name="chart" />)).toContain('aria-hidden="true"');
    const titled = renderToStaticMarkup(<Icon name="chart" title="Chart" />);
    expect(titled).toContain('role="img"');
    expect(titled).toContain("<title>Chart</title>");
  });
});
