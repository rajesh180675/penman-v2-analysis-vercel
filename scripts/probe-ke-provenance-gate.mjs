/**
 * Probe: does the ke provenance gate actually downgrade a run that would
 * otherwise reach production-ready?
 *
 * Runs each of the 5 expectations-gated golden companies through the same
 * `auditCompanyRun` the all-companies audit uses, twice:
 *   1. gate ON  (default — rigor.assumptionProvenanceBlock enabled)
 *   2. gate OFF (VITE_RIGOR_ASSUMPTION_PROVENANCE_BLOCK=false)
 *
 * If the gate is what holds a company at `valuation-eligible`, turning it OFF
 * should let that company drift to `production-ready` — which would mean the
 * all-companies audit (audit-all-companies-setup.ts:174, exact rigorLevel
 * match) WOULD catch a gate regression, and the residual e2e gap is covered.
 * If no company drifts, they sit at their target for other reasons and the
 * gate's downgrade has no e2e coverage.
 *
 * Usage: npx tsx scripts/probe-ke-provenance-gate.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { auditCompanyRun } from "./lib/auditCompanyRun.ts";

const PROJECT_ROOT = resolve(process.cwd());
const COMPANIES_DIR = join(PROJECT_ROOT, "public/data/companies");
const registry = JSON.parse(readFileSync(join(COMPANIES_DIR, "registry.json"), "utf-8"));

const GOLDEN_FOLDERS = ["Asian Paints", "HDFC Bank", "Bajaj Finance", "NTPC", "Reliance Industries"];
const targets = registry.filter((c) => GOLDEN_FOLDERS.includes(c.folder));

function readTarget(folder) {
  const p = join(COMPANIES_DIR, folder, "expectations.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")).targetState?.expectedRigorLevel ?? "?" : "?";
}

function gateOff() {
  process.env.VITE_RIGOR_ASSUMPTION_PROVENANCE_BLOCK = "false";
}
function gateOn() {
  delete process.env.VITE_RIGOR_ASSUMPTION_PROVENANCE_BLOCK;
}

for (const company of targets) {
  gateOn();
  const on = await auditCompanyRun(company, { projectRoot: PROJECT_ROOT });
  gateOff();
  const off = await auditCompanyRun(company, { projectRoot: PROJECT_ROOT });
  gateOn();

  const drift = on.rigorLevel !== off.rigorLevel || on.rigor?.confidenceStatus !== off.rigor?.confidenceStatus;

  console.log(`${company.folder.padEnd(22)} target=${readTarget(company.folder)}`);
  console.log(`  gate ON : rigor=${on.rigorLevel} confidence=${on.rigor?.confidenceStatus} prov=${on.rigor?.assumptionProvenanceStatus}`);
  console.log(`  gate OFF: rigor=${off.rigorLevel} confidence=${off.rigor?.confidenceStatus} prov=${off.rigor?.assumptionProvenanceStatus}`);
  console.log(`  ${drift ? ">>> DRIFTS — gate is load-bearing here; the audit would catch a regression" : "no drift — held at target by another gate, not the provenance gate"}`);
}
console.log("\nDone.");
