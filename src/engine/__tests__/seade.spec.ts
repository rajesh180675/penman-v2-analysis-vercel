/**
 * SEADE Milestone A — deterministic, additive, fail-closed, on real data.
 *
 * @vitest-environment node
 *
 * Verifies:
 *  1. Utility derivation produces a ready case input for NTPC and POWERGRID
 *     (rate base, CWIP, regulatory deferrals are observable in their exports).
 *  2. The derived utility input passes executeCatalogSectorCase guards and
 *     produces a finite, positive per-share value.
 *  3. Derivation is deterministic: same input → same output.
 *  4. Telecom derivation fails closed (insufficient-evidence) on BHARTIARTL
 *     because subscriber/ARPU data is not present in standard financials.
 *  5. Provenance is populated for every derived input.
 *  6. The onboarding row is marked ready when derivation succeeds.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull } from "../pipeline";
import { DEFAULT_CONFIG, type RecastPeriod, type EngineConfig } from "../types";
import { resolveShareBasis } from "../shareCountTools";
import { deriveSectorCase } from "../seade/index";
import { executeCatalogSectorCase } from "../sectorCases/index";
import { CURRENT_SECTOR_CASE_REGISTRY } from "../sectorCases/registry";
import type { CompanyType } from "../types";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");

interface Fixture {
  periods: RecastPeriod[];
  config: EngineConfig;
  shares: number | null;
}

async function loadCompany(folder: string, type: Exclude<CompanyType, "auto">): Promise<Fixture | null> {
  const zipPath = resolve(COMPANIES_DIR, folder, `${folder}.zip`);
  if (!existsSync(zipPath)) return null;
  const buf = readFileSync(zipPath);
  const parsed = await parseCapitalineZip(
    new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    { companyId: folder, filename: `${folder}.zip` },
  );
  const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: type };
  const pipeline = processCompanyDataFull(parsed.periods, config);
  const shares = resolveShareBasis(pipeline.periods, config).sharesForPerShare ?? null;
  return { periods: pipeline.periods, config, shares };
}

// Load each fixture once for the whole file; node env keeps memory bounded.
let ntpc: Fixture | null = null;
let powergrid: Fixture | null = null;
let bharti: Fixture | null = null;
let tatasteel: Fixture | null = null;
let mm: Fixture | null = null;
let ultracemco: Fixture | null = null;

describe.sequential("SEADE — sector evidence auto-derivation (real data)", () => {
  beforeAll(async () => {
    ntpc = await loadCompany("NTPC", "utility");
    powergrid = await loadCompany("Power Grid Corporation of India Ltd", "utility");
    bharti = await loadCompany("Bharti Airtel", "telecom");
    tatasteel = await loadCompany("Tata Steel", "cyclical");
    mm = await loadCompany("Mahindra & Mahindra", "cyclical");
    ultracemco = await loadCompany("UltraTech Cement Ltd", "cyclical");
  }, 240_000);

  afterEach(() => {
    globalThis.gc?.();
  });

  it("derives a ready utility-rab case input for NTPC", () => {
    if (!ntpc) return; // data unavailable in this environment
    const res = deriveSectorCase({
      issuerId: "NTPC", companyType: "utility",
      periods: ntpc.periods, config: ntpc.config, sharesOutstandingCr: ntpc.shares,
    });
    expect(res.derived).not.toBeNull();
    expect(res.derived!.caseType).toBe("utility-rab");
    expect(res.derived!.derivationStatus).toBe("ready");
    expect(res.derived!.missingEvidence).toEqual([]);
    expect(res.onboardingRow.status).toBe("ready");
  });

  it("derived NTPC input passes executeCatalogSectorCase guards and computes a finite per-share value", () => {
    if (!ntpc) return;
    const res = deriveSectorCase({
      issuerId: "NTPC", companyType: "utility",
      periods: ntpc.periods, config: ntpc.config, sharesOutstandingCr: ntpc.shares,
    });
    expect(res.derived!.derivationStatus).toBe("ready");
    const modelId = CURRENT_SECTOR_CASE_REGISTRY.require(res.derived!.caseType).modelId;
    const exec = executeCatalogSectorCase({ modelId, input: res.derived!.inputs });
    expect(exec.status).toBe("computed");
    if (exec.status === "computed") {
      expect(Number.isFinite(exec.caseResult.equityValueCr)).toBe(true);
      expect(exec.caseResult.equityValueCr).toBeGreaterThan(0);
      expect(Number.isFinite(exec.caseResult.perShareInr)).toBe(true);
      expect(exec.caseResult.perShareInr).toBeGreaterThan(0);
      const failedBlocking = exec.caseResult.guardResults.filter((g) => g.status === "failed" && g.blocksResult);
      expect(failedBlocking).toEqual([]);
    }
  });

  it("derives a ready utility-rab case input for POWERGRID that computes", () => {
    if (!powergrid) return;
    const res = deriveSectorCase({
      issuerId: "POWERGRID", companyType: "utility",
      periods: powergrid.periods, config: powergrid.config, sharesOutstandingCr: powergrid.shares,
    });
    expect(res.derived!.derivationStatus).toBe("ready");
    const modelId = CURRENT_SECTOR_CASE_REGISTRY.require(res.derived!.caseType).modelId;
    const exec = executeCatalogSectorCase({ modelId, input: res.derived!.inputs });
    expect(exec.status).toBe("computed");
  });

  it("derivation is deterministic: same input produces identical output", () => {
    if (!ntpc) return;
    const a = deriveSectorCase({
      issuerId: "NTPC", companyType: "utility",
      periods: ntpc.periods, config: ntpc.config, sharesOutstandingCr: ntpc.shares,
    });
    const b = deriveSectorCase({
      issuerId: "NTPC", companyType: "utility",
      periods: ntpc.periods, config: ntpc.config, sharesOutstandingCr: ntpc.shares,
    });
    expect(JSON.stringify(a.derived?.inputs)).toBe(JSON.stringify(b.derived?.inputs));
  });

  it("populates provenance for every derived utility input field", () => {
    if (!ntpc) return;
    const res = deriveSectorCase({
      issuerId: "NTPC", companyType: "utility",
      periods: ntpc.periods, config: ntpc.config, sharesOutstandingCr: ntpc.shares,
    });
    expect(res.derived!.derivationStatus).toBe("ready");
    const prov = res.derived!.provenance;
    // Every numeric field of the utility input must have a provenance record.
    for (const field of [
      "regulatedRateBaseCr", "constructionWorkInProgressCr", "cwipEligibilityPct",
      "regulatoryAssetsCr", "regulatoryLiabilitiesCr", "regulatedEquityWeight",
      "allowedReturnOnEquity", "costOfEquity", "terminalGrowth", "netDebtCr",
    ] as const) {
      expect(prov[field], `missing provenance for ${field}`).toBeDefined();
      expect(prov[field]!.formula.length).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(prov[field]!.confidence);
    }
    // Rate base must be a direct observation (high confidence).
    expect(prov["regulatedRateBaseCr"]!.confidence).toBe("high");
  });

  it("telecom derivation returns insufficient-evidence (not a fabricated input) when subscriber/ARPU is unobservable", () => {
    if (!bharti) return;
    const res = deriveSectorCase({
      issuerId: "BHARTIARTL", companyType: "telecom",
      periods: bharti.periods, config: bharti.config, sharesOutstandingCr: bharti.shares,
    });
    expect(res.derived).not.toBeNull();
    expect(res.derived!.caseType).toBe("telecom-network");
    expect(res.derived!.derivationStatus).toBe("insufficient-evidence");
    expect(res.derived!.missingEvidence).toContain("telecom.subscriber-arpu");
    expect(res.onboardingRow.status).toBe("blocked");
  });

  it("returns null derived and a not-applicable onboarding row for an unsupported company type", () => {
    // Consumer companies have no SEADE derivation module (retail is a later milestone).
    const res = deriveSectorCase({
      issuerId: "DABUR", companyType: "consumer",
      periods: [], config: { ...DEFAULT_CONFIG, company_type: "consumer" }, sharesOutstandingCr: 100,
    });
    expect(res.derived).toBeNull();
    expect(res.onboardingRow.status).toBe("not-applicable");
  });

  // ── Cyclical derivation (Milestone B) ────────────────────────────────────

  it("derives a ready cyclical-mid-cycle input for ULTRACEMCO that computes a finite per-share value", () => {
    if (!ultracemco) return;
    const res = deriveSectorCase({
      issuerId: "ULTRACEMCO", companyType: "cyclical",
      periods: ultracemco.periods, config: ultracemco.config, sharesOutstandingCr: ultracemco.shares,
    });
    expect(res.derived).not.toBeNull();
    expect(res.derived!.caseType).toBe("cyclical-mid-cycle");
    expect(res.derived!.derivationStatus).toBe("ready");
    expect(res.derived!.missingEvidence).toEqual([]);
    const modelId = CURRENT_SECTOR_CASE_REGISTRY.require(res.derived!.caseType).modelId;
    const exec = executeCatalogSectorCase({ modelId, input: res.derived!.inputs });
    expect(exec.status).toBe("computed");
    if (exec.status === "computed") {
      expect(Number.isFinite(exec.caseResult.perShareInr)).toBe(true);
      expect(exec.caseResult.perShareInr).toBeGreaterThan(0);
    }
  });

  it("cyclical derivation is deterministic on TATASTEEL", () => {
    if (!tatasteel) return;
    const a = deriveSectorCase({
      issuerId: "TATASTEEL", companyType: "cyclical",
      periods: tatasteel.periods, config: tatasteel.config, sharesOutstandingCr: tatasteel.shares,
    });
    const b = deriveSectorCase({
      issuerId: "TATASTEEL", companyType: "cyclical",
      periods: tatasteel.periods, config: tatasteel.config, sharesOutstandingCr: tatasteel.shares,
    });
    expect(a.derived!.derivationStatus).toBe("ready");
    expect(JSON.stringify(a.derived?.inputs)).toBe(JSON.stringify(b.derived?.inputs));
  });

  it("heavily-leveraged cyclicals (TATASTEEL, M&M) derive ready inputs but the calculator blocks non-positive equity honestly", () => {
    // Mid-cycle FCFF DCF on these companies genuinely cannot cover their net
    // debt load — a real economic signal. SEADE derives the input (ready) and
    // the calculator fail-closed blocks the non-positive output. This is the
    // honest outcome: we surface the blocked guard, we do not suppress it.
    for (const [ticker, fx] of [["TATASTEEL", tatasteel], ["M&M", mm]] as const) {
      if (!fx) continue;
      const res = deriveSectorCase({
        issuerId: ticker, companyType: "cyclical",
        periods: fx.periods, config: fx.config, sharesOutstandingCr: fx.shares,
      });
      expect(res.derived!.derivationStatus).toBe("ready");
      const modelId = CURRENT_SECTOR_CASE_REGISTRY.require(res.derived!.caseType).modelId;
      const exec = executeCatalogSectorCase({ modelId, input: res.derived!.inputs });
      // The output guard must block (negative equity) — not compute a bad number.
      expect(exec.status).toBe("blocked");
      if (exec.status === "blocked" && exec.caseResult) {
        const failedIds = exec.caseResult.guardResults.filter((g) => g.status === "failed").map((g) => g.guardId);
        expect(failedIds).toContain("output.finite-valuation");
      }
    }
  });

  it("cyclical provenance records mid-cycle normalization rule and covers all input fields", () => {
    if (!ultracemco) return;
    const res = deriveSectorCase({
      issuerId: "ULTRACEMCO", companyType: "cyclical",
      periods: ultracemco.periods, config: ultracemco.config, sharesOutstandingCr: ultracemco.shares,
    });
    expect(res.derived!.derivationStatus).toBe("ready");
    const prov = res.derived!.provenance;
    for (const field of [
      "normalizedVolume", "cashCostPerUnit", "annualFixedCostsCr",
      "sustainingCapexCr", "cashTaxRate", "costOfOperations", "terminalGrowth", "netDebtCr",
    ] as const) {
      expect(prov[field], `missing provenance for ${field}`).toBeDefined();
      expect(prov[field]!.formula.length).toBeGreaterThan(0);
    }
    // Volume must record the median-Sales mid-cycle normalization rule.
    expect(prov["normalizedVolume"]!.formula).toMatch(/median Sales/i);
  });
});
