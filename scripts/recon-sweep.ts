#!/usr/bin/env tsx
/**
 * recon-sweep.ts — run the industrial pipeline per company and dump
 * reconciliation residual check stats (per key: count, worst, median ratio,
 * mean absolute residual, basis scale) so gate calibration is data-driven.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../src/engine/capitalineParser";
import { DEFAULT_CONFIG } from "../src/engine/types";
import { processCompanyDataFull } from "../src/engine/pipeline";
import { evaluateReconciliationResiduals } from "../src/engine/reconciliationResiduals";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPANIES = join(ROOT, "public", "data", "companies");
const registry: { folder: string; ticker: string; type: string }[] =
  JSON.parse(readFileSync(join(COMPANIES, "registry.json"), "utf-8"));

type KeyStat = { n: number; fail: number; warn: number; worst: number; absRes: number[]; absent: number };
const globalStats: Record<string, KeyStat> = {};
const perCompany: { ticker: string; status: string; maxRatio: number; worstKey: string }[] = [];

for (const company of registry) {
  const zipPath = join(COMPANIES, company.folder, `${company.folder}.zip`);
  if (!existsSync(zipPath)) continue;
  try {
    const buf = readFileSync(zipPath);
    const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: company.folder, filename: `${company.folder}.zip` });
    const config = { ...DEFAULT_CONFIG, company_type: company.type as typeof DEFAULT_CONFIG.company_type };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    const recon = evaluateReconciliationResiduals({ recastData: pipeline.periods, config });
    let worstKey = "", worstRatio = -1;
    for (const c of recon.checks) {
      const s = (globalStats[c.key] ??= { n: 0, fail: 0, warn: 0, worst: 0, absRes: [], absent: 0 });
      s.n++;
      if (c.status === "failed") s.fail++;
      if (c.status === "degraded") s.warn++;
      s.worst = Math.max(s.worst, c.ratio);
      s.absRes.push(c.ratio);
      if (c.ratio > worstRatio) { worstRatio = c.ratio; worstKey = c.key; }
    }
    perCompany.push({ ticker: company.ticker, status: recon.status, maxRatio: recon.maxResidualRatio, worstKey });
  } catch (e) {
    perCompany.push({ ticker: company.ticker, status: "ERROR", maxRatio: -1, worstKey: String((e as Error).message).slice(0, 60) });
  }
}

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

console.log("=== PER-KEY GLOBAL STATS (all companies) ===");
console.log("key | periods | failed | degraded | worst% | median%");
for (const [k, s] of Object.entries(globalStats).sort((a, b) => b[1].fail - a[1].fail)) {
  console.log(`${k} | ${s.n} | ${s.fail} | ${s.warn} | ${(s.worst * 100).toFixed(1)} | ${(med(s.absRes) * 100).toFixed(2)}`);
}
console.log("\n=== PER-COMPANY ===");
for (const c of perCompany) console.log(`${c.ticker} | ${c.status} | max ${(c.maxRatio * 100).toFixed(1)}% | worst: ${c.worstKey}`);
console.log(`\nCONFIRMED: ${perCompany.filter((c) => c.status === "confirmed").length}, DEGRADED: ${perCompany.filter((c) => c.status === "degraded").length}, FAILED: ${perCompany.filter((c) => c.status === "failed").length}, ERROR: ${perCompany.filter((c) => c.status === "ERROR").length}`);
