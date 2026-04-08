/** Phase 5.1-5.3: Earnings Quality Framework
 *
 * Based on Dechow et al. (2010) framework:
 * - Recognition timeliness
 * - Neutrality (conservative vs aggressive)
 * - Completeness (clean surplus vs dirty surplus)
 * - Realization (cash backing of accruals)
 *
 * Plus Roychowdhury (2006) real earnings management tests
 * and Dechow-Dichev (2002) accrual quality regression.
 */

import type { RecastPeriod } from "./types";

/* ================================================================
   Dechow-Dichev Accrual Quality (2002)
   Regress working capital accruals on current, lag, and lead CFO.
   R-squared measures earnings quality: low R² = high accrual noise
=============================================================== */

export interface DechowDichevResult {
  /** Number of observations used in regression. */
  n: number;
  /** R-squared of WCA ~ CFO regression. Higher = better accrual quality. */
  rSquared: number;
  /** Residual standard deviation. Lower = cleaner accruals. */
  residualStdDev: number;
  /** Average absolute accrual quality (|residual| / avg total assets). */
  avgAbsAq: number;
  /** Quality label. */
  label: string;
}

/**
 * Dechow-Dichev accrual quality estimate.
 * WCA = dWC (change in working capital accruals)
 * Model: WCA_t = alpha + b0*CFO_{t-1} + b1*CFO_t + b2*CFO_{t+1} + epsilon
 * R-squared: High R² means accruals track cash flows well → high earnings quality.
 */
export function dechowDichevQuality(
  cfoSeries: number[],
  wcaSeries: number[],
): DechowDichevResult | null {
  const n = cfoSeries.length;
  if (n < 5) return null; // Need at least 5 periods for meaningful regression

  // Simple OLS: WCA ~ CFO (current only, for limited data)
  // Full model uses lag/lead but we simplify to CFO_t for data-sparse environments
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    pairs.push([cfoSeries[i], wcaSeries[i]]);
  }

  const valid = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const m = valid.length;
  if (m < 4) return null;

  const meanX = valid.reduce((s, [x]) => s + x, 0) / m;
  const meanY = valid.reduce((s, [, y]) => s + y, 0) / m;

  let ssxx = 0;
  let ssxy = 0;
  let ssyy = 0;
  for (const [x, y] of valid) {
    const dx = x - meanX;
    const dy = y - meanY;
    ssxx += dx * dx;
    ssxy += dx * dy;
    ssyy += dy * dy;
  }

  const slope = ssxx > 0 ? ssxy / ssxx : 0;
  const intercept = meanY - slope * meanX;
  const predicted = valid.map(([x]) => intercept + slope * x);
  const residuals = valid.map(([, y], i) => y - predicted[i]);

  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const rSquared = ssyy > 0 ? Math.max(0, 1 - ssRes / ssyy) : 0;
  const residualStdDev = Math.sqrt(ssRes / (m - 2));

  // Average absolute accrual quality (normalized to CFO scale)
  const avgCfo = Math.abs(valid.reduce((s, [x]) => s + x, 0) / m);
  const avgAbsAq = avgCfo > 0 ? (residuals.reduce((s, r) => s + Math.abs(r), 0) / m) / avgCfo : 1;

  let label = "Insufficient data for accrual quality assessment.";
  if (rSquared >= 0.70) {
    label = "High accrual quality — WC accruals closely track cash flows.";
  } else if (rSquared >= 0.40) {
    label = "Moderate accrual quality — Some accrual noise detected.";
  } else if (rSquared >= 0.20) {
    label = "Low accrual quality — Accruals poorly aligned with cash flows.";
  } else {
    label = "Very low accrual quality — Earnings contain significant accrual noise.";
  }

  return {
    n: m,
    rSquared,
    residualStdDev,
    avgAbsAq,
    label,
  };
}

/* ================================================================
   Roychowdhury (2006) Real Earnings Management Tests
   Detect abnormal discretionary expenses, abnormal production costs,
   and abnormal CFO.
=============================================================== */

