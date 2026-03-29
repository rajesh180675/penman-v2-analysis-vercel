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
    expect(readiness.fallbackUsed).toBe(true);
    expect(readiness.anchorPeriod).toBe("2024-03-31");
    expect(readiness.contaminationTier).toBe("GUARDED");
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
