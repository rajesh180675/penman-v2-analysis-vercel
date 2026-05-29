#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 1.4 — doc schema pin check.
 *
 * Reads TRACEABILITY_SCHEMA_VERSION from src/engine/policyVersions.ts
 * and fails if any tracked top-level doc references a different
 * `traceability-v\d+` literal. Prevents the v8/v17 drift that surfaced
 * in the multi-agent codebase review.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const POLICY_FILE = path.join(ROOT, "src", "engine", "policyVersions.ts");
const DOCS_TO_CHECK = ["CLAUDE.md", "RIGOR_KNOWLEDGE_BASE.md"];

function readSchemaVersion() {
  if (!fs.existsSync(POLICY_FILE)) {
    console.error(`doc-schema-pin: policy file missing at ${POLICY_FILE}`);
    process.exit(2);
  }
  const content = fs.readFileSync(POLICY_FILE, "utf8");
  const match = content.match(/TRACEABILITY_SCHEMA_VERSION\s*=\s*["']([^"']+)["']/);
  if (!match) {
    console.error(
      `doc-schema-pin: could not parse TRACEABILITY_SCHEMA_VERSION from ${POLICY_FILE}`,
    );
    process.exit(2);
  }
  return match[1];
}

function checkDoc(relPath, expected) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return [];
  const content = fs.readFileSync(fullPath, "utf8");
  const lines = content.split(/\r?\n/);
  const re = /\b(?:\d{4}-\d{2}-)?traceability-v\d+\b/g;
  const failures = [];
  lines.forEach((line, idx) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[0] !== expected) {
        failures.push({ file: relPath, line: idx + 1, found: m[0] });
      }
    }
  });
  return failures;
}

const expected = readSchemaVersion();
const failures = DOCS_TO_CHECK.flatMap((doc) => checkDoc(doc, expected));

if (failures.length > 0) {
  console.error(`doc-schema-pin: stale schema references found. Expected: ${expected}`);
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  found: ${f.found}`);
  }
  console.error(
    `\nUpdate the docs to match TRACEABILITY_SCHEMA_VERSION, or update the version in src/engine/policyVersions.ts and add an ADR for the bump.`,
  );
  process.exit(1);
}
console.log(`doc-schema-pin: OK — all references match ${expected}`);
