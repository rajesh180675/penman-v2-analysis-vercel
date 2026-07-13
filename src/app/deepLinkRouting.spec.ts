import { describe, expect, it } from "vitest";
import type { ScopeAssessment } from "../engine/scopePolicy";
import { resolvePostIngestionDeepLinkTab } from "./deepLinkRouting";

function scope(blocked: boolean): ScopeAssessment {
  return {
    policyVersion: "test",
    classification: blocked ? "unsupported-financial-company" : "supported-industrial",
    analysisFamily: blocked ? "financial-institution" : "industrial",
    blocked,
    label: "test",
    reasons: [],
    recommendedAction: "test",
    signals: [],
  };
}

describe("post-ingestion deep-link routing", () => {
  it("preserves supported industrial destinations", () => {
    expect(resolvePostIngestionDeepLinkTab({ requestedTab: "valuation", family: "industrial", scope: scope(false), hasStandaloneData: true })).toBe("valuation");
  });

  it("requires standalone data before opening scope", () => {
    expect(resolvePostIngestionDeepLinkTab({ requestedTab: "scope", family: "industrial", scope: scope(false), hasStandaloneData: false })).toBe("statements");
  });

  it("routes unsupported financial surfaces to the bank framework", () => {
    const financialScope = { ...scope(false), classification: "supported-financial", analysisFamily: "financial-institution" } as ScopeAssessment;
    expect(resolvePostIngestionDeepLinkTab({ requestedTab: "forecast", family: "financial-institution", scope: financialScope, hasStandaloneData: false })).toBe("bank");
    expect(resolvePostIngestionDeepLinkTab({ requestedTab: "valuation", family: "financial-institution", scope: financialScope, hasStandaloneData: false })).toBe("valuation");
  });

  it("routes blocked financial surfaces to diagnostics", () => {
    expect(resolvePostIngestionDeepLinkTab({ requestedTab: "dashboard", family: "financial-institution", scope: scope(true), hasStandaloneData: false })).toBe("debug");
  });
});
