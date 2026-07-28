/* ================================================================
   That the audit shards cover the whole registry.

   The company audit is the suite that answers "does every company still
   value cleanly", and it answers it in three CI jobs that each take a
   slice of the registry. Which makes the tiling load-bearing in a way
   nothing checked: the three shard specs carried hardcoded bounds of
   0+10, 10+10 and 20+12, covering indices 0-31, under a comment on the
   last one reading "tail shard, sized to cover full registry". That was
   true when the registry held 32 companies. A 33rd was added and index
   32 — Vodafone Idea, in the registry specifically as a negative-equity
   stress test — was audited by no shard.

   All three jobs stayed green, because a shard that covers less than it
   claims is indistinguishable from one that covers everything: each
   passes its own slice, and no test owns the union.

   This spec owns the union. It runs in the ordinary suite (it reads the
   registry and some source text; it audits nothing), so the guard does
   not itself cost 45 minutes to evaluate.
================================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_SHARD_COUNT, tileShard } from "../lib/auditShards";

const PROJECT_ROOT = resolve(__dirname, "../..");
const REGISTRY_PATH = join(PROJECT_ROOT, "public/data/companies/registry.json");
const SPEC_DIR = join(PROJECT_ROOT, "src/engine/__tests__");
const WORKFLOW_PATH = join(PROJECT_ROOT, ".github/workflows/validate.yml");

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as ReadonlyArray<{ ticker: string }>;

/** Indices a shard owns, expanded. */
function indicesFor(shard: number, total: number): number[] {
  const { start, size } = tileShard(shard, total);
  return Array.from({ length: size }, (_, offset) => start + offset);
}

function allShardIndices(total: number): number[] {
  return Array.from({ length: AUDIT_SHARD_COUNT }, (_, shard) => indicesFor(shard, total)).flat();
}

describe("tileShard partitions a registry of any size", () => {
  // Property, not examples: every index exactly once, whatever the total. The
  // sizes are asserted nowhere on purpose — how the remainder is distributed is
  // this function's business, but that nothing is dropped or double-audited is
  // the contract callers depend on.
  it.each([0, 1, 2, 3, 4, 32, 33, 34, 100])("covers [0, %i) exactly once", (total) => {
    const covered = allShardIndices(total);
    expect(covered.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("keeps shard sizes within one of each other", () => {
    // Not correctness, but the reason to compute the split rather than hand it
    // out arbitrarily: three CI jobs with a 45-minute timeout each.
    const sizes = Array.from({ length: AUDIT_SHARD_COUNT }, (_, shard) => tileShard(shard, 33).size);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("rejects a shard index outside the shard count", () => {
    // Fails loudly rather than returning an empty slice, which would read as
    // "this shard has no companies" and pass.
    expect(() => tileShard(AUDIT_SHARD_COUNT, 33)).toThrow(/out of range/);
    expect(() => tileShard(-1, 33)).toThrow(/out of range/);
  });
});

describe("the shards cover the live registry", () => {
  it("audits every company in registry.json", () => {
    const covered = allShardIndices(registry.length);
    const missing = registry
      .map((company, index) => ({ company, index }))
      .filter(({ index }) => !covered.includes(index))
      .map(({ company, index }) => `${index}: ${company.ticker}`);

    // Named, not counted: the failure has to say which company stopped being
    // audited, since that is the question a reviewer will have.
    expect(missing).toEqual([]);
  });

  it("would have caught the tiling this spec was written for", () => {
    // Non-vacuity, and the specific regression. The old bounds are replayed
    // here as literals — at 33 companies they drop the last one, which is
    // exactly what shipped and what three green jobs failed to report.
    const OLD_BOUNDS = [{ start: 0, size: 10 }, { start: 10, size: 10 }, { start: 20, size: 12 }];
    const oldCovered = OLD_BOUNDS.flatMap(({ start, size }) =>
      Array.from({ length: size }, (_, offset) => start + offset),
    );

    expect(oldCovered).toHaveLength(32);
    expect(oldCovered).not.toContain(32);
    expect(registry.length).toBeGreaterThan(32);
    // And the computed tiling does not.
    expect(allShardIndices(registry.length)).toContain(registry.length - 1);
  });
});

describe("the shard count agrees everywhere it is written down", () => {
  // Three places encode "how many shards": this constant, the spec files, and
  // the CI matrix. Adding a fourth shard spec without touching the matrix would
  // leave its companies unaudited in CI while passing locally — the same class
  // of silent gap as the tiling bug, one level up.
  it("matches the number of shard spec files", () => {
    const specs = readdirSync(SPEC_DIR).filter((name) => /^audit-all-companies-shard-\d+\.spec\.ts$/.test(name));
    expect(specs).toHaveLength(AUDIT_SHARD_COUNT);
  });

  it("matches the CI job matrix", () => {
    const workflow = readFileSync(WORKFLOW_PATH, "utf-8");
    // Scoped to the `company-audit:` job, because `validate.yml` has two
    // `shard:` matrices and the first one belongs to the unit-test job. An
    // unscoped search finds `[1, 2, 3]` — the unit shards, 1-indexed — and
    // then reports a mismatch against a matrix this file has no business
    // checking. (Which it did, on the first run of this spec.)
    const jobStart = workflow.indexOf("\n  company-audit:");
    expect(jobStart, "no `company-audit:` job found in validate.yml").toBeGreaterThan(-1);
    // Bounded by the next top-level job key so a later matrix cannot be read as
    // this job's.
    const rest = workflow.slice(jobStart + 1);
    const nextJob = /\n {2}[a-z][\w-]*:\n/.exec(rest);
    const job = nextJob ? rest.slice(0, nextJob.index) : rest;

    const matrix = /shard:\s*\[([^\]]+)\]/.exec(job);
    expect(matrix, "no `shard: [...]` matrix in the company-audit job").not.toBeNull();
    const shards = matrix![1]!.split(",").map((entry) => Number(entry.trim()));
    expect(shards.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: AUDIT_SHARD_COUNT }, (_, index) => index),
    );
    // And that the job runs the spec files those indices name, rather than a
    // matrix that happens to count correctly while pointing somewhere else.
    expect(job).toContain("audit-all-companies-shard-${{ matrix.shard }}.spec.ts");
  });

  it("has every shard spec derive its slice instead of hardcoding one", () => {
    // Read as source text deliberately. The bounds a spec passes are invisible
    // to everything above: `tileShard` can be perfectly correct while a spec
    // ignores it and passes literals, which is the state this whole file exists
    // to rule out. Nothing here runs the audit, so nothing here can observe the
    // slice a spec actually chose.
    for (let shard = 0; shard < AUDIT_SHARD_COUNT; shard += 1) {
      const text = readFileSync(join(SPEC_DIR, `audit-all-companies-shard-${shard}.spec.ts`), "utf-8");
      expect(text, `shard ${shard} must call createShardAuditTests`).toContain(`createShardAuditTests(${shard})`);
      // Comments stripped first. Shard 2's docblock quotes the bounds it used to
      // carry, so a check against the raw text flags the explanation of the bug
      // as the bug — which is what happened on the first run of this spec. What
      // is being asserted is about code, so comments are not part of it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, `shard ${shard} must not hardcode slice bounds`).not.toMatch(/start:\s*\d+/);
    }
  });
});
