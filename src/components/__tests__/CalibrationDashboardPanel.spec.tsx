/* ================================================================
   CalibrationDashboardPanel: which states and alerts it shows, and
   whether it admits to the ones it doesn't.

   Two faults, both in `.slice(0, N)` with no total on the surface.
   The state tiles took the head of `stateRankings` — but only one of
   the two producers sorts by count. `CompanyWorkspace` builds the
   field inline from `Object.entries` over a reduce, which yields
   first-seen order, and since `runHistory` is newest-first that is
   "ordered by most recent first appearance". So a state seen once in
   last week's run outranked one seen nine times, under a field named
   `stateRankings`, in tiles showing nothing but a state and a count.
================================================================ */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CalibrationDashboardPanel from "../CalibrationDashboardPanel";
import type { SignalCalibrationSummary } from "../../engine/signalBacktest";

function calibration(
  rankings: Array<{ state: string; count: number }>,
): SignalCalibrationSummary {
  return {
    stateRankings: rankings,
    strongestState: null,
    weakestState: null,
    calibrationBand: "usable",
    alertDiscipline: "Alert history is still sparse.",
    hitRateSummary: "No replay statistics stored.",
    recommendation: "Run more audited cycles.",
  };
}

/** Newest first, the order `api/research` returns each blob listing in. */
function alerts(labels: string[]) {
  return labels.map((label, index) => ({
    id: `alert-${label}`,
    label,
    storedAt: `2026-0${index + 1}-01T00:00:00Z`,
    summary: `Signal fired for ${label}.`,
  }));
}

function render(props: {
  rankings?: Array<{ state: string; count: number }>;
  alerts?: Array<Record<string, unknown>>;
}) {
  return renderToStaticMarkup(
    <CalibrationDashboardPanel
      calibration={calibration(props.rankings ?? [])}
      alerts={props.alerts ?? []}
    />,
  );
}

describe("CalibrationDashboardPanel signal-state tiles", () => {
  it("shows the three most frequent states, not the first three given", () => {
    // The order `CompanyWorkspace` hands over: whichever state its newest run
    // happened to carry comes first, regardless of how rare it is.
    const html = render({
      rankings: [
        { state: "screaming-buy", count: 1 },
        { state: "guarded", count: 9 },
        { state: "watchlist", count: 7 },
        { state: "interesting", count: 4 },
      ],
    });
    expect(html).toContain("guarded");
    expect(html).toContain("watchlist");
    expect(html).toContain("interesting");
    expect(html).not.toContain("screaming-buy");
  });

  it("orders the tiles by descending count", () => {
    const html = render({
      rankings: [
        { state: "interesting", count: 4 },
        { state: "guarded", count: 9 },
        { state: "watchlist", count: 7 },
      ],
    });
    expect(html.indexOf("guarded")).toBeLessThan(html.indexOf("watchlist"));
    expect(html.indexOf("watchlist")).toBeLessThan(html.indexOf("interesting"));
  });

  it("says how many states there are and how many it left out", () => {
    const html = render({
      rankings: [
        { state: "blocked", count: 5 },
        { state: "guarded", count: 4 },
        { state: "watchlist", count: 3 },
        { state: "interesting", count: 2 },
        { state: "high-conviction", count: 1 },
      ],
    });
    expect(html).toContain("Signal states (5)");
    expect(html).toContain("2 less frequent states are not shown");
  });

  it("words a single hidden state in the singular", () => {
    const html = render({
      rankings: [
        { state: "blocked", count: 5 },
        { state: "guarded", count: 4 },
        { state: "watchlist", count: 3 },
        { state: "interesting", count: 2 },
      ],
    });
    expect(html).toContain("1 less frequent state is not shown");
  });

  it("claims nothing hidden when every state fits", () => {
    const html = render({
      rankings: [
        { state: "guarded", count: 4 },
        { state: "watchlist", count: 3 },
      ],
    });
    expect(html).toContain("Signal states (2)");
    expect(html).not.toMatch(/not shown/);
  });

  it("renders no state header at all when there are no runs to rank", () => {
    const html = render({});
    expect(html).not.toMatch(/Signal states \(/);
  });

  it("does not reorder the array it was given", () => {
    // Neither current caller would observe an in-place sort — `CompanyWorkspace`
    // rebuilds the literal each render, and `calibrateSignalBacktest` has already
    // read `weakestState` off the same array before returning it. Pinned anyway
    // because the array belongs to the caller, and this comparator is the one
    // thing standing between a caller's ordering and what renders. Note that an
    // in-place sort is idempotent, so no number of renders would expose it:
    // only the caller's array can.
    const rankings = [
      { state: "interesting", count: 4 },
      { state: "guarded", count: 9 },
    ];
    renderToStaticMarkup(
      <CalibrationDashboardPanel calibration={calibration(rankings)} alerts={[]} />,
    );
    expect(rankings.map((row) => row.state)).toEqual(["interesting", "guarded"]);
  });
});

describe("CalibrationDashboardPanel persisted alerts", () => {
  it("says how many alerts there are and how many it left out", () => {
    const html = render({
      alerts: alerts(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]),
    });
    expect(html).toContain("Persisted alerts (12)");
    expect(html).toContain("2 older alerts are not shown");
  });

  it("keeps the newest alerts, which the API returns first", () => {
    const list = alerts(["newest", "b", "c", "d", "e", "f", "g", "h", "i", "j", "oldest"]);
    const html = render({ alerts: list });
    expect(html).toContain("Signal fired for newest.");
    expect(html).not.toContain("Signal fired for oldest.");
  });

  it("words a single hidden alert in the singular", () => {
    const html = render({
      alerts: alerts(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]),
    });
    expect(html).toContain("1 older alert is not shown");
  });

  it("claims nothing hidden when every alert fits", () => {
    const html = render({ alerts: alerts(["a", "b"]) });
    expect(html).toContain("Persisted alerts (2)");
    expect(html).not.toMatch(/not shown/);
  });

  it("shows a zero total rather than a count over the empty-state copy", () => {
    const html = render({});
    expect(html).toContain("Persisted alerts (0)");
    expect(html).toContain("No persisted alerts yet");
    // The "newest first" claim belongs only to a list that has entries.
    expect(html).not.toMatch(/newest first/);
  });
});
