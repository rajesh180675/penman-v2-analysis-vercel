/**
 * Structural Break Detector — Phase I robustness
 *
 * Reliance Industries FY2024: book equity dropped ~₹1.4 L Cr after the
 * Jio Financial Services spinoff. Without flagging this, every
 * Penman-Nissim period-over-period ratio (RNOA, ROE, asset turnover,
 * capital allocation) treats it as a real economic event, and time-
 * series persistence calculations get poisoned.
 *
 * Other canonical Indian cases:
 *   - Hindalco demerger of Aditya Birla Capital (FY2018)
 *   - Bajaj Holdings split into Bajaj Finserv + Bajaj Auto (FY2008)
 *   - Wipro Enterprises spinoff from Wipro Ltd (FY2013)
 *   - Tata Communications Internet spinoff (FY2024)
 *   - Reliance Capital (Anil Ambani group) restructuring
 *
 * This module flags periods where a financial metric jumps by more than
 * a configured threshold versus the prior year, and suggests excluding
 * that transition from time-series persistence calculations.
 *
 * It does NOT auto-recompute the recast — that's a downstream choice.
 * Just flags so the UI can surface "this YoY change is too large to be
 * organic; verify if M&A / demerger / IFRS-16 lease capitalization."
 */

import type { RecastPeriod } from "./types";

export type StructuralBreakKind =
  | "equity-drop"
  | "equity-jump"
  | "revenue-drop"
  | "revenue-jump"
  | "asset-base-drop"
  | "asset-base-jump";

export interface StructuralBreak {
  /** Period where the break was detected (the latter of the YoY pair). */
  period_end: string;
  /** Prior period (the earlier of the YoY pair). */
  priorPeriod_end: string;
  /** Type of break. */
  kind: StructuralBreakKind;
  /** YoY change as a fraction (e.g. -0.35 = 35% drop). */
  yoyChange: number;
  /** Metric value at the break period. */
  currentValue: number;
  /** Metric value at the prior period. */
  priorValue: number;
  /** Human-readable reason. */
  reason: string;
}

export interface StructuralBreakAssessment {
  /** All detected breaks across the series, in chronological order. */
  breaks: StructuralBreak[];
  /** True when at least one period flagged. */
  hasBreaks: boolean;
  /** Periods that are part of a break transition. UI uses this to grey them out. */
  affectedPeriods: Set<string>;
  /** Suggested action when breaks exist. */
  recommendation: string;
}

/** Default thresholds. Equity is more sensitive than revenue because demergers
 *  hit equity directly while revenue can survive a spinoff via licensing. */
const DEFAULT_THRESHOLDS = {
  equityDrop: -0.30,    // ≥30% YoY drop in CSE
  equityJump: 0.50,     // ≥50% YoY jump (often capital raise / IFRS-16 transition)
  revenueDrop: -0.30,   // ≥30% YoY drop in Sales
  revenueJump: 0.60,    // ≥60% YoY jump (M&A acquisition closing)
  noaDrop: -0.40,       // ≥40% YoY drop in NOA (asset spinoff)
  noaJump: 0.60,        // ≥60% YoY jump (acquisition)
};