export interface RoychowdhuryResult {
  /** Abnormal CFO (actual vs predicted). Negative = potential REM. */
  abnormalCFO: number | null;
  /** Abnormal discretionary expenses. Negative = cutting expenses to boost earnings. */
  abnormalDiscExp: number | null;
  /** Abnormal production costs. Positive = overproduction to reduce COGS. */
  abnormalProdCost: number | null;
  /** Aggregate REM score (sum of absolute abnormal activities). */
  remScore: number | null;
  /** Flag for potential real earnings management. */
  remFlag: boolean;
  label: string;
}

/**
 * Simple Roychowdhury-style real earnings management detection.
 *
 * Uses sales growth vs expense growth divergence to estimate
 * abnormal discretionary spending. Overproduction is estimated
 * via inventory build-up relative to sales growth.
 */
export function roychowdhuryREM(
  sales: number[],
  cfo: number[],
  discretionaryExpense: number[], // R&D + SG&A + advertising
  productionCost: number[], // COGS + dInventory
): RoychowdhuryResult | null {
  const n = sales.length;
  if (n < 4) return null;

  // Use the latest period for analysis
  const latestSales = sales[n - 1];

  // Compute normal relationships via simple regression
  // Normal CFO ~ Sales
  const cfoNormal = simpleRegression(sales, cfo);
  const predictedCFO = cfoNormal ? cfoNormal.slope * latestSales + cfoNormal.intercept : null;
  const abnormalCFO = predictedCFO != null ? cfo[n - 1] - predictedCFO : null;

  // Normal discretionary expense ~ Sales
  const discNormal = simpleRegression(sales, discretionaryExpense);
  const predictedDisc = discNormal ? discNormal.slope * latestSales + discNormal.intercept : null;
  const abnormalDiscExp = predictedDisc != null ? discretionaryExpense[n - 1] - predictedDisc : null;

  // Normal production cost ~ Sales
  const prodNormal = simpleRegression(sales, productionCost);
  const predictedProd = prodNormal ? prodNormal.slope * latestSales + prodNormal.intercept : null;
  const abnormalProdCost = predictedProd != null ? productionCost[n - 1] - predictedProd : null;

  // Aggregate REM score (Roychowdhury: abs(abnormal CFO) + abs(abnormal disc exp) + abs(abnormal prod cost))
  const absComponents = [abnormalCFO, abnormalDiscExp, abnormalProdCost].filter(
    (v): v is number => v != null && Number.isFinite(v),
  ).map((v) => Math.abs(v));

  const remScore = absComponents.length > 0 ? absComponents.reduce((s, v) => s + v, 0) : null;

  // Normalize by sales to get a ratio
  const normalizedREM = remScore != null && latestSales > 0 ? remScore / Math.abs(latestSales) : null;

  // Flag: REM flag if normalized score > 10% of sales
  const remFlag = normalizedREM != null && normalizedREM > 0.10;

  let label = "Insufficient data for REM analysis.";
  if (remFlag) {
    label = `Potential real earnings management detected (REM score: ${(normalizedREM * 100).toFixed(1)}% of sales).`;
  } else if (normalizedREM != null) {
    label = `No significant REM signals (REM score: ${(normalizedREM * 100).toFixed(1)}% of sales).`;
  }

  return {
    abnormalCFO,
    abnormalDiscExp,
    abnormalProdCost,
    remScore,
    remFlag,
    label,
  };
}

/* ================================================================
   Earnings Quality Composite Scorecard
   Integrates Dechow-Dichev, Roychowdhury, and Penman-specific signals.
=============================================================== */

export interface EarningsQualityCard {
  /** 0-100 score (higher = better quality). */
  totalScore: number;
  /** Recognition timeliness (0-25). */
  timeliness: number;
  /** Neutrality/conservatism (0-25). */
  neutrality: number;
  /** Completeness/clean surplus (0-25). */
  completeness: number;
  /** Realization/cash backing (0-25). */
  realization: number;
  /** REM flag. */
  remFlag: boolean;
  /** Human-readable summary. */
  label: string;
  flags: string[];
}

