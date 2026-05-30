/**
 * Penman–Nissim V3 Analytics Engine — public barrel.
 *
 * Plan 2 PR-2.2: the orchestrator and standalone helpers that used to live
 * here were relocated into sibling ./v3Analytics/* modules. This file is now
 * a re-export barrel so every external import path (V3AnalyticsPanel,
 * AcademicReport, supplementaryPathA.spec, etc.) is unchanged.
 *
 * All monetary values: ₹ Crore (float64). All ratios: dimensionless (0.25 = 25%).
 */
export enum OutputChannel {
  REPORT = "report",
  AUDIT = "audit",
}

// §0 Canonical registry + consistency violations
export { CanonicalOutputRegistry, ConsistencyViolation } from "./v3Analytics/shared";

// §2.5 Data validation
export { runDataValidation } from "./v3Analytics/dataValidation";
export type { DataValidationResult } from "./v3Analytics/dataValidation";

// §6 Clean-surplus / dirty-surplus + event framing
export {
  computeDirtySurplus,
  computeDirtySurplusFramework,
  detectPeriodEventFlags,
} from "./v3Analytics/eventFraming";
export type {
  DSSeverity,
  DirtySurplusRecord,
  DirtySurplusSummary,
  DirtySurplusFramework,
  TriggerCalibrationResult,
  EventFlag,
  PeriodEventFlags,
} from "./v3Analytics/eventFraming";

// §11 Terminal value anchoring + guardrails
export { selectTerminalAnchor, classifyTVShare } from "./v3Analytics/terminalValue";
export type { TerminalAnchorResult, TVGrade } from "./v3Analytics/terminalValue";

// §12 Sensitivity matrix + anchor table
export { computeSensitivityMatrix, computeAnchorTable } from "./v3Analytics/sensitivity";
export type { SensMatrixEntry, AnchorTableEntry } from "./v3Analytics/sensitivity";

// §14 Composite confidence score
export { computeConfidenceScore } from "./v3Analytics/confidence";
export type { ConfidenceResult, ConfidenceComponent } from "./v3Analytics/confidence";

// §9.1 Company-specific fade parameters
export { estimateFadeParams } from "./v3Analytics/fadeParams";
export type { FadeParamEstimate } from "./v3Analytics/fadeParams";

// §15 Auto-generated monitoring triggers
export { calibrateMonitoringTriggers, generateMonitoringTriggers } from "./v3Analytics/triggers";
export type { MonitoringTrigger } from "./v3Analytics/triggers";

// §5.9 Report-rendering helpers
export {
  buildRatioSummary,
  selectOADecompositionPeriods,
  renderOADecomposition,
  buildAccrualTable,
} from "./v3Analytics/reporting";
export type { RatioSummary, OADecompositionResult, AccrualTableRow } from "./v3Analytics/reporting";

// §16.1 Share-count derivation
export { deriveShareCount } from "./v3Analytics/shareCount";
export type { ShareCountResult } from "./v3Analytics/shareCount";

// §16.2 Market-implied analytics
export { computeMarketImplied } from "./v3Analytics/marketImplied";
export type { MarketImpliedResult } from "./v3Analytics/marketImplied";

// §16.3 Section 6B rendering
export { buildSection6B } from "./v3Analytics/section6B";
export type { Section6BStatus, Section6BResult } from "./v3Analytics/section6B";

// §15.2 RE/ReOI identity-gap decomposition
export { decomposeReReOIGap } from "./v3Analytics/reReoiGap";
export type { ReReOIGapDecomposition } from "./v3Analytics/reReoiGap";

// §13.4 Version-change log
export { compareWithPriorRegistry, renderVersionChangeLog } from "./v3Analytics/versionChange";
export type { VersionChangeEntry } from "./v3Analytics/versionChange";

// §13.3 Cross-section consistency assertions
export { runCrossSectionAssertions } from "./v3Analytics/crossSection";
export type { CrossSectionRenderedBundle } from "./v3Analytics/crossSection";

// Metadata firewall (audit/report separation)
export { AUDIT_MARKERS, firewallCheck, enforceMetadataFirewall } from "./v3Analytics/metadataFirewall";

// Orchestrator
export { computeV3Analytics } from "./v3Analytics/compute";
export type { V3AnalyticsBundle } from "./v3Analytics/compute";
