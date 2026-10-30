import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../types";
import { INRAbsolute } from "../../types/units";
import * as modelsModule from "../models";
import { buildValuationCommandCenter } from "../core";

// Asian Paints with a market price, so every price-dependent model is valued.
const FOLDER = "Asian Paints";
const CONFIG = { ...DEFAULT_CONFIG, market_price: INRAbsolute(2400) };
let data: RecastPeriod[];

beforeAll(async () => {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: FOLDER });
  data = processCompanyDataFull(parsed.periods, CONFIG).periods;
}, 120_000);

describe("valuation models stage", () => {
  it("is what the command center reports: every model, from the stage's own inputs", () => {
    const spy = vi.spyOn(modelsModule, "runValuationModels");
    const cc = buildValuationCommandCenter({ data, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30" });
    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0]![0];
    spy.mockRestore();

    // Run on its own, from the inputs the command center gave it.
    const models = modelsModule.runValuationModels(input);
    expect(models.stageVersion).toBe(modelsModule.VALUATION_MODELS_STAGE_VERSION);
    expect(models.scenarios).toEqual(cc.scenarios);
    expect(models.reverseDcf).toEqual(cc.reverseDcf);
    expect(models.sotpResult).toEqual(cc.sotp);
    expect(models.conglomerateAssessment).toEqual(cc.conglomerate);
    expect(models.evEbitda).toEqual(cc.evEbitda);
    expect(models.workingCapitalGate).toEqual(cc.workingCapitalGate);
    expect(models.cleanSurplus).toEqual(cc.cleanSurplus);
    expect(models.damodaranCapm).toEqual(cc.damodaranCapm);
    expect(models.reverseDcfMonteCarlo).toEqual(cc.reverseDcfMonteCarlo);
    expect(models.cashFlowDcf).toEqual(cc.cashFlowDcf);
    expect(models.epv).toEqual(cc.epv);
    // Every price-dependent model was valued against the price, not skipped.
    expect(cc.epv?.marginOfSafety).not.toBeNull();
    expect(cc.reverseDcf.impliedOwnerEarningsGrowth).not.toBeNull();
  });

  it("values each card at the ke its forecast case was built on, not the stage's", () => {
    const spy = vi.spyOn(modelsModule, "runValuationModels");
    buildValuationCommandCenter({ data, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30" });
    const input = spy.mock.calls[0]![0];
    spy.mockRestore();
    const base = modelsModule.runValuationModels(input);
    const higher = modelsModule.runValuationModels({ ...input, costOfCapital: { ...input.costOfCapital, ke: input.costOfCapital.ke + 0.02 } });
    expect(higher.scenarios.map((card) => card.intrinsicPerShare)).toEqual(base.scenarios.map((card) => card.intrinsicPerShare));
  });
});
