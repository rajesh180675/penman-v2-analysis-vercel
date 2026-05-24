/**
 * Advanced Models — ITC (Conglomerate with segments)
 *
 * @vitest-environment jsdom
 *
 * Verifies all Sprint 1 advanced models produce valid results for ITC.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull, PipelineResult } from "../pipeline";
import { DEFAULT_CONFIG, RecastPeriod, EngineConfig } from "../types";
import { decomposeSegmentRNOA } from "../segmentRNOAEngine";
import { computePenmanExpectedReturn } from "../penmanExpectedReturn";
import { computeERI } from "../earningsReliabilityIndex";
import { computeReverseDCF } from "../reverseDCF";
import { computeAccountingAnchor } from "../accountingAnchor";
import { analyzeCapitalAllocation, measureConglomerateDiscount, detectTransferPricingDistortion } from "../capitalAllocationEngine";
import { computeMertonCredit, computeRegimeConditionalValuation } from "../mertonRegimeEngine";
import { analyzeFadeRate } from "../fadeRateEngine";
import type { AllSegmentData } from "../segmentParser";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");
const ZIP_PATH = resolve(COMPANIES_DIR, "ITC", "ITC.zip");
const HAS_ZIP = existsSync(ZIP_PATH);

describe.skipIf(!HAS_ZIP)("Advanced Models — ITC (Conglomerate)", () => {
  let periods: RecastPeriod[];
  let segmentData: AllSegmentData | null;
  let pipeline: PipelineResult;

  const PRICE = 440;
  const SHARES = 1248.85;

  beforeAll(async () => {
    const zipPath = resolve(COMPANIES_DIR, "ITC", "ITC.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "ITC.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "consumer" };
    pipeline = processCompanyDataFull(parsed.periods, config);
    periods = pipeline.periods;
    segmentData = parsed.segmentData;
    expect(periods.length).toBeGreaterThanOrEqual(5);
  }, 90_000);

  it("pipeline routes to industrial family", () => {
    expect(pipeline.analysisFamily).toBe("industrial");
    expect(pipeline.periods.length).toBeGreaterThanOrEqual(5);
  });

  it("ERI produces valid score", () => {
    const eri = computeERI(periods);
    expect(eri).not.toBeNull();
    expect(eri!.score).toBeGreaterThan(0);
    expect(eri!.score).toBeLessThanOrEqual(100);
    expect(eri!.score).toBeGreaterThan(40);
  });

  it("Fade Rate produces omega", () => {
    const fade = analyzeFadeRate(periods, 0.13, "consumer", segmentData?.business ?? null);
    expect(fade).not.toBeNull();
    expect(fade!.firm.omega).toBeGreaterThan(0);
    expect(fade!.firm.omega).toBeLessThanOrEqual(1);
    expect(fade!.firm.confidence).toBeTruthy();
  });

  it("Merton Credit produces PD and distance-to-default", () => {
    const merton = computeMertonCredit(periods);
    expect(merton).not.toBeNull();
    expect(merton!.probabilityOfDefault).toBeGreaterThanOrEqual(0);
    expect(merton!.probabilityOfDefault).toBeLessThanOrEqual(1);
    expect(merton!.distanceToDefault).toBeGreaterThan(0);
    expect(merton!.probabilityOfDefault).toBeLessThan(0.1);
  });

  it("Segment RNOA decomposes business segments", () => {
    expect(segmentData?.business).toBeTruthy();
    const segRNOA = decomposeSegmentRNOA(segmentData!.business!, 0.13);
    expect(segRNOA).not.toBeNull();
    expect(segRNOA!.segments.length).toBeGreaterThanOrEqual(2);
    for (const seg of segRNOA!.segments) {
      expect(seg.name).toBeTruthy();
      expect(seg.revenue).toBeGreaterThan(0);
      expect(typeof seg.opm).toBe("number");
      expect(typeof seg.ato).toBe("number");
      expect(typeof seg.rnoa).toBe("number");
      expect(["star", "margin_fortress", "volume_play", "dog"]).toContain(seg.quadrant);
      expect(["startup", "growth", "mature", "decline"]).toContain(seg.lifecycle);
    }
  });

  it("Penman Expected Return produces E[R]", () => {
    const omega = analyzeFadeRate(periods, 0.13, "consumer", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const penman = computePenmanExpectedReturn(periods, 0.13, omega, PRICE, SHARES);
    expect(penman).not.toBeNull();
    expect(typeof penman!.expectedReturn).toBe("number");
    expect(penman!.expectedReturn).toBeGreaterThan(-0.5);
    expect(penman!.expectedReturn).toBeLessThan(1.0);
  });

  it("Reverse DCF produces implied growth", () => {
    const omega = analyzeFadeRate(periods, 0.13, "consumer", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const rdcf = computeReverseDCF(periods, 0.13, omega, PRICE, SHARES);
    expect(rdcf).not.toBeNull();
    expect(typeof rdcf!.impliedGrowth).toBe("number");
    expect(Number.isFinite(rdcf!.impliedGrowth)).toBe(true);
  });

  it("Accounting Anchor produces valuation layers", () => {
    const omega = analyzeFadeRate(periods, 0.13, "consumer", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const anchor = computeAccountingAnchor(periods, 0.13, omega, PRICE, SHARES);
    expect(anchor).not.toBeNull();
    expect(anchor!.layers.assetValue).toBeGreaterThan(0);
    expect(anchor!.layers.epv).toBeGreaterThan(0);
    expect(typeof anchor!.layers.growthValue).toBe("number");
    expect(anchor!.layers.totalIntrinsic).toBeGreaterThan(0);
    expect(anchor!.marketPrice).toBe(PRICE);
  });

  it("Capital Allocation scores segment capital deployment", () => {
    expect(segmentData?.business).toBeTruthy();
    const capAlloc = analyzeCapitalAllocation(segmentData!.business!, 0.13);
    expect(capAlloc).not.toBeNull();
    expect(capAlloc!.segments.length).toBeGreaterThanOrEqual(2);
    expect(capAlloc!.firmLevel.capitalEfficiencyScore).toBeGreaterThanOrEqual(0);
    expect(capAlloc!.firmLevel.capitalEfficiencyScore).toBeLessThanOrEqual(100);
    expect(["excellent", "good", "poor", "value_destructive"]).toContain(capAlloc!.firmLevel.allocationQuality);
  });

  it("Conglomerate Discount measures holding discount/premium", () => {
    expect(segmentData?.business).toBeTruthy();
    const congDisc = measureConglomerateDiscount(segmentData!.business!, PRICE, SHARES);
    expect(congDisc).not.toBeNull();
    expect(typeof congDisc!.discountPct).toBe("number");
    expect(Number.isFinite(congDisc!.discountPct)).toBe(true);
    expect(congDisc!.impliedSOTPValue).toBeGreaterThan(0);
  });

  it("Transfer Pricing detects distortions (may be empty)", () => {
    expect(segmentData?.business).toBeTruthy();
    const tp = detectTransferPricingDistortion(segmentData!.business!);
    expect(Array.isArray(tp)).toBe(true);
    for (const flag of tp) {
      expect(flag.segment).toBeTruthy();
      expect(["info", "warning", "critical"]).toContain(flag.severity);
    }
  });

  it("Regime-Conditional Valuation produces expansion/recession scenarios", () => {
    const omega = analyzeFadeRate(periods, 0.13, "consumer", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const regime = computeRegimeConditionalValuation(periods, 0.13, omega, SHARES);
    expect(regime).not.toBeNull();
    expect(regime!.baseCase).toBeGreaterThan(0);
    expect(regime!.expansion.value).toBeGreaterThan(0);
    expect(regime!.recession.value).toBeGreaterThan(0);
    expect(regime!.expansion.value).toBeGreaterThan(regime!.recession.value);
    expect(regime!.drawdownRisk).toBeGreaterThan(0);
    expect(["expansion", "late_cycle", "recession", "recovery"]).toContain(regime!.currentRegime);
  });
});
