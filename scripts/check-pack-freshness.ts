#!/usr/bin/env tsx
/**
 * Fail while a pinned pack is still valid but about to lapse.
 *
 * All the logic lives in `src/engine/marketPacks/packFreshness.ts`, under test.
 * This file is only the CI entry point: pick the date, print the findings, set
 * the exit code.
 *
 * Unlike every other `lint:*` check in this repo, this one can go red without
 * anybody changing anything — it is a function of today's date. That is the
 * intended behaviour and the reason it exists: the alternative is discovering a
 * lapsed observation from a moved discount rate. When it fires, the fix is to
 * refresh the pack, not to widen the window:
 *
 *   npx tsx scripts/refresh-beta-pack.ts        # beta windows
 *   (macro pack is hand-sourced — see the sourcing rules in indiaMacroPack.ts)
 *
 * `expiring` exits 1 as well as `expired`. Warning without failing would make
 * this another check that prints a problem and lets it through, which is the
 * exact pathology #299 removed from the scorecard.
 */

import {
  PACK_FRESHNESS_LEAD_DAYS,
  checkPackFreshness,
} from "../src/engine/marketPacks/packFreshness";
import { INDIA_MACRO_PACK } from "../src/engine/marketPacks/indiaMacroPack";
import { INDIA_EQUITY_BETA_PACK } from "../src/engine/marketPacks/indiaEquityBetaPack";

// Overridable so a reviewer can ask "what will CI say next Monday?" without
// waiting for Monday, and so this script is reproducible after the fact.
const override = process.argv.find((a) => a.startsWith("--as-of="))?.split("=")[1];
const analysisAsOf = override ?? new Date().toISOString().slice(0, 10);
if (!Number.isFinite(Date.parse(analysisAsOf))) {
  console.error(`Invalid --as-of date: "${analysisAsOf}". Expected YYYY-MM-DD.`);
  process.exit(1);
}

const findings = checkPackFreshness({
  macroPack: INDIA_MACRO_PACK,
  betaPack: INDIA_EQUITY_BETA_PACK,
  analysisAsOf,
});

if (findings.length === 0) {
  console.log(
    `Pinned packs fresh at ${analysisAsOf}: every observation has more than ${PACK_FRESHNESS_LEAD_DAYS} days of headroom.`,
  );
  process.exit(0);
}

console.error(`Pinned pack freshness problems at ${analysisAsOf}:\n`);
for (const f of findings) {
  console.error(`  [${f.severity}] ${f.detail}`);
}
console.error(
  "\nRefresh the pack rather than widening the staleness window. A stale observation"
  + "\nresolves as a `prior`, which moves ke and blocks production-ready — silently.",
);
process.exit(1);
