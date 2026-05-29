import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull } from "../pipeline";
import { buildValuationCommandCenter } from "../valuationCommandCenter";
import { DEFAULT_CONFIG, EngineConfig } from "../types";
import { it, expect } from "vitest";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");
const REGISTRY_PATH = join(COMPANIES_DIR, "registry.json");
const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

interface AuditResult {
  folder: string;
  ticker: string;
  type: string;
  periods: number;
  stress: number | null;
  base: number | null;
  bull: number | null;
  revDcf: number | null;
  sotp: number | null;
  epv: number | null;
  evEbitda: number | null;
  flags: string[];
  error?: string;
}

export function createAuditTests({ start, size }: { start: number; size: number }) {
  const slice = registry.slice(start, start + size);
  const results: AuditResult[] = [];

  for (const company of slice) {
    it(`${company.folder} (${company.ticker}) — valuation is valid`, async () => {
      const result = await auditCompany(company);
      results.push(result);

      expect(result.flags).toEqual([]);
      expect(result.periods).toBeGreaterThanOrEqual(3);
      expect(result.stress).not.toBeNull();
      expect(result.base).not.toBeNull();
    }, 120_000);
  }

  it("print shard summary", () => {
    const errorResults = results.filter((r) => r.flags.length);
    const okResults = results.filter((r) => !r.flags.length);

    console.log(
      `\n[Shard ${start}-${start + size}] ` +
      `${okResults.length}/${results.length} clean, ` +
      `${errorResults.length} flagged`,
    );

    for (const r of errorResults) {
      console.log(`  ${r.folder} (${r.ticker}): ${r.flags.join(", ")}`);
    }

    expect(errorResults.length).toBe(0);
  });
}

async function auditCompany(company: any): Promise<AuditResult> {
  const zipPath = join(COMPANIES_DIR, company.folder, `${company.folder}.zip`);
  const hasZip = existsSync(zipPath);

  if (!hasZip) {
    return {
      folder: company.folder, ticker: company.ticker, type: company.type,
      periods: 0, stress: null, base: null, bull: null, revDcf: null,
      sotp: null, epv: null, evEbitda: null, flags: ["MISSING_ZIP"],
    };
  }

  try {
    const buf = readFileSync(zipPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const parsed = await parseCapitalineZip(u8, { companyId: company.folder, filename: `${company.folder}.zip` });
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: company.type as any };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    const periods = pipeline.periods;

    const valuation = buildValuationCommandCenter({
      data: periods, config, marketData: null,
      analysisStatus: null, segmentData: parsed.segmentData || null,
    } as any);

    const scenarios = valuation.scenarios || [];
    const stress = scenarios.find((s: any) => s.key === "stress")?.intrinsicPerShare ?? null;
    const base = scenarios.find((s: any) => s.key === "base")?.intrinsicPerShare ?? null;
    const bull = scenarios.find((s: any) => s.key === "bull")?.intrinsicPerShare ?? null;
    const companyFlags: string[] = [];

    if (stress !== null && !Number.isFinite(stress)) companyFlags.push("STRESS_INVALID");
    if (base !== null && !Number.isFinite(base)) companyFlags.push("BASE_INVALID");
    if (bull !== null && !Number.isFinite(bull)) companyFlags.push("BULL_INVALID");
    if (stress !== null && base !== null && stress > base) companyFlags.push("STRESS_GT_BASE");
    if (base !== null && bull !== null && base > bull) companyFlags.push("BASE_GT_BULL");
    if (base !== null && base < 0) companyFlags.push("NEGATIVE_BASE");

    const revDcf = valuation.reverseDcf?.impliedOwnerEarningsGrowth ?? null;
    if (revDcf !== null && !Number.isFinite(revDcf)) companyFlags.push("REVDCF_INVALID");
    const sotp = (valuation as any).sotp?.totalValue ?? null;
    if (company.type === "conglomerate" && sotp === null) companyFlags.push("CONGLO_NO_SOTP");
    const epv = (valuation as any).epv?.perShare ?? null;
    if (epv !== null && !Number.isFinite(epv)) companyFlags.push("EPV_INVALID");
    const evEbitda = (valuation as any).evEbitda?.enterpriseValue ?? null;
    if (evEbitda !== null && !Number.isFinite(evEbitda)) companyFlags.push("EVEBITDA_INVALID");
    if (!scenarios.length) companyFlags.push("NO_SCENARIOS");

    return {
      folder: company.folder, ticker: company.ticker, type: company.type,
      periods: periods.length, stress, base, bull, revDcf, sotp, epv, evEbitda,
      flags: companyFlags,
    };
  } catch (error: any) {
    return {
      folder: company.folder, ticker: company.ticker, type: company.type,
      periods: 0, stress: null, base: null, bull: null, revDcf: null,
      sotp: null, epv: null, evEbitda: null, flags: [`ERROR: ${error.message}`],
      error: error.message,
    };
  }
}
