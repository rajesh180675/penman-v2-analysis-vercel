import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../types";
import { INRAbsolute } from "../../types/units";
import * as synthesisModule from "../synthesis";
import { buildValuationCommandCenter } from "../core";

// Asian Paints with a market price, so the price-dependent evidence is built.
const FOLDER = "Asian Paints";
const CONFIG = { ...DEFAULT_CONFIG, market_price: INRAbsolute(2400) };
let data: RecastPeriod[];

beforeAll(async () => {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: FOLDER });
  data = processCompanyDataFull(parsed.periods, CONFIG).periods;
}, 120_000);

function captured() {
  const spy = vi.spyOn(synthesisModule, "runValuationSynthesis");
  const cc = buildValuationCommandCenter({ data, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30" });
  expect(spy).toHaveBeenCalledTimes(1);
  const input = spy.mock.calls[0]![0];
  spy.mockRestore();
  return { cc, input };
}

describe("valuation synthesis stage", () => {
  it("is what the command center reports: the evidence and the headline, from the stage's own inputs", () => {
    const { cc, input } = captured();
    const synthesis = synthesisModule.runValuationSynthesis(input);
    expect(synthesis.stageVersion).toBe(synthesisModule.VALUATION_SYNTHESIS_STAGE_VERSION);
    expect(synthesis.valuationTriangulation).toEqual(cc.valuationTriangulation);
    expect(synthesis.evidenceLedger).toEqual(cc.evidenceLedger);
    expect(synthesis.forecastHoldout).toEqual(cc.forecastHoldout);
    expect(synthesis.marketImpliedExpectations).toEqual(cc.marketImpliedExpectations);
    expect(synthesis.evidenceWeightedSynthesis).toEqual(cc.evidenceWeightedSynthesis);
    // A headline was synthesized, not left empty.
    expect(cc.evidenceWeightedSynthesis.intrinsicRange.midPerShare).not.toBeNull();
  });

  it("sets its per-share lenses against the price it is given", () => {
    const { input } = captured();
    const base = synthesisModule.runValuationSynthesis(input);
    const halved = synthesisModule.runValuationSynthesis({ ...input, priceOnValuationShares: input.priceOnValuationShares! / 2 });
    expect(halved.evidenceWeightedSynthesis).not.toEqual(base.evidenceWeightedSynthesis);
    // The models it synthesizes are its input, unchanged by it.
    expect(halved.evidenceLedger).toEqual(base.evidenceLedger);
  });
});
