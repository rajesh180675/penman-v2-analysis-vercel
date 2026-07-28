/**
 * How the company registry is split across the CI audit shard jobs.
 *
 * Its own module, and deliberately importing nothing: the coverage guard that
 * checks this tiling has to run in the ordinary test suite, and anything
 * reachable from `auditCompanyRun` pulls the whole pipeline in with it.
 */

/**
 * How many shards exist. Three things must agree on this number — the
 * `matrix.shard` list in `.github/workflows/validate.yml`, the count of
 * `audit-all-companies-shard-N.spec.ts` files, and this constant — so
 * `auditShardCoverage.spec.ts` asserts all three rather than trusting them.
 */
export const AUDIT_SHARD_COUNT = 3;

export interface AuditShardBounds {
  readonly start: number;
  readonly size: number;
}

/**
 * The slice of `total` items that one shard owns, computed rather than written
 * down.
 *
 * It used to be written down, which is the whole reason this function exists.
 * The three shard specs carried hardcoded `{ start, size }` pairs of 0+10,
 * 10+10 and 20+12 — tiling indices 0 through 31, under a comment saying the
 * tail shard was "sized to cover full registry". That was true when the
 * registry held 32 companies. A 33rd was added, and index 32 (Vodafone Idea:
 * chronic losses, negative net worth, in the registry precisely as a
 * negative-equity stress test) was then audited by no shard at all. Since CI
 * runs only the shard specs, it was audited nowhere in CI, and nothing said so
 * — a shard that covers less than it claims looks exactly like one that
 * covers everything.
 *
 * Remainder is handed to the earliest shards, so sizes differ by at most one
 * and the union is always exactly `[0, total)`.
 */
export function tileShard(shard: number, total: number, shardCount = AUDIT_SHARD_COUNT): AuditShardBounds {
  if (!Number.isInteger(shard) || shard < 0 || shard >= shardCount) {
    throw new Error(`shard ${shard} is out of range for ${shardCount} shards`);
  }
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`total ${total} must be a non-negative integer`);
  }
  const base = Math.floor(total / shardCount);
  const remainder = total % shardCount;
  return {
    start: shard * base + Math.min(shard, remainder),
    size: base + (shard < remainder ? 1 : 0),
  };
}
