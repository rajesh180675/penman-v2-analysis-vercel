#!/usr/bin/env tsx
/**
 * publish-snapshots.ts — copy every frozen forecast snapshot into one file the
 * browser can read, for the Case's Forecast section.
 *
 *   npx tsx scripts/accountability/publish-snapshots.ts
 *
 * Reads accountability/snapshots/<made-at>/<ticker>.json (never modified: a
 * frozen forecast is a record) and writes public/data/accountability/snapshots.json,
 * ordered by made-at date, then ticker. A test keeps the two in step.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function collectSnapshots(root: string): unknown[] {
  const base = join(root, "accountability", "snapshots");
  return readdirSync(base).sort().flatMap((madeAt) =>
    readdirSync(join(base, madeAt)).filter((f) => f.endsWith(".json")).sort()
      .map((file) => JSON.parse(readFileSync(join(base, madeAt, file), "utf8")) as unknown));
}

const snapshots = collectSnapshots(ROOT);
mkdirSync(join(ROOT, "public", "data", "accountability"), { recursive: true });
writeFileSync(join(ROOT, "public", "data", "accountability", "snapshots.json"), JSON.stringify(snapshots, null, 1) + "\n");
console.log(`Published ${snapshots.length} frozen forecast snapshots.`);
