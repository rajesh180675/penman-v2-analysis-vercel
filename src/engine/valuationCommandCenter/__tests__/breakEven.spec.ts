import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG } from "../../types";
import { INRAbsolute } from "../../types/units";
import { buildValuationCommandCenter } from "../core";
import { baseValueWithShift, revalueBase, solveBreakEven, solveBreakEvens } from "../breakEven";

const FOLDER = "Tata Consultancy Services Ltd";
let cc: ReturnType<typeof buildValuationCommandCenter>;

beforeAll(async () => {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: FOLDER });
  const config = { ...DEFAULT_CONFIG, company_type: "it-services" as const, market_price: INRAbsolute(3100) };
  cc = buildValuationCommandCenter({ data: processCompanyDataFull(parsed.periods, config).periods, config, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-09-26" });
}, 120_000);

describe("break-even drivers", () => {
  it("reproduces the base card's value exactly with no shift", () => {
    const base = cc.scenarios.find((s) => s.key === "base")!;
    expect(base.intrinsicPerShare).not.toBeNull();
    for (const driver of ["sales_growth", "core_sales_pm", "ke"] as const) {
      expect(baseValueWithShift(cc, driver, 0)).toBeCloseTo(base.intrinsicPerShare!, 9);
    }
  });

  it("moves value the economically right way", () => {
    const at = (driver: "sales_growth" | "core_sales_pm" | "ke", d: number) => baseValueWithShift(cc, driver, d)!;
    expect(at("sales_growth", 0.02)).toBeGreaterThan(at("sales_growth", 0));
    expect(at("core_sales_pm", 0.02)).toBeGreaterThan(at("core_sales_pm", 0));
    expect(at("ke", 0.01)).toBeLessThan(at("ke", 0));
  });

  it("finds, for each driver, the value at which the base case equals the price", () => {
    for (const result of solveBreakEvens(cc)) {
      if (result.breakEven == null) {
        expect(result.reason).toBe("beyond-range");
        continue;
      }
      const value = baseValueWithShift(cc, result.driver, result.breakEven - result.base)!;
      expect(value).toBeCloseTo(cc.marketPrice!, 2);
    }
  });

  it("re-values with several shifts at once and returns the forecast behind the value", () => {
    const base = revalueBase(cc)!;
    const shifted = revalueBase(cc, { sales_growth: 0.02, core_sales_pm: -0.01 })!;
    const card = cc.scenarios.find((s) => s.key === "base")!;
    expect(base.value).toBeCloseTo(card.intrinsicPerShare!, 9);
    expect(base.forecast).toHaveLength(card.scenario.horizonT);
    // Year-1 sales follow the shifted growth from the anchor's sales.
    const g1 = card.scenario.drivers.sales_growth[0]!;
    expect(shifted.forecast![0]!.Sales_f).toBeCloseTo(cc.anchorPeriod.is.Sales * (1 + g1 + 0.02), 6);
    expect(shifted.forecast![0]!.core_sales_pm_assumption).toBeCloseTo(card.scenario.drivers.core_sales_pm[0]! - 0.01, 12);
  });

  it("moves value with terminal growth, and refuses a terminal growth at or above the discount rate", () => {
    expect(revalueBase(cc, { g: 0.01 })!.value!).toBeGreaterThan(revalueBase(cc)!.value!);
    const card = cc.scenarios.find((s) => s.key === "base")!;
    expect(revalueBase(cc, { g: card.assumptions.ke - card.assumptions.g })!.value).toBeNull();
  });

  it("refuses to solve without a price", () => {
    expect(solveBreakEven({ ...cc, marketPrice: null }, "ke")).toMatchObject({ breakEven: null, reason: "no-price" });
  });

  it("reports a price no plausible driver reaches as beyond range, not a number", () => {
    expect(solveBreakEven({ ...cc, marketPrice: 1e9 }, "core_sales_pm")).toMatchObject({ breakEven: null, reason: "beyond-range" });
  });
});
