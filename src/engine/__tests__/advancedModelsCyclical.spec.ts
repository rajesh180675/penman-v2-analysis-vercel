/**
 * Advanced Models — Maruti Suzuki (Industrial) + HDFC Bank (Bank pipeline guard)
 *
 * @vitest-environment jsdom
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
import { computeAccountingAnchor } from "../accountingAnchor";
import { computeMertonCredit, computeRegimeConditionalValuation } from "../mertonRegimeEngine";
import { analyzeFadeRate } from "../fadeRateEngine";
import type { AllSegmentData } from "../segmentParser";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");
const MARUTI_ZIP = resolve(COMPANIES_DIR, "Maruti Suzuki", "Maruti Suzuki.zip");
const HAS_ZIPS = existsSync(MARUTI_ZIP);

// ─── Maruti Suzuki (Industrial, cyclical auto) ─────────────────────────────

describe.skipIf(!HAS_ZIPS)("Advanced Models — Maruti Suzuki (Industrial)", () => {
  let periods: RecastPeriod[];
  let segmentData: AllSegmentData | null;

  const PRICE = 13500;
  const SHARES = 31.42;  // crore shares

  beforeAll(async () => {
    const zipPath = resolve(COMPANIES_DIR, "Maruti Suzuki India Ltd", "Maruti Suzuki India Ltd.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "Maruti Suzuki India Ltd.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "industrial" };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    periods = pipeline.periods;
    segmentData = parsed.segmentData;
    expect(periods.length).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it("ERI is bounded", () => {
    const eri = computeERI(periods);
    expect(eri).not.toBeNull();
    expect(eri!.score).toBeGreaterThanOrEqual(0);
    expect(eri!.score).toBeLessThanOrEqual(100);
  });

  it("Merton Credit for low-debt industrial", () => {
    const merton = computeMertonCredit(periods);
    expect(merton).not.toBeNull();
    // Maruti is nearly debt-free
    expect(merton!.probabilityOfDefault).toBeLessThan(0.05);
    expect(merton!.distanceToDefault).toBeGreaterThan(1);
  });

  it("Fade Rate omega is reasonable for auto", () => {
    const fade = analyzeFadeRate(periods, 0.13, "industrial", segmentData?.business ?? null);
    expect(fade).not.toBeNull();
    expect(fade!.firm.omega).toBeGreaterThan(0);
    expect(fade!.firm.omega).toBeLessThanOrEqual(1);
  });

  it("Reverse DCF produces finite implied growth", () => {
    const omega = analyzeFadeRate(periods, 0.13, "industrial", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const rdcf = computeReverseDCF(periods, 0.13, omega, PRICE, SHARES);
    expect(rdcf).not.toBeNull();
    expect(Number.isFinite(rdcf!.impliedGrowth)).toBe(true);
  });

  it("Accounting Anchor produces positive layers", () => {
    const omega = analyzeFadeRate(periods, 0.13, "industrial", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const anchor = computeAccountingAnchor(periods, 0.13, omega, PRICE, SHARES);
    expect(anchor).not.toBeNull();
    expect(anchor!.layers.assetValue).toBeGreaterThan(0);
    expect(anchor!.layers.epv).toBeGreaterThan(0);
    expect(anchor!.layers.totalIntrinsic).toBeGreaterThan(0);
  });

  it("Regime-Conditional Valuation has meaningful spread", () => {
    const omega = analyzeFadeRate(periods, 0.13, "industrial", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const regime = computeRegimeConditionalValuation(periods, 0.13, omega, SHARES);
    expect(regime).not.toBeNull();
    expect(regime!.baseCase).toBeGreaterThan(0);
    expect(regime!.expansion.value).toBeGreaterThan(regime!.recession.value);
    expect(regime!.drawdownRisk).toBeGreaterThan(0);
  });

  it("Segment RNOA decomposes if segments exist", () => {
    if (!segmentData?.business) return; // skip if no segment data
    const segRNOA = decomposeSegmentRNOA(segmentData!.business!, 0.13);
    expect(segRNOA).not.toBeNull();
    expect(segRNOA!.segments.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── HDFC Bank (Bank pipeline — advanced models guard) ──────────────────────

describe.skipIf(!HAS_ZIPS)("Advanced Models — HDFC Bank (Bank pipeline guard)", () => {
  beforeAll(async () => {
    const zipPath = resolve(COMPANIES_DIR, "HDFC Bank", "HDFC Bank.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "HDFC Bank.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "bank" };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    // Bank pipeline returns 0 industrial periods — that's correct
    expect(pipeline.analysisFamily).toBe("financial-institution");
    expect(pipeline.bankResult).toBeTruthy();
  }, 60_000);

  it("ERI returns null for bank (needs RecastPeriod, not raw)", () => {
    // ERI expects RecastPeriod[] — with empty array, it returns null
    const eri = computeERI([]);
    expect(eri).toBeNull();
  });

  it("Merton Credit returns null for insufficient data (bank guard)", () => {
    // Banks route to a different pipeline — advanced models that need
    // RecastPeriod should gracefully handle empty input
    const merton = computeMertonCredit([]);
    expect(merton).toBeNull();
  });
});
