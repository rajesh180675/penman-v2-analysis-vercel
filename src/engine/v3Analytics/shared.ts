/* ================================================================
   v3Analytics decomposition — shared foundation module.

   Holds the canonical-output primitives that sub-modules of the
   v3Analytics cluster depend on. Sub-modules import these DOWN from
   `./shared`; they must never import back UP from `../v3Analytics`
   (that back-edge is the circular dependency this module breaks).

   `v3Analytics.ts` re-exports the public surface, so external callers
   (shareCountTools, tests, UI) see no change in import paths.

   Lifted verbatim from src/engine/v3Analytics.ts. Behaviour identical.
================================================================ */

export class ConsistencyViolation extends Error {}

export class CanonicalOutputRegistry {
  private values = new Map<string, unknown>();
  private sources = new Map<string, string>();
  register<T>(key: string, value: T, sourceSpec: string): T {
    if (this.values.has(key)) {
      const existing = this.values.get(key);
      if (typeof existing === "number" && typeof value === "number") {
        const denom = Math.max(Math.abs(existing), 1);
        const delta = Math.abs(existing - value) / denom;
        if (delta > 0.001) {
          throw new ConsistencyViolation(
            `Conflicting values for '${key}': ${existing} (from ${this.sources.get(key)}) vs ${value} (from ${sourceSpec})`
          );
        }
      } else if (JSON.stringify(existing) !== JSON.stringify(value)) {
        throw new ConsistencyViolation(
          `Conflicting values for '${key}': ${JSON.stringify(existing)} (from ${this.sources.get(key)}) vs ${JSON.stringify(value)} (from ${sourceSpec})`
        );
      }
      return existing as T;
    }
    this.values.set(key, value);
    this.sources.set(key, sourceSpec);
    return value;
  }
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.values.entries());
  }
}
