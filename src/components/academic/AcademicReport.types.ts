import { buildAnalysisPublicationSnapshot } from "../../lib/publication/analysisPublicationSnapshot";
import { computeValuation } from "../../engine/PenmanNissimEngine";
import { computeV3Analytics, computeAnchorTable } from "../../engine/v3Analytics";
import {
  computeNoaDiagnostics,
  computeNoaShiftSeries,
  computePeriodDiagnostics,
  computeRatioTimeline,
  computeSection6BLocal,
} from "./AcademicReport.hooks";

export type Publication = ReturnType<typeof buildAnalysisPublicationSnapshot>;
export type Valuation = ReturnType<typeof computeValuation>;
export type V3Bundle = ReturnType<typeof computeV3Analytics>;
export type AnchorTable = ReturnType<typeof computeAnchorTable>;
export type TerminalAnchor = V3Bundle["anchorResult"] | undefined;

export type QualityGate = Publication["qualityGate"];
export type Traceability = Publication["traceability"];
export type RunIdentity = Publication["runIdentity"];
export type ValuationReadiness = Publication["valuationReadiness"];
export type TraceabilitySummary = Publication["traceabilitySummary"];

export type NoaDiagnostics = ReturnType<typeof computeNoaDiagnostics>;
export type NoaShiftSeries = ReturnType<typeof computeNoaShiftSeries>;
export type PeriodDiagnostics = ReturnType<typeof computePeriodDiagnostics>;
export type RatioTimeline = ReturnType<typeof computeRatioTimeline>;
export type Section6BLocal = ReturnType<typeof computeSection6BLocal>;
