#!/usr/bin/env node
/**
 * refresh-company.mjs — one-shot data refresh for a single company.
 *
 * Reads registry.json to determine the company type, then runs the right
 * pipeline:
 *   - bank          → extract_bank_quality.py <ticker>      → sync
 *   - nbfc          → extract_nbfc_quality.py <ticker>
 *                     → parse_nbfc_capitaline_extras.py "<folder>"
 *                     → sync
 *   - insurance     → extract_insurance_quality.py          → sync
 *   - everything else → sync only (no AR sidecar pipeline)
 *
 * Usage:
 *   node scripts/refresh-company.mjs "Bajaj Finance"
 *   node scripts/refresh-company.mjs "HDFC Bank"
 *   node scripts/refresh-company.mjs ITC
 *
 *   # Dry run — show what would be done, do nothing:
 *   node scripts/refresh-company.mjs --dry-run "Bajaj Finance"
 *
 *   # Skip the AR extractor step (when you only updated Capitaline files
 *   # and don't want to re-parse AR PDFs):
 *   node scripts/refresh-company.mjs --skip-extract "Bajaj Finance"
 *
 * Note: The AR extractors live at scripts/extract_*_quality.py and depend
 * on Annual Report PDFs at C:\Users\rajesh\WindsurfAPI\ITC-valuation-template\
 * public\data\annual_reports. If you don't have those PDFs, the extractor
 * step will skip gracefully and only sync-companies.cjs will run — which is
 * fine if you only want to repackage the .xls files into ZIPs.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const REGISTRY = join(PROJECT_ROOT, "public", "data", "companies", "registry.json");

// Map company.folder -> ticker for AR extractors. Tickers MUST match what
// the Python scripts expect (see TICKER_TO_FOLDER tables in each extractor).
const FOLDER_TO_EXTRACTOR_TICKER = {
  "HDFC Bank": "HDFCBANK",
  "ICICI Bank": "ICICIBANK",
  "KOTAKBANK": "KOTAKBANK",
  "SBIN": "SBIN",
  "Bajaj Finance": "BAJFINANCE",
  "Life Insurance Corporation of India": null,  // extract_insurance_quality.py takes no arg
};

function parseArgs(argv) {
  const args = { dryRun: false, skipExtract: false, folder: null };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--skip-extract") args.skipExtract = true;
    else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else if (!args.folder) args.folder = a;
    else {
      console.error(`Unexpected positional arg: ${a}`);
      process.exit(2);
    }
  }
  if (!args.folder) {
    console.error("Usage: node scripts/refresh-company.mjs [--dry-run] [--skip-extract] \"<Folder Name>\"");
    process.exit(2);
  }
  return args;
}

function loadRegistry() {
  if (!existsSync(REGISTRY)) {
    console.error(`registry.json not found: ${REGISTRY}`);
    console.error("Run `node sync-companies.cjs` first to generate it.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(REGISTRY, "utf-8"));
}

function findCompany(registry, folder) {
  // Exact match first
  let entry = registry.find(c => c.folder === folder);
  if (entry) return entry;

  // Case-insensitive fallback (tolerates "bajaj finance" or "BAJAJ FINANCE")
  entry = registry.find(c => c.folder.toLowerCase() === folder.toLowerCase());
  if (entry) {
    console.warn(`WARN folder casing mismatch: you typed "${folder}", registry has "${entry.folder}". Using registry value.`);
    return entry;
  }

  console.error(`Company not found: "${folder}"`);
  console.error("Known folders:");
  for (const c of registry) console.error(`  - ${c.folder}`);
  process.exit(1);
}

function run(label, cmd, args, opts = {}) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ ${cmd} ${args.join(" ")}`);
  if (opts.dryRun) {
    console.log("(dry run — skipped)");
    return { status: 0 };
  }
  const r = spawnSync(cmd, args, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",   // node on Windows needs shell:true for .py / .cjs resolution
  });
  if (r.status !== 0) {
    console.error(`\nFAIL: "${label}" exited with ${r.status}`);
  }
  return r;
}

async function main() {
  const args = parseArgs(process.argv);
  const registry = loadRegistry();
  const company = findCompany(registry, args.folder);

  console.log(`Refreshing: ${company.name}  (folder="${company.folder}", type="${company.type}", ticker="${company.ticker}")`);
  if (args.dryRun) console.log("DRY RUN — no commands will execute.");

  const ranSteps = [];
  const skippedSteps = [];

  // Step 1: AR extractor (type-dependent, optional)
  if (!args.skipExtract) {
    if (company.type === "bank" || company.type === "nbfc") {
      const ticker = FOLDER_TO_EXTRACTOR_TICKER[company.folder];
      if (!ticker) {
        skippedSteps.push(`extract_${company.type}_quality.py — no ticker mapping for "${company.folder}"`);
      } else {
        const script = company.type === "bank"
          ? "scripts/extract_bank_quality.py"
          : "scripts/extract_nbfc_quality.py";
        const r = run(`${company.type} AR extractor`, "python", [script, ticker], { dryRun: args.dryRun });
        if (r.status === 0) ranSteps.push(script);
        else skippedSteps.push(`${script} (exit ${r.status} — likely missing AR PDFs)`);
      }
    } else if (company.type === "insurance") {
      const r = run("insurance AR extractor", "python", ["scripts/extract_insurance_quality.py"], { dryRun: args.dryRun });
      if (r.status === 0) ranSteps.push("scripts/extract_insurance_quality.py");
      else skippedSteps.push(`scripts/extract_insurance_quality.py (exit ${r.status})`);
    } else {
      skippedSteps.push(`AR extractor — type "${company.type}" has no AR pipeline`);
    }
  } else {
    skippedSteps.push("AR extractor (--skip-extract)");
  }

  // Step 2: Capitaline sidecar merger (NBFC-only, currently Bajaj-specific)
  if (company.type === "nbfc") {
    const sidecarsExist = existsSync(join(PROJECT_ROOT, "public/data/companies", company.folder, "RBI NHB Banks"));
    if (sidecarsExist) {
      const r = run("Capitaline NBFC merger", "python",
        ["scripts/parse_nbfc_capitaline_extras.py", company.folder], { dryRun: args.dryRun });
      if (r.status === 0) ranSteps.push("scripts/parse_nbfc_capitaline_extras.py");
      else skippedSteps.push(`parse_nbfc_capitaline_extras.py (exit ${r.status})`);
    } else {
      skippedSteps.push(`parse_nbfc_capitaline_extras.py — no sidecar folders for "${company.folder}"`);
    }
  }

  // Step 3: ZIP packager + registry sync (always runs)
  const r = run("ZIP packager + registry sync", "node", ["sync-companies.cjs"], { dryRun: args.dryRun });
  if (r.status === 0) ranSteps.push("sync-companies.cjs");
  else {
    console.error("\nFATAL: sync-companies.cjs failed. Aborting.");
    process.exit(r.status || 1);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`Refresh complete: ${company.name}`);
  console.log("=".repeat(60));
  console.log("\nRan:");
  for (const s of ranSteps) console.log(`  ✓ ${s}`);
  if (skippedSteps.length > 0) {
    console.log("\nSkipped:");
    for (const s of skippedSteps) console.log(`  · ${s}`);
  }
  console.log("\nNext steps:");
  console.log(`  1. Restart dev server (Ctrl+C in the npm run dev:local terminal, then re-run)`);
  console.log(`  2. (Production) BLOB_READ_WRITE_TOKEN=... node scripts/upload-to-blob.mjs`);
  console.log(`  3. git add public/data/companies && git commit && git push`);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
