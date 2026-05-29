/* Pure type leaf — economic sanity gate summary.
   Relocated from logic module(s) to break the types-barrel <-> analysisTraceability
   cycle (weakness #1). Self-contained.
   Contains ONLY types (no runtime values), imports only other pure leaves, so it
   can never re-enter the engine's type->logic->type tangle. The originating logic
   module re-exports these names, so existing import paths stay valid. */

export type GateCheckId =
  | "terminal-period-contamination"
  | "dirty-surplus-integrity"
  | "implausible-rnoa-jump"
  | "demerger-discontinued-contamination"
  | "anchor-period-selection";

export interface GateCheckResult {
  checkId: GateCheckId;
  passed: boolean;
  reason: string;
  severity: "block" | "warn";
  affectedPeriods: string[];
}

export interface EconomicSanitySummary {
  status: "passed" | "warned" | "blocked";
  anchorPeriod: string | null;
  anchorReason: string;
  skippedPeriods: { period: string; reason: string }[];
  failedChecks: GateCheckResult[];
}
