export interface RateLimitLease {
  readonly allowed: boolean;
  readonly key: string;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: string;
  readonly retryAfterSeconds: number;
}

export interface AtomicRateLimitStore {
  /** Atomically increment a key and return its count and fixed-window expiry. */
  increment(key: string, windowSeconds: number, nowMs: number): Promise<{ count: number; resetAtMs: number }>;
}

export class DistributedRateLimiter {
  constructor(private readonly store: AtomicRateLimitStore) {}

  async acquire(input: {
    readonly organizationId: string;
    readonly workspaceId: string;
    readonly principalId: string;
    readonly action: string;
    readonly limit: number;
    readonly windowSeconds: number;
    readonly now?: Date;
  }): Promise<RateLimitLease> {
    if (!Number.isInteger(input.limit) || input.limit < 1) throw new Error("Rate limit must be a positive integer.");
    if (!Number.isInteger(input.windowSeconds) || input.windowSeconds < 1) throw new Error("Rate-limit window must be a positive integer.");
    const key = [input.organizationId, input.workspaceId, input.principalId, input.action]
      .map((part) => encodeURIComponent(part)).join(":");
    const nowMs = (input.now ?? new Date()).getTime();
    const result = await this.store.increment(key, input.windowSeconds, nowMs);
    const allowed = result.count <= input.limit;
    return Object.freeze({
      allowed,
      key,
      limit: input.limit,
      remaining: Math.max(0, input.limit - result.count),
      resetAt: new Date(result.resetAtMs).toISOString(),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((result.resetAtMs - nowMs) / 1_000)),
    });
  }
}

/** Reference implementation; deployed adapters must use an atomic shared store. */
export class InMemoryAtomicRateLimitStore implements AtomicRateLimitStore {
  readonly #windows = new Map<string, { count: number; resetAtMs: number }>();

  async increment(key: string, windowSeconds: number, nowMs: number) {
    const existing = this.#windows.get(key);
    if (!existing || existing.resetAtMs <= nowMs) {
      const created = { count: 1, resetAtMs: nowMs + windowSeconds * 1_000 };
      this.#windows.set(key, created);
      return { ...created };
    }
    existing.count += 1;
    return { ...existing };
  }
}
