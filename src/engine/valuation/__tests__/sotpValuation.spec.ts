/* ================================================================
   Plan 5 PR-5.4 — SOTP valuation contract tests.
================================================================ */

import { describe, it, expect } from "vitest";
import { sotpValuation, selectPeerMultiple, getPeerMultiples } from "../sotpValuation";

describe("sotpValuation (Plan 5 PR-5.4)", () => {
  it("peer-multiples snapshot ships with retrievalDate, source, >=15 segments, Diversified fallback", () => {
    const data = getPeerMultiples();
    expect(data.retrievalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.source).toContain("Capitaline");
    expect(data.segments.length).toBeGreaterThanOrEqual(15);
    expect(data.segments.find((s) => s.segment === "Diversified")).toBeDefined();
  });

  it("selectPeerMultiple finds exact match", () => {
    expect(selectPeerMultiple("Cement").segment).toBe("Cement");
  });

  it("selectPeerMultiple does substring lookup ('Auto' -> first Auto-* row)", () => {
    const auto = selectPeerMultiple("Auto");
    expect(auto.segment.startsWith("Auto")).toBe(true);
  });

  it("selectPeerMultiple unknown segment falls back to Diversified", () => {
    expect(selectPeerMultiple("totally-unknown-thingamajig").segment).toBe("Diversified");
  });

  it("single-segment SOTP equals revenue * EV/Revenue average with EBITDA when both supplied", () => {
    const r = sotpValuation({
      segments: [{ segment: "FMCG-Foods", revenue: 100_00_00_00_000, ebitda: 18_00_00_00_000 }],
      netDebt: 0,
      sharesOutstanding: 1_00_00_00_000,
    });
    const peer = selectPeerMultiple("FMCG-Foods");
    const expectedEv = 0.5 * (100_00_00_00_000 * peer.evRevenue + 18_00_00_00_000 * peer.evEbitda);
    expect(r.totalEnterpriseValue).toBeCloseTo(expectedEv, -2);
    expect(r.equityValue).toBeCloseTo(expectedEv, -2);
  });

  it("SOTP without EBITDA falls back to EV/Revenue alone", () => {
    const r = sotpValuation({
      segments: [{ segment: "Cement", revenue: 50_00_00_00_000 }],
      netDebt: 0,
      sharesOutstanding: 1_00_00_00_000,
    });
    const peer = selectPeerMultiple("Cement");
    expect(r.perSegment[0]?.evFromEbitda).toBeNull();
    expect(r.totalEnterpriseValue).toBeCloseTo(50_00_00_00_000 * peer.evRevenue, -2);
  });

  it("multi-segment EV is the sum of per-segment EVs", () => {
    const r = sotpValuation({
      segments: [
        { segment: "FMCG-Foods", revenue: 100, ebitda: 18 },
        { segment: "Cement", revenue: 50, ebitda: 8 },
      ],
      netDebt: 0,
      sharesOutstanding: 1,
    });
    const sum = r.perSegment.reduce((s, p) => s + p.segmentEv, 0);
    expect(r.totalEnterpriseValue).toBeCloseTo(sum, 6);
    expect(r.perSegment).toHaveLength(2);
  });

  it("equity = EV - netDebt + surplusAssets", () => {
    const r = sotpValuation({
      segments: [{ segment: "Cement", revenue: 100 }],
      netDebt: 30,
      surplusAssets: 10,
      sharesOutstanding: 1,
    });
    const peer = selectPeerMultiple("Cement");
    const ev = 100 * peer.evRevenue;
    expect(r.equityValue).toBeCloseTo(ev - 30 + 10, 6);
  });

  it("perShareValue = equity / sharesOutstanding", () => {
    const r = sotpValuation({
      segments: [{ segment: "Cement", revenue: 100 }],
      netDebt: 0,
      sharesOutstanding: 4,
    });
    expect(r.perShareValue).toBeCloseTo(r.equityValue / 4, 6);
  });

  it("zero shares outstanding -> perShareValue = 0 (no NaN/Infinity leak)", () => {
    const r = sotpValuation({
      segments: [{ segment: "Cement", revenue: 100 }],
      netDebt: 0,
      sharesOutstanding: 0,
    });
    expect(r.perShareValue).toBe(0);
  });

  it("citation echoes retrievalDate + source + version", () => {
    const data = getPeerMultiples();
    const r = sotpValuation({
      segments: [{ segment: "Cement", revenue: 100 }],
      netDebt: 0,
      sharesOutstanding: 1,
    });
    expect(r.citation.retrievalDate).toBe(data.retrievalDate);
    expect(r.citation.source).toBe(data.source);
    expect(r.citation.version).toBe(data.version);
  });
});
