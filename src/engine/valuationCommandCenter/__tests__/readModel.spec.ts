import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG, type RecastPeriod } from "../../types";
import { INRAbsolute } from "../../types/units";
import * as readModelModule from "../readModel";
import { buildValuationCommandCenter } from "../core";

// Asian Paints with a market price, so the signal and opportunity are scored.
const FOLDER = "Asian Paints";
const CONFIG = { ...DEFAULT_CONFIG, market_price: INRAbsolute(2400) };
let data: RecastPeriod[];

beforeAll(async () => {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: FOLDER });
  data = processCompanyDataFull(parsed.periods, CONFIG).periods;
}, 120_000);

function captured() {
  const spy = vi.spyOn(readModelModule, "buildValuationReadModel");
  const cc = buildValuationCommandCenter({ data, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-30" });
  expect(spy).toHaveBeenCalledTimes(1);
  const input = spy.mock.calls[0]![0];
  spy.mockRestore();
  return { cc, input };
}

describe("valuation read model", () => {
  it("is the command center's output but the backtest, from the stages' outputs alone", () => {
    const { cc, input } = captured();
    const { backtest: _backtest, ...withoutBacktest } = cc;
    expect(readModelModule.buildValuationReadModel(input)).toEqual(withoutBacktest);
    expect(cc.signal.label).not.toBe("");
  });

  it("reports the stages' values and does not value anything of its own", () => {
    const { input } = captured();
    const view = readModelModule.buildValuationReadModel(input);
    expect(view.scenarios).toBe(input.models.scenarios);
    expect(view.epv).toBe(input.models.epv);
    expect(view.evidenceWeightedSynthesis).toBe(input.synthesis.evidenceWeightedSynthesis);
    expect(view.costOfCapital).toBe(input.basis.costOfCapital);
  });

  it("scores the signal against the price it is given", () => {
    const { input } = captured();
    const base = readModelModule.buildValuationReadModel(input);
    // No price: a kill switch, so the signal can only be guarded or blocked.
    const unpriced = readModelModule.buildValuationReadModel({ ...input, basis: { ...input.basis, marketPrice: null } });
    expect(unpriced.signal.killSwitches).toContain("Current market price is unavailable.");
    expect(["guarded", "blocked"]).toContain(unpriced.signal.state);
    expect(base.signal.killSwitches).not.toContain("Current market price is unavailable.");
  });
});
