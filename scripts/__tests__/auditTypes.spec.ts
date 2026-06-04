import { describe, expect, it } from "vitest";
import {
  AUDIT_OUTCOMES,
  deriveAuditOutcome,
  isActionableAuditOutcome,
  statusClassFromOutcome,
} from "../lib/auditTypes";

describe("audit skip/error taxonomy", () => {
  it("exposes the bounded Plan 0 PR-0.2 outcome vocabulary without legacy OK_COMPUTED names", () => {
    expect(AUDIT_OUTCOMES).toEqual([
      "PRODUCTION_READY",
      "VALUATION_ELIGIBLE_GUARDED",
      "ECONOMICALLY_PLAUSIBLE_CAPPED",
      "EXPECTED_SKIP_MISSING_SIDECAR",
      "EXPECTED_SKIP_INSUFFICIENT_HISTORY",
      "EXPECTED_SKIP_UNSUPPORTED_SOURCE",
      "MODEL_GAP",
      "POLICY_WARNING",
      "CALC_ERROR",
    ]);
    expect(AUDIT_OUTCOMES).not.toContain("OK_COMPUTED");
    expect(AUDIT_OUTCOMES).not.toContain("EXPECTED_SCOPE_CAP");
  });

  it.each([
    ["production-ready", "PRODUCTION_READY"],
    ["valuation-eligible", "VALUATION_ELIGIBLE_GUARDED"],
    ["economically-plausible", "ECONOMICALLY_PLAUSIBLE_CAPPED"],
    ["structurally-reconciled", "POLICY_WARNING"],
    ["syntactically-valid", "POLICY_WARNING"],
  ] as const)("maps computed rigor level %s to %s", (rigorLevel, expected) => {
    expect(deriveAuditOutcome({ flags: [], hasComputedValue: true, rigorLevel, periodCount: 5 })).toBe(expected);
  });

  it.each([
    [["CALC_ERROR:MISSING_ZIP"], "CALC_ERROR"],
    [["JUSTIFIED_PB_INVALID"], "CALC_ERROR"],
    [["EXPECTED_SKIP_MISSING_SIDECAR:INSURANCE_EV_VNB"], "EXPECTED_SKIP_MISSING_SIDECAR"],
    [["EXPECTED_SKIP_INSUFFICIENT_HISTORY:ONLY_ONE_PERIOD"], "EXPECTED_SKIP_INSUFFICIENT_HISTORY"],
    [["EXPECTED_SKIP_UNSUPPORTED_SOURCE:MANUAL"], "EXPECTED_SKIP_UNSUPPORTED_SOURCE"],
    [["EXPECTED_SCOPE_CAP:SECTOR_NATIVE_MODEL_PENDING"], "ECONOMICALLY_PLAUSIBLE_CAPPED"],
    [["MODEL_GAP:NO_SCENARIOS"], "MODEL_GAP"],
    [["NO_SCENARIOS"], "MODEL_GAP"],
    [["DETAIL:sidecar reason"], "POLICY_WARNING"],
  ] as const)("prioritizes flag %j as %s", (flags, expected) => {
    expect(deriveAuditOutcome({ flags: [...flags], hasComputedValue: false, rigorLevel: null, periodCount: 4 })).toBe(expected);
  });

  it("classifies insufficient history even without a pre-existing flag", () => {
    expect(deriveAuditOutcome({ flags: [], hasComputedValue: false, rigorLevel: null, periodCount: 1 })).toBe(
      "EXPECTED_SKIP_INSUFFICIENT_HISTORY",
    );
  });

  it("maps outcomes to stable summary classes and actionability", () => {
    expect(statusClassFromOutcome("PRODUCTION_READY")).toBe("production-ready");
    expect(statusClassFromOutcome("VALUATION_ELIGIBLE_GUARDED")).toBe("valuation-eligible-guarded");
    expect(statusClassFromOutcome("ECONOMICALLY_PLAUSIBLE_CAPPED")).toBe("economically-plausible-capped");
    expect(statusClassFromOutcome("EXPECTED_SKIP_MISSING_SIDECAR")).toBe("expected-skip");
    expect(statusClassFromOutcome("CALC_ERROR")).toBe("calc-error");

    expect(isActionableAuditOutcome("PRODUCTION_READY")).toBe(false);
    expect(isActionableAuditOutcome("EXPECTED_SKIP_MISSING_SIDECAR")).toBe(false);
    expect(isActionableAuditOutcome("MODEL_GAP")).toBe(true);
    expect(isActionableAuditOutcome("POLICY_WARNING")).toBe(true);
    expect(isActionableAuditOutcome("CALC_ERROR")).toBe(true);
  });
});
