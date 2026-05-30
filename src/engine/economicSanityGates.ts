/**
 * Economic Sanity Gates — Gap 2 / PR-B
 *
 * Structural reconciliation says "the math adds up." Economic sanity says
 * "the math is meaningful." Terminal-period contamination (e.g. a one-time
 * impairment in the most recent period) silently corrupts terminal value
 * and hence intrinsic value.
 *
 * Five checks per period, walked latest → oldest until a clean anchor is
 * found within the lookback window:
 *
 *   A) terminal-period-contamination   — major capital transaction in latest period
 *   B) dirty-surplus-integrity         — sustained large dirty-surplus residual
 *   C) implausible-rnoa-jump           — RNOA jumps ≥30pp without a known cause
 *   D) demerger-discontinued-contamination — manifest flags discontinued ops
 *   E) anchor-period-selection         — walks back until a passing period
 *
 * When `status === "blocked"` and `isEnabled("rigor.economicSanityBlock")`,
 * the run cannot reach `economically-plausible`.
 */

import {
  BUYBACK_PCT_OF_CSE,
  CorporateActionEvent,
  RIGHTS_PCT_OF_CSE,
} from "./corporateActions";
import { computeFCFEDirtySurplus } from "./fcfeDirtySurplus";
import { RawPeriodData, RecastPeriod } from "./types";
import { periodMetricValue } from "./rawMetricTools";

// Types relocated to ./types/economicSanity (pure leaf, weakness #1 cycle break).
// Imported back for internal use; re-exported so existing "./economicSanityGates" paths stay valid.
import type {
  GateCheckId,
  GateCheckResult,
  EconomicSanitySummary,
} from "./types/economicSanity";
export type {
  GateCheckId,
  GateCheckResult,
  EconomicSanitySummary,
};

/** Maximum periods we walk back from latest looking for a clean anchor.
 *  Beyond this, the run is blocked even if some older period is clean. */
export const MAX_ANCHOR_LOOKBACK_PERIODS = 3;

/** RNOA-jump threshold (in absolute percentage points). */
export const RNOA_JUMP_THRESHOLD = 0.30;

/** Dirty-surplus residual ratio threshold (vs CSE) sustained across consecutive years. */
export const DIRTY_SURPLUS_RESIDUAL_PCT_OF_CSE = 0.04;
export const DIRTY_SURPLUS_CONSECUTIVE_YEARS = 2;

/**
 * Optional manifest of unusual items by period (Gap 3 / PR-C will populate
 * this). When provided, Check A treats `affectsTerminalEligibility` items as
 * additional contamination signals; Check C suppresses RNOA-jump warnings
 * if a known unusual item explains the jump.
 */
export interface UnusualItemManifestLike {
  period: string;
  affectsTerminalEligibility: boolean;
  category: string;
}

interface EvaluateInput {
  periods: RecastPeriod[];
  rawData: RawPeriodData[];
  corporateActions?: CorporateActionEvent[] | undefined;
  unusualManifest?: UnusualItemManifestLike[] | undefined;
}

/**
 * Run the five checks for a single period and return per-check verdicts.
 * The caller (`evaluateEconomicSanity`) walks periods latest → oldest.
 */
