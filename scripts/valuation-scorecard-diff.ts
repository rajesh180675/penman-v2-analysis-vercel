#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { diffValuationMaturityScorecards } from "./lib/valuationScorecardDiff";
import type { ValuationMaturityScorecard } from "./lib/valuationMaturityScorecard";

function usage(): string {
  return "Usage: npx tsx scripts/valuation-scorecard-diff.ts <before.json> <after.json>";
}

function readScorecard(path: string): ValuationMaturityScorecard {
  return JSON.parse(readFileSync(path, "utf8")) as ValuationMaturityScorecard;
}

function run(): void {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath || beforePath === "--help") {
    console.log(usage());
    process.exit(beforePath === "--help" ? 0 : 1);
  }

  const diff = diffValuationMaturityScorecards(readScorecard(beforePath), readScorecard(afterPath));
  console.log(JSON.stringify(diff, null, 2));
}

run();
