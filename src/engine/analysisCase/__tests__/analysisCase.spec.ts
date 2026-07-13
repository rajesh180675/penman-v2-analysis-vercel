import { describe, expect, it } from "vitest";
import type { RecastPeriod } from "../../types";
import type { EconomicSanitySummary } from "../../types/economicSanity";
import type { ValuationReadiness } from "../../valuationPolicy";
import {
  resolveSourcedAssumptionSet,
  selectFamilyPeriodAnalysisWindow,
  selectUnifiedAnalysisWindow,
  type AssumptionCandidate,
} from "../index";

function period(period_end: string, withRatios = true): RecastPeriod {
  return {
    period_end,
    bs: {} as RecastPeriod["bs"],
    is: {} as RecastPeriod["is"],
    cu: {} as RecastPeriod["cu"],
    cf: {} as RecastPeriod["cf"],
    ...(withRatios ? { ratios: {} as NonNullable<RecastPeriod["ratios"]> } : {}),
  };
}

function economic(anchorPeriod: string | null, status: EconomicSanitySummary["status"] = "passed"): EconomicSanitySummary {
  return {
    status,
    anchorPeriod,
    anchorReason: anchorPeriod ? `Economic anchor ${anchorPeriod}.` : "No economic anchor.",
    skippedPeriods: [],
    failedChecks: [],
  };
}

function readiness(anchorPeriod: string | null, status: ValuationReadiness["status"] = "production-ready"): ValuationReadiness {
  return {
    status,
    latestPeriod: "2025-03-31",
    anchorPeriod,
    anchorIndex: anchorPeriod === "2025-03-31" ? 2 : 1,
    fallbackUsed: anchorPeriod !== "2025-03-31",
    contaminationTier: "CLEAN",
    persistenceStatus: "durable",
    persistenceScore: 80,
    terminalFlags: [],
    terminalFlagLabels: [],
    reasons: ["Valuation readiness evaluated."],
  };
}

const periods = [period("2023-03-31"), period("2024-03-31"), period("2025-03-31")];

describe("unified analysis window", () => {
  it("chooses the strict common anchor once for every downstream consumer", async () => {
    const window = await selectUnifiedAnalysisWindow({
      periods,
      rawData: [],
      economicSanity: economic("2025-03-31"),
      valuationReadiness: readiness("2024-03-31", "guarded"),
    });

    expect(window.anchorPeriod).toBe("2024-03-31");
    expect(window.includedPeriods).toEqual(["2023-03-31", "2024-03-31"]);
    expect(window.excludedPeriods).toEqual([
      expect.objectContaining({ period: "2025-03-31", reasonCode: "AFTER_COMMON_POLICY_ANCHOR" }),
    ]);
    expect(window.selectionStatus).toBe("guarded");
    expect(window.windowId).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed when economic sanity has no anchor", async () => {
    const window = await selectUnifiedAnalysisWindow({
      periods,
      rawData: [],
      economicSanity: economic(null, "blocked"),
      valuationReadiness: readiness("2025-03-31"),
    });
    expect(window.selectionStatus).toBe("blocked");
    expect(window.blockerCodes).toContain("ECONOMIC_ANCHOR_BLOCKED");
    expect(window.includedPeriods).toEqual([]);
  });

  it("records analyst-confirmed exclusions and reselects a prior anchor", async () => {
    const window = await selectUnifiedAnalysisWindow({
      periods,
      rawData: [],
      economicSanity: economic("2025-03-31"),
      valuationReadiness: readiness("2025-03-31"),
      analystExclusions: [{
        period: "2025-03-31",
        reasonCode: "REVIEWER_CONFIRMED_ONE_OFF",
        evidenceRefs: [],
        confirmed: true,
      }],
    });
    expect(window.anchorPeriod).toBe("2024-03-31");
    expect(window.excludedPeriods[0]).toEqual(expect.objectContaining({
      period: "2025-03-31",
      policy: "analyst-confirmed",
    }));
  });

  it("pins a guarded native-family window without claiming industrial gate evidence", async () => {
    const window = await selectFamilyPeriodAnalysisWindow({
      rawData: [
        { company_id: "BANK", period_end: "2024-03-31", raw_metric_values: {} },
        { company_id: "BANK", period_end: "2025-03-31", raw_metric_values: {} },
      ],
    });

    expect(window.selectionStatus).toBe("guarded");
    expect(window.economicStatus).toBe("warned");
    expect(window.valuationReadinessStatus).toBe("guarded");
    expect(window.includedPeriods).toEqual(["2024-03-31", "2025-03-31"]);
    expect(window.anchorPeriod).toBe("2025-03-31");
    expect(window.windowId).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("sourced assumption set", () => {
  it("requires actual evidence and a contained historical period window", async () => {
    const window = await selectUnifiedAnalysisWindow({
      periods,
      rawData: [],
      economicSanity: economic("2025-03-31"),
      valuationReadiness: readiness("2025-03-31"),
    });
    const candidates: AssumptionCandidate<unknown>[] = [{
      assumptionId: "base.revenue-growth",
      key: "revenue_growth",
      value: 0.08,
      unit: "fraction",
      mode: "derived",
      evidenceRefs: [],
      periodWindow: null,
      range: { low: 0.04, high: 0.12, method: "historical distribution" },
      distribution: null,
      confidence: "high",
      reviewerState: "system",
      required: true,
    }];
    const set = await resolveSourcedAssumptionSet({ window, candidates });
    expect(set.status).toBe("blocked");
    expect(set.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_EVIDENCE",
      "MISSING_PERIOD_WINDOW",
    ]));
  });

  it("quarantines market-implied assumptions from intrinsic confidence", async () => {
    const window = await selectUnifiedAnalysisWindow({
      periods,
      rawData: [],
      economicSanity: economic("2025-03-31"),
      valuationReadiness: readiness("2025-03-31"),
    });
    const evidenceRef = {
      kind: "evidence" as const,
      contentHash: `sha256:${"a".repeat(64)}` as const,
      mediaType: "application/json",
      byteLength: 10,
      schemaVersion: "market-snapshot-v1",
    };
    const set = await resolveSourcedAssumptionSet({
      window,
      candidates: [{
        assumptionId: "market.implied-growth",
        key: "revenue_growth",
        value: 0.25,
        unit: "fraction",
        mode: "market-implied",
        evidenceRefs: [evidenceRef],
        periodWindow: null,
        range: null,
        distribution: null,
        confidence: "low",
        reviewerState: "system",
        required: false,
      }],
    });
    expect(set.status).toBe("confirmed");
    expect(set.assumptions[0]!.eligibleForIntrinsicConfidence).toBe(false);
    expect(set.intrinsicEligibleAssumptionIds).toEqual([]);
  });
});