function checksForPeriod(
  current: RecastPeriod,
  prev: RecastPeriod | null,
  context: EvaluateInput,
): GateCheckResult[] {
  const checks: GateCheckResult[] = [];

  // ─── Check A: terminal-period-contamination ─────────────────────────────
  // Major capital transaction (buyback ≥5% CSE OR rights ≥10% CSE) in this
  // period contaminates it as an anchor. Also fires on Gap-3 unusual items
  // marked affectsTerminalEligibility.
  const cse = current.bs.CSE;
  const buyback = -1 * (current.cf.ShareBuybacks ?? 0); // outflow stored negative
  const rights = current.cf.EquityIssued ?? 0;
  const buybackRatio = cse > 0 ? Math.abs(buyback) / cse : 0;
  const rightsRatio = cse > 0 ? Math.abs(rights) / cse : 0;
  const knownAction = (context.corporateActions ?? []).find(
    (a) => a.periodEnd === current.period_end && (a.kind === "buyback" || a.kind === "capital-raise" || a.kind === "dilution"),
  );
  const unusualBlocking = (context.unusualManifest ?? []).filter(
    (u) => u.period === current.period_end && u.affectsTerminalEligibility,
  );
  const aIssues: string[] = [];
  if (buybackRatio >= BUYBACK_PCT_OF_CSE) {
    aIssues.push(`buyback ≈ ${(buybackRatio * 100).toFixed(1)}% of CSE`);
  }
  if (rightsRatio >= RIGHTS_PCT_OF_CSE) {
    aIssues.push(`equity issuance ≈ ${(rightsRatio * 100).toFixed(1)}% of CSE`);
  }
  if (knownAction && aIssues.length === 0) {
    aIssues.push(`detected ${knownAction.kind} (${knownAction.detail})`);
  }
  if (unusualBlocking.length > 0) {
    aIssues.push(`unusual items affecting terminal: ${unusualBlocking.map((u) => u.category).join(", ")}`);
  }
  checks.push({
    checkId: "terminal-period-contamination",
    passed: aIssues.length === 0,
    reason:
      aIssues.length === 0
        ? "No major capital transaction or terminal-blocking unusual items in this period."
        : `Major capital event(s) in this period: ${aIssues.join("; ")}`,
    severity: "block",
    affectedPeriods: [current.period_end],
  });

  // ─── Check B: dirty-surplus-integrity ───────────────────────────────────
  // Reuse fcfeDirtySurplus residual computation. We flag when the ratio of
  // dirty surplus to CSE is large for two consecutive periods.
  const fcfe = prev ? computeFCFEDirtySurplus(current, prev) : null;
  const dirtyRatio =
    fcfe?.dirtySurplus != null && cse > 0 ? Math.abs(fcfe.dirtySurplus) / cse : 0;
  // We can only flag "consecutive years" if we have prev — single-year spikes
  // are warnings, not blocks. Block requires two-year sustained signal which
  // we evaluate at the run level (see post-loop merge below).
  checks.push({
    checkId: "dirty-surplus-integrity",
    passed: dirtyRatio < DIRTY_SURPLUS_RESIDUAL_PCT_OF_CSE,
    reason:
      dirtyRatio >= DIRTY_SURPLUS_RESIDUAL_PCT_OF_CSE
        ? `Dirty-surplus residual is ${(dirtyRatio * 100).toFixed(1)}% of CSE (threshold ${(DIRTY_SURPLUS_RESIDUAL_PCT_OF_CSE * 100).toFixed(0)}%).`
        : `Dirty-surplus residual is within threshold.`,
    severity: "warn",
    affectedPeriods: [current.period_end],
  });

  // ─── Check C: implausible-rnoa-jump ─────────────────────────────────────
  // |RNOA_t - RNOA_{t-1}| ≥ 30pp without a known capital event or unusual
  // item. With a cause, suppress (no warn).
  const rnoaCur = current.ratios?.RNOA ?? null;
  const rnoaPrev = prev?.ratios?.RNOA ?? null;
  let rnoaJumpReason = "RNOA stayed within plausible bounds period-on-period.";
  let rnoaPassed = true;
  if (rnoaCur != null && rnoaPrev != null) {
    const jump = Math.abs(rnoaCur - rnoaPrev);
    if (jump >= RNOA_JUMP_THRESHOLD) {
      const causeKnown = Boolean(knownAction) || unusualBlocking.length > 0;
      if (!causeKnown) {
        rnoaPassed = false;
        rnoaJumpReason = `RNOA jumped ${(jump * 100).toFixed(1)}pp from ${(rnoaPrev * 100).toFixed(1)}% to ${(rnoaCur * 100).toFixed(1)}% with no known capital event or unusual item.`;
      } else {
        rnoaJumpReason = `RNOA jumped ${(jump * 100).toFixed(1)}pp; suppressed because a capital event or unusual item explains it.`;
      }
    }
  }
  checks.push({
    checkId: "implausible-rnoa-jump",
    passed: rnoaPassed,
    reason: rnoaJumpReason,
    severity: "warn",
    affectedPeriods: [current.period_end],
  });

  // ─── Check D: demerger-discontinued-contamination ───────────────────────
  // We look in raw_metric_values for discontinued-operations / demerger flags
  // surfaced by the parser. Gap 3 (PR-C) will replace this with an explicit
  // manifest; for now we use a label heuristic + the unusual-manifest input.
  const raw = context.rawData.find((r) => r.period_end === current.period_end);
  const discontinuedSignal = raw
    ? periodMetricValue(raw, [
        "Profit / (Loss) From Discontinued Operations",
        "Profit Loss from Discontinued Operations",
        "Demerger Adjustment",
        "Net Profit/(Loss) for the Period from Discontinued Operations",
      ])
    : null;
  const manifestDemerger = (context.unusualManifest ?? []).some(
    (u) => u.period === current.period_end && (u.category === "demerger-scheme-effect" || u.category === "discontinued-operations"),
  );
  const dPassed = (discontinuedSignal == null || Math.abs(discontinuedSignal) < 1) && !manifestDemerger;
  checks.push({
    checkId: "demerger-discontinued-contamination",
    passed: dPassed,
    reason: dPassed
      ? "No demerger or discontinued-operations signal detected for this period."
      : `Demerger / discontinued-operations signal detected${
          discontinuedSignal != null ? ` (₹${discontinuedSignal.toFixed(0)})` : ""
        }.`,
    severity: "block",
    affectedPeriods: [current.period_end],
  });

  return checks;
}

