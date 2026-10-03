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
 * Banks, NBFCs and insurers run `evaluateFinancialEconomicSanity` on their
 * bank-shape metrics instead (A and D unchanged, an ROE jump for C, no B).
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
import type { BankPeriodMetrics } from "./bankPipeline/metrics";

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

interface ContextLike {
  rawData: RawPeriodData[];
  corporateActions?: CorporateActionEvent[] | undefined;
  unusualManifest?: UnusualItemManifestLike[] | undefined;
}

function knownCapitalAction(periodEnd: string, context: ContextLike): CorporateActionEvent | undefined {
  return (context.corporateActions ?? []).find(
    (a) => a.periodEnd === periodEnd && (a.kind === "buyback" || a.kind === "capital-raise" || a.kind === "dilution"),
  );
}

function terminalUnusualItems(periodEnd: string, context: ContextLike): UnusualItemManifestLike[] {
  return (context.unusualManifest ?? []).filter((u) => u.period === periodEnd && u.affectsTerminalEligibility);
}

/** Check A's verdict from the period's terminal-blocking unusual items and its capital-transaction notes. */
function terminalContaminationCheck(
  periodEnd: string,
  unusualBlocking: readonly UnusualItemManifestLike[],
  capitalNotes: readonly string[],
): GateCheckResult {
  const aIssues: string[] = [];
  if (unusualBlocking.length > 0) {
    aIssues.push(`unusual items affecting terminal: ${unusualBlocking.map((u) => u.category).join(", ")}`);
  }
  const capitalNote = capitalNotes.length > 0 ? ` Capital transaction noted, not disqualifying: ${capitalNotes.join("; ")}.` : "";
  return {
    checkId: "terminal-period-contamination",
    passed: aIssues.length === 0,
    reason:
      aIssues.length === 0
        ? `No terminal-blocking unusual items in this period.${capitalNote}`
        : `Terminal-blocking event(s) in this period: ${aIssues.join("; ")}.${capitalNote}`,
    severity: "block",
    affectedPeriods: [periodEnd],
  };
}

/**
 * Check D. We look in raw_metric_values for discontinued-operations / demerger
 * flags surfaced by the parser. Gap 3 (PR-C) will replace this with an explicit
 * manifest; for now we use a label heuristic + the unusual-manifest input.
 */
function demergerDiscontinuedCheck(periodEnd: string, context: ContextLike): GateCheckResult {
  const raw = context.rawData.find((r) => r.period_end === periodEnd);
  const discontinuedSignal = raw
    ? periodMetricValue(raw, [
        "Profit / (Loss) From Discontinued Operations",
        "Profit Loss from Discontinued Operations",
        "Demerger Adjustment",
        "Net Profit/(Loss) for the Period from Discontinued Operations",
      ])
    : null;
  const manifestDemerger = (context.unusualManifest ?? []).some(
    (u) => u.period === periodEnd && (u.category === "demerger-scheme-effect" || u.category === "discontinued-operations"),
  );
  const dPassed = (discontinuedSignal == null || Math.abs(discontinuedSignal) < 1) && !manifestDemerger;
  return {
    checkId: "demerger-discontinued-contamination",
    passed: dPassed,
    reason: dPassed
      ? "No demerger or discontinued-operations signal detected for this period."
      : `Demerger / discontinued-operations signal detected${
          discontinuedSignal != null ? ` (₹${discontinuedSignal.toFixed(0)})` : ""
        }.`,
    severity: "block",
    affectedPeriods: [periodEnd],
  };
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
  // Fires on Gap-3 unusual items marked affectsTerminalEligibility. A major
  // capital transaction with owners (buyback ≥5% CSE, equity issuance ≥10%,
  // a detected capital action) is noted in the reason but does not fail the
  // check: it changes the balance sheet's financing, not the operating
  // earnings the anchor capitalizes — the policy S-5.1/S-5.2 and the
  // unusual-item classifier apply to buybacks and capital returns (#360, #367).
  const cse = current.bs.CSE;
  const buyback = -1 * (current.cf.ShareBuybacks ?? 0); // outflow stored negative
  const rights = current.cf.EquityIssued ?? 0;
  const buybackRatio = cse > 0 ? Math.abs(buyback) / cse : 0;
  const rightsRatio = cse > 0 ? Math.abs(rights) / cse : 0;
  const knownAction = knownCapitalAction(current.period_end, context);
  const unusualBlocking = terminalUnusualItems(current.period_end, context);
  const capitalNotes: string[] = [];
  if (buybackRatio >= BUYBACK_PCT_OF_CSE) {
    capitalNotes.push(`buyback ≈ ${(buybackRatio * 100).toFixed(1)}% of CSE`);
  }
  if (rightsRatio >= RIGHTS_PCT_OF_CSE) {
    capitalNotes.push(`equity issuance ≈ ${(rightsRatio * 100).toFixed(1)}% of CSE`);
  }
  if (knownAction && capitalNotes.length === 0) {
    capitalNotes.push(`detected ${knownAction.kind} (${knownAction.detail})`);
  }
  checks.push(terminalContaminationCheck(current.period_end, unusualBlocking, capitalNotes));

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
  checks.push(demergerDiscontinuedCheck(current.period_end, context));

  return checks;
}

