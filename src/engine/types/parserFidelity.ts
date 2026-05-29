/* Pure type leaf — parser fidelity summary.
   Relocated from logic module(s) to break the types-barrel <-> analysisTraceability
   cycle (weakness #1). ParserFidelityCheck stays in ../parserDiagnostics (acyclic).
   Contains ONLY types (no runtime values), imports only other pure leaves, so it
   can never re-enter the engine's type->logic->type tangle. The originating logic
   module re-exports these names, so existing import paths stay valid. */

import type { ParserFidelityCheck } from "../parserDiagnostics";
export type { ParserFidelityCheck };

export type ParserFidelityStatus = "confirmed" | "degraded" | "failed";

export interface ParserFidelitySummary {
  status: ParserFidelityStatus;
  score: number;
  summary: string;
  warningCount: number;
  errorCount: number;
  checks: ParserFidelityCheck[];
}