/**
 * Walks periods latest → oldest until it finds a period that passes ALL
 * block-severity checks within `MAX_ANCHOR_LOOKBACK_PERIODS`. Warn-severity
 * failures do not disqualify a candidate but are carried forward.
 */
export function evaluateEconomicSanity(
  periods: RecastPeriod[],
  rawData: RawPeriodData[],
  corporateActions?: CorporateActionEvent[] | undefined,
  unusualManifest?: UnusualItemManifestLike[] | undefined,
): EconomicSanitySummary {
  if (!periods.length) {
    return {
      status: "blocked",
      anchorPeriod: null,
      anchorReason: "No recast periods available — anchor cannot be selected.",
      skippedPeriods: [],
      failedChecks: [],
    };
  }

  const ctx: EvaluateInput = { periods, rawData, corporateActions, unusualManifest };
  // Sort ascending by period_end so we can index from the end.
  const ordered = [...periods].sort((a, b) =>
    a.period_end.localeCompare(b.period_end),
  );

  const skipped: { period: string; reason: string }[] = [];
  const allWarnings: GateCheckResult[] = [];
  let anchor: RecastPeriod | null = null;
  let anchorReason = "";
  const lookbackLimit = Math.min(ordered.length, MAX_ANCHOR_LOOKBACK_PERIODS + 1);

  for (let lookbackIdx = 0; lookbackIdx < lookbackLimit; lookbackIdx++) {
    const idx = ordered.length - 1 - lookbackIdx;
    if (idx < 0) break;
    const current = ordered[idx]!;
    const prev = idx > 0 ? ordered[idx - 1]! : null;
    const checks = checksForPeriod(current, prev, ctx);
    const blocking = checks.filter((c) => c.severity === "block" && !c.passed);
    const warnings = checks.filter((c) => c.severity === "warn" && !c.passed);
    if (blocking.length === 0) {
      anchor = current;
      anchorReason =
        lookbackIdx === 0
          ? `Latest period ${current.period_end} cleared all block-severity checks.`
          : `Walked back ${lookbackIdx} period(s); ${current.period_end} cleared all block-severity checks.`;
      // Carry warnings from the anchor period only — older warnings are
      // logged via skippedPeriods.
      allWarnings.push(...warnings);
      break;
    } else {
      skipped.push({
        period: current.period_end,
        reason: blocking.map((c) => c.checkId).join(","),
      });
      // Aggregate failed checks for visibility in the envelope.
      allWarnings.push(...blocking, ...warnings);
    }
  }

  if (!anchor) {
    return {
      status: "blocked",
      anchorPeriod: null,
      anchorReason: `No clean period found within ${MAX_ANCHOR_LOOKBACK_PERIODS}-period lookback. Skipped: ${skipped
        .map((s) => `${s.period} (${s.reason})`)
        .join("; ")}`,
      skippedPeriods: skipped,
      failedChecks: allWarnings,
    };
  }

  // Sustained dirty-surplus block: if the anchor period's prior period also
  // breached the dirty-surplus threshold, escalate to block.
  const anchorIdx = ordered.indexOf(anchor);
  if (anchorIdx > 0) {
    const prev = ordered[anchorIdx - 1]!;
    const prevChecks = checksForPeriod(prev, anchorIdx - 2 >= 0 ? ordered[anchorIdx - 2]! : null, ctx);
    const dirtyHere = checksForPeriod(anchor, prev, ctx).find((c) => c.checkId === "dirty-surplus-integrity");
    const dirtyPrev = prevChecks.find((c) => c.checkId === "dirty-surplus-integrity");
    if (dirtyHere && dirtyPrev && !dirtyHere.passed && !dirtyPrev.passed) {
      // Promote to block: append a synthetic block-severity check.
      const sustained: GateCheckResult = {
        checkId: "dirty-surplus-integrity",
        passed: false,
        severity: "block",
        affectedPeriods: [prev.period_end, anchor.period_end],
        reason: `Dirty-surplus residual exceeded threshold for ${DIRTY_SURPLUS_CONSECUTIVE_YEARS} consecutive years (${prev.period_end}, ${anchor.period_end}).`,
      };
      return {
        status: "blocked",
        anchorPeriod: null,
        anchorReason: `Anchor ${anchor.period_end} would have qualified, but sustained dirty-surplus residual blocks the run.`,
        skippedPeriods: [...skipped, { period: anchor.period_end, reason: sustained.checkId }],
        failedChecks: [...allWarnings, sustained],
      };
    }
  }

  const anchorWarnings = allWarnings.filter((c) => c.affectedPeriods.includes(anchor!.period_end));
  const status: EconomicSanitySummary["status"] = anchorWarnings.length > 0 ? "warned" : "passed";

  return {
    status,
    anchorPeriod: anchor.period_end,
    anchorReason,
    skippedPeriods: skipped,
    failedChecks: allWarnings,
  };
}
