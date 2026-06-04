export const AUDIT_OUTCOMES = [
  "PRODUCTION_READY",
  "VALUATION_ELIGIBLE_GUARDED",
  "ECONOMICALLY_PLAUSIBLE_CAPPED",
  "EXPECTED_SKIP_MISSING_SIDECAR",
  "EXPECTED_SKIP_INSUFFICIENT_HISTORY",
  "EXPECTED_SKIP_UNSUPPORTED_SOURCE",
  "MODEL_GAP",
  "POLICY_WARNING",
  "CALC_ERROR",
] as const;

export type AuditOutcome = typeof AUDIT_OUTCOMES[number];

export type AuditStatusClass =
  | "production-ready"
  | "valuation-eligible-guarded"
  | "economically-plausible-capped"
  | "expected-skip"
  | "model-gap"
  | "calc-error"
  | "policy-warning";

const RIGOR_TO_OUTCOME: Record<string, AuditOutcome> = {
  "production-ready": "PRODUCTION_READY",
  "valuation-eligible": "VALUATION_ELIGIBLE_GUARDED",
  "economically-plausible": "ECONOMICALLY_PLAUSIBLE_CAPPED",
};

export interface DeriveAuditOutcomeInput {
  flags: string[];
  hasComputedValue: boolean;
  rigorLevel?: string | null;
  periodCount?: number | null;
}

export function statusClassFromOutcome(outcome: AuditOutcome): AuditStatusClass {
  switch (outcome) {
    case "PRODUCTION_READY": return "production-ready";
    case "VALUATION_ELIGIBLE_GUARDED": return "valuation-eligible-guarded";
    case "ECONOMICALLY_PLAUSIBLE_CAPPED": return "economically-plausible-capped";
    case "EXPECTED_SKIP_MISSING_SIDECAR": return "expected-skip";
    case "EXPECTED_SKIP_INSUFFICIENT_HISTORY": return "expected-skip";
    case "EXPECTED_SKIP_UNSUPPORTED_SOURCE": return "expected-skip";
    case "MODEL_GAP": return "model-gap";
    case "CALC_ERROR": return "calc-error";
    case "POLICY_WARNING": return "policy-warning";
  }
}

export function isActionableAuditOutcome(outcome: AuditOutcome): boolean {
  return outcome === "MODEL_GAP" || outcome === "POLICY_WARNING" || outcome === "CALC_ERROR";
}

export function isExpectedSkipOutcome(outcome: AuditOutcome): boolean {
  return outcome === "EXPECTED_SKIP_MISSING_SIDECAR"
    || outcome === "EXPECTED_SKIP_INSUFFICIENT_HISTORY"
    || outcome === "EXPECTED_SKIP_UNSUPPORTED_SOURCE";
}

export function deriveAuditOutcome(input: DeriveAuditOutcomeInput): AuditOutcome {
  const { flags, hasComputedValue, rigorLevel, periodCount } = input;

  if (flags.some((f) => f.startsWith("ERROR") || f.startsWith("CALC_ERROR") || f.endsWith("_INVALID"))) {
    return "CALC_ERROR";
  }
  if (flags.some((f) => f.startsWith("EXPECTED_SKIP_MISSING_SIDECAR"))) {
    return "EXPECTED_SKIP_MISSING_SIDECAR";
  }
  if (flags.some((f) => f.startsWith("EXPECTED_SKIP_INSUFFICIENT_HISTORY"))) {
    return "EXPECTED_SKIP_INSUFFICIENT_HISTORY";
  }
  if (flags.some((f) => f.startsWith("EXPECTED_SKIP_UNSUPPORTED_SOURCE"))) {
    return "EXPECTED_SKIP_UNSUPPORTED_SOURCE";
  }
  if (flags.some((f) => f.startsWith("EXPECTED_SCOPE_CAP"))) {
    return "ECONOMICALLY_PLAUSIBLE_CAPPED";
  }
  if (flags.some((f) => f.startsWith("MODEL_GAP") || f === "NO_SCENARIOS")) {
    return "MODEL_GAP";
  }
  if (!hasComputedValue && periodCount != null && periodCount > 0 && periodCount < 2) {
    return "EXPECTED_SKIP_INSUFFICIENT_HISTORY";
  }
  if (flags.length > 0) {
    return "POLICY_WARNING";
  }
  if (!hasComputedValue) {
    return "MODEL_GAP";
  }

  return RIGOR_TO_OUTCOME[rigorLevel ?? ""] ?? "POLICY_WARNING";
}
