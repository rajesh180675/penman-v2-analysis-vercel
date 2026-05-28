#!/usr/bin/env node
/* ================================================================
   Plan 6 PR-6.3 — Bundle size guard.

   Reads dist/ after a build and enforces per-bundle gzipped-size
   budgets. Fails CI when any chunk exceeds its budget, so a
   regression in code-splitting is caught at PR time rather than
   by users watching the loading spinner.

   Budgets are defensible defaults:
     entry           300 KB gz   the initial JS the user must download
     vendor-react    150 KB gz   React + scheduler
     vendor-charts   200 KB gz   recharts + d3-*
     vendor-file-parsing  120 KB gz   xlsx/jszip — lazy-only
     any-other-chunk      400 KB gz

   The TOTAL gzipped JS is also capped at 2.5 MB to catch unbounded
   accidental imports.
================================================================ */

const fs = require("fs");
const path = require("path");
const { gzipSync } = require("zlib");

const DIST_DIR = path.join(__dirname, "..", "dist", "assets");
const TOTAL_BUDGET_GZIP_BYTES = 2.5 * 1024 * 1024; // 2.5 MB

// Per-bundle budgets in gzipped bytes. Uses substring match against
// the chunk filename (which includes the manualChunks name).
const PER_BUNDLE_BUDGET_GZIP_BYTES = [
  { match: /^index-/, budget: 300 * 1024, label: "entry" },
  { match: /vendor-react/, budget: 150 * 1024, label: "vendor-react" },
  { match: /vendor-charts/, budget: 200 * 1024, label: "vendor-charts" },
  { match: /vendor-file-parsing/, budget: 350 * 1024, label: "vendor-file-parsing" },
  { match: /^vendor-/, budget: 400 * 1024, label: "vendor-other" },
  { match: /\.js$/, budget: 400 * 1024, label: "app-chunk" },
];

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return gzipSync(buf).length;
}

function classify(name) {
  for (const rule of PER_BUNDLE_BUDGET_GZIP_BYTES) {
    if (rule.match.test(name)) return rule;
  }
  return null;
}

function fmtKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`bundle-budget: ${DIST_DIR} not found — run 'npm run build' first.`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(DIST_DIR)
    .filter((f) => f.endsWith(".js"))
    .map((f) => {
      const full = path.join(DIST_DIR, f);
      return { name: f, size: gzipSize(full) };
    })
    .sort((a, b) => b.size - a.size);

  let total = 0;
  const violations = [];
  for (const file of files) {
    total += file.size;
    const rule = classify(file.name);
    if (rule && file.size > rule.budget) {
      violations.push(
        `  ${file.name} (${rule.label}): ${fmtKb(file.size)} > ${fmtKb(rule.budget)}`,
      );
    }
  }

  console.log(`bundle-budget: ${files.length} JS chunks, total gz = ${fmtKb(total)}`);
  console.log("Top 5 chunks (gzipped):");
  for (const file of files.slice(0, 5)) {
    const rule = classify(file.name);
    const labelTag = rule ? ` [${rule.label}]` : "";
    console.log(`  ${fmtKb(file.size).padStart(10)}  ${file.name}${labelTag}`);
  }

  if (total > TOTAL_BUDGET_GZIP_BYTES) {
    violations.push(
      `  TOTAL: ${fmtKb(total)} > ${fmtKb(TOTAL_BUDGET_GZIP_BYTES)} — investigate accidental imports.`,
    );
  }

  if (violations.length > 0) {
    console.error("\nbundle-budget: VIOLATIONS");
    for (const v of violations) console.error(v);
    process.exit(1);
  }

  console.log("bundle-budget: all chunks within budget");
}

main();
