/**
 * Anomaly Detection Module — V2-FINAL Spec Implementation
 *
 * Implements:
 *   S-5.1  Dirty Surplus Spike (per period)
 *   S-5.2  Dividend Discrepancy Gate
 *   S-5.3  Metric Step-Change Detection (incl. incremental margin)
 *   S-5.4  Large Asset/Liability Disappearance
 *   S-5.5  Reclassification Detection
 *   S-5.6  Payout Ratio Anomaly
 *   S-5.7  Period Flag Summary and Cascading Score
 *   S-6.3  Accrual Regime Classification
 *   S-10.2 Contamination Tier System
 *   S-10.1 Terminal RE Anchor Validation
 */

export {
  detectDirtySurplusPerPeriod,
  detectDividendDiscrepancy,
  detectMetricStepChanges,
  detectComponentDisappearance,
  detectReclassification,
  detectPayoutAnomaly,
} from "./anomalyDetection/detectors";
export type { DirtySurplusResult, MetricOutlierResult } from "./anomalyDetection/detectors";

export {
  classifyAccrualRegime,
  validateTerminalREAnchor,
  buildPeriodFlagSummary,
  computeContaminationTier,
} from "./anomalyDetection/classifiers";
export type { AccrualRegime, TerminalREValidation, PeriodFlagSummary } from "./anomalyDetection/classifiers";

export { runAnomalyDetection } from "./anomalyDetection/pipeline";
export type { AnomalyBundle } from "./anomalyDetection/pipeline";
