#!/usr/bin/env tsx
/**
 * valuation-scorecard.ts — weighted valuation maturity scorecard.
 *
 * Usage:
 *   npx tsx scripts/valuation-scorecard.ts --format json
 *   npx tsx scripts/valuation-scorecard.ts --format md
 *   npx tsx scripts/valuation-scorecard.ts --format json --limit 3
 *   npx tsx scripts/valuation-scorecard.ts --format md --ticker HDFCBANK
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditCompanyRun,
  type AuditRegistryEntry,
} from "./lib/auditCompanyRun";
import {
  buildValuationMaturityScorecard,
  renderScorecardMarkdown,
  type ValuationScorecardAuditRow,
} from "./lib/valuationMaturityScorecard";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const REGISTRY_PATH = join(PROJECT_ROOT, "public", "data", "companies", "registry.json");

interface CliArgs {
  format: "json" | "md";
  limit: number | null;
  ticker: string | null;
}

function usage(): string {
  return [
    "Usage: npx tsx scripts/valuation-scorecard.ts [--format json|md] [--limit N] [--ticker TICKER]",
    "",
    "Formats:",
    "  json  Machine-readable scorecard payload",
    "  md    Markdown report",
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { format: "md", limit: null, ticker: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--format") {
      const value = argv[i + 1];
      if (value !== "json" && value !== "md") throw new Error("--format must be json or md");
      args.format = value;
      i += 1;
    } else if (arg.startsWith("--format=")) {
      const value = arg.split("=")[1];
      if (value !== "json" && value !== "md") throw new Error("--format must be json or md");
      args.format = value;
    } else if (arg === "--limit") {
      const value = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--limit must be a positive integer");
      args.limit = value;
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.split("=")[1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error("--limit must be a positive integer");
      args.limit = value;
    } else if (arg === "--ticker") {
      args.ticker = argv[i + 1] ?? null;
      if (!args.ticker) throw new Error("--ticker requires a value");
      i += 1;
    } else if (arg.startsWith("--ticker=")) {
      args.ticker = arg.split("=")[1] ?? null;
      if (!args.ticker) throw new Error("--ticker requires a value");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function loadRegistry(): AuditRegistryEntry[] {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as AuditRegistryEntry[];
}

function selectCompanies(registry: AuditRegistryEntry[], args: CliArgs): AuditRegistryEntry[] {
  if (args.ticker) {
    const needle = args.ticker.toUpperCase();
    return registry.filter((company) => company.ticker.toUpperCase() === needle || company.folder.toUpperCase() === needle);
  }
  if (args.limit != null) return registry.slice(0, args.limit);
  return registry;
}

function toScorecardRow(result: Awaited<ReturnType<typeof auditCompanyRun>>): ValuationScorecardAuditRow {
  return {
    folder: result.folder,
    ticker: result.ticker,
    companyType: result.companyType,
    analysisFamily: result.analysisFamily,
    pipelineStrategyId: result.pipelineStrategyId,
    periods: result.periods,
    latestPeriod: result.latestPeriod,
    models: result.models,
    outcome: result.outcome,
    statusClass: result.statusClass,
    flags: result.flags,
    rigor: result.rigor,
  };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const registry = loadRegistry();
  const companies = selectCompanies(registry, args);
  const rows: ValuationScorecardAuditRow[] = [];

  for (const company of companies) {
    const result = await auditCompanyRun(company, { projectRoot: PROJECT_ROOT });
    rows.push(toScorecardRow(result));
  }

  const scorecard = buildValuationMaturityScorecard(rows);
  if (args.format === "json") {
    console.log(JSON.stringify(scorecard, null, 2));
  } else {
    console.log(renderScorecardMarkdown(scorecard));
  }
}

run().catch((error) => {
  console.error("FATAL:", (error as Error).message);
  process.exit(1);
});
