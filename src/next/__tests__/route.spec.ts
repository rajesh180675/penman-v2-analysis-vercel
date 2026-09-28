import { describe, expect, it } from "vitest";
import { caseRoute, formatRoute, parseRoute, type Route } from "../route";

describe("next UI routes", () => {
  it("round-trips every space", () => {
    const routes: Route[] = [
      { space: "library" },
      caseRoute("ITC"),
      { space: "case", company: "M&M", section: "valuation", asOf: "2023-03-31", scenario: "bear" },
      { space: "record", company: "TCS", tool: null },
      { space: "record", company: "M&M", tool: "report" },
      { space: "record", company: null, tool: null },
      { space: "lab", tool: "regression", company: null },
      { space: "lab", tool: "v3analytics", company: "M&M" },
      { space: "lab", tool: null, company: null },
    ];
    for (const route of routes) expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it("links a Record tool under its company and a Lab tool with the company as a parameter", () => {
    expect(formatRoute({ space: "record", company: "TCS", tool: "thesis" })).toBe("#/record/TCS/thesis");
    expect(formatRoute({ space: "lab", tool: "v3analytics", company: "M&M" })).toBe("#/lab/v3analytics?company=M%26M");
    // A tool with no company has no Record URL of its own.
    expect(formatRoute({ space: "record", company: null, tool: "report" })).toBe("#/record");
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
