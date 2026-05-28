/* ================================================================
   Traceability re-export
   The full AnalysisTraceabilityEnvelope and rigor-ladder definitions
   live in src/engine/analysisTraceability.ts. This file re-exports
   the type-only surface so importers get a stable seam without
   forcing them through the implementation module.
================================================================ */

export type { AnalysisTraceabilityEnvelope } from "../analysisTraceability";
