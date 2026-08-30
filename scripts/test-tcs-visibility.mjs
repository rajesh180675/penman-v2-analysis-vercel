/**
 * Quick TCS-only visibility test.
 * Usage: npx tsx scripts/test-tcs-visibility.mjs
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
  console.log(`ZIP: ${zipPath}`);
  const zipBuf = readFileSync(zipPath);
  console.log(`ZIP size: ${(zipBuf.length / 1024).toFixed(0)} KB`);

  const zipBytes = new Uint8Array(zipBuf);

  console.log("Parsing...");
  const t0 = Date.now();
  const { periods, debug } = await parseCapitalineZip(zipBytes, {
    companyId: folder,
    filename: `${folder}.zip`,
  });
  console.log(`Parse took ${Date.now() - t0}ms`);
  console.log(`Periods: ${periods.length}`);
  console.log(`Files parsed: ${debug?.files?.length ?? 0}`);
  if (debug?.files) {
    for (const f of debug.files) {
      console.log(`  ${f.file}: rows=${f.rowCount} method=${f.bestMethod} errors=${f.errors.length}`);
    }
  }

  if (periods.length === 0) {
    console.log("*** PARSED ZERO PERIODS — this is the bug ***");
    process.exit(1);
  }

  // Check first period's raw keys
  if (periods.length > 0) {
    const p0 = periods[0];
    console.log(`\nFirst period: ${p0.period_end}`);
    console.log(`  company_id: ${p0.company_id}`);
    const keys = Object.keys(p0.raw_metric_values);
    console.log(`  raw_metric_values: ${keys.length} keys`);
    const sampleKeys = keys.slice(0, 10);
    console.log(`  sample keys: ${sampleKeys.join(", ")}`);
    // Check critical keys
    const critical = ["Total Assets", "Total Stockholders' Equity", "Profit After Tax", "Revenue From Operations(Net)"];
    for (const k of critical) {
      const found = keys.find(key => key.toLowerCase().includes(k.toLowerCase()));
      console.log(`  '${k}': ${found ? `FOUND as '${found}' = ${p0.raw_metric_values[found]}` : "NOT FOUND"}`);
    }
  }

  console.log("\nRunning pipeline...");
  const t1 = Date.now();
  const config = { ...DEFAULT_CONFIG, company_type: "auto" };
  let pipelineResult;
  try {
    pipelineResult = processCompanyDataFull(periods, config);
  } catch (err) {
    console.log(`PIPELINE THREW: ${err instanceof Error ? err.message : String(err)}`);
    console.log(err instanceof Error ? err.stack : "");
    process.exit(1);
  }
  console.log(`Pipeline took ${Date.now() - t1}ms`);
  console.log(`Family: ${pipelineResult.analysisFamily}`);
  console.log(`Strategy: ${pipelineResult.pipelineStrategyId}`);
  console.log(`Recast periods: ${pipelineResult.periods.length}`);
  console.log(`Has bankResult: ${pipelineResult.bankResult != null}`);
  console.log(`Dashboard visible: ${pipelineResult.periods.length > 0 || pipelineResult.bankResult != null}`);

  if (pipelineResult.periods.length === 0 && !pipelineResult.bankResult) {
    console.log("*** DASHBOARD TAB HIDDEN — no recastData and no bankResult ***");
    if (pipelineResult.frequencyWarning) {
      console.log(`Frequency warning: ${pipelineResult.frequencyWarning}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
