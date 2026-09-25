import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG } from "../../types";
import { INRAbsolute } from "../../types/units";
import { buildValuationCommandCenter } from "../core";
import { baseValueWithShift, solveBreakEven, solveBreakEvens } from "../breakEven";

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

  it("refuses to solve without a price", () => {
    expect(solveBreakEven({ ...cc, marketPrice: null }, "ke")).toMatchObject({ breakEven: null, reason: "no-price" });
  });

  it("reports a price no plausible driver reaches as beyond range, not a number", () => {
    expect(solveBreakEven({ ...cc, marketPrice: 1e9 }, "core_sales_pm")).toMatchObject({ breakEven: null, reason: "beyond-range" });
  });
});
