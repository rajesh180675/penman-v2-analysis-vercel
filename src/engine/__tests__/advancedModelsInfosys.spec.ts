/**
 * Advanced Models — Infosys (IT Services)
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull } from "../pipeline";
import { DEFAULT_CONFIG, RecastPeriod, EngineConfig } from "../types";
import { computePenmanExpectedReturn } from "../penmanExpectedReturn";
import { computeERI } from "../earningsReliabilityIndex";

import { computeAccountingAnchor } from "../accountingAnchor";
import { computeMertonCredit, computeRegimeConditionalValuation } from "../mertonRegimeEngine";
import { analyzeFadeRate } from "../fadeRateEngine";
import type { AllSegmentData } from "../segmentParser";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");
const ZIP_PATH = resolve(COMPANIES_DIR, "Infosys", "Infosys.zip");
const HAS_ZIP = existsSync(ZIP_PATH);

describe.skipIf(!HAS_ZIP)("Advanced Models — Infosys (IT Services)", () => {
  let periods: RecastPeriod[];
  let segmentData: AllSegmentData | null;

  const PRICE = 1580;
  const SHARES = 414.58;

  beforeAll(async () => {
    const zipPath = resolve(COMPANIES_DIR, "Infosys", "Infosys.zip");
    const buf = readFileSync(zipPath);
    const file = new File([buf], "Infosys.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "it-services" };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    periods = pipeline.periods;
    segmentData = parsed.segmentData;
    expect(periods.length).toBeGreaterThanOrEqual(5);
    // No inline timeout: this hook parses a real Capitaline ZIP and runs the
    // full pipeline, which takes ~22s isolated but exceeds 30s under the fork
    // contention of `npm run test:sharded`. Inherit the 120s hookTimeout in
    // vitest.config.ts, which exists for exactly this case.
  });

  it("ERI for a quality IT company is high", () => {
    const eri = computeERI(periods);
    expect(eri).not.toBeNull();
    expect(eri!.score).toBeGreaterThan(50);
  });

  it("Fade Rate reflects durable IT margins", () => {
    const fade = analyzeFadeRate(periods, 0.13, "it-services", segmentData?.business ?? null);
    expect(fade).not.toBeNull();
    expect(fade!.firm.omega).toBeGreaterThan(0.3);
  });

  it("Penman Expected Return reflects IT valuation", () => {
    const omega = analyzeFadeRate(periods, 0.13, "it-services", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const penman = computePenmanExpectedReturn(periods, 0.13, omega, PRICE, SHARES);
    expect(penman).not.toBeNull();
    expect(Number.isFinite(penman!.expectedReturn)).toBe(true);
  });

  it("Accounting Anchor for asset-light IT firm", () => {
    const omega = analyzeFadeRate(periods, 0.13, "it-services", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const anchor = computeAccountingAnchor(periods, 0.13, omega, PRICE, SHARES);
    expect(anchor).not.toBeNull();
    expect(anchor!.layers.assetValue).toBeGreaterThan(0);
    expect(anchor!.layers.epv).toBeGreaterThan(anchor!.layers.assetValue);
  });

  it("Merton Credit shows near-zero default for cash-rich IT", () => {
    const merton = computeMertonCredit(periods);
    expect(merton).not.toBeNull();
    expect(merton!.probabilityOfDefault).toBeLessThan(0.05);
    expect(merton!.distanceToDefault).toBeGreaterThan(1);
  });

  it("Regime-Conditional Valuation provides scenario spread", () => {
    const omega = analyzeFadeRate(periods, 0.13, "it-services", segmentData?.business ?? null)?.firm.omega ?? 0.55;
    const regime = computeRegimeConditionalValuation(periods, 0.13, omega, SHARES);
    expect(regime).not.toBeNull();
    expect(regime!.baseCase).toBeGreaterThan(0);
    expect(regime!.expansion.value).toBeGreaterThan(regime!.recession.value);
  });
});
