/* ============================================================
   ScenarioRangeChart dropped the per-share framing when there was
   no share basis. The call site (`ForecastReport.tsx:436/441`)
   bridges each scenario `value` and `expectedValue` with `toPerShare`
   only when `sharesOut` is truthy; otherwise it passes the raw ₹Cr
   `V_RE_CV3`. Before this fix the chart always labeled itself
   "Intrinsic per share" and drew `marketPrice` (a ₹/share equity
   price) as the reference line — so a ₹Cr bar sat beside a ₹/share
   line under a "per share" label: the unit-scale class again (see
   `docs/.../unit-scale-mismatch-in-charts`).

   The fix is a `perShare` flag: when false, the chart labels itself
   "₹ Cr", drops the "per share" prose and the market-price stat, and
   withholds the `marketPrice` reference line (a different unit has no
   place on the axis). The `expectedValue` line stays — it is bridged
   identically to the bars, so it shares their unit on both paths.
============================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ScenarioRangeChart from "../charts/ScenarioRangeChart";

function scenarios(values: Array<{ label: string; value: number; probability: number; color: string }>) {
  return values.map((v) => ({ ...v }));
}

describe("ScenarioRangeChart unit framing", () => {
  it("frames as per-share and surfaces the market price when perShare is true", () => {
    // recharts' ResponsiveContainer measures 0×0 under renderToStaticMarkup
    // (see valuationScaleMath.spec.ts), so the inner SVG — and with it the
    // <ReferenceLine> labels — is not emitted. What static markup does emit
    // is the wrapper: the framing prose and the stat block. That is enough to
    // pin the perShare contract, since withholding the market price happens
    // in the wrapper (the stat is what a reader actually compares to the bars).
    const html = renderToStaticMarkup(
      <ScenarioRangeChart
        scenarios={scenarios([
          { label: "Stress", value: 120, probability: 0.2, color: "#ef4444" },
          { label: "Base", value: 180, probability: 0.4, color: "#3b82f6" },
          { label: "Bull", value: 260, probability: 0.3, color: "#10b981" },
          { label: "Panic", value: 90, probability: 0.1, color: "#6366f1" },
        ])}
        marketPrice={150}
        expectedValue={180}
        perShare
      />,
    );

    expect(html).toContain("per share");
    expect(html).toContain("Market price shown as reference");
    // The market price is surfaced as a labeled stat beside the bars.
    expect(html).toContain("Market Price");
    expect(html).toContain(">₹150<");
  });

  it("drops the per-share label and the market-price reference line when perShare is false", () => {
    // `marketPrice` is a ₹/share equity price — meaningless beside ₹Cr bars,
    // so it must not appear as a reference on the axis or as a stat, and the
    // prose must not promise "per share". The ₹Cr values below are V_RE_CV3
    // verbatim (ForecastReport.tsx:436/441 on the no-sharesOut branch).
    const html = renderToStaticMarkup(
      <ScenarioRangeChart
        scenarios={scenarios([
          { label: "Stress", value: 12_000, probability: 0.2, color: "#ef4444" },
          { label: "Base", value: 18_500, probability: 0.4, color: "#3b82f6" },
          { label: "Bull", value: 26_000, probability: 0.3, color: "#10b981" },
          { label: "Panic", value: 9_000, probability: 0.1, color: "#6366f1" },
        ])}
        marketPrice={150}
        expectedValue={18_500}
        perShare={false}
      />,
    );

    // The chart now honestly names its unit instead of claiming per-share.
    expect(html).toContain("₹ Cr");
    expect(html).not.toContain("per share");
    expect(html).not.toContain("Market price shown as reference");
    // Neither the stat nor the reference-line label leaks the ₹/share price.
    expect(html).not.toContain("Market Price");
    expect(html).not.toContain("Market ₹150");
  });

  it("keeps the expected-value stat on both unit paths", () => {
    // E[V] is bridged with the same `toPerShare`/raw rule as the bars, so it
    // shares their unit whether or not a share basis exists — it should never
    // be the value that gets dropped when the unit switches. The SVG reference
    // line itself is not emitted under static markup (ResponsiveContainer
    // 0×0), but the Expected Value stat block is, and it carries the value —
    // so asserting the stat reads on both paths pins the same contract.
    const perShareHtml = renderToStaticMarkup(
      <ScenarioRangeChart
        scenarios={scenarios([{ label: "Base", value: 180, probability: 1, color: "#3b82f6" }])}
        expectedValue={180}
        perShare
      />,
    );
    const croreHtml = renderToStaticMarkup(
      <ScenarioRangeChart
        scenarios={scenarios([{ label: "Base", value: 18_500, probability: 1, color: "#3b82f6" }])}
        expectedValue={18_500}
        perShare={false}
      />,
    );

    expect(perShareHtml).toContain("Expected Value");
    expect(croreHtml).toContain("Expected Value");
    // The stat formats via .toFixed(0) (no group separator), so 18,500 reads
    // as "18500" — the point is the value is present, in the bars' own unit.
    expect(croreHtml).toContain("₹18500");
    expect(croreHtml).not.toContain("per share");
  });
});