export function buildEarningsQualityCard(
  ddResult: DechowDichevResult | null,
  remResult: RoychowdhuryResult | null,
  dirtySurplusPctCSE: number | null,
  cashConversionRatio: number | null,
  _accrualRatio: number | null,
): EarningsQualityCard {
  const flags: string[] = [];

  // Recognition timeliness (Dechow-Dichev R² proxy)
  let timeliness = 12; // Neutral
  if (ddResult) {
    timeliness = ddResult.rSquared * 25;
    if (ddResult.rSquared < 0.30) {
      flags.push(`Low accrual quality R² (${ddResult.rSquared.toFixed(2)}) suggests earnings lag economic events.`);
    }
  }

  // Neutrality/conservatism (REM detection)
  let neutrality = 12; // Neutral
  if (remResult) {
    neutrality = remResult.remFlag ? 5 : 20;
    if (remResult.remFlag) {
      flags.push(remResult.label);
    }
  }

  // Completeness (dirty surplus ratio)
  let completeness = 15;
  if (dirtySurplusPctCSE != null) {
    const absDS = Math.abs(dirtySurplusPctCSE);
    if (absDS < 0.02) {
      completeness = 22; // Clean surplus
    } else if (absDS < 0.05) {
      completeness = 15; // Minor dirty surplus
    } else if (absDS < 0.10) {
      completeness = 8;  // Moderate dirty surplus
      flags.push(`Dirty surplus is ${(absDS * 100).toFixed(1)}% of CSE — OCI significantly dilutes reported earnings.`);
    } else {
      completeness = 3;  // Severe dirty surplus
      flags.push(`Severe dirty surplus (${(absDS * 100).toFixed(1)}% of CSE) — earnings quality materially compromised.`);
    }
  }

  // Realization (cash conversion ratio)
  let realization = 12;
  if (cashConversionRatio != null) {
    if (cashConversionRatio >= 0.90) {
      realization = 22; // Excellent cash backing
    } else if (cashConversionRatio >= 0.70) {
      realization = 15; // Good cash backing
    } else if (cashConversionRatio >= 0.50) {
      realization = 8;  // Weak cash backing
      flags.push(`Cash conversion ratio of ${(cashConversionRatio * 100).toFixed(0)}% suggests weak cash backing of reported earnings.`);
    } else {
      realization = 3;  // Poor cash backing
      flags.push(`Very low cash conversion ratio (${(cashConversionRatio * 100).toFixed(0)}%) — earnings quality severely compromised.`);
    }
  }

  const totalScore = Math.round(timeliness + neutrality + completeness + realization);

  let label = "Earnings quality appears moderate.";
  if (totalScore >= 80) {
    label = "High earnings quality — Earnings are timely, neutral, complete, and well-realized in cash.";
  } else if (totalScore >= 60) {
    label = "Moderate earnings quality — Some concerns around timeliness, neutrality, or cash realization.";
  } else if (totalScore >= 40) {
    label = "Low earnings quality — Material concerns across multiple dimensions.";
  } else {
    label = "Very low earnings quality — Earnings are unreliable for valuation purposes.";
  }

  if (ddResult) flags.unshift(`Accrual quality R²: ${ddResult.rSquared.toFixed(2)} (${ddResult.label})`);

  return {
    totalScore: Math.max(0, Math.min(100, totalScore)),
    timeliness: Math.round(timeliness * 4) / 4,
    neutrality: Math.round(neutrality * 4) / 4,
    completeness: Math.round(completeness * 4) / 4,
    realization: Math.round(realization * 4) / 4,
    remFlag: remResult?.remFlag ?? false,
    label,
    flags,
  };
}

/* ================================================================
   Builder: Extract series from RecastPeriod[] and run DD + REM
=============================================================== */

export interface DechowDichevAndRemResults {
  ddResult: DechowDichevResult | null;
  remResult: RoychowdhuryResult | null;
}

