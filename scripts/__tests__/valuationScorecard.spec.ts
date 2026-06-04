import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCORECARD_SCHEMA_VERSION,
  SCORECARD_FAMILIES,
  buildValuationMaturityScorecard,
  renderScorecardMarkdown,
  type ValuationScorecardAuditRow,
} from "../lib/valuationMaturityScorecard";

const projectRoot = process.cwd();
const scorecardScript = resolve(projectRoot, "scripts/valuation-scorecard.ts");

const baseRow = {
  folder: "Example Co",
  ticker: "EXAMPLE",
  companyType: "consumer",
  analysisFamily: "industrial" as const,
  pipelineStrategyId: "industrial-v1",
  periods: 15,
  latestPeriod: "2025-03-31",
  models: ["VCC"],
  outcome: "POLICY_WARNING" as const,
  statusClass: "policy-warning" as const,
  flags: [],
  rigor: {
    currentLevel: "syntactically-valid",
    parserFidelityStatus: "pass",
    parserFidelityScore: 92,
    reconciliationStatus: "partial",
    reconciliationMaxRatio: 0.02,
    confidenceStatus: "guarded",
  },
};

function row(overrides: Partial<ValuationScorecardAuditRow>): ValuationScorecardAuditRow {
  return { ...baseRow, ...overrides };
}

describe("valuation maturity scorecard", () => {
  it("exposes the eight Plan 0 weighted score families with weights summing to 100", () => {
    expect(SCORECARD_SCHEMA_VERSION).toBe("2026-06-valuation-maturity-v1");
    expect(SCORECARD_FAMILIES.map((family) => [family.id, family.weight])).toEqual([
      ["industrial-core", 15],
      ["financial-institution-coverage", 15],
      ["sector-native-coverage", 12],
      ["cross-paradigm-independence", 12],
      ["traceability-reconciliation-fail-closed", 16],
      ["data-freshness-source-tieout", 10],
      ["workbook-reviewer-defensibility", 10],
      ["engineering-release-quality", 10],
    ]);
    expect(SCORECARD_FAMILIES.reduce((sum, family) => sum + family.weight, 0)).toBe(100);
  });

  it("builds an honest weighted scorecard from audited rows without counting expected skips as calc errors", () => {
    const scorecard = buildValuationMaturityScorecard([
      row({
        folder: "Core Industrial",
        ticker: "CORE",
        companyType: "consumer",
        outcome: "PRODUCTION_READY",
        statusClass: "production-ready",
        rigor: { ...baseRow.rigor, currentLevel: "production-ready", reconciliationStatus: "pass" },
      }),
      row({
        folder: "Bank Coverage",
        ticker: "BANK",
        companyType: "bank",
        analysisFamily: "financial-institution",
        pipelineStrategyId: "bank-v1",
        models: ["PB", "ERI", "DDM"],
        outcome: "VALUATION_ELIGIBLE_GUARDED",
        statusClass: "valuation-eligible-guarded",
        rigor: { ...baseRow.rigor, currentLevel: "structurally-reconciled", reconciliationStatus: "pass" },
      }),
      row({
        folder: "Insurance Sidecar Gap",
        ticker: "INS",
        companyType: "insurance",
        analysisFamily: "financial-institution",
        pipelineStrategyId: "insurance-v1",
        models: ["PB", "ERI", "DDM"],
        outcome: "EXPECTED_SKIP_MISSING_SIDECAR",
        statusClass: "expected-skip",
        flags: ["EXPECTED_SKIP_MISSING_SIDECAR:INSURANCE_EV_VNB"],
        rigor: { ...baseRow.rigor, currentLevel: "structurally-reconciled", reconciliationStatus: "pass" },
      }),
      row({
        folder: "Utility Still Industrial",
        ticker: "UTIL",
        companyType: "utility",
        pipelineStrategyId: "industrial-v1",
        outcome: "POLICY_WARNING",
        statusClass: "policy-warning",
      }),
    ], { generatedAt: "2026-06-04T00:00:00.000Z" });

    expect(scorecard.schemaVersion).toBe(SCORECARD_SCHEMA_VERSION);
    expect(scorecard.corpus.companies).toBe(4);
    expect(scorecard.corpus.outcomes.EXPECTED_SKIP_MISSING_SIDECAR).toBe(1);
    expect(scorecard.corpus.expectedSkips).toBe(1);
    expect(scorecard.corpus.calcErrors).toBe(0);

    const industrial = scorecard.families.find((family) => family.id === "industrial-core");
    const financial = scorecard.families.find((family) => family.id === "financial-institution-coverage");
    const sector = scorecard.families.find((family) => family.id === "sector-native-coverage");
    const data = scorecard.families.find((family) => family.id === "data-freshness-source-tieout");

    expect(industrial?.score).toBe(10);
    expect(financial?.sampleSize).toBe(2);
    expect(financial?.blockers).toContain("1 expected financial-institution skip requires source sidecar/freshness follow-up");
    expect(sector?.score).toBeLessThan(5);
    expect(sector?.blockers).toContain("utility remains routed through industrial-v1 instead of a sector-native model");
    expect(data?.blockers).toContain("source hashes, source-cell tieout, and market freshness are not yet first-class scorecard inputs");

    const weighted = scorecard.families.reduce((sum, family) => sum + family.score * family.weight, 0) / 100;
    expect(scorecard.overallScore).toBe(Number(weighted.toFixed(1)));
  });

  it("renders markdown with family scores, blockers, and the audit outcome summary", () => {
    const scorecard = buildValuationMaturityScorecard([
      row({ outcome: "POLICY_WARNING", statusClass: "policy-warning" }),
    ], { generatedAt: "2026-06-04T00:00:00.000Z" });

    const markdown = renderScorecardMarkdown(scorecard);

    expect(markdown).toContain("# Valuation Maturity Scorecard");
    expect(markdown).toContain("Schema: `2026-06-valuation-maturity-v1`");
    expect(markdown).toContain("| Family | Weight | Score | Status | Evidence | Blockers |");
    expect(markdown).toContain("Industrial core valuation");
    expect(markdown).toContain("POLICY_WARNING: 1");
  });
});

describe("valuation-scorecard CLI", () => {
  it("prints parseable JSON for a bounded audit sample", () => {
    const output = execFileSync(process.execPath, ["--import", "tsx/esm", scorecardScript, "--format", "json", "--limit", "1"], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 5,
    });

    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe(SCORECARD_SCHEMA_VERSION);
    expect(parsed.totalWeight).toBe(100);
    expect(parsed.families).toHaveLength(8);
    expect(parsed.corpus.companies).toBe(1);
  }, 120_000);
});
