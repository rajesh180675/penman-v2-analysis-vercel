#!/usr/bin/env node
/**
 * audit-diff.cjs — Compare two audit baselines and surface drift beyond tolerance.
 *
 * Usage:
 *   node scripts/audit-diff.cjs phase1 phase2
 *   node scripts/audit-diff.cjs phase1 phase2 --tolerance=0.05
 *
 * Exit codes:
 *   0 — no drift beyond tolerance
 *   1 — drift detected (CI gate)
 *   2 — usage error
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINES_DIR = path.join(ROOT, "audit-baselines");

const NUMERIC_FIELDS = [
  ["valuation", "stress"],
  ["valuation", "base"],
  ["valuation", "bull"],
  ["valuation", "revDcfGrowth"],
  ["valuation", "sotpTotal"],
  ["valuation", "epvPerShare"],
  ["valuation", "evEbitdaEv"],
  ["rigor", "parserFidelityScore"],
  ["rigor", "reconciliationMaxRatio"],
];

const STRING_FIELDS = [
  ["rigor", "currentLevel"],
  ["rigor", "parserFidelityStatus"],
  ["rigor", "reconciliationStatus"],
  ["rigor", "confidenceStatus"],
];

let beforeLabel = null;
let afterLabel = null;
let tolerance = 0.05;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--tolerance=")) tolerance = parseFloat(arg.split("=")[1]);
  else if (!beforeLabel) beforeLabel = arg;
  else if (!afterLabel) afterLabel = arg;
}
if (!beforeLabel || !afterLabel) {
  console.error("Usage: node scripts/audit-diff.cjs <before> <after> [--tolerance=0.05]");
  process.exit(2);
}

function load(label) {
  const p = path.join(BASELINES_DIR, `${label}.json`);
  if (!fs.existsSync(p)) {
    console.error(`Missing baseline: ${p}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function get(obj, pathParts) {
  let cur = obj;
  for (const k of pathParts) {
    if (cur == null) return null;
    cur = cur[k];
  }
  return cur;
}

const before = load(beforeLabel);
const after = load(afterLabel);

const beforeMap = new Map(before.entries.map((e) => [e.folder, e]));
const afterMap = new Map(after.entries.map((e) => [e.folder, e]));

const drifts = [];

for (const [folder, a] of afterMap) {
  const b = beforeMap.get(folder);
  if (!b) {
    drifts.push({ folder, kind: "added", detail: `new in ${afterLabel}` });
    continue;
  }
  for (const fp of NUMERIC_FIELDS) {
    const bv = get(b, fp);
    const av = get(a, fp);
    if (bv == null && av == null) continue;
    if (bv == null || av == null) {
      drifts.push({ folder, kind: "null-flip", field: fp.join("."), before: bv, after: av });
      continue;
    }
    const denom = Math.max(Math.abs(bv), Math.abs(av), 1);
    const delta = Math.abs(av - bv) / denom;
    if (delta > tolerance) {
      drifts.push({ folder, kind: "numeric", field: fp.join("."), before: bv, after: av, delta });
    }
  }
  for (const fp of STRING_FIELDS) {
    const bv = get(b, fp);
    const av = get(a, fp);
    if (bv !== av) {
      drifts.push({ folder, kind: "status", field: fp.join("."), before: bv, after: av });
    }
  }
  const bFlags = (b.flags || []).join(",");
  const aFlags = (a.flags || []).join(",");
  if (bFlags !== aFlags) {
    drifts.push({ folder, kind: "flags", before: bFlags || "(none)", after: aFlags || "(none)" });
  }
}

for (const folder of beforeMap.keys()) {
  if (!afterMap.has(folder)) drifts.push({ folder, kind: "removed", detail: `dropped in ${afterLabel}` });
}

console.log(`Diff ${beforeLabel} -> ${afterLabel} (tolerance ${(tolerance * 100).toFixed(1)}%)`);
console.log(`  ${before.entries.length} -> ${after.entries.length} companies`);
console.log("");

if (drifts.length === 0) {
  console.log("OK — no drift beyond tolerance.");
  process.exit(0);
}

const grouped = new Map();
for (const d of drifts) {
  if (!grouped.has(d.folder)) grouped.set(d.folder, []);
  grouped.get(d.folder).push(d);
}

for (const [folder, items] of grouped) {
  console.log(`\n${folder}:`);
  for (const d of items) {
    if (d.kind === "numeric") {
      console.log(`  ${d.field}: ${d.before} -> ${d.after}  (${(d.delta * 100).toFixed(2)}%)`);
    } else if (d.kind === "status") {
      console.log(`  ${d.field}: "${d.before}" -> "${d.after}"`);
    } else if (d.kind === "null-flip") {
      console.log(`  ${d.field}: ${d.before} -> ${d.after}  [null transition]`);
    } else if (d.kind === "flags") {
      console.log(`  flags: [${d.before}] -> [${d.after}]`);
    } else {
      console.log(`  ${d.kind}: ${d.detail}`);
    }
  }
}

console.log(`\n${drifts.length} drift(s) across ${grouped.size} compan${grouped.size === 1 ? "y" : "ies"}.`);
process.exit(1);
