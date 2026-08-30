/** @vitest-environment jsdom (mounts new chart components to verify they render the expected SVG/data) */

import { afterEach, describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CagrOverlayChart } from "../charts/CagrOverlayChart";
import { DonutChart } from "../charts/DonutChart";
import { HorizontalBarList } from "../charts/HorizontalBarList";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  const created = createRoot(container);
  root = created;
  act(() => {
    created.render(node);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

describe("CagrOverlayChart", () => {
  it("renders empty state for fewer than 2 points", () => {
    const el = mount(<CagrOverlayChart data={[{ period: "FY25", value: 100 }]} />);
    expect(el.textContent).toContain("No data");
  });

  it("computes and shows the CAGR annotation", () => {
    // 100 → 121 over 2 years = +10% CAGR
    const el = mount(
      <CagrOverlayChart
        data={[
          { period: "FY23", value: 100 },
          { period: "FY24", value: 110 },
          { period: "FY25", value: 121 },
        ]}
      />,
    );
    expect(el.textContent).toContain("+10.0% CAGR");
    expect(el.textContent).toContain("FY23→FY25");
  });

  it("marks negative CAGR with a minus tone", () => {
    const el = mount(
      <CagrOverlayChart
        data={[
          { period: "FY23", value: 121 },
          { period: "FY24", value: 110 },
          { period: "FY25", value: 100 },
        ]}
      />,
    );
    expect(el.textContent).toContain("-9.1% CAGR");
  });

  it("renders empty state when first value is non-positive (log-domain guard)", () => {
    const el = mount(
      <CagrOverlayChart
        data={[
          { period: "FY23", value: 0 },
          { period: "FY24", value: 100 },
        ]}
      />,
    );
    expect(el.textContent).toContain("No data");
  });
});

describe("DonutChart", () => {
  it("renders empty state when no entries or zero total", () => {
    const el = mount(<DonutChart entries={[]} />);
    expect(el.textContent).toContain("No data");

    const el2 = mount(<DonutChart entries={[{ label: "A", value: 0 }]} />);
    expect(el2.textContent).toContain("No data");
  });

  it("renders legend with percentages summing to 100", () => {
    const el = mount(
      <DonutChart
        entries={[
          { label: "A", value: 25 },
          { label: "B", value: 25 },
          { label: "C", value: 50 },
        ]}
      />,
    );
    expect(el.textContent).toContain("A");
    expect(el.textContent).toContain("25%");
    expect(el.textContent).toContain("50%");
  });

  it("renders center label + sub when provided", () => {
    const el = mount(
      <DonutChart
        entries={[{ label: "A", value: 100 }]}
        centerLabel="₹42.1K Cr"
        centerSub="Total capital"
      />,
    );
    expect(el.textContent).toContain("₹42.1K Cr");
    expect(el.textContent).toContain("Total capital");
  });
});

describe("HorizontalBarList", () => {
  it("renders empty state on zero entries", () => {
    const el = mount(<HorizontalBarList entries={[]} />);
    expect(el.textContent).toContain("No data");
  });

  it("renders all labels and formatted values", () => {
    const el = mount(
      <HorizontalBarList
        entries={[
          { label: "Cigarettes", value: 12840, tone: "positive" },
          { label: "Hotels", value: 290, tone: "positive" },
          { label: "Paperboards", value: -610, tone: "negative" },
        ]}
        formatValue={(v) => `₹${v}`}
      />,
    );
    expect(el.textContent).toContain("Cigarettes");
    expect(el.textContent).toContain("Hotels");
    expect(el.textContent).toContain("Paperboards");
    // Note: bar values render via Recharts <LabelList>, which requires a live
    // layout pass — not available in jsdom. Covered by browser-level gallery
    // testing (see penman-ui-improver skill).
  });
});
