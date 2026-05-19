/**
 * Smoke tests for SubsidiaryContributionPanel — Phase B of dual-scope architecture.
 *
 * Verifies:
 *   - Panel renders without crashing for a typical conglomerate gap (ITC-like)
 *   - Red flags fire correctly for the three primary conditions
 *   - Unavailable-analysis branch shows the fallback message
 *
 * Uses renderToStaticMarkup (no DOM) to keep these tests fast and aligned
 * with the existing component-test pattern (QualityReport.spec, etc.).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SubsidiaryContributionPanel from "../dashboard/SubsidiaryContributionPanel";
import type {
  ScopeAwareResult,
  SubsidiaryContribution,
  SubsidiaryContributionSummary,
} from "../../engine/scopeAwareLoader";
import type { PipelineResult } from "../../engine/pipeline";

// Minimal PipelineResult stub — Panel only reads scopeAwareResult.summary
// and scopeAwareResult.subsidiaryContribution, so consolidated/standalone
// fields are never traversed. Cast through unknown to avoid carrying the
// full PipelineResult type surface in fixtures.
const EMPTY_PIPELINE = {} as unknown as PipelineResult;

function mkContribution(overrides: Partial<SubsidiaryContribution>): SubsidiaryContribution {
  return {
    period_end: "2024-03-31",
    salesContribution: 1000,
    patContribution: 200,
    coreOIContribution: 250,
    cseContribution: 500,
    noaContribution: 800,
    cfoContribution: 180,
    salesContributionPct: 0.10,
    patContributionPct: 0.10,
    coreOIContributionPct: 0.12,
    cseContributionPct: 0.20,
    noaContributionPct: 0.25,
    cfoContributionPct: 0.10,
    bothAvailable: true,
    ...overrides,
  };
}

function mkResult(opts: {
  contributions: SubsidiaryContribution[];
  summary: Partial<SubsidiaryContributionSummary>;
  available?: boolean;
  consolidatedOnlyPeriods?: string[];
  standaloneOnlyPeriods?: string[];
}): ScopeAwareResult {
  return {
    consolidated: EMPTY_PIPELINE,
    standalone: EMPTY_PIPELINE,
    subsidiaryContribution: opts.contributions,
    summary: {
      alignedPeriods: opts.contributions.length,
      medianPatContributionPct: 0.10,
      medianSalesContributionPct: 0.10,
      medianCoreOIContributionPct: 0.12,
      medianNOAContributionPct: 0.25,
      latest: opts.contributions[opts.contributions.length - 1] ?? null,
      patContributionTrend: "stable",
      ...opts.summary,
    },
    consolidatedOnlyPeriods: opts.consolidatedOnlyPeriods ?? [],
    standaloneOnlyPeriods: opts.standaloneOnlyPeriods ?? [],
    scopeAwareAnalysisAvailable: opts.available ?? true,
  };
}

describe("SubsidiaryContributionPanel", () => {
  it("renders the standard conglomerate case (ITC-like, ~10% subsidiary PAT)", () => {
    const result = mkResult({
      contributions: [
        mkContribution({ period_end: "2022-03-31" }),
        mkContribution({ period_end: "2023-03-31" }),
        mkContribution({ period_end: "2024-03-31" }),
      ],
      summary: { medianPatContributionPct: 0.10 },
    });
    const html = renderToStaticMarkup(<SubsidiaryContributionPanel result={result} />);
    expect(html).toContain("Subsidiary Contribution Analysis");
    expect(html).toContain("Aligned Periods");
    expect(html).toContain("Period-by-Period Breakdown");
    // Should have neither parent-dominates nor heavy-subsidiary flag at 10%
    expect(html).not.toContain("Parent dominates");
    expect(html).not.toContain("Significant subsidiary footprint");
  });

  it("flags 'Parent dominates' when median PAT contribution < 5%", () => {
    const result = mkResult({
      contributions: [mkContribution({ patContribution: 50, patContributionPct: 0.02 })],
      summary: { medianPatContributionPct: 0.02 },
    });
    const html = renderToStaticMarkup(<SubsidiaryContributionPanel result={result} />);
    expect(html).toContain("Parent dominates");
    expect(html).toContain("SOTP analysis is unlikely to add value");
  });

  it("flags 'Significant subsidiary footprint' when median PAT contribution > 30%", () => {
    const result = mkResult({
      contributions: [mkContribution({ patContribution: 700, patContributionPct: 0.40 })],
      summary: { medianPatContributionPct: 0.40 },
    });
    const html = renderToStaticMarkup(<SubsidiaryContributionPanel result={result} />);
    expect(html).toContain("Significant subsidiary footprint");
    expect(html).toContain("SOTP valuation recommended");
  });

  it("flags 'Standalone PAT exceeds consolidated' on negative subsidiary contribution", () => {
    const result = mkResult({
      contributions: [
        mkContribution({ period_end: "2024-03-31", patContribution: -150, patContributionPct: null }),
      ],
      summary: { medianPatContributionPct: null },
    });
    const html = renderToStaticMarkup(<SubsidiaryContributionPanel result={result} />);
    expect(html).toContain("Standalone PAT exceeds consolidated");
    expect(html).toContain("inter-company dividend");
  });

  it("flags 'Period coverage mismatch' when periods don't align fully", () => {
    const result = mkResult({
      contributions: [mkContribution({})],
      summary: {},
      consolidatedOnlyPeriods: ["2020-03-31", "2021-03-31"],
      standaloneOnlyPeriods: [],
    });
    const html = renderToStaticMarkup(<SubsidiaryContributionPanel result={result} />);
    expect(html).toContain("Period coverage mismatch");
  });

  it("flags 'growing' or 'shrinking' trend correctly", () => {
    const growingResult = mkResult({
      contributions: [mkContribution({})],
      summary: { patContributionTrend: "growing" },
    });
    const growingHtml = renderToStaticMarkup(<SubsidiaryContributionPanel result={growingResult} />);
    expect(growingHtml).toContain("Subsidiaries are growing");

    const shrinkingResult = mkResult({
      contributions: [mkContribution({})],
      summary: { patContributionTrend: "shrinking" },
    });
    const shrinkingHtml = renderToStaticMarkup(<SubsidiaryContributionPanel result={shrinkingResult} />);
    expect(shrinkingHtml).toContain("Subsidiaries shrinking");
  });

  it("shows fallback when scopeAwareAnalysisAvailable is false", () => {
    const result = mkResult({
      contributions: [],
      summary: { alignedPeriods: 0 },
      available: false,
    });
    const html = renderToStaticMarkup(<SubsidiaryContributionPanel result={result} />);
    expect(html).toContain("Scope-aware analysis unavailable");
    expect(html).toContain("Could not align consolidated and standalone periods");
  });
});
