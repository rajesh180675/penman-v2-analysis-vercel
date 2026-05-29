/* Pure type leaf — reconciliation residual summary.
   Relocated from logic module(s) to break the types-barrel <-> analysisTraceability
   cycle (weakness #1). Self-contained.
   Contains ONLY types (no runtime values), imports only other pure leaves, so it
   can never re-enter the engine's type->logic->type tangle. The originating logic
   module re-exports these names, so existing import paths stay valid. */

export type ReconciliationResidualStatus = "confirmed" | "degraded" | "failed";

export interface ReconciliationResidualCheck {
  key: string;
  label: string;
  periodEnd: string;
  residual: number;
  ratio: number;
  warningThreshold: number;
  criticalThreshold: number;
  status: ReconciliationResidualStatus;
  detail: string;
}

export interface ReconciliationResidualSummary {
  status: ReconciliationResidualStatus;
  summary: string;
  warningCount: number;
  errorCount: number;
  maxResidualRatio: number;
  checks: ReconciliationResidualCheck[];
}
