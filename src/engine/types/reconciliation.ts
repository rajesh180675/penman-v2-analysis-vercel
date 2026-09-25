/* Pure type leaf — reconciliation residual summary.
   Relocated from logic module(s) to break the types-barrel <-> analysisTraceability
   cycle (weakness #1). Self-contained.
   Contains ONLY types (no runtime values), imports only other pure leaves, so it
   can never re-enter the engine's type->logic->type tangle. The originating logic
   module re-exports these names, so existing import paths stay valid. */

/**
 * Overall reconciliation verdict.
 *
 * `insufficient-evidence` is deliberately distinct from `degraded`: degraded
 * means checks actually ran and produced warning-level residuals, while
 * insufficient evidence means no independent residual check could run.  The
 * latter must never satisfy the structural rigor gate.
 */
export type ReconciliationResidualStatus =
  | "confirmed"
  | "degraded"
  | "failed"
  | "insufficient-evidence";

export interface ReconciliationResidualCheck {
  key: string;
  label: string;
  periodEnd: string;
  residual: number;
  ratio: number;
  warningThreshold: number;
  criticalThreshold: number;
  status: ReconciliationResidualStatus;
  /**
   * `diagnostic` checks are surfaced and counted, but excluded from the
   * overall status/max-ratio verdict that gates the structural rigor level.
   * Used for evidence-limited reconstructions (cash/debt/distribution
   * bridges) that systematically cannot clear on the current Capitaline CF
   * decomposition — the missing lines (netCashChange, opening/closing cash)
   * are not yet read by the recast, so these compare two incomplete slices.
   * They become gating again once the CF mapping contract carries the full
   * decomposition. See docs/analysis-rigor-ladder.md.
   */
  role?: "gating" | "diagnostic";
  detail: string;
}

export interface ReconciliationResidualSummary {
  status: ReconciliationResidualStatus;
  summary: string;
  warningCount: number;
  errorCount: number;
  maxResidualRatio: number;
  checks: ReconciliationResidualCheck[];
  readiness?: {
    hardTieoutReady: boolean;
    accountsMonitored: number;
  };
}
