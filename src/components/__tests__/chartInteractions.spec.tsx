/** @vitest-environment jsdom (mounts DuPontWaterfall through react-dom/client to click a bar) */

/* ================================================================
   Chart interaction contracts.

   Both cases here were found while removing `as any` casts from the
   recharts callbacks: the casts were hiding two live defects, not just
   type noise. Neither chart had a spec, so these are the first.
================================================================ */

import { afterEach, describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import DuPontWaterfall, { resolveDrillDown } from "../charts/DuPontWaterfall";
import { formatRevenueMixTooltip } from "../dashboard/SegmentBreakdown";

describe("SegmentBreakdown revenue-mix tooltip", () => {
  it("scales the segment share to a percentage", () => {
    // The bug: `(point?.pct ?? 0 * 100).toFixed(1)` parses as
    // `pct ?? (0 * 100)`, so the ×100 only ever applied to the fallback
    // and a real 41.7% share rendered as "0.4%".
    expect(formatRevenueMixTooltip(28_411, 0.417, "₹ Cr")).toBe("₹ Cr 28,411 (41.7%)");
  });

  it("renders an absent share as unknown rather than as zero", () => {
    expect(formatRevenueMixTooltip(1_000, null, "₹ Cr")).toBe("₹ Cr 1,000 (—)");
    expect(formatRevenueMixTooltip(1_000, undefined, "₹ Cr")).toBe("₹ Cr 1,000 (—)");
    // A total of 0 revenue yields a NaN share upstream; don't claim 0.0%.
    expect(formatRevenueMixTooltip(0, Number.NaN, "₹ Cr")).toBe("₹ Cr 0 (—)");
  });

  it("keeps a genuine zero share distinct from a missing one", () => {
    expect(formatRevenueMixTooltip(0, 0, "₹ Cr")).toBe("₹ Cr 0 (0.0%)");
  });
});

// ── DuPont drill-down ────────────────────────────────────────────
const HISTORY = [
  { period: "FY22", taxBurden: 0.74, intBurden: 0.96, opm: 0.25, at: 0.9, eqMult: 1.4, roe5: 0.19 },
  { period: "FY23", taxBurden: 0.75, intBurden: 0.97, opm: 0.26, at: 0.92, eqMult: 1.42, roe5: 0.2 },
  { period: "FY24", taxBurden: 0.76, intBurden: 0.98, opm: 0.27, at: 0.94, eqMult: 1.45, roe5: 0.21 },
];

const LATEST = {
  taxBurden: 0.76,
  interestBurden: 0.98,
  operatingMargin: 0.27,
  assetTurnover: 0.94,
  equityMultiplier: 1.45,
  roe: 0.21,
};

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

/** Re-render into the same root, so component state survives — as it does on a
 *  company switch, where RatioReport stays mounted and only its props change. */
function rerender(node: ReactElement): void {
  const currentRoot = root;
  if (!currentRoot) throw new Error("rerender before mount");
  act(() => {
    currentRoot.render(node);
  });
}

afterEach(() => {
  const currentRoot = root;
  if (currentRoot) {
    act(() => {
      currentRoot.unmount();
    });
  }
  root = null;
  container = null;
  document.body.replaceChildren();
});

describe("DuPontWaterfall drill-down", () => {
  it("opens the trend for the clicked factor", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = mount(<DuPontWaterfall {...LATEST} history={HISTORY} />);

    expect(host.textContent).toContain("Click a bar to see its historical trend");
    // Negative control: nothing is selected before the click, so the
    // drill-down must be absent. Without this the assertion below would
    // pass against a chart that renders every trend unconditionally.
    expect(host.textContent).not.toContain("Period Trend");

    const bars = host.querySelectorAll(".recharts-bar-rectangle");
    expect(bars.length).toBe(5);

    act(() => {
      bars[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Tax Burden is chartData[0]; the panel titles itself from the factor
    // name, which is what proves the clicked row reached the handler.
    expect(host.textContent).toContain("Tax Burden — 3-Period Trend");
  });

  it("closes the trend when the same bar is clicked again", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = mount(<DuPontWaterfall {...LATEST} history={HISTORY} />);
    const bars = host.querySelectorAll(".recharts-bar-rectangle");

    act(() => {
      bars[2]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("Operating Margin — 3-Period Trend");

    act(() => {
      host.querySelectorAll(".recharts-bar-rectangle")[2]!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("Period Trend");
  });

  it("ignores clicks when no history was supplied", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = mount(<DuPontWaterfall {...LATEST} />);

    expect(host.textContent).not.toContain("Click a bar");
    act(() => {
      host.querySelectorAll(".recharts-bar-rectangle")[0]!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("Period Trend");
  });

  // `history={[]}` and a single-period history are both truthy, so a guard on
  // `history` alone would advertise a click and then dim the other bars for a
  // panel that can never render (`trendData.length >= 2` gates it).
  const thinHistories: Array<[string, typeof HISTORY]> = [
    ["an empty history", []],
    ["a single-period history", [HISTORY[0]!]],
  ];
  for (const [label, thin] of thinHistories) {
    it(`does not offer the affordance for ${label}`, () => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const host = mount(<DuPontWaterfall {...LATEST} history={thin} />);
      expect(host.textContent).not.toContain("Click a bar");

      act(() => {
        host.querySelectorAll(".recharts-bar-rectangle")[0]!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(host.textContent).not.toContain("Period Trend");
      // Whether the click was absorbed or merely half-applied — dimming the
      // other bars around a panel that never opens — is not visible here:
      // recharts renders no shapes inside `.recharts-bar-rectangle` under
      // jsdom, so the Cell opacity has no DOM to assert against. That half is
      // covered by the resolveDrillDown block below.
    });
  }

  it("ignores a factor whose own series is entirely null", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Tax Burden is present in the latest period (so it still renders a bar)
    // but absent in every history row, so it has no trend to open.
    const noTaxTrend = HISTORY.map(h => ({ ...h, taxBurden: null }));
    const host = mount(<DuPontWaterfall {...LATEST} history={noTaxTrend} />);

    // Other factors are still trendable, so the header does invite a click.
    expect(host.textContent).toContain("Click a bar to see its historical trend");

    const bars = host.querySelectorAll(".recharts-bar-rectangle");
    act(() => {
      bars[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("Period Trend");

    // A neighbouring factor that does have a series still works.
    act(() => {
      host.querySelectorAll(".recharts-bar-rectangle")[2]!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("Operating Margin — 3-Period Trend");
  });

  it("drops a selection the new history can no longer plot", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // The click guard alone does not cover this: `selectedFactor` is state and
    // `history` is a prop, and RatioReport unmounts on tab switch but not on
    // company switch. So a selection outlives the data it was made against.
    const host = mount(<DuPontWaterfall {...LATEST} history={HISTORY} />);
    act(() => {
      host.querySelectorAll(".recharts-bar-rectangle")[0]!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("Tax Burden — 3-Period Trend");

    rerender(<DuPontWaterfall {...LATEST} history={[HISTORY[0]!]} />);

    expect(host.textContent).not.toContain("Period Trend");
    expect(host.textContent).not.toContain("Click a bar");
  });

  it("restores the trend when a plottable history comes back", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // The flip side of deriving rather than resetting: a selection suppressed
    // by thin data is not destroyed by it. This is what a reset effect would
    // have thrown away, and why the fix reads the state instead of clearing it.
    const host = mount(<DuPontWaterfall {...LATEST} history={HISTORY} />);
    act(() => {
      host.querySelectorAll(".recharts-bar-rectangle")[0]!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    rerender(<DuPontWaterfall {...LATEST} history={[HISTORY[0]!]} />);
    expect(host.textContent).not.toContain("Period Trend");

    rerender(<DuPontWaterfall {...LATEST} history={HISTORY} />);
    expect(host.textContent).toContain("Tax Burden — 3-Period Trend");
  });
});

/* ── The dimming half ─────────────────────────────────────────────
   The clicking tests above can see the panel open and close, but not
   whether the other bars were dimmed: recharts renders no shapes
   inside `.recharts-bar-rectangle` under jsdom, so the `Cell`
   fill-opacity has no DOM to assert against at any animation delay.
   A `[fill-opacity="0.4"]` query matches zero elements even with a
   selection active, which makes it vacuous rather than reassuring.

   Both the dimming and the click guard read `active`/`trendable` from
   this one function, so asserting it here covers the half the DOM
   cannot show.
────────────────────────────────────────────────────────────────── */
const KEYS = ["taxBurden", "intBurden", "opm", "at", "eqMult"] as const;

describe("resolveDrillDown", () => {
  it("offers nothing when there is no history at all", () => {
    const { trendable, active } = resolveDrillDown(KEYS, undefined, "taxBurden");
    expect(trendable.size).toBe(0);
    // No trendable factor means no bar is dimmed, however stale the selection.
    expect(active).toBeNull();
  });

  it.each([
    ["an empty history", [] as typeof HISTORY],
    ["a single-period history", [HISTORY[0]!]],
  ])("offers nothing for %s, which is truthy but unplottable", (_label, thin) => {
    const { trendable, active } = resolveDrillDown(KEYS, thin, "opm");
    expect(trendable.size).toBe(0);
    expect(active).toBeNull();
  });

  it("excludes only the factor whose own series is too thin", () => {
    const noTaxTrend = HISTORY.map(h => ({ ...h, taxBurden: null }));
    const { trendable } = resolveDrillDown(KEYS, noTaxTrend, null);
    expect(trendable.has("taxBurden")).toBe(false);
    // The guard must not pass by disabling everything.
    expect(trendable.has("opm")).toBe(true);
    expect(trendable.size).toBe(4);
  });

  it("needs two samples, not one", () => {
    // One non-null period cannot draw a line, and `trendData.length >= 2`
    // gates the panel, so one sample must not count as trendable.
    const oneSample = HISTORY.map((h, i) => ({ ...h, opm: i === 0 ? h.opm : null }));
    expect(resolveDrillDown(KEYS, oneSample, null).trendable.has("opm")).toBe(false);

    const twoSamples = HISTORY.map((h, i) => ({ ...h, opm: i < 2 ? h.opm : null }));
    expect(resolveDrillDown(KEYS, twoSamples, null).trendable.has("opm")).toBe(true);
  });

  it("suppresses a selection the history can no longer plot", () => {
    // The stale-state route: this is the case where the bars would otherwise
    // stay dimmed around a panel that is no longer rendering.
    expect(resolveDrillDown(KEYS, [HISTORY[0]!], "taxBurden").active).toBeNull();
    expect(resolveDrillDown(KEYS, HISTORY, "taxBurden").active).toBe("taxBurden");
  });

  it("suppresses a selection whose own series went null, not the whole chart", () => {
    const noTaxTrend = HISTORY.map(h => ({ ...h, taxBurden: null }));
    expect(resolveDrillDown(KEYS, noTaxTrend, "taxBurden").active).toBeNull();
    expect(resolveDrillDown(KEYS, noTaxTrend, "opm").active).toBe("opm");
  });

  it("ignores a selection for a factor that renders no bar", () => {
    // `validFactors` drops factors null in the latest period, so a selection
    // can name a key that is no longer on the chart. Dimming the remaining
    // bars for an absent one would be the same defect.
    const withoutTax = KEYS.filter(k => k !== "taxBurden");
    expect(resolveDrillDown(withoutTax, HISTORY, "taxBurden").active).toBeNull();
  });
});
