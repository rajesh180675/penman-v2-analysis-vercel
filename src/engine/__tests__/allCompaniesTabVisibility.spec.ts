
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseCapitalineZip } from "../../engine/capitalineParser";
import { processCompanyDataFull } from "../../engine/pipeline";
import { DEFAULT_CONFIG } from "../../engine/types";
import type { RawPeriodData, EngineConfig } from "../../engine/types";

const COMPANIES_DIR = join(process.cwd(), "public", "data", "companies");

function loadCompanyZip(folder: string): Buffer | null {
  const zipPath = join(COMPANIES_DIR, folder, `${folder}.zip`);
  if (!existsSync(zipPath)) return null;
  return readFileSync(zipPath);
}

function listCompanyFolders(): string[] {
  return readdirSync(COMPANIES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(COMPANIES_DIR, e.name, `${e.name}.zip`)))
    .map((e) => e.name);
}

describe.skip("all companies tab visibility", () => {
  const folders = listCompanyFolders();
  expect(folders.length).toBeGreaterThan(0);

  for (const folder of folders) {
    it(`${folder}: parse → pipeline → has recastData?`, async () => {
      const zipBuf = loadCompanyZip(folder);
      expect(zipBuf, `${folder}.zip not found`).not.toBeNull();
      if (!zipBuf) return;

      // Parse — convert Buffer to Uint8Array (parseCapitalineZip expects arrayBuffer|Uint8Array)
      const { periods, debug } = await parseCapitalineZip(new Uint8Array(zipBuf), {
        companyId: folder,
        filename: `${folder}.zip`,
      });
      
      const periodCount = periods.length;
      console.log(`  ${folder}: parsed ${periodCount} periods, ${debug?.files.length ?? 0} files`);

      // Pipeline
      const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "auto" as const };
      let pipelineResult;
      try {
        pipelineResult = processCompanyDataFull(periods as RawPeriodData[], config);
      } catch (err) {
        console.log(`  ${folder}: PIPELINE FAILED: ${err instanceof Error ? err.message : String(err)}`);
        // If pipeline throws, tabs will be hidden
        expect.fail(`Pipeline threw for ${folder}: ${err instanceof Error ? err.message : String(err)}`);
      }

      const recastCount = pipelineResult.periods.length;
      const family = pipelineResult.analysisFamily;
      const strategy = pipelineResult.pipelineStrategyId;
      const hasBankResult = pipelineResult.bankResult != null;
      
      console.log(`  ${folder}: family=${family}, strategy=${strategy}, recastPeriods=${recastCount}, hasBankResult=${hasBankResult}`);

      // Dashboard tab requires: hasRecast (recastCount > 0) OR bankResult != null
      const dashboardVisible = recastCount > 0 || hasBankResult;
      console.log(`  ${folder}: dashboardVisible=${dashboardVisible}`);

      if (!dashboardVisible) {
        console.log(`  ${folder}: *** DASHBOARD TAB HIDDEN *** family=${family}, recastData=${recastCount}, bankResult=${hasBankResult}`);
      }
      
      // All companies should show at least dashboard
      expect(dashboardVisible, `${folder}: dashboard tab not visible (family=${family}, recastPeriods=${recastCount}, hasBankResult=${hasBankResult})`).toBe(true);
    }, 120000); // 2 min timeout per company
  }
});
