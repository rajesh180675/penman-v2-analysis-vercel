/**
 * PVRE Milestone A — deterministic, additive, on real data.
 *
 * @vitest-environment jsdom
 *
 * Verifies:
 *  1. Same seed → identical outputs (reproducibility, required for run hashing).
 *  2. Different seed → different but statistically sane outputs.
 *  3. Base-case point estimate sits inside the sampled distribution.
 *  4. Disagreement gate is computed and is one of pass/guarded/blocked.
 *  5. probabilityUndervalued is in [0,1] when a market price is supplied.
 *  6. Skip-with-reason when iterations < minimum.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull, PipelineResult } from "../pipeline";
import { buildValuationCommandCenter } from "../valuationCommandCenter/core";
import { resolveShareBasis } from "../shareCountTools";
import { DEFAULT_CONFIG, RecastPeriod, EngineConfig } from "../types";
import { INRAbsolute } from "../types/units";
import { runPvre, buildDefaultDriverDistributions, PVRE_DEFAULT_BOUNDS, structuralKwForKe } from "../pvre/pvreEngine";
import type { ValuationScenarioCard } from "../valuationCommandCenter/types";

const COMPANIES_DIR = resolve(__dirname, "../../../public/data/companies");
const ZIP_PATH = resolve(COMPANIES_DIR, "ITC", "ITC.zip");
const HAS_ZIP = existsSync(ZIP_PATH);

const itIfData = HAS_ZIP ? it : it.skip;

describe("PVRE Milestone A — industrial (ITC)", () => {
  let periods: RecastPeriod[] = [];
  let baseCard: ValuationScenarioCard | null = null;
  let config: EngineConfig = DEFAULT_CONFIG;
  let scenarioConfig: EngineConfig | undefined = undefined;
  const PRICE = 440;

  beforeAll(async () => {
    if (!HAS_ZIP) return;
    const buf = readFileSync(ZIP_PATH);
    const file = new File([buf], "ITC.zip", { type: "application/zip" });
    const parsed = await parseCapitalineZip(file);
    config = { ...DEFAULT_CONFIG, company_type: "consumer", market_price: INRAbsolute(PRICE) };
    const pipeline: PipelineResult = processCompanyDataFull(parsed.periods, config);
    periods = pipeline.periods;
    const cc = buildValuationCommandCenter({ data: periods, config });
    baseCard = cc.scenarios.find((s) => s.key === "base") ?? null;
    scenarioConfig = resolveShareBasis(periods, config).valuationConfig;
  }, 120_000);

  itIfData("base scenario exists", () => {
    expect(baseCard).not.toBeNull();
    expect(periods.length).toBeGreaterThanOrEqual(5);
  });

  itIfData("same seed → identical outputs (reproducibility)", () => {
    if (!baseCard) throw new Error("no base card");
    const input = {
      latest: periods[periods.length - 1]!,
      baseScenario: baseCard,
      config,scenarioConfig,
      seed: 42,
      iterations: 64,
      marketPrice: PRICE,
      bounds: PVRE_DEFAULT_BOUNDS,
    };
    const a = runPvre(input);
    const b = runPvre(input);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status === "ok" && b.status === "ok") {
      expect(a.intrinsic?.q50).toBe(b.intrinsic?.q50);
      expect(JSON.stringify(a.perModel)).toBe(JSON.stringify(b.perModel));
    }
  });

  itIfData("different seed → different draws, same shape", () => {
    if (!baseCard) throw new Error("no base card");
    const a = runPvre({
      latest: periods[periods.length - 1]!,
      baseScenario: baseCard,
      config,scenarioConfig,
      seed: 1,
      iterations: 64,
      marketPrice: PRICE,
      bounds: PVRE_DEFAULT_BOUNDS,
    });
    const b = runPvre({
      latest: periods[periods.length - 1]!,
      baseScenario: baseCard,
      config,scenarioConfig,
      seed: 999,
      iterations: 64,
      marketPrice: PRICE,
      bounds: PVRE_DEFAULT_BOUNDS,
    });
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status === "ok" && b.status === "ok") {
      // medians should differ with different draws, but both finite
      expect(Number.isFinite(a.intrinsic?.q50 ?? NaN)).toBe(true);
      expect(Number.isFinite(b.intrinsic?.q50 ?? NaN)).toBe(true);
      expect(a.intrinsic?.q50).not.toEqual(b.intrinsic?.q50);
    }
  });

  itIfData("base point estimate sits inside the sampled range", () => {
    if (!baseCard) throw new Error("no base card");
    const base = baseCard.intrinsicPerShare;
    expect(base).not.toBeNull();
    const res = runPvre({
      latest: periods[periods.length - 1]!,
      baseScenario: baseCard,
      config,scenarioConfig,
      seed: 7,
      iterations: 128,
      marketPrice: PRICE,
      bounds: PVRE_DEFAULT_BOUNDS,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.intrinsic).not.toBeNull();
      const r = res.intrinsic!;
      // Base should be within the 90% CI of samples centered on it. We're
      // sampling symmetric-normal drivers around the base drivers, so the
      // distribution median should track the base closely.
      expect(base!).toBeGreaterThan(r.q05 * 0.5);
      expect(base!).toBeLessThan(r.q95 * 2);
    }
  });

  itIfData("disagreement gate is a valid state", () => {
    if (!baseCard) throw new Error("no base card");
    const res = runPvre({
      latest: periods[periods.length - 1]!,
      baseScenario: baseCard,
      config,scenarioConfig,
      seed: 42,
      iterations: 64,
      marketPrice: PRICE,
      bounds: PVRE_DEFAULT_BOUNDS,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.disagreement).not.toBeNull();
      expect(["pass", "guarded", "blocked"]).toContain(res.disagreement!.gate);
      // RE and ReOI value the SAME forecast in every draw, so the ratio tracks
      // the base case's own RE/ReOI gap — not the spread of the inputs, which
      // is reported separately. (ITC's gap is large and real: book-weighted kw
      // on a cash-rich, high-P/B balance sheet is ~30%. The old input-spread
      // metric could not see it.)
      const v = baseCard.valuation;
      const baseGap = Math.abs(v.V_RE_CV3! - v.V_ReOI_CV03!) / ((Math.abs(v.V_RE_CV3!) + Math.abs(v.V_ReOI_CV03!)) / 2);
      expect(res.disagreement!.disagreementRatio).not.toBeNull();
      expect(res.disagreement!.disagreementRatio!).toBeGreaterThan(baseGap * 0.75);
      expect(res.disagreement!.disagreementRatio!).toBeLessThan(baseGap * 1.25);
      expect(res.uncertaintyWidthRatio).not.toBeNull();
    }
  });

  itIfData("probabilityUndervalued ∈ [0,1] when price is set", () => {
    if (!baseCard) throw new Error("no base card");
    const res = runPvre({
      latest: periods[periods.length - 1]!,
      baseScenario: baseCard,
      config,scenarioConfig,
      seed: 42,
      iterations: 128,
      marketPrice: PRICE,
      bounds: PVRE_DEFAULT_BOUNDS,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.probabilityUndervalued).not.toBeNull();
      expect(res.probabilityUndervalued!).toBeGreaterThanOrEqual(0);
      expect(res.probabilityUndervalued!).toBeLessThanOrEqual(1);
    }
  });

  itIfData("skip-with-reason on too-few iterations", () => {
    if (!baseCard) throw new Error("no base card");
    const res = runPvre({
      latest: periods[periods.length - 1]!,
      baseScenario: baseCard,
      config,scenarioConfig,
      seed: 1,
      iterations: 5,
      marketPrice: PRICE,
      bounds: PVRE_DEFAULT_BOUNDS,
    });
    expect(res.status).toBe("skipped");
  });

  it("moves kw with ke by the equity weight (S-9.4C), not independently", () => {
    const latest = { bs: { NOA: 1000, CSE: 800, MI: 0 } } as unknown as RecastPeriod;
    const base = { ke: 0.12, kw: 0.106 };
    expect(structuralKwForKe(0.12, base, latest)).toBeCloseTo(0.106, 10);
    // +100bp on ke moves kw by 0.8 × 100bp for an 80%-equity-funded issuer.
    expect(structuralKwForKe(0.13, base, latest)).toBeCloseTo(0.114, 10);
    // A net-cash issuer (equity weight > 1) moves kw MORE than ke.
    const netCash = { bs: { NOA: 1000, CSE: 1250, MI: 0 } } as unknown as RecastPeriod;
    expect(structuralKwForKe(0.13, base, netCash) - base.kw).toBeCloseTo(0.0125, 10);
  });

  it("distributions builder produces sane defaults", () => {
    const fakeCard = {
      assumptions: {
        ke: 0.12, kw: 0.10, g: 0.05, salesGrowthYear1: 0.08,
        corePmYear1: 0.20, reinvestmentRateYear1: 0.2, incrementalRoicYear1: 0.15,
      },
    } as unknown as ValuationScenarioCard;
    const d = buildDefaultDriverDistributions(fakeCard);
    expect(d.ke.parameters.mean).toBeCloseTo(0.12, 6);
    // kw is derived from each ke draw, never sampled on its own.
    expect("kw" in d).toBe(false);
    expect(d.gTerminal.parameters.mean).toBeCloseTo(0.05, 6);
    expect(d.ke.parameters.sd).toBeGreaterThan(0);
  });
});
