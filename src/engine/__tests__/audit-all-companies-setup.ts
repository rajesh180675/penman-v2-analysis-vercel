import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull } from "../pipeline";
import { buildValuationCommandCenter } from "../valuationCommandCenter";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { getAnalysisPolicyVersions } from "../policyVersions";
import { DEFAULT_CONFIG, EngineConfig, RecastPeriod } from "../types";
import { it, expect } from "vitest";
import type { ValuationCommandCenterOutput } from "../valuationCommandCenter";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");
const REGISTRY_PATH = join(COMPANIES_DIR, "registry.json");
const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Array<{
  folder: string; ticker: string; type: string;
}>;

interface ExpectationsContract {
  companyId: string;
  companyName: string;
  expectedRigorLevel: string;
  expectedParserFidelityStatus: string;
  expectedReconciliationStatus: string;
  expectedEconomicSanityStatus: string;
  expectedConceptIdentityStatus: string;
  keyMetricTolerances: Record<string, { min: number; max: number }>;
  expectedAnomalyFlags: string[];
  expectedUnusualItemCount: { min: number; max: number };
  expectedRunsCleanWorkbook: boolean;
  notes?: string;
}

/**
 * Sector-superset metric bag. Industrial fills RNOA/ROCE/NFO_to_CSE;
 * banks/NBFCs fill NIM/ROA/ROE/leverage/spread/etc.; insurers fill
 * combined-ratio/float-leverage. expectations.json declares which keys it
 * wants to band-check; the harness reads them out of this bag at gate time.
 */
type SectorMetrics = {
  // Industrial (Penman-Nissim)
  RNOA?: number | null;
  ROCE?: number | null;
  NFO_to_CSE?: number | null;
  // Bank / NBFC (bankMetrics)
  NIM?: number | null;
  ROA?: number | null;
  ROE?: number | null;
  leverage?: number | null;
  spread?: number | null;
  creditCost?: number | null;
  costToIncome?: number | null;
  casaRatio?: number | null;
  yieldOnAdvances?: number | null;
  costOfBorrowings?: number | null;
  // Insurance (bankMetrics with subtype === "insurance")
  claimsRatio?: number | null;
  expenseRatio?: number | null;
  combinedRatio?: number | null;
  floatToEquity?: number | null;
  investmentYield?: number | null;
  premiumGrowth?: number | null;
  // Quality-sidecar (banks only when joined)
  GNPA?: number | null;
  NNPA?: number | null;
  PCR?: number | null;
  CRAR?: number | null;
};

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
  // Phase 2.1 — expectations gate context
  hasExpectations: boolean;
  // Phase 2.2 — pipeline dispatch family.
  // industrial → metrics from result.periods[last].ratios
  // financial-institution → metrics from result.bankResult.bankMetrics[last]
  family?: "industrial" | "financial-institution";
  metrics?: SectorMetrics;
  rigorLevel?: string;
  parserFidelityStatus?: string;
  reconciliationStatus?: string;
  anomalyFlagKeys?: string[];
  error?: string;
}

function readExpectations(folder: string): ExpectationsContract | null {
  const p = join(COMPANIES_DIR, folder, "expectations.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as ExpectationsContract;
}

function safeRatio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null) return null;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