type AnchorWalk<P> =
  | { anchor: P; anchorReason: string; skipped: { period: string; reason: string }[]; failedChecks: GateCheckResult[] }
  | { anchor: null; blocked: EconomicSanitySummary };

/**
 * Walks `ordered` (ascending by period_end) latest → oldest until a period
 * passes ALL block-severity checks within `MAX_ANCHOR_LOOKBACK_PERIODS`.
 * Warn-severity failures do not disqualify a candidate but are carried forward.
 */
function walkForAnchor<P extends { period_end: string }>(
  ordered: readonly P[],
  checksFor: (current: P, prev: P | null) => GateCheckResult[],
): AnchorWalk<P> {
  const skipped: { period: string; reason: string }[] = [];
  const failedChecks: GateCheckResult[] = [];
  const lookbackLimit = Math.min(ordered.length, MAX_ANCHOR_LOOKBACK_PERIODS + 1);

  for (let lookbackIdx = 0; lookbackIdx < lookbackLimit; lookbackIdx++) {
    const idx = ordered.length - 1 - lookbackIdx;
    if (idx < 0) break;
    const current = ordered[idx]!;
    const prev = idx > 0 ? ordered[idx - 1]! : null;
    const checks = checksFor(current, prev);
    const blocking = checks.filter((c) => c.severity === "block" && !c.passed);
    const warnings = checks.filter((c) => c.severity === "warn" && !c.passed);
    // Warnings are carried from the anchor and from skipped periods; a skipped
    // period's blocking checks are captured in skipped[].reason.
    failedChecks.push(...warnings);
    if (blocking.length === 0) {
      const anchorReason =
        lookbackIdx === 0
          ? `Latest period ${current.period_end} cleared all block-severity checks.`
          : `Walked back ${lookbackIdx} period(s); ${current.period_end} cleared all block-severity checks.`;
      return { anchor: current, anchorReason, skipped, failedChecks };
    }
    skipped.push({
      period: current.period_end,
      reason: blocking.map((c) => c.checkId).join(","),
    });
  }

  return {
    anchor: null,
    blocked: {
      status: "blocked",
      anchorPeriod: null,
      anchorReason: `No clean period found within ${MAX_ANCHOR_LOOKBACK_PERIODS}-period lookback. Skipped: ${skipped
        .map((s) => `${s.period} (${s.reason})`)
        .join("; ")}`,
      skippedPeriods: skipped,
      failedChecks,
    },
  };
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

  const walk = walkForAnchor(ordered, (current, prev) => checksForPeriod(current, prev, ctx));
  if (walk.anchor === null) return walk.blocked;
  const { anchor, anchorReason, skipped, failedChecks: allFailedChecks } = walk;

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
        failedChecks: [...allFailedChecks, sustained],
      };
    }
  }

  const anchorWarnings = allFailedChecks.filter((c) => c.affectedPeriods.includes(anchor.period_end));
  const status: EconomicSanitySummary["status"] = anchorWarnings.length > 0 ? "warned" : "passed";

  return {
    status,
    anchorPeriod: anchor.period_end,
    anchorReason,
    skippedPeriods: skipped,
    failedChecks: allFailedChecks,
  };
}

/** ROE-jump threshold for financial institutions (absolute), Check C's analogue. */
export const ROE_JUMP_THRESHOLD = RNOA_JUMP_THRESHOLD;

