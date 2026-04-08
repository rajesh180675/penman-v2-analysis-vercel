import { describe, expect, it } from "vitest";
import { Severity, RecastPeriod } from "../types";
import { deriveCompanyLabel, resolveValuationReadiness } from "../valuationPolicy";

function mkPeriod(period_end: string, spec_flags: RecastPeriod["spec_flags"] = []): RecastPeriod {
  return {
    period_end,
    spec_flags,
  } as RecastPeriod;
}

describe("resolveValuationReadiness", () => {
  it("falls back to the latest clean prior anchor when the terminal period is compromised", () => {
    const periods = [
      mkPeriod("2023-03-31"),
      mkPeriod("2024-03-31"),
      mkPeriod("2025-03-31", [
        {
          spec_id: "S-5.1",
          severity: Severity.CRITICAL,
          label: "STRUCTURAL_EVENT",
          message: "Dirty surplus event.",
          affects_terminal: true,
          period: "2025-03-31",
        },
        {
          spec_id: "S-5.3",
          severity: Severity.CRITICAL,
          label: "RNOA_OUTLIER_CRITICAL",
          message: "RNOA outlier.",
          affects_terminal: true,
          period: "2025-03-31",
        },
      ]),
    ];

    const readiness = resolveValuationReadiness(periods);

    expect(readiness.status).toBe("guarded");
    expect(readiness.fallbackUsed).toBe(false);
    expect(readiness.anchorPeriod).toBe("2025-03-31");
    expect(readiness.contaminationTier).toBe("GUARDED");
    expect(readiness.reasons.length).toBeGreaterThan(0);
  });

  it("marks fragile persistence separately from contamination", () => {
    const fragilePeriods = [
      {
        ...mkPeriod("2023-03-31"),
        bs: { separationScore: 62 },
        ratios: { Sales_growth: 0.16, CoreSalesPM: 0.16, PM: 0.16, ATO: 1.2, SPREAD: 0.05, cash_conversion_ratio: 0.58, NOA_growth: 0.2, FLEV: 0.7 },
      },
      {
        ...mkPeriod("2024-03-31"),
        bs: { separationScore: 61 },
        ratios: { Sales_growth: 0.2, CoreSalesPM: 0.19, PM: 0.19, ATO: 1.15, SPREAD: 0.06, cash_conversion_ratio: 0.52, NOA_growth: 0.24, FLEV: 0.76 },
      },
      {
        ...mkPeriod("2025-03-31"),
        bs: { separationScore: 60 },
        ratios: { Sales_growth: 0.28, CoreSalesPM: 0.24, PM: 0.24, ATO: 1.1, SPREAD: 0.06, cash_conversion_ratio: 0.46, NOA_growth: 0.29, FLEV: 0.82 },
      },
    ] as RecastPeriod[];

    const readiness = resolveValuationReadiness(fragilePeriods);

    expect(readiness.status).toBe("production-ready");
    expect(readiness.persistenceStatus).toBe("fragile");
    expect(readiness.persistenceScore).toBeLessThan(45);
    expect(readiness.reasons.some((reason) => reason.toLowerCase().includes("persistence"))).toBe(true);
  });

  it("uses terminal RE anchor flags when they are present on the terminal period", () => {
    const periods = [
      mkPeriod("2023-03-31"),
      mkPeriod("2024-03-31"),
      mkPeriod("2025-03-31", [
        {
          spec_id: "S-10.1",
          severity: Severity.CRITICAL,
          label: "RE_ANCHOR_INVALID",
          message: "Terminal RE anchor invalid.",
          affects_terminal: true,
          period: "2025-03-31",
        },
      ]),
    ];

    const readiness = resolveValuationReadiness(periods);

    expect(readiness.status).toBe("guarded");
    expect(readiness.terminalFlagLabels).toContain("RE_ANCHOR_INVALID");
    expect(readiness.reasons.length).toBeGreaterThan(0);
  });

  it("guards valuation when fewer than two usable recast periods are available", () => {
    const periods = [
      {
        ...mkPeriod("2025-03-31"),
        bs: { separationScore: 88 },
        ratios: { Sales_growth: 0.1, CoreSalesPM: 0.12, PM: 0.12, ATO: 1.2, SPREAD: 0.05, cash_conversion_ratio: 0.8, NOA_growth: 0.08, FLEV: 0.2 },
      },
    ] as RecastPeriod[];

    const readiness = resolveValuationReadiness(periods);

    expect(readiness.status).toBe("guarded");
    expect(readiness.reasons.some((reason) => reason.includes("at least two recast periods"))).toBe(true);
  });

  it("keeps clean valuation production-ready but records shallow-history caution when only two usable periods exist", () => {
    const periods = [
      {
        ...mkPeriod("2024-03-31"),
        bs: { separationScore: 88 },
        ratios: { Sales_growth: 0.08, CoreSalesPM: 0.12, PM: 0.12, ATO: 1.2, SPREAD: 0.05, cash_conversion_ratio: 0.82, NOA_growth: 0.08, FLEV: 0.2 },
      },
      {
        ...mkPeriod("2025-03-31"),
        bs: { separationScore: 87 },
        ratios: { Sales_growth: 0.09, CoreSalesPM: 0.13, PM: 0.13, ATO: 1.21, SPREAD: 0.05, cash_conversion_ratio: 0.83, NOA_growth: 0.09, FLEV: 0.2 },
      },
    ] as RecastPeriod[];

    const readiness = resolveValuationReadiness(periods);

    expect(readiness.status).toBe("production-ready");
    expect(readiness.reasons.some((reason) => reason.includes("fewer than four recast periods"))).toBe(true);
  });
});
describe("deriveCompanyLabel", () => {
  it("prefers explicit config ticker, then explicit company id, then raw data", () => {
    expect(
      deriveCompanyLabel([{ company_id: "RAW", period_end: "2025-03-31", raw_metric_values: {} }], "ITC", "AUDIT"),
    ).toBe("ITC");
    expect(
      deriveCompanyLabel([{ company_id: "RAW", period_end: "2025-03-31", raw_metric_values: {} }], "", "AUDIT"),
    ).toBe("AUDIT");
    expect(
      deriveCompanyLabel([{ company_id: "RAW", period_end: "2025-03-31", raw_metric_values: {} }], "", ""),
    ).toBe("RAW");
  });
});
