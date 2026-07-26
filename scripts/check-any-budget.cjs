#!/usr/bin/env node
/**
 * Plan 1 PR-1.2 — `any` budget enforcement.
 *
 * Counts `\bany\b` occurrences in src/engine/ (excluding test/spec files
 * and lines that are pure comments) and fails CI when a file exceeds
 * its budget in `src/engine/__lint__/any-budget.json`.
 *
 * Budgets exist per-file because the engine has a small fixed set of
 * legitimate `any` types (parser inputs, jszip 3.10 typing gaps, etc.)
 * that we accept while we wait for upstream type definitions to catch up.
 *
 * The total budget acts as the global ceiling so unmonitored files
 * cannot regress en masse.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BUDGET_PATH = path.join(__dirname, "..", "src", "engine", "__lint__", "any-budget.json");
const ROOT = path.join(__dirname, "..", "src", "engine");

if (!fs.existsSync(BUDGET_PATH)) {
  console.error(`any-budget: budget file missing at ${BUDGET_PATH}`);
  process.exit(2);
}
const budget = JSON.parse(fs.readFileSync(BUDGET_PATH, "utf8"));

/** Recursively walk a directory, returning .ts files (skipping tests). */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "__lint__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Count `\bany\b` occurrences excluding pure-comment lines. */
function countAnyInFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    // skip pure-comment lines (// foo, * bar)
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    const matches = line.match(/\bany\b/g);
    if (matches) count += matches.length;
  }
  return count;
}

const files = walk(ROOT);
const perFile = {};
let total = 0;
for (const file of files) {
  const rel = path.relative(path.join(__dirname, ".."), file).replace(/\\/g, "/");
  const n = countAnyInFile(file);
  if (n > 0) perFile[rel] = n;
  total += n;
}

let failed = false;

// 1) Total ceiling
const totalBudget = budget.total ?? 30;
if (total > totalBudget) {
  console.error(`any-budget: total ${total} exceeds budget ${totalBudget}`);
  failed = true;
} else {
  console.log(`any-budget: total ${total} <= ${totalBudget}`);
}

// 2) Per-file budgets — file may not exceed its budget; unbudgeted files must be 0
const perFileBudget = budget.perFile ?? {};
for (const [rel, n] of Object.entries(perFile)) {
  const max = perFileBudget[rel];
  if (max === undefined) {
    console.error(`any-budget: ${rel} has ${n} 'any' but no budget entry — add it to ${path.relative(process.cwd(), BUDGET_PATH).replace(/\\/g, "/")}`);
    failed = true;
  } else if (n > max) {
    console.error(`any-budget: ${rel} has ${n} 'any' > budget ${max}`);
    failed = true;
  }
}

// 3) Stale budgets — file dropped below budget should be tightened
for (const rel of Object.keys(perFileBudget)) {
  const actual = perFile[rel] ?? 0;
  if (actual < perFileBudget[rel]) {
    console.warn(`any-budget: ${rel} budgeted ${perFileBudget[rel]} but only has ${actual} — tighten to ${actual} when convenient`);
  }
}

process.exit(failed ? 1 : 0);
