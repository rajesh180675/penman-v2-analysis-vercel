/**
 * Advanced Models — Reliance Industries + Tata Steel
 *
 * @vitest-environment jsdom
 *
 * These companies previously misrouted to the bank pipeline because their
 * consolidated data contains financial subsidiary signals. The scope policy
 * fix (unconditional manual override) ensures they run through Penman-Nissim.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull } from "../pipeline";
import { DEFAULT_CONFIG, RecastPeriod, EngineConfig } from "../types";
import { decomposeSegmentRNOA } from "../segmentRNOAEngine";
import { computeERI } from "../earningsReliabilityIndex";
import { computeReverseDCF } from "../reverseDCF";
import { analyzeCapitalAllocation } from "../capitalAllocationEngine";
import { computeMertonCredit, computeRegimeConditionalValuation } from "../mertonRegimeEngine";
import { analyzeFadeRate } from "../fadeRateEngine";
import type { AllSegmentData } from "../segmentParser";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");
const TATA_ZIP = resolve(COMPANIES_DIR, "Tata Steel", "Tata Steel.zip");
const HAS_ZIPS = existsSync(TATA_ZIP);

// ─── Tata Steel (Cyclical — has financial subsidiary signals) ───────────────

describe.skipIf(!HAS_ZIPS)("Advanced Models — Tata Steel (Cyclical, scope fix)", () => {
  let periods: RecastPeriod[];
  let segmentData: AllSegmentData | null;

  const PRICE = 145;
  const SHARES = 1215.29;

  beforeAll(async () => {
    const zipPath = resolve(COMPANIES_DIR, "Tata Steel", "Tata Steel.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "Tata Steel.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    // Previously this misrouted to financial-institution. Now user choice is law.
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "cyclical" };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    periods = pipeline.periods;
    segmentData = parsed.segmentData;
    expect(pipeline.analysisFamily).toBe("industrial");
    expect(periods.length).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it("ERI handles cyclical volatility", () => {
    const eri = computeERI(periods);
    expect(eri).not.toBeNull();
    expect(eri!.score).toBeGreaterThanOrEqual(0);
    expect(eri!.score).toBeLessThanOrEqual(100);
  });

  it("Merton Credit reflects leveraged cyclical", () => {
    const merton = computeMertonCredit(periods);
    expect(merton).not.toBeNull();
    expect(merton!.probabilityOfDefault).toBeGreaterThan(0);
    expect(merton!.distanceToDefault).toBeGreaterThan(0);
  });

  it("Fade Rate omega is bounded", () => {
    const fade = analyzeFadeRate(periods, 0.13, "cyclical", segmentData?.business ?? null);
    expect(fade).not.toBeNull();
    expect(fade!.firm.omega).toBeGreaterThan(0);
    expect(fade!.firm.omega).toBeLessThanOrEqual(1);
  });

  it("Reverse DCF produces finite result", () => {
    const omega = analyzeFadeRate(periods, 0.13, "cyclical", segmentData?.business ?? null)?.firm.omega ?? 0.45;
    const rdcf = computeReverseDCF(periods, 0.13, omega, PRICE, SHARES);
    expect(rdcf).not.toBeNull();
    expect(Number.isFinite(rdcf!.impliedGrowth)).toBe(true);
  });
});

// ─── Reliance Industries (Conglomerate — has NBFC subsidiary signals) ───────

describe.skipIf(!HAS_ZIPS)("Advanced Models — Reliance Industries (Conglomerate, scope fix)", () => {
  let periods: RecastPeriod[];
  let segmentData: AllSegmentData | null;

  const PRICE = 1400;
  const SHARES = 677.02;

  beforeAll(async () => {
    const zipPath = resolve(COMPANIES_DIR, "Reliance Industries", "Reliance Industries.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "Reliance Industries.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    // "industrial" now unconditionally routes to Penman-Nissim
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "industrial" };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    periods = pipeline.periods;
    segmentData = parsed.segmentData;
    expect(pipeline.analysisFamily).toBe("industrial");
    expect(periods.length).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it("Segment RNOA decomposes Reliance segments", () => {
    expect(segmentData?.business).toBeTruthy();
    const segRNOA = decomposeSegmentRNOA(segmentData!.business!, 0.13);
    expect(segRNOA).not.toBeNull();
    expect(segRNOA!.segments.length).toBeGreaterThanOrEqual(3);
    const rnoas = segRNOA!.segments.map(s => s.rnoa);
    expect(Math.max(...rnoas) - Math.min(...rnoas)).toBeGreaterThan(0);
  });

  it("Capital Allocation scores segment deployment", () => {
    expect(segmentData?.business).toBeTruthy();
    const capAlloc = analyzeCapitalAllocation(segmentData!.business!, 0.13);
    expect(capAlloc).not.toBeNull();
    expect(capAlloc!.segments.length).toBeGreaterThanOrEqual(3);
    expect(capAlloc!.firmLevel.capitalEfficiencyScore).toBeGreaterThanOrEqual(0);
  });

  it("Reverse DCF produces finite implied growth", () => {
    const omega = analyzeFadeRate(periods, 0.13, "industrial", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const rdcf = computeReverseDCF(periods, 0.13, omega, PRICE, SHARES);
    expect(rdcf).not.toBeNull();
    expect(Number.isFinite(rdcf!.impliedGrowth)).toBe(true);
  });

  it("Merton Credit reflects moderate leverage", () => {
    const merton = computeMertonCredit(periods);
    expect(merton).not.toBeNull();
    expect(merton!.distanceToDefault).toBeGreaterThan(0);
    expect(merton!.probabilityOfDefault).toBeLessThan(0.3);
  });

  it("Regime-Conditional Valuation spans expansion/recession", () => {
    const omega = analyzeFadeRate(periods, 0.13, "industrial", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const regime = computeRegimeConditionalValuation(periods, 0.13, omega, SHARES);
    expect(regime).not.toBeNull();
    expect(regime!.baseCase).toBeGreaterThan(0);
    expect(regime!.expansion.value).toBeGreaterThan(regime!.recession.value);
  });
});