export function createAuditTests({ start, size }: { start: number; size: number }) {
  const slice = registry.slice(start, start + size);
  const results: AuditResult[] = [];

  for (const company of slice) {
    const expectations = readExpectations(company.folder);
    const expectationsLabel = expectations ? " [expectations gate]" : "";

    it(`${company.folder} (${company.ticker}) — valuation is valid${expectationsLabel}`, async () => {
      const result = await auditCompany(company);
      results.push(result);

      // Pipeline crash always fails.
      if (result.flags.some((f) => f.startsWith("ERROR"))) {
        expect(result.flags, `pipeline crashed: ${result.error}`).toEqual([]);
      }

      // Universal weak gates — apply to all companies.
      // Industrial path produces RecastPeriod[]; financial-institution path
      // produces BankPeriodMetrics[]. Both surface a periods count.
      expect(result.periods).toBeGreaterThanOrEqual(2);
      // Scenario gates apply only to the industrial path. Bank/NBFC/insurance
      // valuations live under bankResult.valuation (BankValuationBundle), not
      // valuation.scenarios; their stress/base/bull are null here by design.
      if (result.family === "industrial") {
        expect(result.stress).not.toBeNull();
        expect(result.base).not.toBeNull();
      }

      // Strict gates — apply only when expectations.json is present.
      // This is the Phase 2.1 regression gate: ROCE sign flips, RNOA
      // collapses, terminal-valuation drift would all be caught here.
      if (expectations) {
        // (a) Rigor level matches
        if (result.rigorLevel) {
          expect(
            result.rigorLevel,
            `rigor level drift: expected "${expectations.expectedRigorLevel}", got "${result.rigorLevel}"`,
          ).toBe(expectations.expectedRigorLevel);
        }
        // (b) Parser fidelity status
        if (result.parserFidelityStatus) {
          expect(
            result.parserFidelityStatus,
            `parser fidelity drift: expected "${expectations.expectedParserFidelityStatus}"`,
          ).toBe(expectations.expectedParserFidelityStatus);
        }
        // (c) Reconciliation status
        if (result.reconciliationStatus) {
          expect(
            result.reconciliationStatus,
            `reconciliation status drift: expected "${expectations.expectedReconciliationStatus}"`,
          ).toBe(expectations.expectedReconciliationStatus);
        }
        // (d) keyMetricTolerances — assert each metric is within band
        if (result.metrics) {
          for (const [metric, band] of Object.entries(expectations.keyMetricTolerances)) {
            const value = result.metrics[metric as keyof typeof result.metrics];
            if (value == null || !Number.isFinite(value)) {
              throw new Error(`metric "${metric}" expected in [${band.min}, ${band.max}] but value is ${value}`);
            }
            expect(value, `${metric} out of band [${band.min}, ${band.max}]: got ${value}`)
              .toBeGreaterThanOrEqual(band.min);
            expect(value, `${metric} out of band [${band.min}, ${band.max}]: got ${value}`)
              .toBeLessThanOrEqual(band.max);
          }
        }
        // (e) Anomaly flags — every expected flag must appear in the
        // observed set (subset check; observed may legitimately include
        // additional minor flags without failing the gate).
        if (result.anomalyFlagKeys && expectations.expectedAnomalyFlags.length > 0) {
          for (const expectedFlag of expectations.expectedAnomalyFlags) {
            expect(
              result.anomalyFlagKeys,
              `expected anomaly flag "${expectedFlag}" not raised by pipeline`,
            ).toContain(expectedFlag);
          }
        }
      }
    }, 120_000);
  }

  it("print shard summary", () => {
    const errorResults = results.filter((r) => r.flags.length);
    const okResults = results.filter((r) => !r.flags.length);
    const gatedResults = results.filter((r) => r.hasExpectations);

    // eslint-disable-next-line no-console
    console.log(
      `\n[Shard ${start}-${start + size}] ` +
      `${okResults.length}/${results.length} clean, ` +
      `${errorResults.length} flagged, ` +
      `${gatedResults.length} with expectations.json (strict gate)`,
    );

    for (const r of errorResults) {
      // eslint-disable-next-line no-console
      console.log(`  ${r.folder} (${r.ticker}): ${r.flags.join(", ")}`);
    }
  });
}

