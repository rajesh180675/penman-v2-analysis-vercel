/**
 * Quick TCS pipeline test.
 * Usage: npx tsx scripts/test-tcs-pipeline.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../src/engine/capitalineParser.ts";
import { processCompanyDataFull } from "../src/engine/pipeline.ts";
import { DEFAULT_CONFIG } from "../src/engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPANIES_DIR = join(__dirname, "..", "public", "data", "companies");

async function main() {
  const folder = "Tata Consultancy Services Ltd";
  console.log(`Testing ${folder}...`);

  const zipPath = join(COMPANIES_DIR, folder, `${folder}.zip`);
  const zipBuf = readFileSync(zipPath);
  console.log(`ZIP size: ${(zipBuf.length / 1024).toFixed(0)} KB`);

  console.log("Parsing...");
  const t0 = Date.now();
  const result = await parseCapitalineZip(new Uint8Array(zipBuf), {
    companyId: folder,
    filename: `${folder}.zip`,
  });
  console.log(`Parse took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`Periods: ${result.periods.length}`);

  if (result.periods.length === 0) {
    console.log("*** ZERO PERIODS ***");
    process.exit(1);
  }

  // Check first period's raw keys
  const p0 = result.periods[0];
  console.log(`\nFirst period: ${p0.period_end}`);
  const keys = Object.keys(p0.raw_metric_values);
  console.log(`raw_metric_values: ${keys.length} keys`);
  const critical = ["Total Assets", "Total Stockholders", "Profit After Tax", "Revenue From Operations"];
  for (const k of critical) {
    const found = keys.find(key => key.toLowerCase().includes(k.toLowerCase()));
    console.log(`  '${k}': ${found ? `FOUND = ${p0.raw_metric_values[found]}` : "NOT FOUND"}`);
  }

  console.log("\nRunning pipeline...");
  const t1 = Date.now();
  const config = { ...DEFAULT_CONFIG, company_type: "auto" };
  let pipelineResult;
  try {
    pipelineResult = processCompanyDataFull(result.periods, config);
  } catch (err) {
    console.log(`PIPELINE THREW: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error) console.log(err.stack);
    process.exit(1);
  }
  console.log(`Pipeline took ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(`Family: ${pipelineResult.analysisFamily}`);
  console.log(`Strategy: ${pipelineResult.pipelineStrategyId}`);
  console.log(`Recast periods: ${pipelineResult.periods.length}`);
  console.log(`Has bankResult: ${pipelineResult.bankResult != null}`);
  console.log(`Dashboard visible: ${pipelineResult.periods.length > 0 || pipelineResult.bankResult != null}`);

  if (pipelineResult.periods.length > 0) {
    const last = pipelineResult.periods[pipelineResult.periods.length - 1];
    console.log(`\nLast recast period: ${last.period_end}`);
    console.log(`  bs.TA: ${last.bs?.TA}`);
    console.log(`  bs.CSE: ${last.bs?.CSE}`);
    console.log(`  is.Sales: ${last.is?.Sales}`);
    console.log(`  is.PAT: ${last.is?.PAT}`);
    console.log(`  has ratios: ${last.ratios != null}`);
    console.log(`  has ri: ${last.ri != null}`);
    console.log(`  has quality: ${last.quality != null}`);
  }

  if (pipelineResult.periods.length === 0 && !pipelineResult.bankResult) {
    console.log("*** DASHBOARD TAB HIDDEN ***");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
