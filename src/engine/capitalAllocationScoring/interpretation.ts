/**
 * Capital Allocation Scoring — reading a result safely.
 *
 * `scoreCapitalAllocation` always returns a `compositeScore` and a letter
 * `grade`, even when it has just told you not to trust them. Below three
 * periods of positive CNI — a loss-maker, a turnaround — the dimensions stop
 * meaning anything: reinvestment ROIC on negative CNI is incoherent, FCF
 * conversion inverts sign, and zero dividends score badly for a reason that is
 * actually prudent. So it sets `dataSufficient: false` with a `skipReason`, and
 * returns a number anyway.
 *
 * `CapAllocScoreResult.dataSufficient` has said since Phase I that the UI
 * "should surface the skip reason rather than displaying the score as
 * authoritative". Nothing did. Every consumer read `compositeScore` directly
 * and turned a plausible 0–100 into a verdict, a grade line, or a "strong
 * capital allocation discipline" bullet, while the panel beside it rendered the
 * scorer's own caveat.
 *
 * Same shape as `decisiveMoat`, and deliberately so: two scorers with the same
 * self-disqualification contract should not have two different rules for
 * respecting it.
 */

import type { CapAllocScoreResult } from "./types";

/**
 * The capital-allocation result a conclusion may rest on, or `null`.
 *
 * Pass the raw result to anything that *displays* the score or its
 * `skipReason` — `CapitalAllocationPanel` renders both together, and the caveat
 * is the useful output there. Pass it through here for anything that *decides*:
 * verdicts, quality gates, grade lines, thesis prose.
 */
export function decisiveCapAlloc(
  capAlloc: CapAllocScoreResult | null | undefined,
): CapAllocScoreResult | null {
  return capAlloc && capAlloc.dataSufficient ? capAlloc : null;
}