/**
 * Economic sanity for banks, NBFCs and insurers, on their bank-shape metrics.
 *
 * They never produce a Penman-Nissim recast, so `evaluateEconomicSanity`
 * blocked every one of them at "No recast periods available": the shape
 * mismatch #217 fixed for structural reconciliation, one rung up. Checks A and
 * D apply unchanged, since the unusual-item manifest and the demerger signal
 * are read from the raw statements. Check C's analogue is a jump in ROE. A
 * period without profit or positive equity cannot anchor a valuation that
 * capitalizes earnings on book equity, so it is skipped. Check B (dirty
 * surplus) is not evaluated: bank metrics carry no equity-issuance line, so
 * every capital raise would read as a residual.
 */
export function evaluateFinancialEconomicSanity(
  metrics: readonly BankPeriodMetrics[],
  rawData: RawPeriodData[],
  corporateActions?: CorporateActionEvent[] | undefined,
  unusualManifest?: UnusualItemManifestLike[] | undefined,
): EconomicSanitySummary {
  if (!metrics.length) {
    return {
      status: "blocked",
      anchorPeriod: null,
      anchorReason: "No financial-institution periods available — anchor cannot be selected.",
      skippedPeriods: [],
      failedChecks: [],
    };
  }
  const ctx: ContextLike = { rawData, corporateActions, unusualManifest };
  const ordered = [...metrics].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const walk = walkForAnchor(ordered, (current, prev) => financialChecksForPeriod(current, prev, ctx));
  if (walk.anchor === null) return walk.blocked;
  const anchorPeriod = walk.anchor.period_end;
  const anchorWarnings = walk.failedChecks.filter((c) => c.affectedPeriods.includes(anchorPeriod));
  return {
    status: anchorWarnings.length > 0 ? "warned" : "passed",
    anchorPeriod,
    anchorReason: walk.anchorReason,
    skippedPeriods: walk.skipped,
    failedChecks: walk.failedChecks,
  };
}

function financialChecksForPeriod(
  current: BankPeriodMetrics,
  prev: BankPeriodMetrics | null,
  context: ContextLike,
): GateCheckResult[] {
  const periodEnd = current.period_end;
  const checks: GateCheckResult[] = [];

  const { pat, totalEquity: equity } = current;
  const anchorable = pat != null && Number.isFinite(pat) && equity != null && Number.isFinite(equity) && equity > 0;
  checks.push({
    checkId: "financial-anchor-metrics",
    passed: anchorable,
    reason: anchorable
      ? "Profit and positive equity are filed for this period."
      : equity != null && Number.isFinite(equity) && equity <= 0
        ? `Equity is ${equity.toFixed(0)}: a period without positive equity cannot anchor a valuation on book equity.`
        : "Profit or equity is missing for this period.",
    severity: "block",
    affectedPeriods: [periodEnd],
  });

  const knownAction = knownCapitalAction(periodEnd, context);
  const unusualBlocking = terminalUnusualItems(periodEnd, context);
  const capitalNotes = knownAction ? [`detected ${knownAction.kind} (${knownAction.detail})`] : [];
  checks.push(terminalContaminationCheck(periodEnd, unusualBlocking, capitalNotes));

  const roeCur = current.roe ?? null;
  const roePrev = prev?.roe ?? null;
  let roeReason = "ROE stayed within plausible bounds period-on-period.";
  let roePassed = true;
  if (roeCur != null && roePrev != null) {
    const jump = Math.abs(roeCur - roePrev);
    if (jump >= ROE_JUMP_THRESHOLD) {
      if (!knownAction && unusualBlocking.length === 0) {
        roePassed = false;
        roeReason = `ROE jumped ${(jump * 100).toFixed(1)}pp from ${(roePrev * 100).toFixed(1)}% to ${(roeCur * 100).toFixed(1)}% with no known capital event or unusual item.`;
      } else {
        roeReason = `ROE jumped ${(jump * 100).toFixed(1)}pp; suppressed because a capital event or unusual item explains it.`;
      }
    }
  }
  checks.push({
    checkId: "implausible-roe-jump",
    passed: roePassed,
    reason: roeReason,
    severity: "warn",
    affectedPeriods: [periodEnd],
  });

  checks.push(demergerDiscontinuedCheck(periodEnd, context));
  return checks;
}
