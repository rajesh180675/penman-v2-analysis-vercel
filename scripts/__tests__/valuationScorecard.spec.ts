import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCORECARD_SCHEMA_VERSION,
  SCORECARD_FAMILIES,
  buildValuationMaturityScorecard,
  renderScorecardMarkdown,
  type ValuationScorecardAuditRow,
} from "../lib/valuationMaturityScorecard";
import { diffValuationMaturityScorecards } from "../lib/valuationScorecardDiff";

const projectRoot = process.cwd();
const scorecardScript = resolve(projectRoot, "scripts/valuation-scorecard.ts");
const scorecardDiffScript = resolve(projectRoot, "scripts/valuation-scorecard-diff.ts");

const baseRow = {
  folder: "Example Co",
  ticker: "EXAMPLE",
  companyType: "consumer",
  analysisFamily: "industrial" as const,
  pipelineStrategyId: "industrial-v1",
  periods: 15,
  latestPeriod: "2025-03-31",
  models: ["VCC"],
  valuationEvidence: {
    readinessStatus: "guarded",
    readinessAnchorPeriod: "2025-03-31",
    defensibilityStatus: "guarded",
    triangulationMethods: [],
    independentLensGroups: [],
  },
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
    expect(SCORECARD_SCHEMA_VERSION).toBe("2026-06-valuation-maturity-v2");
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
    expect(data?.blockers).toContain("source hashes/source-cell lineage remain incomplete for the rows above");
    expect(data?.blockers).toContain("market freshness remains blocked where source_unavailable/stale evidence is emitted");

    const weighted = scorecard.families.reduce((sum, family) => sum + family.score * family.weight, 0) / 100;
    expect(scorecard.overallScore).toBe(Number(weighted.toFixed(1)));
  });

  it("emits row-level blocker reasons so policy warnings are actionable instead of circular", () => {
    const scorecard = buildValuationMaturityScorecard([
      row({
        ticker: "SYNTACTIC",
        outcome: "POLICY_WARNING",
        statusClass: "policy-warning",
        flags: [],
        rigor: {
          ...baseRow.rigor,
          currentLevel: "syntactically-valid",
          parserFidelityStatus: "pass",
          reconciliationStatus: "failed",
        },
        valuationEvidence: {
          ...baseRow.valuationEvidence,
          readinessStatus: "guarded",
          defensibilityStatus: "guarded",
        },
      }),
    ], { generatedAt: "2026-06-04T00:00:00.000Z" });

    const rowSummary = scorecard.rowSummaries[0];
    expect(rowSummary.ticker).toBe("SYNTACTIC");
    expect(rowSummary.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      "rigor-syntactic-only",
      "reconciliation-not-cleared",
      "valuation-readiness-guarded",
      "source-lineage-missing",
      "market-freshness-stale-or-missing",
      "reviewer-pack-missing",
    ]));
    expect(rowSummary.blockers.every((blocker) => blocker.clearsWhen.length > 0)).toBe(true);
    expect(scorecard.corpus.blockerCounts["source-lineage"]).toBeGreaterThan(0);
    expect(scorecard.families.find((family) => family.id === "data-freshness-source-tieout")?.blockers)
      .toContain("1 row lacks first-class source lineage evidence");
  });

  it("clears the source-lineage blocker when audit rows carry hashed source artifacts", () => {
    const scorecard = buildValuationMaturityScorecard([
      row({
        ticker: "HASHED",
        sourceEvidence: {
          artifactCount: 1,
          hashedArtifactCount: 1,
          sourceUnavailableCount: 0,
          lineageRef: {
            hasLineage: true,
            conceptCount: 8,
            periodCount: 5,
            checksum: "b".repeat(64),
          },
          artifacts: [{
            artifactId: "Hashed Co.zip",
            provider: "capitaline",
            role: "primary-source",
            sha256: "a".repeat(64),
            byteLength: 1234,
            sourceUnavailable: false,
          }],
        },
      }),
    ], { generatedAt: "2026-06-04T00:00:00.000Z" });

    expect(scorecard.rowSummaries[0].blockers.map((blocker) => blocker.code)).not.toContain("source-lineage-missing");
    expect(scorecard.corpus.blockerCounts["source-lineage"]).toBe(0);
    expect(scorecard.families.find((family) => family.id === "data-freshness-source-tieout")?.blockers)
      .not.toContain("1 row lacks first-class source lineage evidence");
  });

  it("clears the market-freshness blocker only when timestamped market evidence is fresh", () => {
    const scorecard = buildValuationMaturityScorecard([
      row({
        ticker: "FRESH",
        marketEvidence: {
          status: "fresh",
          reason: "NSE close imported from source fixture.",
          inputs: [{ kind: "market-price", source: "nse", asOf: "2026-06-05", value: 1234 }],
        },
      }),
      row({
        ticker: "UNAVAILABLE",
        marketEvidence: {
          status: "source_unavailable",
          reason: "No live market source configured.",
          inputs: [],
        },
      }),
    ]);

    const fresh = scorecard.rowSummaries.find((summary) => summary.ticker === "FRESH");
    const unavailable = scorecard.rowSummaries.find((summary) => summary.ticker === "UNAVAILABLE");
    expect(fresh?.blockers.map((blocker) => blocker.code)).not.toContain("market-freshness-source-unavailable");
    expect(fresh?.blockers.map((blocker) => blocker.code)).not.toContain("market-freshness-stale-or-missing");
    expect(unavailable?.blockers.map((blocker) => blocker.code)).toContain("market-freshness-source-unavailable");
    expect(scorecard.corpus.blockerCounts["market-freshness"]).toBe(1);
  });

  it("uses triangulation and readiness evidence when scoring scorecard audit rows", () => {
    const scorecard = buildValuationMaturityScorecard([
      row({
        folder: "Asian Paints",
        ticker: "ASIANPAINT",
        models: ["VCC", "SOTP", "EPV", "CASH_DCF"],
        outcome: "PRODUCTION_READY",
        statusClass: "production-ready",
        rigor: { ...baseRow.rigor, currentLevel: "production-ready", reconciliationStatus: "pass" },
        valuationEvidence: {
          readinessStatus: "production-ready",
          readinessAnchorPeriod: "2025-03-31",
          defensibilityStatus: "confirmed",
          triangulationMethods: [
            { key: "accrual-riv", label: "Residual income", perShare: 120 },
            { key: "cash-fcff-dcf", label: "FCFF DCF", perShare: 118 },
          ],
          independentLensGroups: ["accrual-history", "cash-statement"],
        },
      }),
    ], { generatedAt: "2026-06-04T00:00:00.000Z" });

    const independence = scorecard.families.find((family) => family.id === "cross-paradigm-independence");
    const traceability = scorecard.families.find((family) => family.id === "traceability-reconciliation-fail-closed");

    expect(independence?.score).toBeGreaterThanOrEqual(9);
    expect(independence?.evidence).toContain("Triangulation methods: accrual-riv, cash-fcff-dcf");
    expect(independence?.evidence).toContain("Independent lens groups: accrual-history, cash-statement");
    expect(traceability?.evidence).toContain("Valuation readiness statuses: production-ready");
  });

  it("diffs scorecard artifacts by family, row outcome, and cleared blockers", () => {
    const before = buildValuationMaturityScorecard([
      row({
        ticker: "CANARY",
        outcome: "POLICY_WARNING",
        statusClass: "policy-warning",
        rigor: { ...baseRow.rigor, currentLevel: "syntactically-valid", reconciliationStatus: "failed" },
        valuationEvidence: { ...baseRow.valuationEvidence, readinessStatus: "guarded" },
      }),
    ], { generatedAt: "2026-06-04T00:00:00.000Z" });
    const after = buildValuationMaturityScorecard([
      row({
        ticker: "CANARY",
        outcome: "PRODUCTION_READY",
        statusClass: "production-ready",
        rigor: { ...baseRow.rigor, currentLevel: "production-ready", reconciliationStatus: "pass" },
        models: ["VCC", "CASH_DCF"],
        valuationEvidence: {
          ...baseRow.valuationEvidence,
          readinessStatus: "production-ready",
          defensibilityStatus: "confirmed",
          triangulationMethods: [
            { key: "accrual-riv", label: "Residual income", perShare: 100 },
            { key: "cash-fcff-dcf", label: "FCFF DCF", perShare: 103 },
          ],
          independentLensGroups: ["accrual-history", "cash-statement"],
        },
      }),
    ], { generatedAt: "2026-06-04T00:00:00.000Z" });

    const diff = diffValuationMaturityScorecards(before, after);

    expect(diff.overallScoreDelta).toBeGreaterThan(0);
    expect(diff.familyDeltas).toContainEqual(expect.objectContaining({ id: "traceability-reconciliation-fail-closed" }));
    expect(diff.rowChanges).toContainEqual(expect.objectContaining({
      ticker: "CANARY",
      beforeOutcome: "POLICY_WARNING",
      afterOutcome: "PRODUCTION_READY",
      clearedBlockers: expect.arrayContaining(["rigor-syntactic-only", "reconciliation-not-cleared", "valuation-readiness-guarded"]),
    }));
    expect(diff.regressions).toEqual([]);
  });

  it("renders markdown with family scores, blockers, and the audit outcome summary", () => {
    const scorecard = buildValuationMaturityScorecard([
      row({ outcome: "POLICY_WARNING", statusClass: "policy-warning" }),
    ], { generatedAt: "2026-06-04T00:00:00.000Z" });

    const markdown = renderScorecardMarkdown(scorecard);

    expect(markdown).toContain("# Valuation Maturity Scorecard");
    expect(markdown).toContain("Schema: `2026-06-valuation-maturity-v2`");
    expect(markdown).toContain("## Current Baseline and Target");
    expect(markdown).toContain("Current score:");
    expect(markdown).toContain("Target score: **10.0/10**");
    expect(markdown).toContain("## Expected skips are not bugs");
    expect(markdown).toContain("EXPECTED_SKIP_MISSING_SIDECAR");
    expect(markdown).toContain("| Family | Weight | Score | Status | Evidence | Blockers |");
    expect(markdown).toContain("Industrial core valuation");
    expect(markdown).toContain("POLICY_WARNING: 1");
    expect(markdown).toContain("## Row Blocker Ledger");
    expect(markdown).toContain("## Production-Ready Checkpoints");
    expect(markdown).toContain("reviewer-pack");
    expect(markdown).toContain("source-lineage-missing");
    expect(markdown).toContain("reviewer-pack-missing");
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
    expect(parsed.corpus.blockerCounts["source-lineage"]).toBe(0);
    expect(parsed.rowSummaries[0].blockers.map((blocker: { code: string }) => blocker.code)).not.toContain("source-lineage-missing");
    expect(parsed.rowSummaries[0].productionReady.status).toBe("pass");
    expect(parsed.rowSummaries[0].productionReady.checkpoints.map((checkpoint: { id: string }) => checkpoint.id))
      .toEqual(expect.arrayContaining(["market-freshness", "reviewer-pack"]));
  }, 120_000);

  it("prints parseable JSON diffs for two scorecard artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "valuation-scorecard-diff-"));
    try {
      const beforePath = join(dir, "before.json");
      const afterPath = join(dir, "after.json");
      const before = buildValuationMaturityScorecard([
        row({ ticker: "CANARY", outcome: "POLICY_WARNING", statusClass: "policy-warning" }),
      ], { generatedAt: "2026-06-04T00:00:00.000Z" });
      const after = buildValuationMaturityScorecard([
        row({
          ticker: "CANARY",
          outcome: "PRODUCTION_READY",
          statusClass: "production-ready",
          rigor: { ...baseRow.rigor, currentLevel: "production-ready", reconciliationStatus: "pass" },
          valuationEvidence: { ...baseRow.valuationEvidence, readinessStatus: "production-ready" },
        }),
      ], { generatedAt: "2026-06-04T00:00:00.000Z" });
      writeFileSync(beforePath, JSON.stringify(before), "utf8");
      writeFileSync(afterPath, JSON.stringify(after), "utf8");

      const output = execFileSync(process.execPath, ["--import", "tsx/esm", scorecardDiffScript, beforePath, afterPath], {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });

      const parsed = JSON.parse(output);
      expect(parsed.rowChanges[0].ticker).toBe("CANARY");
      expect(parsed.rowChanges[0].beforeOutcome).toBe("POLICY_WARNING");
      expect(parsed.rowChanges[0].afterOutcome).toBe("PRODUCTION_READY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
