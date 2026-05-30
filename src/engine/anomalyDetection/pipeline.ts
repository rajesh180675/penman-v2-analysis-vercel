import { RecastPeriod, SpecFlag, ContaminationResult, EngineConfig } from "../types";
import {
  DirtySurplusResult,
  MetricOutlierResult,
  detectDirtySurplusPerPeriod,
  detectDividendDiscrepancy,
  detectMetricStepChanges,
  detectComponentDisappearance,
  detectReclassification,
  detectPayoutAnomaly,
} from "./detectors";
import {
  PeriodFlagSummary,
  validateTerminalREAnchor,
  buildPeriodFlagSummary,
  computeContaminationTier,
} from "./classifiers";

/* ── Full Anomaly Pipeline ──────────────────────────────────────── */

export interface AnomalyBundle {
  dsSeries         : DirtySurplusResult[];
  divDiscFlags     : SpecFlag[];
  metricOutliers   : MetricOutlierResult[];
  componentDecline : SpecFlag[];
  reclassification : SpecFlag[];
  payoutAnomaly    : SpecFlag[];
  /** All flags for the latest (terminal) period */
  terminalFlags    : SpecFlag[];
  contamination    : ContaminationResult;
  /** Per-period flag summaries */
  periodSummaries  : PeriodFlagSummary[];
  /** Cumulative dirty surplus */
  cumulativeDS     : number;
  cumulativeDS_pct : number;
}

export function runAnomalyDetection(
  periods: RecastPeriod[],
  cfg: EngineConfig,
  reSeries?: Array<{period:string;RE:number;ReOI:number}>
): AnomalyBundle {
  if (periods.length < 2) {
    const empty: ContaminationResult = {
      tier: "CLEAN", score: 0, n_flags: 0, n_critical: 0, n_warning: 0,
      primary_anchor: "RE_T", message: "Insufficient periods.", flag_labels: [],
    };
    return {
      dsSeries: [], divDiscFlags: [], metricOutliers: [], componentDecline: [],
      reclassification: [], payoutAnomaly: [], terminalFlags: [], contamination: empty,
      periodSummaries: [], cumulativeDS: 0, cumulativeDS_pct: 0,
    };
  }

  const dsSeries        = detectDirtySurplusPerPeriod(periods, cfg);
  const divDiscFlags    = detectDividendDiscrepancy(periods, dsSeries, cfg);
  const metricOutliers  = detectMetricStepChanges(periods, cfg);
  const componentDecline = detectComponentDisappearance(periods, cfg);
  const reclassification = detectReclassification(periods, cfg);
  const payoutAnomaly   = detectPayoutAnomaly(periods);

  // RE anchor validation if reSeries provided
  let reAnchorFlags: SpecFlag[] = [];
  if (reSeries && reSeries.length > 0) {
    const reValidation = validateTerminalREAnchor(reSeries, cfg);
    reAnchorFlags = reValidation.flags;
  }

  // Cumulative dirty surplus
  const cumulativeDS = dsSeries.reduce((s, r) => s + r.DS_t, 0);
  const terminalCSE  = Math.max(Math.abs(periods[periods.length - 1]!.bs.CSE), 1);
  const cumulativeDS_pct = Math.abs(cumulativeDS) / terminalCSE;

  // Build per-period summaries
  const allFlagsFlat: SpecFlag[] = [
    ...dsSeries.flatMap(r => r.flags),
    ...divDiscFlags,
    ...metricOutliers.flatMap(r => r.flags),
    ...componentDecline,
    ...reclassification,
    ...payoutAnomaly,
    ...reAnchorFlags,
  ];

  const periodSummaries = periods.map(p =>
    buildPeriodFlagSummary(
      p.period_end,
      dsSeries.flatMap(r => r.flags),
      divDiscFlags,
      metricOutliers.flatMap(r => r.flags),
      componentDecline,
      reclassification,
      payoutAnomaly,
      reAnchorFlags,
    )
  );

  // Terminal period flags
  const latestPeriod = periods[periods.length - 1]!.period_end;
  const terminalFlags = allFlagsFlat.filter(f => f.period === latestPeriod);

  // Add any terminal RE anchor flags
  terminalFlags.push(...reAnchorFlags);

  const contamination = computeContaminationTier(terminalFlags);

  return {
    dsSeries, divDiscFlags, metricOutliers, componentDecline,
    reclassification, payoutAnomaly, terminalFlags, contamination,
    periodSummaries, cumulativeDS, cumulativeDS_pct,
  };
}
