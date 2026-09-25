import { describe, expect, it } from "vitest";
import { caseRoute, formatRoute, parseRoute, type Route } from "../route";

describe("next UI routes", () => {
  it("round-trips every space", () => {
    const routes: Route[] = [
      { space: "library" },
      caseRoute("ITC"),
      { space: "case", company: "M&M", section: "valuation", asOf: "2023-03-31", scenario: "bear" },
      { space: "record", company: "TCS" },
      { space: "record", company: null },
      { space: "lab", tool: "regression" },
      { space: "lab", tool: null },
    ];
    for (const route of routes) expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it("encodes a ticker with reserved characters", () => {
    expect(formatRoute(caseRoute("M&M"))).toBe("#/case/M%26M/verdict");
  });

  it("puts only non-default case state in the URL", () => {
    expect(formatRoute(caseRoute("ITC", "forecast"))).toBe("#/case/ITC/forecast");
    expect(formatRoute({ space: "case", company: "ITC", section: "verdict", asOf: "2023-03-31", scenario: "bull" }))
      .toBe("#/case/ITC/verdict?asOf=2023-03-31&scenario=bull");
  });

  it("falls back instead of throwing on unknown or malformed input", () => {
    expect(parseRoute("")).toEqual({ space: "library" });
    expect(parseRoute("#/nowhere")).toEqual({ space: "library" });
    expect(parseRoute("#/case")).toEqual({ space: "library" });
    expect(parseRoute("#/case/ITC/not-a-section?asOf=last-year&scenario=wild")).toEqual(caseRoute("ITC"));
  });
});
