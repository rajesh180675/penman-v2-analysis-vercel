/**
 * End-to-end test: parse every company ZIP → run pipeline → check tab visibility.
 *
 * Usage: npx tsx scripts/test-all-companies-visibility.mjs
 *
 * Reports for each company:
 *   - parsed period count
 *   - pipeline family (industrial / financial-institution)
 *   - recast period count (hasRecast)
 *   - bankResult presence
 *   - dashboard tab visible?
 *
 * Exits non-zero if any company fails to show the dashboard tab.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitalineZip } from "../src/engine/capitalineParser.ts";
import { processCompanyDataFull } from "../src/engine/pipeline.ts";
import { DEFAULT_CONFIG } from "../src/engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPANIES_DIR = join(__dirname, "..", "public", "data", "companies");

function listCompanyFolders() {
  return readdirSync(COMPANIES_DIR, { withFileTypes: true })
    .filter((e) => {
      if (!e.isDirectory()) return false;
      const zipPath = join(COMPANIES_DIR, e.name, `${e.name}.zip`);
      return existsSync(zipPath);
    })
    .map((e) => e.name)
    .sort();
}

async function testCompany(folder) {
  const zipPath = join(COMPANIES_DIR, folder, `${folder}.zip`);
  const zipBuf = readFileSync(zipPath);
  const zipBytes = new Uint8Array(zipBuf);

  try {
    const { periods, debug } = await parseCapitalineZip(zipBytes, {
      companyId: folder,
      filename: `${folder}.zip`,
    });

    if (!periods || periods.length === 0) {
      return {
        folder,
        status: "PARSE_ZERO_PERIODS",
        periodCount: 0,
        filesParsed: debug?.files?.length ?? 0,
        recastCount: 0,
        family: null,
        hasBankResult: false,
        dashboardVisible: false,
      };
    }

    const config = { ...DEFAULT_CONFIG, company_type: "auto" };
    let pipelineResult;
    try {
      pipelineResult = processCompanyDataFull(periods, config);
    } catch (err) {
      return {
        folder,
        status: "PIPELINE_THREW",
        error: err instanceof Error ? err.message : String(err),
        periodCount: periods.length,
        filesParsed: debug?.files?.length ?? 0,
        recastCount: 0,
        family: null,
        hasBankResult: false,
        dashboardVisible: false,
      };
    }

    const recastCount = pipelineResult.periods.length;
    const family = pipelineResult.analysisFamily;
    const hasBankResult = pipelineResult.bankResult != null;
    const dashboardVisible = recastCount > 0 || hasBankResult;

    return {
      folder,
      status: dashboardVisible ? "OK" : "DASHBOARD_HIDDEN",
      periodCount: periods.length,
      filesParsed: debug?.files?.length ?? 0,
      recastCount,
      family,
      strategy: pipelineResult.pipelineStrategyId,
      hasBankResult,
      dashboardVisible,
    };
  } catch (err) {
    return {
      folder,
      status: "PARSE_FAILED",
      error: err instanceof Error ? err.message : String(err),
      periodCount: 0,
      recastCount: 0,
      family: null,
      hasBankResult: false,
      dashboardVisible: false,
    };
  }
}

async function main() {
  const folders = listCompanyFolders();
  console.log(`\nTesting ${folders.length} companies...\n`);

  const results = [];
  let failures = 0;

  for (const folder of folders) {
    process.stdout.write(`${folder.padEnd(45)} ... `);
    const result = await testCompany(folder);
    results.push(result);

    if (result.dashboardVisible) {
      console.log(`OK  periods=${String(result.periodCount).padStart(3)} recast=${String(result.recastCount).padStart(3)} family=${result.family ?? "N/A"}`);
    } else {
      failures++;
      console.log(`*** DASHBOARD HIDDEN *** ${result.status}`);
      if (result.error) console.log(`    error: ${result.error}`);
      console.log(`    periods=${result.periodCount} recast=${result.recastCount} family=${result.family ?? "N/A"} bankResult=${result.hasBankResult}`);
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Results: ${results.length - failures} OK, ${failures} HIDDEN`);

  if (failures > 0) {
    console.log(`\nCompanies with hidden dashboard:`);
    for (const r of results.filter((r) => !r.dashboardVisible)) {
      console.log(`  ${r.folder}: ${r.status} (periods=${r.periodCount}, recast=${r.recastCount}, family=${r.family})`);
      if (r.error) console.log(`    ${r.error}`);
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
