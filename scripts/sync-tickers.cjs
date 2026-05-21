#!/usr/bin/env node
/**
 * sync-tickers.cjs — regenerate src/engine/nseSymbolRegistry.ts from registry.json
 *
 * Phase rigor-4 (May 2026): registry.json is now the canonical ticker source.
 * This script derives nseSymbolRegistry.ts from it so the two never drift.
 *
 * Run after editing registry.json:
 *   node scripts/sync-tickers.cjs
 *
 * The companyLibraryGrid.tsx COMPANIES const is left as-is — that file
 * fetches registry.json at runtime and uses COMPANIES only as the offline
 * fallback. As long as registry.json is the source for the runtime path,
 * a stale COMPANIES const has no production effect.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "public", "data", "companies", "registry.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "src", "engine", "nseSymbolRegistry.ts");

const HEADER = `/**
 * NSE Symbol Registry — GENERATED FROM registry.json
 *
 * DO NOT EDIT BY HAND. Run \`node scripts/sync-tickers.cjs\` after
 * modifying public/data/companies/registry.json.
 *
 * Maps company folder names (as used in public/data/companies/) to NSE
 * ticker symbols. Used by the market data hook to auto-resolve symbols
 * when provider is "nse".
 *
 * Phase rigor-4 (May 2026): registry.json is now the single source of
 * truth for tickers. This file is a derived artifact.
 */

`;

const FOOTER = `
/**
 * Resolve NSE symbol from a company name/folder.
 * Tries exact match first, then case-insensitive, then partial.
 */
export function resolveNseSymbol(companyNameOrFolder: string | null | undefined): string | null {
  if (!companyNameOrFolder) return null;

  // Exact match
  if (companyNameOrFolder in NSE_SYMBOL_REGISTRY) {
    return NSE_SYMBOL_REGISTRY[companyNameOrFolder];
  }

  // Case-insensitive match
  const lower = companyNameOrFolder.toLowerCase();
  for (const [key, symbol] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (key.toLowerCase() === lower) return symbol;
  }

  // Partial match (company name contains key or vice versa)
  for (const [key, symbol] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return symbol;
    }
  }

  // If the input is itself a known NSE symbol, pass through
  const knownSymbols = Object.values(NSE_SYMBOL_REGISTRY);
  if (knownSymbols.includes(companyNameOrFolder.toUpperCase())) {
    return companyNameOrFolder.toUpperCase();
  }

  return null;
}

/**
 * Resolve the original company folder name given an NSE symbol.
 * Used to find the matching public/data/companies/ directory name.
 */
export function resolveFolderFromSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();

  // Try to find the exact match in registry values
  for (const [key, val] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (val.toUpperCase() === upper) {
      return key;
    }
  }

  // Fallback: case-insensitive whitespace-stripped match on keys
  for (const [key] of Object.entries(NSE_SYMBOL_REGISTRY)) {
    if (key.toLowerCase().replace(/ /g, "") === symbol.toLowerCase().replace(/ /g, "")) {
      return key;
    }
  }

  // Fallback to the input symbol if nothing matched
  return symbol;
}
`;

function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
  if (!Array.isArray(registry)) {
    console.error("registry.json is not an array");
    process.exit(1);
  }

  const entries = registry
    .filter((c) => c.folder && c.ticker)
    .sort((a, b) => a.folder.localeCompare(b.folder))
    .map((c) => `  ${JSON.stringify(c.folder)}: ${JSON.stringify(c.ticker)},`);

  const body = `export const NSE_SYMBOL_REGISTRY: Record<string, string> = {\n${entries.join("\n")}\n};\n`;

  const out = HEADER + body + FOOTER;

  // Idempotent: only write if content differs (preserves mtime)
  let existing = "";
  try { existing = fs.readFileSync(OUTPUT_PATH, "utf-8"); } catch (_) { /* fresh */ }
  if (existing.replace(/\r\n/g, "\n") === out.replace(/\r\n/g, "\n")) {
    console.log(`nseSymbolRegistry.ts already up to date (${entries.length} entries)`);
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, out, "utf-8");
  console.log(`+ wrote nseSymbolRegistry.ts (${entries.length} entries from registry.json)`);
}

main();
