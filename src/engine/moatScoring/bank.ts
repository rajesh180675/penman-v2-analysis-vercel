/**
 * Economic Moat Scoring — bank/NBFC scorer (ROE-based).
 */

import { EngineConfig } from "../types";
import { resolveCostOfCapitalFromConfig } from "../costOfCapital";
import { BankPeriodMetrics } from "../bankPipeline";
import { BankMoatResult } from "./types";
import { medianOf, stdDev, clamp, estimatePhi, estimateCAP, computeTrend } from "./stats";
import { classifyMoatWidth } from "./dimensions";

// ─── Bank Moat ────────────────────────────────────────────────────────────────

/**
 * Compute moat score for a bank/NBFC using ROE-based analysis.
 * ROE spread = ROE − ke (analogous to RNOA − kw for industrials)
 */
export function computeBankMoatScore(
  bankMetrics: BankPeriodMetrics[],
  config: EngineConfig,
): BankMoatResult | null {
  if (!bankMetrics || bankMetrics.length < 3) return null;

  const notes: string[] = [];
  const ke = resolveCostOfCapitalFromConfig({ config }).ke;

  const sorted = [...bankMetrics].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime()
  );

  const roeValues: number[] = [];
  const roeSpreadValues: number[] = [];

  for (const m of sorted) {
    if (m.roe != null && Number.isFinite(m.roe)) {
      roeValues.push(m.roe);
      roeSpreadValues.push(m.roe - ke);
    }
  }

  if (!roeValues.length) return null;

  const medianROE       = medianOf(roeValues);
  const medianROESpread = medianOf(roeSpreadValues);
  const periodsAboveKe  = roeValues.filter(v => v > ke).length;
  const totalPeriods    = sorted.length;

  // Composite score: median ROE spread (0–50), % above ke (0–30), stability (0–20)
  const spreadScore = clamp(((medianROESpread ?? 0) / 0.08) * 50, 0, 50);
  const pctScore    = (periodsAboveKe / totalPeriods) * 30;
  const sd          = stdDev(roeValues) ?? 0;
  const stabScore   = clamp((1 - sd / 0.05) * 20, 0, 20);
  const compositeScore = Math.round(spreadScore + pctScore + stabScore);

  const moatWidth = classifyMoatWidth(
    compositeScore,
    periodsAboveKe,
    // Review W10: ROE-ke gradient is wider than RNOA-kw, so "strong spread"
    // for banks is +7% above ke (vs +5% for industrial RNOA-kw). Using 0.05
    // here would let routine ROE leakage above cost-of-equity register as
    // strong-moat evidence and inflate bank moat-width classifications.
    roeValues.filter(v => v > ke + 0.07).length,
    totalPeriods,
  );

  // CAP for bank: use ROE series
  const phi = estimatePhi(roeValues);
  const latestROE = roeValues[roeValues.length - 1]!;
  const cap = estimateCAP(latestROE, ke, phi, roeValues);

  const moatTrend = computeTrend(roeSpreadValues);

  if (roeValues.length < 5) notes.push("Fewer than 5 periods with ROE — bank moat assessment less reliable");

  return {
    compositeScore: clamp(compositeScore, 0, 100),
    moatWidth,
    medianROE,
    medianROESpread,
    periodsAboveKe,
    totalPeriods,
    cap,
    moatTrend,
    notes,
  };
}