function pctChange(curr: number, prev: number): number | null {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (prev === 0) return null;
  return (curr - prev) / Math.abs(prev);
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Detect structural breaks in a recast period series.
 *
 * Returns a structured assessment. Caller decides how to use it:
 *   - UI: render warning banner with affected periods
 *   - Persistence calculations: exclude break periods from rolling stats
 *   - Forecasting: anchor on post-break period rather than blending across
 */
export function detectStructuralBreaks(
  periods: RecastPeriod[] | null | undefined,
  thresholds: Partial<typeof DEFAULT_THRESHOLDS> = {},
): StructuralBreakAssessment {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const breaks: StructuralBreak[] = [];

  if (!periods || periods.length < 2) {
    return {
      breaks: [],
      hasBreaks: false,
      affectedPeriods: new Set(),
      recommendation: "Need ≥2 periods to detect structural breaks.",
    };
  }

  const sorted = [...periods].sort(
    (a, b) =>
      new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const prev = sorted[i - 1];

    // Equity (CSE)
    const cseChange = pctChange(curr.bs?.CSE ?? NaN, prev.bs?.CSE ?? NaN);
    if (cseChange != null) {
      if (cseChange <= t.equityDrop) {
        breaks.push({
          period_end: curr.period_end,
          priorPeriod_end: prev.period_end,
          kind: "equity-drop",
          yoyChange: cseChange,
          currentValue: curr.bs.CSE,
          priorValue: prev.bs.CSE,
          reason: `Common shareholders' equity dropped ${fmtPct(cseChange)} YoY (₹${prev.bs.CSE.toFixed(0)} Cr → ₹${curr.bs.CSE.toFixed(0)} Cr). Likely demerger, large dividend, or capital reduction.`,
        });
      } else if (cseChange >= t.equityJump) {
        breaks.push({
          period_end: curr.period_end,
          priorPeriod_end: prev.period_end,
          kind: "equity-jump",
          yoyChange: cseChange,
          currentValue: curr.bs.CSE,
          priorValue: prev.bs.CSE,
          reason: `Common shareholders' equity jumped ${fmtPct(cseChange)} YoY (₹${prev.bs.CSE.toFixed(0)} Cr → ₹${curr.bs.CSE.toFixed(0)} Cr). Likely large capital raise (IPO/QIP/rights), revaluation reserve, or accounting standard transition.`,
        });
      }
    }

    // Revenue (Sales)
    const salesChange = pctChange(curr.is?.Sales ?? NaN, prev.is?.Sales ?? NaN);
    if (salesChange != null && (curr.is?.Sales ?? 0) > 0 && (prev.is?.Sales ?? 0) > 0) {
      if (salesChange <= t.revenueDrop) {
        breaks.push({
          period_end: curr.period_end,
          priorPeriod_end: prev.period_end,
          kind: "revenue-drop",
          yoyChange: salesChange,
          currentValue: curr.is.Sales,
          priorValue: prev.is.Sales,
          reason: `Revenue dropped ${fmtPct(salesChange)} YoY. Likely segment divestiture, demerger of operating business, or COVID-magnitude demand shock.`,
        });
      } else if (salesChange >= t.revenueJump) {
        breaks.push({
          period_end: curr.period_end,
          priorPeriod_end: prev.period_end,
          kind: "revenue-jump",
          yoyChange: salesChange,
          currentValue: curr.is.Sales,
          priorValue: prev.is.Sales,
          reason: `Revenue jumped ${fmtPct(salesChange)} YoY. Likely M&A closing or segment reclassification.`,
        });
      }
    }

    // Net Operating Assets (NOA)
    const noaChange = pctChange(curr.bs?.NOA ?? NaN, prev.bs?.NOA ?? NaN);
    if (noaChange != null) {
      if (noaChange <= t.noaDrop) {
        breaks.push({
          period_end: curr.period_end,
          priorPeriod_end: prev.period_end,
          kind: "asset-base-drop",
          yoyChange: noaChange,
          currentValue: curr.bs.NOA,
          priorValue: prev.bs.NOA,
          reason: `Net operating assets dropped ${fmtPct(noaChange)} YoY. Likely spinoff of operating subsidiary or major divestiture.`,
        });
      } else if (noaChange >= t.noaJump) {
        breaks.push({
          period_end: curr.period_end,
          priorPeriod_end: prev.period_end,
          kind: "asset-base-jump",
          yoyChange: noaChange,
          currentValue: curr.bs.NOA,
          priorValue: prev.bs.NOA,
          reason: `Net operating assets jumped ${fmtPct(noaChange)} YoY. Likely M&A acquisition or IFRS-16 lease capitalization (FY2020 transition for many companies).`,
        });
      }
    }
  }

  const affectedPeriods = new Set<string>(
    breaks.flatMap((b) => [b.priorPeriod_end, b.period_end]),
  );

  let recommendation = "No structural breaks detected.";
  if (breaks.length > 0) {
    const yearsAffected = new Set(
      breaks.map((b) => b.period_end.slice(0, 4)),
    ).size;
    recommendation =
      `${breaks.length} structural break(s) detected across ${yearsAffected} period(s). ` +
      `Time-series persistence (RNOA fade, ROE durability, growth trends) and Penman-Nissim ` +
      `terminal-value derivations should anchor on post-break periods only. Consider uploading ` +
      `pre-break and post-break entities as separate company records if both eras are material.`;
  }

  return {
    breaks,
    hasBreaks: breaks.length > 0,
    affectedPeriods,
    recommendation,
  };
}
