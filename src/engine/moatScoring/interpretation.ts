/**
 * Economic Moat Scoring — reading a result safely.
 *
 * `computeMoatScore` always returns a `compositeScore` and a `moatWidth`, even
 * when it has just told you not to trust them: a loss-maker with no periods of
 * positive RNOA, or an IT-services company whose RNOA is inflated by a NOA
 * denominator near zero, both come back with `dataSufficient: false` and a
 * `skipReason` — and a number.
 *
 * That number is the trap. Every consumer that reached for `compositeScore`
 * directly got a plausible 0–100 value and turned it into a verdict, a
 * "durable competitive advantages" sentence, or a strength bullet, while the
 * panel beside it rendered the scorer's own "this classification is
 * unreliable" caveat. One run, two contradictory claims.
 *
 * So the rule lives here once rather than at each decision site: a score you
 * may draw a conclusion from is a score the scorer stands behind.
 */

import type { MoatScoreResult } from "./types";

/**
 * The moat result a conclusion may rest on, or `null`.
 *
 * Pass the raw result to anything that *displays* the score or its
 * `skipReason` — the caveat is the useful output in that case. Pass it through
 * here for anything that *decides*: verdicts, quality gates, thesis prose.
 */
export function decisiveMoat(moat: MoatScoreResult | null | undefined): MoatScoreResult | null {
  return moat && moat.dataSufficient ? moat : null;
}