async function auditCompany(company: { folder: string; ticker: string; type: string }): Promise<AuditResult> {
  const hasExpectations = existsSync(join(COMPANIES_DIR, company.folder, "expectations.json"));
  const empty: AuditResult = {
    folder: company.folder, ticker: company.ticker, type: company.type,
    periods: 0, stress: null, base: null, bull: null, revDcf: null,
    sotp: null, epv: null, evEbitda: null, flags: [],
    hasExpectations,
  };

  const zipPath = join(COMPANIES_DIR, company.folder, `${company.folder}.zip`);
  if (!existsSync(zipPath)) {
    return { ...empty, flags: ["MISSING_ZIP"] };
  }

  try {
    const buf = readFileSync(zipPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const parsed = await parseCapitalineZip(u8, { companyId: company.folder, filename: `${company.folder}.zip` });
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: company.type as EngineConfig["company_type"] };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    const family = pipeline.analysisFamily;

    // Common envelope (works for both families — buildAnalysisTraceability
    // is sector-agnostic; banks pass an empty recastData and the envelope
    // walks parserFidelity / mapping / concept identity normally).
    const trace = buildAnalysisTraceability({
      generatedAt: "2026-05-30T00:00:00.000Z",
      runId: `audit-${company.folder}`,
      companyId: company.folder,
      sourceMode: "capitaline",
      recastData: pipeline.periods,
      config,
      rawData: parsed.periods,
      periodCount: parsed.periods.length,
      recastPeriodCount: pipeline.periods.length,
      latestPeriod: parsed.periods[parsed.periods.length - 1]?.period_end ?? null,
      policyVersions: getAnalysisPolicyVersions(),
      debugInfo: parsed.debug,
      hasDebugInfo: Boolean(parsed.debug),
      debugFiles: parsed.debug?.files?.length ?? 0,
      rawMetricKeyCount: parsed.debug?.rawMetricKeys?.length ?? 0,
      bankMetrics: pipeline.bankResult?.bankMetrics ?? null,
      bankSubtype: pipeline.bankResult?.subtype ?? null,
    });

    const anomalyFlagKeys = pipeline.anomalies.terminalFlags
      .map((f) => f.spec_id)
      .filter((c): c is string => typeof c === "string");

    if (family === "financial-institution") {
      // Banks/NBFCs/insurance: metrics come from bankResult.bankMetrics.
      // valuation.scenarios is empty (those live on bankResult.valuation),
      // so industrial-style scenario gates are skipped at the call site.
      const bm = pipeline.bankResult?.bankMetrics ?? [];
      const latestBm = bm[bm.length - 1];
      const metrics: SectorMetrics = {
        NIM: latestBm?.nim ?? null,
        ROA: latestBm?.roa ?? null,
        ROE: latestBm?.roe ?? null,
        leverage: latestBm?.leverage ?? null,
        spread: latestBm?.spread ?? null,
        creditCost: latestBm?.creditCost ?? null,
        costToIncome: latestBm?.costToIncome ?? null,
        casaRatio: latestBm?.casaRatio ?? null,
        yieldOnAdvances: latestBm?.yieldOnAdvances ?? null,
        costOfBorrowings: latestBm?.costOfBorrowings ?? null,
        claimsRatio: latestBm?.claimsRatio ?? null,
        expenseRatio: latestBm?.expenseRatio ?? null,
        combinedRatio: latestBm?.combinedRatio ?? null,
        floatToEquity: latestBm?.floatToEquity ?? null,
        investmentYield: latestBm?.investmentYield ?? null,
        premiumGrowth: latestBm?.premiumGrowth ?? null,
        // Quality-sidecar passthroughs (null when no sidecar)
        GNPA: latestBm?.quality?.gnpa_pct != null ? latestBm.quality.gnpa_pct / 100 : null,
        NNPA: latestBm?.quality?.nnpa_pct != null ? latestBm.quality.nnpa_pct / 100 : null,
        PCR: latestBm?.quality?.pcr_pct != null ? latestBm.quality.pcr_pct / 100 : null,
        CRAR: latestBm?.quality?.crar_pct != null ? latestBm.quality.crar_pct / 100 : null,
      };
      return {
        ...empty,
        family,
        periods: bm.length,
        metrics,
        rigorLevel: trace.rigor.currentLevel,
        parserFidelityStatus: trace.parserFidelity.status,
        reconciliationStatus: trace.reconciliation.status,
        anomalyFlagKeys,
        flags: [],
      };
    }

    // Industrial path
    const periods = pipeline.periods;
    const latest: RecastPeriod | undefined = periods[periods.length - 1];

    const valuation = buildValuationCommandCenter({
      data: periods, config, marketData: null,
      analysisStatus: null, segmentData: parsed.segmentData || null,
    } as never) as ValuationCommandCenterOutput;

    const scenarios = valuation.scenarios || [];
    const stress = scenarios.find((s) => s.key === "stress")?.intrinsicPerShare ?? null;
    const base = scenarios.find((s) => s.key === "base")?.intrinsicPerShare ?? null;
    const bull = scenarios.find((s) => s.key === "bull")?.intrinsicPerShare ?? null;
    const companyFlags: string[] = [];

    if (stress !== null && !Number.isFinite(stress)) companyFlags.push("STRESS_INVALID");
    if (base !== null && !Number.isFinite(base)) companyFlags.push("BASE_INVALID");
    if (bull !== null && !Number.isFinite(bull)) companyFlags.push("BULL_INVALID");
    if (stress !== null && base !== null && stress > base) companyFlags.push("STRESS_GT_BASE");
    if (base !== null && bull !== null && base > bull) companyFlags.push("BASE_GT_BULL");
    if (base !== null && base < 0) companyFlags.push("NEGATIVE_BASE");

    const revDcf = valuation.reverseDcf?.impliedOwnerEarningsGrowth ?? null;
    if (revDcf !== null && !Number.isFinite(revDcf)) companyFlags.push("REVDCF_INVALID");
    const sotp = valuation.sotp?.totalEnterpriseValue ?? null;
    if (company.type === "conglomerate" && sotp === null) companyFlags.push("CONGLO_NO_SOTP");
    const epv = valuation.epv?.epvPerShare ?? null;
    if (epv !== null && !Number.isFinite(epv)) companyFlags.push("EPV_INVALID");
    const evEbitda = valuation.evEbitda?.enterpriseValue ?? null;
    if (evEbitda !== null && !Number.isFinite(evEbitda)) companyFlags.push("EVEBITDA_INVALID");
    if (!scenarios.length) companyFlags.push("NO_SCENARIOS");

    const metrics: SectorMetrics = {
      RNOA: latest?.ratios?.RNOA ?? null,
      ROCE: latest?.ratios?.ROCE ?? null,
      NFO_to_CSE: safeRatio(latest?.bs.NFO ?? null, latest?.bs.CSE ?? null),
    };

    return {
      ...empty,
      family,
      periods: periods.length, stress, base, bull, revDcf, sotp, epv, evEbitda,
      flags: companyFlags,
      metrics,
      rigorLevel: trace.rigor.currentLevel,
      parserFidelityStatus: trace.parserFidelity.status,
      reconciliationStatus: trace.reconciliation.status,
      anomalyFlagKeys,
    };
  } catch (error) {
    const msg = (error as Error).message;
    return { ...empty, flags: [`ERROR: ${msg}`], error: msg };
  }
}
