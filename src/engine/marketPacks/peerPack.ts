/**
 * Pinned peer pack — dated constituents for relative valuation.
 *
 * Why this exists: peer multiples need a *price* and a *share count* for every
 * constituent, and the company registry carries neither. `EngineConfig` holds
 * one price and one share count — the target's. So peer PE/PB were structurally
 * incomputable, not merely small-sample (see `peerRelativeValuation`).
 *
 * Lives in `src/engine/` rather than the target `src/domain/` layout: adding a
 * parallel hierarchy for one module buys nothing while 451 engine files sit
 * here. The move is the native-extraction phase's job.
 *
 * Two independent claims a pack has to support, both explicit:
 *   - breadth: enough constituents that a median means something;
 *   - freshness: prices dated, and dated close enough to the analysis to compare.
 */

/** Below this, a "sector median" is an artifact of who happened to be loaded. */
export const MIN_PEER_CONSTITUENTS = 5;

/** Prices older than this are disclosed as stale rather than silently used. */
export const PEER_PRICE_STALENESS_DAYS = 30;

export interface PeerPackConstituent {
  readonly companyId: string;
  readonly label: string;
  /** Traded price per share. Null when the source had no quote. */
  readonly price: number | null;
  /** Date the price was observed (YYYY-MM-DD). Null is treated as unusable. */
  readonly priceAsOf: string | null;
  /** Share count matching the price basis. Null when unavailable. */
  readonly shares: number | null;
}

export interface PeerPack {
  /** Date the pack was assembled (YYYY-MM-DD). */
  readonly asOf: string;
  /** Where the constituents and quotes came from, for the evidence row. */
  readonly source: string;
  /** Which peer group this pack claims to cover, e.g. "consumer/FMCG". */
  readonly peerGroupKey: string;
  readonly constituents: readonly PeerPackConstituent[];
}

export type PeerPackEligibility =
  | {
      readonly status: "eligible";
      readonly usableCount: number;
      readonly asOf: string;
      readonly source: string;
    }
  | {
      readonly status: "skipped";
      readonly usableCount: number;
      readonly reason: string;
    };

function isUsable(constituent: PeerPackConstituent): boolean {
  return constituent.price != null
    && Number.isFinite(constituent.price)
    && constituent.price > 0
    && constituent.shares != null
    && Number.isFinite(constituent.shares)
    && constituent.shares > 0
    && constituent.priceAsOf != null;
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number | null {
  const from = Date.parse(fromIsoDate);
  const to = Date.parse(toIsoDate);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Decide whether a pack may back a median multiple.
 *
 * Skipped is a first-class outcome carrying a reason, not a null: a reviewer
 * needs to see that the peer lens was withheld and why, which is the difference
 * between "no peer signal" and "peer signal of zero".
 */
export function resolvePeerPackEligibility(
  pack: PeerPack | null | undefined,
  options?: { readonly minimumConstituents?: number; readonly analysisAsOf?: string | null },
): PeerPackEligibility {
  if (!pack) {
    return { status: "skipped", usableCount: 0, reason: "No pinned peer pack supplied; peer multiples need dated per-constituent prices." };
  }

  const minimum = options?.minimumConstituents ?? MIN_PEER_CONSTITUENTS;
  const usable = pack.constituents.filter(isUsable);

  if (usable.length < minimum) {
    return {
      status: "skipped",
      usableCount: usable.length,
      reason: `Peer pack has ${usable.length} usable constituent(s) for ${pack.peerGroupKey}; a median needs at least ${minimum}.`,
    };
  }

  const analysisAsOf = options?.analysisAsOf ?? null;
  if (analysisAsOf) {
    const age = daysBetween(pack.asOf, analysisAsOf);
    if (age == null) {
      return { status: "skipped", usableCount: usable.length, reason: `Peer pack date "${pack.asOf}" or analysis date "${analysisAsOf}" is not a valid date.` };
    }
    if (age < 0) {
      return { status: "skipped", usableCount: usable.length, reason: `Peer pack is dated ${pack.asOf}, after the analysis date ${analysisAsOf}; that would be look-ahead.` };
    }
    if (age > PEER_PRICE_STALENESS_DAYS) {
      return { status: "skipped", usableCount: usable.length, reason: `Peer pack is ${age} days stale (dated ${pack.asOf}); limit is ${PEER_PRICE_STALENESS_DAYS} days.` };
    }
  }

  return { status: "eligible", usableCount: usable.length, asOf: pack.asOf, source: pack.source };
}

/** Usable constituents keyed by companyId, for multiple computation. */
export function usablePeerConstituents(pack: PeerPack): Map<string, PeerPackConstituent> {
  return new Map(pack.constituents.filter(isUsable).map((constituent) => [constituent.companyId, constituent]));
}