/**
 * Extract multi-period time series from RecastPeriod[] and run
 * both Dechow-Dichev accrual quality and Roychowdhury REM tests.
 *
 * CFO = period.cf.CFO
 * WCA = d(Inventory + TradeReceivables) - d(TradePayables + ProvisionsCurrent)
 * DiscretionaryExpense = sgaAdvertising + sgaLegalProfessional (SG&A)
 * ProductionCost = COGS + dInventory (inventory build-up proxy for overproduction)
 */
export function buildDechowDichevAndRem(
  periods: RecastPeriod[],
): DechowDichevAndRemResults {
  if (!periods || periods.length < 5) {
    return { ddResult: null, remResult: null };
  }

  // Sort chronologically (oldest first)
  const sorted = [...periods].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  // Build CFO, WCA, and REM series
  const cfoSeries: number[] = [];
  const wcaSeries: number[] = [];
  const salesSeries: number[] = [];
  const discExpenseSeries: number[] = [];
  const prodCostSeries: number[] = [];

  let prevOperatingWC: number | null = null;

  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i];
    cfoSeries.push(p.cf.CFO ?? 0);
    salesSeries.push(p.is.Sales ?? 0);

    // Operating working capital = Inventory + Receivables - Payables - Provisions
    const inv = p.bs.Inventory ?? 0;
    const rec = p.bs.TradeReceivables ?? 0;
    const pay = p.bs.TradePayables ?? 0;
    const prov = p.bs.OL_ProvisionsCurrent ?? 0;
    const operatingWC = inv + rec - pay - prov;

    // WCA = change in operating working capital
    if (prevOperatingWC != null) {
      wcaSeries.push(operatingWC - prevOperatingWC);
    } else {
      wcaSeries.push(operatingWC);
    }
    prevOperatingWC = operatingWC;

    // Discretionary expense: SG&A advertising or total SG&A
    const sgaAdv = p.is.operatingCostBridge?.sgaAdvertising ?? 0;
    const sgaTotal = p.is.operatingCostBridge?.sgaDetailed ?? 0;
    discExpenseSeries.push(sgaAdv > 0 ? sgaAdv : sgaTotal > 0 ? sgaTotal : 0);

    // Production cost: COGS + increase in inventory
    const prevInv = i > 0 ? sorted[i - 1].bs.Inventory ?? 0 : inv;
    prodCostSeries.push(p.is.COGS + Math.max(inv - prevInv, 0));
  }

  const ddResult = dechowDichevQuality(cfoSeries, wcaSeries);

  const remResult = roychowdhuryREM(
    salesSeries,
    cfoSeries,
    discExpenseSeries,
    prodCostSeries,
  );

  return { ddResult, remResult };
}

/* ================================================================
   Helper: Simple linear regression via OLS
=============================================================== */

interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

function simpleRegression(x: number[], y: number[]): RegressionResult | null {
  const n = x.length;
  if (n < 2) return null;

  const valid: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) valid.push([x[i], y[i]]);
  }
  if (valid.length < 2) return null;

  const m = valid.length;
  const meanX = valid.reduce((s, [v]) => s + v, 0) / m;
  const meanY = valid.reduce((s, [, v]) => s + v, 0) / m;

  let ssxx = 0;
  let ssxy = 0;
  let ssyy = 0;
  for (const [xi, yi] of valid) {
    const dx = xi - meanX;
    const dy = yi - meanY;
    ssxx += dx * dx;
    ssxy += dx * dy;
    ssyy += dy * dy;
  }

  const slope = ssxx > 0 ? ssxy / ssxx : 0;
  const intercept = meanY - slope * meanX;
  const rSquared = ssyy > 0 ? Math.max(0, 1 - valid.reduce((s, [xi, yi]) => {
    const pred = intercept + slope * xi;
    return s + (yi - pred) ** 2;
  }, 0) / ssyy) : 0;

  return { slope, intercept, rSquared };
}
